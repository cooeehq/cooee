import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  getPendingMigrations,
  listMigrationFiles,
  migrationChecksumMatches,
} from "../db/migrate";

describe("database migrations", () => {
  test("discovers SQL migrations in filename order", async () => {
    const migrationsDir = mkdtempSync(join(tmpdir(), "cooee-migrations-"));
    writeFileSync(join(migrationsDir, "0002_second.sql"), "select 2;");
    writeFileSync(join(migrationsDir, "notes.txt"), "ignore me");
    writeFileSync(join(migrationsDir, "0001_first.sql"), "select 1;");

    const migrations = await listMigrationFiles(migrationsDir);

    expect(migrations.map((migration) => migration.version)).toEqual([
      "0001_first.sql",
      "0002_second.sql",
    ]);
  });

  test("skips migrations already recorded as applied", () => {
    expect(
      getPendingMigrations(
        [
          { version: "0000_initial.sql", path: "/tmp/0000_initial.sql" },
          { version: "0001_next.sql", path: "/tmp/0001_next.sql" },
        ],
        new Set(["0000_initial.sql"]),
      ).map((migration) => migration.version),
    ).toEqual(["0001_next.sql"]);
  });

  test("accepts only the known pre-open-source initial migration checksum", () => {
    expect(
      migrationChecksumMatches(
        "0000_initial.sql",
        "810f69208c81f8190c42d05a42a177010132e237275395a0a05e72356e041236",
        "current-checksum",
      ),
    ).toBe(true);
    expect(
      migrationChecksumMatches(
        "0000_initial.sql",
        "unexpected-checksum",
        "current-checksum",
      ),
    ).toBe(false);
    expect(
      migrationChecksumMatches(
        "0001_next.sql",
        "legacy-checksum",
        "current-checksum",
      ),
    ).toBe(false);
  });
});
