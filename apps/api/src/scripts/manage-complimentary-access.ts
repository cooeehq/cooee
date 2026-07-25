import postgres from "postgres";
import {
  isEntitledSubscriptionStatus,
  isHostedPaidPlanId,
  type HostedPaidPlanId,
} from "@cooee/shared";

type Command = "grant" | "revoke" | "status";

type Options = {
  command: Command;
  workspaceId?: string;
  ownerEmail?: string;
  planId: HostedPaidPlanId;
  reason?: string;
  grantedBy?: string;
  expiresAt?: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value.`);
  return value;
}

function parseOptions(args: string[]): Options {
  const command = args[0];
  if (!command || !["grant", "revoke", "status"].includes(command)) {
    fail("Choose grant, revoke, or status.");
  }

  const workspaceId = readOption(args, "--workspace-id");
  const ownerEmail = readOption(args, "--owner-email")?.trim().toLowerCase();
  if (Boolean(workspaceId) === Boolean(ownerEmail)) {
    fail("Provide exactly one of --workspace-id or --owner-email.");
  }

  const planId = readOption(args, "--plan") ?? "watermelon";
  if (!isHostedPaidPlanId(planId)) fail("Choose a paid plan.");

  const expiresAt = readOption(args, "--expires-at");
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    fail("--expires-at must be an RFC3339 timestamp.");
  }

  const reason = readOption(args, "--reason");
  const grantedBy = readOption(args, "--granted-by");
  if (command === "grant" && (!reason || !grantedBy)) {
    fail("Granting access requires --reason and --granted-by.");
  }

  return {
    command: command as Command,
    workspaceId,
    ownerEmail,
    planId,
    reason,
    grantedBy,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
  };
}

const options = parseOptions(Bun.argv.slice(2));
const databaseUrl = Bun.env.DATABASE_URL;
if (!databaseUrl) fail("DATABASE_URL is required.");

const sql = postgres(databaseUrl, { max: 1 });

try {
  const workspaceRows = (options.workspaceId
    ? await sql`
        select id, name from workspaces where id = ${options.workspaceId}
      `
    : await sql`
        select distinct w.id, w.name
        from workspaces w
        join memberships m on m.workspace_id = w.id and m.role = 'owner'
        join users u on u.id = m.user_id
        where lower(u.email) = ${options.ownerEmail!}
        order by w.name, w.id
      `) as unknown as Array<{ id: string; name: string }>;

  if (workspaceRows.length === 0) fail("No matching workspace was found.");
  if (workspaceRows.length > 1) {
    fail(
      `The owner has ${workspaceRows.length} workspaces. Use --workspace-id to choose one.`,
    );
  }
  const workspace = workspaceRows[0];

  if (options.command === "status") {
    const grants = (await sql`
      select plan_id, expires_at, revoked_at, created_at
      from complimentary_access_grants
      where workspace_id = ${workspace.id}
      order by created_at desc
    `) as unknown as Array<{
      plan_id: string;
      expires_at: Date | null;
      revoked_at: Date | null;
      created_at: Date;
    }>;
    console.info(JSON.stringify({ workspace, grants }, null, 2));
  } else if (options.command === "revoke") {
    const revoked = await sql.begin(async (tx) => {
      const rows = await tx`
        update complimentary_access_grants
        set revoked_at = now(), updated_at = now()
        where workspace_id = ${workspace.id} and revoked_at is null
        returning id
      `;
      if (rows.length > 0) {
        await tx`
          insert into audit_events (
            id, workspace_id, action, subject_type, subject_id, metadata
          ) values (
            ${crypto.randomUUID()}, ${workspace.id},
            'complimentary_access.revoked', 'workspace', ${workspace.id},
            ${tx.json({ revokedBy: options.grantedBy ?? "operator" })}
          )
        `;
      }
      return rows.length;
    });
    console.info(
      `Revoked ${revoked} complimentary grant(s) for ${workspace.name}.`,
    );
  } else {
    const subscriptions = (await sql`
      select status from billing_subscriptions
      where workspace_id = ${workspace.id}
      order by updated_at desc
      limit 1
    `) as unknown as Array<{ status: string }>;
    if (
      subscriptions[0] &&
      isEntitledSubscriptionStatus(subscriptions[0].status)
    ) {
      fail(
        "This workspace has an entitled saved subscription. Resolve or archive it before granting complimentary access.",
      );
    }

    await sql.begin(async (tx) => {
      await tx`
        update complimentary_access_grants
        set revoked_at = now(), updated_at = now()
        where workspace_id = ${workspace.id} and revoked_at is null
      `;
      const grantId = crypto.randomUUID();
      await tx`
        insert into complimentary_access_grants (
          id, workspace_id, plan_id, reason, granted_by, expires_at
        ) values (
          ${grantId}, ${workspace.id}, ${options.planId}, ${options.reason!},
          ${options.grantedBy!}, ${options.expiresAt ?? null}
        )
      `;
      await tx`
        insert into audit_events (
          id, workspace_id, action, subject_type, subject_id, metadata
        ) values (
          ${crypto.randomUUID()}, ${workspace.id},
          'complimentary_access.granted', 'complimentary_access_grant',
          ${grantId},
          ${tx.json({
            planId: options.planId,
            reason: options.reason,
            grantedBy: options.grantedBy,
            expiresAt: options.expiresAt ?? null,
          })}
        )
      `;
    });
    console.info(
      `Granted complimentary ${options.planId} access to ${workspace.name}.`,
    );
  }
} finally {
  await sql.end();
}
