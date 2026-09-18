import postgres from "postgres";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type MigrationFile = {
  version: string;
  path: string;
};

type MigrationSqlClient = {
  unsafe<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    params?: unknown[],
  ): Promise<T[]>;
  begin<T>(callback: (tx: MigrationSqlClient) => Promise<T>): Promise<T>;
  end?(): Promise<void>;
};

const migrationsDir = fileURLToPath(new URL("./migrations", import.meta.url));

const compatibleMigrationChecksums = new Map<string, ReadonlySet<string>>([
  [
    "0000_initial.sql",
    new Set([
      // Production applied the incremental pre-open-source baseline before the
      // migrations were consolidated into the current fresh-install schema.
      "810f69208c81f8190c42d05a42a177010132e237275395a0a05e72356e041236",
    ]),
  ],
]);

export function migrationChecksumMatches(
  version: string,
  recorded: string,
  expected: string,
): boolean {
  return (
    recorded === expected ||
    compatibleMigrationChecksums.get(version)?.has(recorded) === true
  );
}

export async function listMigrationFiles(
  directory = migrationsDir,
): Promise<MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => ({
      version: entry.name,
      path: join(directory, entry.name),
    }))
    .sort((left, right) => left.version.localeCompare(right.version));
}

export function getPendingMigrations(
  migrations: MigrationFile[],
  appliedVersions: Set<string>,
): MigrationFile[] {
  return migrations.filter(
    (migration) => !appliedVersions.has(migration.version),
  );
}

export async function runDatabaseMigrations(
  client: MigrationSqlClient,
  directory = migrationsDir,
): Promise<void> {
  await client.unsafe(
    "select pg_advisory_lock(hashtext('cooee_schema_migrations'))",
  );
  try {
    const migrations = await listMigrationFiles(directory);

    await client.unsafe(`
      create table if not exists schema_migrations (
        version text primary key,
        checksum text,
        applied_at timestamptz not null default now()
      )
    `);

    const appliedRows = await client.unsafe<{
      version: string;
      checksum: string | null;
    }>("select version, checksum from schema_migrations");
    const appliedVersions = new Set(appliedRows.map((row) => row.version));
    const migrationChecksums = new Map<string, string>();
    for (const migration of migrations) {
      migrationChecksums.set(
        migration.version,
        await sha256(await Bun.file(migration.path).text()),
      );
    }
    for (const row of appliedRows) {
      const expected = migrationChecksums.get(row.version);
      if (!expected) continue;
      if (
        row.checksum &&
        !migrationChecksumMatches(row.version, row.checksum, expected)
      ) {
        throw new Error(
          `Applied migration ${row.version} no longer matches its recorded checksum.`,
        );
      }
      if (!row.checksum) {
        await client.unsafe(
          "update schema_migrations set checksum = $1 where version = $2",
          [expected, row.version],
        );
      }
    }

    const pendingMigrations = getPendingMigrations(migrations, appliedVersions);

    for (const migration of pendingMigrations) {
      await client.begin(async (tx) => {
        await tx.unsafe(await Bun.file(migration.path).text());
        await tx.unsafe(
          "insert into schema_migrations (version, checksum) values ($1, $2)",
          [migration.version, migrationChecksums.get(migration.version)],
        );
      });
    }
  } finally {
    await client.unsafe(
      "select pg_advisory_unlock(hashtext('cooee_schema_migrations'))",
    );
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function migrateDatabase(databaseUrl = Bun.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }

  const client = postgres(databaseUrl, {
    max: 1,
  }) as unknown as MigrationSqlClient;
  try {
    await runDatabaseMigrations(client);
  } finally {
    await client.end?.();
  }
}

if (import.meta.main) {
  await migrateDatabase();
  console.log("Database migrations complete.");
}
