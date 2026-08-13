import postgres from "postgres";
import {
  defaultChangelogCategoryDefinitions,
  getLastCompletedScheduleWindow,
  isChangelogDue,
  normalizeChangelogCategoryDefinitions,
  normalizePostImageSettings,
} from "@cooee/shared";
import type { PullRequestMetadata } from "@cooee/shared";
import type {
  AiFeedback,
  AiUsageEvent,
  BillingNotificationType,
  BillingSubscription,
  CliSetupSession,
  ComplimentaryAccessGrant,
  CreateCliSetupSessionInput,
  CreateChangelogInput,
  EnsureGitHubInstallationMembershipsInput,
  GitHubInstallation,
  GitHubRepository,
  MarkEntryNotRelevantInput,
  MergeGenerationJob,
  ListPublicEntriesInput,
  NewEntryInput,
  Store,
  StoredChangelog,
  StoredEntry,
  UpdateChangelogSettingsInput,
  UpdateEntryImageInput,
  UpdateEntryInput,
  UpdateWorkspaceBillingInput,
  EnsureUserWorkspaceInput,
  UpsertBillingSubscriptionInput,
  UpsertGitHubInstallationInput,
  UpsertPullRequestInput,
  UpsertGitHubRepositoryInput,
  Workspace,
  WorkspaceMembership,
  WorkspaceSettings,
  PostImageGenerationJob,
  WorkClaimResult,
} from "./types";

type Sql = postgres.Sql;

export class PostgresStore implements Store {
  constructor(private readonly sql: Sql) {}

  static fromDatabaseUrl(databaseUrl: string): PostgresStore {
    return new PostgresStore(postgres(databaseUrl, { max: 10 }));
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  async healthCheck(): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.sql`select 1`,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Database readiness timed out.")),
            3_000,
          );
        }),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async beginGenerationRun(input: {
    changelogId: string;
    windowStartedAt: string;
    windowEndedAt: string;
  }): Promise<boolean> {
    const rows = await this.sql`
      insert into generation_runs (
        id, changelog_id, status, window_started_at, window_ended_at
      ) values (
        ${crypto.randomUUID()}, ${input.changelogId}, 'running',
        ${new Date(input.windowStartedAt)}, ${new Date(input.windowEndedAt)}
      )
      on conflict (changelog_id, window_started_at, window_ended_at)
      do update set
        status = 'running',
        hold_reason = null,
        completed_at = null,
        created_at = now()
      where generation_runs.status = 'failed'
        or (
          generation_runs.status = 'running'
          and generation_runs.created_at < now() - interval '1 hour'
        )
      returning id
    `;
    return rows.length > 0;
  }

  async completeGenerationRun(input: {
    changelogId: string;
    windowStartedAt: string;
    windowEndedAt: string;
    status: "published" | "held" | "empty" | "failed";
    holdReason?: string | null;
  }): Promise<void> {
    await this.sql`
      update generation_runs
      set status = ${input.status},
        hold_reason = ${input.holdReason ?? null},
        completed_at = now()
      where changelog_id = ${input.changelogId}
        and window_started_at = ${new Date(input.windowStartedAt)}
        and window_ended_at = ${new Date(input.windowEndedAt)}
    `;
  }

  async enqueueMergeGenerationJob(input: {
    changelogId: string;
    pullRequestNumber: number;
    windowStartedAt: string;
    windowEndedAt: string;
  }): Promise<void> {
    await this.sql`
      insert into merge_generation_jobs (
        id, changelog_id, pull_request_number, generation_key,
        window_started_at, window_ended_at
      ) values (
        ${crypto.randomUUID()}, ${input.changelogId}, ${input.pullRequestNumber},
        ${`merge:${input.pullRequestNumber}`},
        ${new Date(input.windowStartedAt)}, ${new Date(input.windowEndedAt)}
      )
      on conflict (changelog_id, generation_key) do nothing
    `;
  }

  async enqueueReleaseGenerationJob(input: {
    changelogId: string;
    tagName: string;
    windowStartedAt: string;
    windowEndedAt: string;
  }): Promise<void> {
    await this.sql`
      insert into merge_generation_jobs (
        id, changelog_id, pull_request_number, generation_key,
        window_started_at, window_ended_at
      ) values (
        ${crypto.randomUUID()}, ${input.changelogId}, null,
        ${`release:${input.tagName}`}, ${new Date(input.windowStartedAt)},
        ${new Date(input.windowEndedAt)}
      )
      on conflict (changelog_id, generation_key) do nothing
    `;
  }

  async claimMergeGenerationJobs(input: {
    now: string;
    limit: number;
  }): Promise<MergeGenerationJob[]> {
    const rows = await this.sql`
      with candidates as (
        select id
        from merge_generation_jobs
        where (
          status = 'pending'
          and next_attempt_at <= ${new Date(input.now)}
        ) or (
          status = 'processing'
          and processing_started_at < ${new Date(
            new Date(input.now).getTime() - 60 * 60 * 1000,
          )}
        )
        order by next_attempt_at asc, created_at asc
        for update skip locked
        limit ${input.limit}
      )
      update merge_generation_jobs jobs
      set status = 'processing',
        processing_started_at = ${new Date(input.now)},
        attempt_count = jobs.attempt_count + 1,
        claim_token = jobs.id || ':' || (jobs.attempt_count + 1)::text,
        updated_at = now()
      from candidates
      where jobs.id = candidates.id
      returning jobs.*
    `;

    return rows.map(mapMergeGenerationJob);
  }

  async completeMergeGenerationJob(input: {
    jobId: string;
    claimToken: string;
  }): Promise<void> {
    await this.sql`
      update merge_generation_jobs
      set status = 'completed',
        processing_started_at = null,
        claim_token = null,
        last_error = null,
        completed_at = now(),
        updated_at = now()
      where id = ${input.jobId}
        and status = 'processing'
        and claim_token = ${input.claimToken}
    `;
  }

  async retryMergeGenerationJob(input: {
    jobId: string;
    claimToken: string;
    error: string;
    nextAttemptAt: string;
  }): Promise<void> {
    await this.sql`
      update merge_generation_jobs
      set status = 'pending',
        processing_started_at = null,
        claim_token = null,
        last_error = ${input.error},
        next_attempt_at = ${new Date(input.nextAttemptAt)},
        updated_at = now()
      where id = ${input.jobId}
        and status = 'processing'
        and claim_token = ${input.claimToken}
    `;
  }

  async enqueuePostImageGeneration(input: {
    workspaceId: string;
    entryId: string;
  }): Promise<StoredEntry | null> {
    const rows = await this.sql`
      update changelog_entries e
      set image_generation_status = 'pending',
        image_generation_error = null,
        image_generation_attempt_count = 0,
        image_generation_next_attempt_at = now(),
        image_generation_claim_token = null,
        image_generation_claimed_at = null,
        updated_at = now()
      from changelogs c
      where e.changelog_id = c.id
        and c.workspace_id = ${input.workspaceId}
        and e.id = ${input.entryId}
        and e.image_url is null
      returning e.*
    `;
    return rows[0] ? mapEntry(rows[0]) : null;
  }

  async claimPostImageGenerationJobs(input: {
    now: string;
    limit: number;
  }): Promise<PostImageGenerationJob[]> {
    const staleAt = new Date(new Date(input.now).getTime() - 60 * 60 * 1000);
    const rows = await this.sql`
      with candidates as (
        select id
        from changelog_entries
        where image_url is null and (
          (image_generation_status = 'pending'
            and image_generation_next_attempt_at <= ${new Date(input.now)})
          or (image_generation_status = 'generating'
            and image_generation_claimed_at < ${staleAt})
        )
        order by image_generation_next_attempt_at asc nulls first, created_at asc
        for update skip locked
        limit ${input.limit}
      )
      update changelog_entries entries
      set image_generation_status = 'generating',
        image_generation_attempt_count = entries.image_generation_attempt_count + 1,
        image_generation_claim_token = entries.id || ':' ||
          (entries.image_generation_attempt_count + 1)::text,
        image_generation_claimed_at = ${new Date(input.now)},
        updated_at = now()
      from candidates
      where entries.id = candidates.id
      returning entries.*
    `;
    return rows.map(mapPostImageGenerationJob);
  }

  async completePostImageGeneration(input: {
    entryId: string;
    claimToken: string;
    imageUrl: string;
  }): Promise<StoredEntry | null> {
    const rows = await this.sql`
      update changelog_entries
      set image_url = ${input.imageUrl},
        image_generation_status = null,
        image_generation_error = null,
        image_generation_next_attempt_at = null,
        image_generation_claim_token = null,
        image_generation_claimed_at = null,
        updated_at = now()
      where id = ${input.entryId}
        and image_url is null
        and image_generation_status = 'generating'
        and image_generation_claim_token = ${input.claimToken}
      returning *
    `;
    return rows[0] ? mapEntry(rows[0]) : null;
  }

  async retryPostImageGeneration(input: {
    entryId: string;
    claimToken: string;
    error: string;
    nextAttemptAt?: string;
  }): Promise<void> {
    await this.sql`
      update changelog_entries
      set image_generation_status = ${input.nextAttemptAt ? "pending" : "failed"},
        image_generation_error = ${input.error},
        image_generation_next_attempt_at = ${input.nextAttemptAt ? new Date(input.nextAttemptAt) : null},
        image_generation_claim_token = null,
        image_generation_claimed_at = null,
        updated_at = now()
      where id = ${input.entryId}
        and image_generation_status = 'generating'
        and image_generation_claim_token = ${input.claimToken}
    `;
  }

  async listWorkspaceMemberships(
    userId: string,
  ): Promise<WorkspaceMembership[]> {
    const rows = await this.sql`
      select id, workspace_id, user_id, role, source
      from memberships
      where user_id = ${userId}
      order by created_at asc
    `;
    return rows.map(mapWorkspaceMembership);
  }

  async ensureUserWorkspace(
    input: EnsureUserWorkspaceInput,
  ): Promise<WorkspaceMembership> {
    return this.sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext(${input.userId}))`;
      const existing = await sql`
        select id, workspace_id, user_id, role, source
        from memberships
        where user_id = ${input.userId}
        order by created_at asc
        limit 1
      `;
      if (existing[0]) return mapWorkspaceMembership(existing[0]);

      const workspaceId = `ws_${crypto.randomUUID()}`;
      await sql`
        insert into workspaces (id, name, billing_mode, repository_limit)
        values (
          ${workspaceId},
          ${input.userName.trim() || "My workspace"},
          ${input.billingMode},
          ${input.repositoryLimit}
        )
      `;
      const rows = await sql`
        insert into memberships (id, workspace_id, user_id, role, source)
        values (
          ${crypto.randomUUID()}, ${workspaceId}, ${input.userId}, 'owner', 'local'
        )
        returning id, workspace_id, user_id, role, source
      `;
      return mapWorkspaceMembership(rows[0]);
    });
  }

  async ensureGitHubInstallationMemberships(
    input: EnsureGitHubInstallationMembershipsInput,
  ): Promise<WorkspaceMembership[]> {
    return this.sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext(${input.userId}))`;

      const accessibleInstallationIds = new Set(input.installationIds);
      const accessibleRepositoryFullNames = new Set(
        input.repositoryFullNames.map((fullName) => fullName.toLowerCase()),
      );
      const candidateWorkspaceIds = new Set<string>();

      for (const installationId of accessibleInstallationIds) {
        const installations = await sql`
          select workspace_id
          from github_installations
          where installation_id = ${installationId}
          limit 1
        `;
        const workspaceId = installations[0]?.workspace_id;
        if (!workspaceId) continue;

        candidateWorkspaceIds.add(workspaceId);
      }

      const authorizedWorkspaceIds = new Set<string>();
      for (const workspaceId of candidateWorkspaceIds) {
        const installations = await sql`
          select installation_id
          from github_installations
          where workspace_id = ${workspaceId}
        `;
        const repositories = await sql`
          select full_name
          from repositories
          where workspace_id = ${workspaceId}
        `;
        if (
          installations.length > 0 &&
          installations.every((installation) =>
            accessibleInstallationIds.has(installation.installation_id),
          ) &&
          repositories.every((repository) =>
            accessibleRepositoryFullNames.has(
              String(repository.full_name).toLowerCase(),
            ),
          )
        ) {
          authorizedWorkspaceIds.add(workspaceId);
        }
      }

      for (const workspaceId of authorizedWorkspaceIds) {
        await sql`
          insert into memberships (id, workspace_id, user_id, role, source)
          values (
            ${crypto.randomUUID()},
            ${workspaceId},
            ${input.userId},
            'member',
            'github'
          )
          on conflict (workspace_id, user_id) do nothing
        `;
      }

      const existingMemberships = await sql`
        select id, workspace_id, user_id, role, source
        from memberships
        where user_id = ${input.userId}
        order by created_at asc
      `;
      for (const membership of existingMemberships) {
        if (
          membership.source === "github" &&
          !authorizedWorkspaceIds.has(membership.workspace_id)
        ) {
          await sql`
            delete from memberships
            where id = ${membership.id} and source = 'github'
          `;
        }
      }

      const rows = await sql`
        select id, workspace_id, user_id, role, source
        from memberships
        where user_id = ${input.userId}
        order by created_at asc
      `;
      return rows.map(mapWorkspaceMembership);
    });
  }

  async getWorkspace(workspaceId: string): Promise<Workspace | null> {
    const rows = await this.sql`
      select *
      from workspaces
      where id = ${workspaceId}
      limit 1
    `;

    return rows[0] ? mapWorkspace(rows[0]) : null;
  }

  async getWorkspaceSettings(
    workspaceId: string,
  ): Promise<Partial<WorkspaceSettings> | null> {
    const rows = await this.sql`
      select settings
      from workspace_settings
      where workspace_id = ${workspaceId}
      limit 1
    `;

    return (
      (rows[0]?.settings as Partial<WorkspaceSettings> | undefined) ?? null
    );
  }

  async updateWorkspaceSettings(
    workspaceId: string,
    settings: WorkspaceSettings,
  ): Promise<WorkspaceSettings> {
    const rows = await this.sql`
      insert into workspace_settings (
        workspace_id,
        settings,
        updated_at
      )
      values (
        ${workspaceId},
        ${this.sql.json(settings)},
        now()
      )
      on conflict (workspace_id)
      do update set
        settings = excluded.settings,
        updated_at = now()
      returning settings
    `;

    return rows[0].settings as WorkspaceSettings;
  }

  async updateWorkspaceBilling(
    input: UpdateWorkspaceBillingInput,
  ): Promise<Workspace | null> {
    const rows = await this.sql`
      update workspaces
      set billing_mode = ${input.billingMode},
        repository_limit = ${input.repositoryLimit},
        stripe_customer_id = ${input.stripeCustomerId ?? null},
        updated_at = now()
      where id = ${input.workspaceId}
      returning *
    `;

    return rows[0] ? mapWorkspace(rows[0]) : null;
  }

  async getBillingSubscription(
    workspaceId: string,
  ): Promise<BillingSubscription | null> {
    const rows = await this.sql`
      select *
      from billing_subscriptions
      where workspace_id = ${workspaceId}
      order by updated_at desc
      limit 1
    `;

    return rows[0] ? mapBillingSubscription(rows[0]) : null;
  }

  async getActiveComplimentaryAccessGrant(
    workspaceId: string,
  ): Promise<ComplimentaryAccessGrant | null> {
    const rows = await this.sql`
      select *
      from complimentary_access_grants
      where workspace_id = ${workspaceId}
        and revoked_at is null
        and (expires_at is null or expires_at > now())
      order by created_at desc
      limit 1
    `;

    return rows[0] ? mapComplimentaryAccessGrant(rows[0]) : null;
  }

  async getBillingSubscriptionByStripeSubscriptionId(
    stripeSubscriptionId: string,
  ): Promise<BillingSubscription | null> {
    const rows = await this.sql`
      select * from billing_subscriptions
      where stripe_subscription_id = ${stripeSubscriptionId}
      limit 1
    `;
    return rows[0] ? mapBillingSubscription(rows[0]) : null;
  }

  async getBillingSubscriptionByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<BillingSubscription | null> {
    const rows = await this.sql`
      select * from billing_subscriptions
      where stripe_customer_id = ${stripeCustomerId}
      order by updated_at desc
      limit 1
    `;
    return rows[0] ? mapBillingSubscription(rows[0]) : null;
  }

  async upsertBillingSubscription(
    input: UpsertBillingSubscriptionInput,
  ): Promise<BillingSubscription> {
    const existing = await this.sql`
      select *
      from billing_subscriptions
      where stripe_subscription_id = ${input.stripeSubscriptionId}
      limit 1
    `;

    if (existing[0]) {
      const rows = await this.sql`
        update billing_subscriptions
        set workspace_id = ${input.workspaceId},
          stripe_customer_id = ${input.stripeCustomerId},
          status = ${input.status},
          plan_id = ${input.planId},
          billing_cadence = ${input.billingCadence},
          price_id = ${input.priceId},
          repository_limit = ${input.repositoryLimit},
          current_period_start = ${input.currentPeriodStart ? new Date(input.currentPeriodStart) : null},
          current_period_end = ${input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : null},
          billing_email = ${input.billingEmail},
          cancel_at_period_end = ${input.cancelAtPeriodEnd},
          cancel_at = ${input.cancelAt ? new Date(input.cancelAt) : null},
          ended_at = ${input.endedAt ? new Date(input.endedAt) : null},
          last_payment_failed_at = ${input.lastPaymentFailedAt ? new Date(input.lastPaymentFailedAt) : null},
          auto_recharge_enabled = ${input.autoRechargeEnabled ?? true},
          updated_at = now()
        where id = ${existing[0].id}
        returning *
      `;

      return mapBillingSubscription(rows[0]);
    }

    const rows = await this.sql`
      insert into billing_subscriptions (
        id,
        workspace_id,
        stripe_subscription_id,
        stripe_customer_id,
        status,
        plan_id,
        billing_cadence,
        price_id,
        repository_limit,
        current_period_start,
        current_period_end,
        billing_email,
        cancel_at_period_end,
        cancel_at,
        ended_at,
        last_payment_failed_at,
        auto_recharge_enabled
      )
      values (
        ${crypto.randomUUID()},
        ${input.workspaceId},
        ${input.stripeSubscriptionId},
        ${input.stripeCustomerId},
        ${input.status},
        ${input.planId},
        ${input.billingCadence},
        ${input.priceId},
        ${input.repositoryLimit},
        ${input.currentPeriodStart ? new Date(input.currentPeriodStart) : null},
        ${input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : null},
        ${input.billingEmail},
        ${input.cancelAtPeriodEnd},
        ${input.cancelAt ? new Date(input.cancelAt) : null},
        ${input.endedAt ? new Date(input.endedAt) : null},
        ${input.lastPaymentFailedAt ? new Date(input.lastPaymentFailedAt) : null},
        ${input.autoRechargeEnabled ?? true}
      )
      returning *
    `;

    return mapBillingSubscription(rows[0]);
  }

  async archiveBillingSubscription(
    stripeSubscriptionId: string,
    endedAt: string,
  ): Promise<void> {
    await this.sql`
      update billing_subscriptions
      set status = 'canceled',
        cancel_at_period_end = false,
        cancel_at = null,
        ended_at = ${new Date(endedAt)},
        updated_at = now()
      where stripe_subscription_id = ${stripeSubscriptionId}
        and status not in ('canceled', 'incomplete_expired')
    `;
  }

  async pruneCliSetupSessions(before: string): Promise<void> {
    await this.sql`
      delete from cli_setup_sessions
      where expires_at < ${new Date(before)}
    `;
  }

  async createCliSetupSession(
    input: CreateCliSetupSessionInput,
  ): Promise<CliSetupSession> {
    const rows = await this.sql`
      insert into cli_setup_sessions (
        id, browser_code_hash, poll_token_hash, target_repository, expires_at
      ) values (
        ${crypto.randomUUID()}, ${input.browserCodeHash}, ${input.pollTokenHash},
        ${input.targetRepository}, ${new Date(input.expiresAt)}
      )
      returning *
    `;
    return mapCliSetupSession(rows[0]);
  }

  async getCliSetupSession(id: string): Promise<CliSetupSession | null> {
    const rows = await this.sql`
      select * from cli_setup_sessions where id = ${id} limit 1
    `;
    return rows[0] ? mapCliSetupSession(rows[0]) : null;
  }

  async getCliSetupSessionByBrowserCodeHash(
    browserCodeHash: string,
  ): Promise<CliSetupSession | null> {
    const rows = await this.sql`
      select * from cli_setup_sessions
      where browser_code_hash = ${browserCodeHash}
      limit 1
    `;
    return rows[0] ? mapCliSetupSession(rows[0]) : null;
  }

  async claimCliSetupSession(input: {
    id: string;
    userId: string;
    workspaceId: string;
  }): Promise<CliSetupSession | null> {
    const rows = await this.sql`
      update cli_setup_sessions
      set user_id = ${input.userId},
        workspace_id = ${input.workspaceId},
        status = case
          when status = 'pending' then 'awaiting-installation'
          else status
        end,
        updated_at = now()
      where id = ${input.id}
        and expires_at > now()
        and (user_id is null or user_id = ${input.userId})
      returning *
    `;
    return rows[0] ? mapCliSetupSession(rows[0]) : null;
  }

  async updateCliSetupSession(input: {
    id: string;
    status: CliSetupSession["status"];
    error?: string | null;
    changelogId?: string | null;
    changelogUrl?: string | null;
    completedAt?: string | null;
  }): Promise<CliSetupSession | null> {
    const rows = await this.sql`
      update cli_setup_sessions
      set status = ${input.status},
        error = ${input.error ?? null},
        changelog_id = coalesce(${input.changelogId ?? null}, changelog_id),
        changelog_url = coalesce(${input.changelogUrl ?? null}, changelog_url),
        completed_at = coalesce(${input.completedAt ? new Date(input.completedAt) : null}, completed_at),
        updated_at = now()
      where id = ${input.id}
      returning *
    `;
    return rows[0] ? mapCliSetupSession(rows[0]) : null;
  }

  async listGitHubInstallations(
    workspaceId: string,
  ): Promise<GitHubInstallation[]> {
    const rows = await this.sql`
      select *
      from github_installations
      where workspace_id = ${workspaceId}
      order by account_login asc
    `;

    return rows.map(mapGitHubInstallation);
  }

  async listRepositories(workspaceId: string): Promise<GitHubRepository[]> {
    const rows = await this.sql`
      select *
      from repositories
      where workspace_id = ${workspaceId}
      order by full_name asc
    `;

    return rows.map(mapGitHubRepository);
  }

  async upsertGitHubInstallation(
    input: UpsertGitHubInstallationInput,
  ): Promise<GitHubInstallation> {
    const existing = await this.sql`
      select *
      from github_installations
      where installation_id = ${input.installationId}
      limit 1
    `;

    if (existing[0]) {
      if (existing[0].workspace_id !== input.workspaceId) {
        throw new Error("GitHub installation is already assigned.");
      }
      const rows = await this.sql`
        update github_installations
        set account_login = ${input.accountLogin},
          account_type = ${input.accountType},
          suspended_at = ${input.suspendedAt ? new Date(input.suspendedAt) : null},
          updated_at = now()
        where id = ${existing[0].id}
        returning *
      `;

      return mapGitHubInstallation(rows[0]);
    }

    const rows = await this.sql`
      insert into github_installations (
        id,
        workspace_id,
        installation_id,
        account_login,
        account_type,
        suspended_at
      )
      values (
        ${crypto.randomUUID()},
        ${input.workspaceId},
        ${input.installationId},
        ${input.accountLogin},
        ${input.accountType},
        ${input.suspendedAt ? new Date(input.suspendedAt) : null}
      )
      returning *
    `;

    return mapGitHubInstallation(rows[0]);
  }

  async upsertGitHubRepositories(input: {
    workspaceId: string;
    githubInstallationId: string;
    repositories: UpsertGitHubRepositoryInput[];
  }): Promise<GitHubRepository[]> {
    const repositories: GitHubRepository[] = [];

    for (const repository of input.repositories) {
      const rows = await this.sql`
        insert into repositories (
          id,
          workspace_id,
          github_installation_id,
          owner,
          name,
          full_name,
          private
        )
        values (
          ${crypto.randomUUID()},
          ${input.workspaceId},
          ${input.githubInstallationId},
          ${repository.owner},
          ${repository.name},
          ${repository.fullName},
          ${repository.private}
        )
        on conflict (full_name)
        do update set
          workspace_id = excluded.workspace_id,
          github_installation_id = excluded.github_installation_id,
          owner = excluded.owner,
          name = excluded.name,
          private = excluded.private,
          updated_at = now()
        returning *
      `;

      repositories.push(mapGitHubRepository(rows[0]));
    }

    return repositories;
  }

  async listChangelogs(workspaceId: string): Promise<StoredChangelog[]> {
    const rows = await this.sql`
      select c.*, r.full_name as repository
      from changelogs c
      join repositories r on r.id = c.repository_id
      where c.workspace_id = ${workspaceId}
      order by c.name asc
    `;

    return rows.map(mapChangelog);
  }

  async createChangelog(
    input: CreateChangelogInput,
  ): Promise<StoredChangelog | null> {
    return this.sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext(${`repository:${input.workspaceId}`}))`;
      const existing = await sql`
        select c.*, r.full_name as repository
        from changelogs c
        join repositories r on r.id = c.repository_id
        where c.workspace_id = ${input.workspaceId}
          and c.repository_id = ${input.repositoryId}
        limit 1
      `;

      if (existing[0]) return mapChangelog(existing[0]);

      if (
        input.repositoryLimit !== null &&
        input.repositoryLimit !== undefined &&
        input.repositoryLimit > 0
      ) {
        const usage = await sql`
          select count(distinct repository_id)::int as count
          from changelogs
          where workspace_id = ${input.workspaceId}
        `;
        if (Number(usage[0]?.count ?? 0) >= input.repositoryLimit) return null;
      }

      const rows = await sql`
        insert into changelogs (
          id, workspace_id, repository_id, slug, name, description,
          public_url, custom_domain, custom_hostname_id,
          custom_hostname_status, custom_hostname_ssl_status, time_zone,
          publish_time, schedule_frequency, schedule_weekday,
          schedule_month_day, generation_source, skip_labels, sensitive_labels,
          category_definitions, group_entries_by_category,
          include_pull_request_links, public_theme, image_settings
        ) values (
          ${crypto.randomUUID()}, ${input.workspaceId}, ${input.repositoryId},
          ${input.slug}, ${input.name}, ${input.description}, ${input.publicUrl},
          ${input.customDomain}, ${input.customHostnameId ?? null},
          ${input.customHostnameStatus ?? null},
          ${input.customHostnameSslStatus ?? null}, ${input.settings.timeZone},
          ${input.settings.publishTime}, ${input.settings.scheduleFrequency},
          ${input.settings.scheduleWeekday ?? 1},
          ${input.settings.scheduleMonthDay ?? 1},
          ${input.settings.generationSource},
          ${sql.json(input.settings.skipLabels)},
          ${sql.json(input.settings.sensitiveLabels)},
          ${sql.json(input.settings.categoryDefinitions)},
          ${input.settings.groupEntriesByCategory},
          ${input.settings.includePullRequestLinks},
          ${input.settings.publicTheme},
          ${sql.json(input.settings.postImageSettings)}
        )
        returning *
      `;

      const repositoryRows = await sql`
        select full_name from repositories
        where id = ${input.repositoryId}
        limit 1
      `;
      return mapChangelog({
        ...rows[0],
        repository: repositoryRows[0]?.full_name,
      });
    });
  }

  async updateChangelogSettings(
    input: UpdateChangelogSettingsInput,
  ): Promise<StoredChangelog | null> {
    const rows = await this.sql`
      update changelogs
      set slug = ${input.slug},
        name = ${input.name},
        description = ${input.description},
        public_url = ${input.publicUrl},
        custom_domain = ${input.customDomain},
        custom_hostname_id = ${input.customHostnameId ?? null},
        custom_hostname_status = ${input.customHostnameStatus ?? null},
        custom_hostname_ssl_status = ${input.customHostnameSslStatus ?? null},
        time_zone = ${input.settings.timeZone},
        publish_time = ${input.settings.publishTime},
        schedule_frequency = ${input.settings.scheduleFrequency},
        schedule_weekday = ${input.settings.scheduleWeekday ?? 1},
        schedule_month_day = ${input.settings.scheduleMonthDay ?? 1},
        generation_source = ${input.settings.generationSource},
        skip_labels = ${this.sql.json(input.settings.skipLabels)},
        sensitive_labels = ${this.sql.json(input.settings.sensitiveLabels)},
        category_definitions = ${this.sql.json(input.settings.categoryDefinitions)},
        group_entries_by_category = ${input.settings.groupEntriesByCategory},
        include_pull_request_links = ${input.settings.includePullRequestLinks},
        public_theme = ${input.settings.publicTheme},
        image_settings = ${this.sql.json(input.settings.postImageSettings)},
        updated_at = now()
      where id = ${input.changelogId}
        and workspace_id = ${input.workspaceId}
      returning *
    `;

    if (!rows[0]) {
      return null;
    }

    const repositoryRows = await this.sql`
      select full_name
      from repositories
      where id = ${rows[0].repository_id}
      limit 1
    `;

    return mapChangelog({
      ...rows[0],
      repository: repositoryRows[0]?.full_name,
    });
  }

  async getChangelogBySlug(slug: string): Promise<StoredChangelog | null> {
    const rows = await this.sql`
      select c.*, r.full_name as repository
      from changelogs c
      join repositories r on r.id = c.repository_id
      where c.slug = ${slug}
      limit 1
    `;

    return rows[0] ? mapChangelog(rows[0]) : null;
  }

  async getChangelogByCustomDomain(
    domain: string,
  ): Promise<StoredChangelog | null> {
    const rows = await this.sql`
      select c.*, r.full_name as repository
      from changelogs c
      join repositories r on r.id = c.repository_id
      where c.custom_domain = ${domain}
      limit 1
    `;

    return rows[0] ? mapChangelog(rows[0]) : null;
  }

  async getChangelogById(id: string): Promise<StoredChangelog | null> {
    const rows = await this.sql`
      select c.*, r.full_name as repository
      from changelogs c
      join repositories r on r.id = c.repository_id
      where c.id = ${id}
      limit 1
    `;

    return rows[0] ? mapChangelog(rows[0]) : null;
  }

  async getChangelogByRepositoryFullName(
    repositoryFullName: string,
  ): Promise<StoredChangelog | null> {
    const rows = await this.sql`
      select c.*, r.full_name as repository
      from changelogs c
      join repositories r on r.id = c.repository_id
      where r.full_name = ${repositoryFullName}
      limit 1
    `;

    return rows[0] ? mapChangelog(rows[0]) : null;
  }

  async listEntries(changelogId: string): Promise<StoredEntry[]> {
    const rows = await this.sql`
      select *
      from changelog_entries
      where changelog_id = ${changelogId}
      order by published_at desc nulls last, created_at desc
    `;

    return rows.map(mapEntry);
  }

  async listPublicEntries(
    input: ListPublicEntriesInput,
  ): Promise<StoredEntry[]> {
    const publishedAtOrAfter = input.publishedAtOrAfter
      ? new Date(input.publishedAtOrAfter)
      : null;
    const publishedBefore = input.publishedBefore
      ? new Date(input.publishedBefore)
      : null;
    const publishedAtOrBefore = input.publishedAtOrBefore
      ? new Date(input.publishedAtOrBefore)
      : null;
    const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 501);
    const rows = await this.sql`
      select *
      from changelog_entries
      where changelog_id = ${input.changelogId}
        and status = 'published'
        and published_at is not null
        and (${publishedAtOrAfter}::timestamptz is null or published_at >= ${publishedAtOrAfter})
        and (${publishedBefore}::timestamptz is null or published_at < ${publishedBefore})
        and (${publishedAtOrBefore}::timestamptz is null or published_at <= ${publishedAtOrBefore})
      order by published_at desc, created_at desc
      limit ${limit}
    `;

    return rows.map(mapEntry);
  }

  async hasPublicEntryBefore(
    changelogId: string,
    publishedBefore: string,
  ): Promise<boolean> {
    const rows = await this.sql`
      select 1
      from changelog_entries
      where changelog_id = ${changelogId}
        and status = 'published'
        and published_at < ${new Date(publishedBefore)}
      limit 1
    `;
    return rows.length > 0;
  }

  async getPublishedArticleBySlug(
    changelogId: string,
    articleSlug: string,
  ): Promise<StoredEntry | null> {
    const rows = await this.sql`
      select *
      from changelog_entries
      where changelog_id = ${changelogId}
        and status = 'published'
        and article_slug = ${articleSlug}
        and article_markdown is not null
        and btrim(article_markdown) <> ''
        and published_at is not null
        and published_at <= now()
      limit 1
    `;
    return rows[0] ? mapEntry(rows[0]) : null;
  }

  async listPullRequestsForWindow(
    changelog: StoredChangelog,
    windowEnd: string,
  ): Promise<PullRequestMetadata[]> {
    const window = getLastCompletedScheduleWindow({
      now: new Date(windowEnd),
      timeZone: changelog.settings.timeZone,
      publishTime: changelog.settings.publishTime,
      frequency: changelog.settings.scheduleFrequency,
      scheduleWeekday: changelog.settings.scheduleWeekday,
      scheduleMonthDay: changelog.settings.scheduleMonthDay,
    });

    return this.listPullRequestsForRange(changelog, {
      startedAt: window.startedAt.toISOString(),
      endedAt: window.endedAt.toISOString(),
    });
  }

  async listPullRequestsForRange(
    changelog: StoredChangelog,
    window: { startedAt: string; endedAt: string },
  ): Promise<PullRequestMetadata[]> {
    const rows = await this.sql`
      select *
      from pull_requests
      where repository_id = ${changelog.repositoryId}
        and merged_at >= ${new Date(window.startedAt)}
        and merged_at < ${new Date(window.endedAt)}
      order by merged_at asc
    `;

    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      title: row.title,
      body: row.body ?? "",
      labels: row.labels ?? [],
      mergedAt: toIso(row.merged_at),
      url: row.url,
      repository: changelog.repository,
      author: row.author_login ?? undefined,
    }));
  }

  async countPullRequestsForWorkspaceRange(
    workspaceId: string,
    window: { startedAt: string; endedAt: string },
  ): Promise<number> {
    const rows = await this.sql`
      select count(distinct pull_requests.id)::int as count
      from pull_requests
      inner join repositories on repositories.id = pull_requests.repository_id
      inner join changelogs on changelogs.repository_id = repositories.id
      where repositories.workspace_id = ${workspaceId}
        and changelogs.workspace_id = ${workspaceId}
        and pull_requests.merged_at >= ${new Date(window.startedAt)}
        and pull_requests.merged_at < ${new Date(window.endedAt)}
    `;

    return Number(rows[0]?.count ?? 0);
  }

  async upsertPullRequest(
    input: UpsertPullRequestInput,
  ): Promise<PullRequestMetadata | null> {
    const repositoryRows = await this.sql`
      select id, full_name
      from repositories
      where full_name = ${input.repositoryFullName}
      limit 1
    `;
    const repository = repositoryRows[0];

    if (!repository) {
      return null;
    }

    const githubId = Number(input.pullRequest.id.replace(/^github_/, ""));
    const rows = await this.sql`
      insert into pull_requests (
        id,
        repository_id,
        github_id,
        number,
        title,
        body,
        labels,
        url,
        merged_at,
        author_login
      )
      values (
        ${input.pullRequest.id},
        ${repository.id},
        ${Number.isFinite(githubId) ? githubId : input.pullRequest.number},
        ${input.pullRequest.number},
        ${input.pullRequest.title},
        ${input.pullRequest.body},
        ${this.sql.json(input.pullRequest.labels)},
        ${input.pullRequest.url},
        ${new Date(input.pullRequest.mergedAt)},
        ${input.pullRequest.author ?? null}
      )
      on conflict (id)
      do update set
        number = excluded.number,
        title = excluded.title,
        body = excluded.body,
        labels = excluded.labels,
        url = excluded.url,
        merged_at = excluded.merged_at,
        author_login = excluded.author_login
      returning *
    `;
    const row = rows[0];

    return {
      id: row.id,
      number: row.number,
      title: row.title,
      body: row.body ?? "",
      labels: row.labels ?? [],
      mergedAt: toIso(row.merged_at),
      url: row.url,
      repository: repository.full_name,
      author: row.author_login ?? undefined,
    };
  }

  async createEntry(input: NewEntryInput): Promise<StoredEntry> {
    const id = crypto.randomUUID();
    const rows = await this.sql`
      insert into changelog_entries (
        id,
        changelog_id,
        title,
        summary,
        category,
        status,
        hold_reason,
        image_url,
        article_slug,
        article_markdown,
        items,
        source_pull_requests,
        generation_key,
        window_ended_at,
        published_at
      )
      values (
        ${id},
        ${input.changelogId},
        ${input.title},
        ${input.summary},
        ${input.category},
        ${input.status},
        ${input.holdReason ?? null},
        ${input.imageUrl ?? null},
        ${input.articleSlug ?? null},
        ${input.articleMarkdown ?? null},
        ${this.sql.json(input.items ?? [])},
        ${this.sql.json(input.sourcePullRequests)},
        ${input.generationKey ?? null},
        ${new Date(input.windowEndedAt)},
        ${input.publishedAt ? new Date(input.publishedAt) : null}
      )
      on conflict (generation_key) do update
      set generation_key = excluded.generation_key
      returning *
    `;

    return mapEntry(rows[0]);
  }

  async countProcessedPullRequestsForWorkspaceRange(
    workspaceId: string,
    window: { startedAt: string; endedAt: string },
  ): Promise<number> {
    const rows = await this.sql`
      select count(*)::int as count
      from processed_pull_request_usage
      where workspace_id = ${workspaceId}
        and processed_at >= ${new Date(window.startedAt)}
        and processed_at < ${new Date(window.endedAt)}
    `;
    return Number(rows[0]?.count ?? 0);
  }

  async reserveProcessedPullRequests(input: {
    workspaceId: string;
    repositoryId: string;
    pullRequestNumbers: number[];
    period: { startedAt: string; endedAt: string };
    limit: number;
  }): Promise<boolean> {
    const uniqueNumbers = [...new Set(input.pullRequestNumbers)];
    if (uniqueNumbers.length === 0) return true;

    return this.sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext(${`usage:${input.workspaceId}`}))`;
      const existing = await sql`
        select repository_id, pull_request_number
        from processed_pull_request_usage
        where workspace_id = ${input.workspaceId}
          and processed_at >= ${new Date(input.period.startedAt)}
          and processed_at < ${new Date(input.period.endedAt)}
      `;
      const existingKeys = new Set(
        existing.map(
          (row) => `${row.repository_id}:${row.pull_request_number}`,
        ),
      );
      const newNumbers = uniqueNumbers.filter(
        (number) => !existingKeys.has(`${input.repositoryId}:${number}`),
      );
      if (existing.length + newNumbers.length > input.limit) return false;

      for (const pullRequestNumber of newNumbers) {
        await sql`
          insert into processed_pull_request_usage (
            id, workspace_id, repository_id, pull_request_number,
            period_started_at, processed_at
          ) values (
            ${crypto.randomUUID()}, ${input.workspaceId}, ${input.repositoryId},
            ${pullRequestNumber}, ${new Date(input.period.startedAt)}, now()
          )
          on conflict (
            workspace_id, repository_id, pull_request_number, period_started_at
          ) do nothing
        `;
      }
      return true;
    });
  }

  async createAiUsageEvent(
    input: Omit<
      AiUsageEvent,
      "id" | "createdAt" | "reportedAt" | "rechargePacksReported"
    >,
  ): Promise<AiUsageEvent> {
    const rows = await this.sql`
      insert into ai_usage_events (
        id, workspace_id, stripe_customer_id, source_id,
        input_tokens, cached_input_tokens, output_tokens, total_tokens
      ) values (
        ${crypto.randomUUID()}, ${input.workspaceId}, ${input.stripeCustomerId},
        ${input.sourceId}, ${input.inputTokens}, ${input.cachedInputTokens},
        ${input.outputTokens}, ${input.totalTokens}
      )
      on conflict (source_id) do update set source_id = excluded.source_id
      returning *
    `;
    return mapAiUsageEvent(rows[0]);
  }

  async listUnreportedAiUsageEvents(
    workspaceId: string,
    limit: number,
  ): Promise<AiUsageEvent[]> {
    const rows = await this.sql`
      select * from ai_usage_events
      where workspace_id = ${workspaceId}
        and stripe_customer_id is not null
        and reported_at is null
      order by created_at asc
      limit ${limit}
    `;
    return rows.map(mapAiUsageEvent);
  }

  async sumAiTokensForWorkspaceRange(
    workspaceId: string,
    window: { startedAt: string; endedAt: string },
  ): Promise<number> {
    const rows = await this.sql`
      select coalesce(sum(total_tokens), 0)::bigint as total_tokens
      from ai_usage_events
      where workspace_id = ${workspaceId}
        and created_at >= ${new Date(window.startedAt)}
        and created_at < ${new Date(window.endedAt)}
    `;
    return Number(rows[0]?.total_tokens ?? 0);
  }

  async sumAiRechargePacksForWorkspaceRange(
    workspaceId: string,
    window: { startedAt: string; endedAt: string },
  ): Promise<number> {
    const rows = await this.sql`
      select coalesce(sum(recharge_packs_reported), 0)::int as packs
      from ai_usage_events
      where workspace_id = ${workspaceId}
        and created_at >= ${new Date(window.startedAt)}
        and created_at < ${new Date(window.endedAt)}
    `;
    return Number(rows[0]?.packs ?? 0);
  }

  async markAiUsageEventReported(id: string): Promise<void> {
    await this.sql`
      update ai_usage_events set reported_at = now()
      where id = ${id}
    `;
  }

  async markAiUsageEventRechargePacksReported(
    id: string,
    packCount: number,
  ): Promise<void> {
    await this.sql`
      update ai_usage_events
      set recharge_packs_reported = ${packCount}
      where id = ${id}
    `;
  }

  async claimWebhookEvent(input: {
    provider: "stripe";
    eventId: string;
    subjectId: string;
    eventType: string;
    createdAt: string;
  }): Promise<WorkClaimResult> {
    return this.sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext(${`webhook:${input.provider}:${input.subjectId}`}))`;
      const duplicate = await sql`
        select processed_at, processing_started_at, last_error
        from webhook_events
        where provider = ${input.provider} and event_id = ${input.eventId}
        limit 1
      `;
      if (duplicate[0]) {
        if (duplicate[0].processed_at) return "completed";
        const processingStartedAt = duplicate[0].processing_started_at
          ? new Date(duplicate[0].processing_started_at).getTime()
          : 0;
        const stale = Date.now() - processingStartedAt >= 5 * 60_000;
        if (!duplicate[0].last_error && !stale) return "busy";
        await sql`
          update webhook_events
          set processing_started_at = now(),
            attempt_count = attempt_count + 1,
            last_error = null
          where provider = ${input.provider} and event_id = ${input.eventId}
        `;
        return "claimed";
      }

      const latest = await sql`
        select event_type, event_created_at
        from webhook_events
        where provider = ${input.provider}
          and subject_id = ${input.subjectId}
        order by event_created_at desc,
          case when event_type = 'customer.subscription.deleted' then 1 else 0 end desc
        limit 1
      `;
      const shouldProcess =
        !latest[0] ||
        new Date(input.createdAt).getTime() >
          new Date(latest[0].event_created_at).getTime() ||
        (new Date(input.createdAt).getTime() ===
          new Date(latest[0].event_created_at).getTime() &&
          (latest[0].event_type !== "customer.subscription.deleted" ||
            input.eventType === "customer.subscription.deleted"));
      await sql`
        insert into webhook_events (
          id, provider, event_id, subject_id, event_type, event_created_at,
          processing_started_at, processed_at
        ) values (
          ${crypto.randomUUID()}, ${input.provider}, ${input.eventId},
          ${input.subjectId}, ${input.eventType}, ${new Date(input.createdAt)},
          ${shouldProcess ? new Date() : null}, ${shouldProcess ? null : new Date()}
        )
      `;
      return shouldProcess ? "claimed" : "completed";
    });
  }

  async completeWebhookEvent(
    provider: "stripe",
    eventId: string,
  ): Promise<void> {
    await this.sql`
      update webhook_events
      set processed_at = now(), last_error = null
      where provider = ${provider} and event_id = ${eventId}
    `;
  }

  async failWebhookEvent(
    provider: "stripe",
    eventId: string,
    error: string,
  ): Promise<void> {
    await this.sql`
      update webhook_events
      set last_error = ${error.slice(0, 2000)}
      where provider = ${provider} and event_id = ${eventId}
    `;
  }

  async releaseWebhookEvent(
    provider: "stripe",
    eventId: string,
  ): Promise<void> {
    await this.sql`
      delete from webhook_events
      where provider = ${provider} and event_id = ${eventId}
    `;
  }

  async claimBillingNotification(input: {
    workspaceId: string;
    dedupeKey: string;
    type: BillingNotificationType;
    recipient: string;
  }): Promise<WorkClaimResult> {
    return this.sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext(${`billing-notification:${input.dedupeKey}:${input.type}:${input.recipient}`}))`;
      const existing = await sql`
        select status, processing_started_at
        from billing_notifications
        where dedupe_key = ${input.dedupeKey}
          and type = ${input.type}
          and recipient = ${input.recipient}
        limit 1
      `;
      if (existing[0]?.status === "sent") return "completed";
      if (existing[0]) {
        const stale =
          Date.now() - new Date(existing[0].processing_started_at).getTime() >=
          5 * 60_000;
        if (existing[0].status === "pending" && !stale) return "busy";
        await sql`
          update billing_notifications
          set status = 'pending', processing_started_at = now(),
            last_error = null, updated_at = now()
          where dedupe_key = ${input.dedupeKey}
            and type = ${input.type}
            and recipient = ${input.recipient}
        `;
        return "claimed";
      }
      await sql`
        insert into billing_notifications (
          id, workspace_id, dedupe_key, type, recipient, status,
          processing_started_at
        ) values (
          ${crypto.randomUUID()}, ${input.workspaceId}, ${input.dedupeKey},
          ${input.type}, ${input.recipient}, 'pending', now()
        )
      `;
      return "claimed";
    });
  }

  async completeBillingNotification(input: {
    dedupeKey: string;
    type: BillingNotificationType;
    recipient: string;
    providerMessageId: string | null;
  }): Promise<void> {
    await this.sql`
      update billing_notifications
      set status = 'sent', provider_message_id = ${input.providerMessageId},
        sent_at = now(), last_error = null, updated_at = now()
      where dedupe_key = ${input.dedupeKey}
        and type = ${input.type}
        and recipient = ${input.recipient}
    `;
  }

  async failBillingNotification(input: {
    dedupeKey: string;
    type: BillingNotificationType;
    recipient: string;
    error: string;
  }): Promise<void> {
    await this.sql`
      update billing_notifications
      set status = 'failed', last_error = ${input.error.slice(0, 2000)},
        updated_at = now()
      where dedupe_key = ${input.dedupeKey}
        and type = ${input.type}
        and recipient = ${input.recipient}
    `;
  }

  async publishEntry(
    workspaceId: string,
    entryId: string,
  ): Promise<StoredEntry | null> {
    const rows = await this.sql`
      update changelog_entries e
      set status = 'published',
        hold_reason = null,
        published_at = coalesce(
          e.published_at,
          (
            select max(pr.merged_at)
            from jsonb_array_elements(e.source_pull_requests) source(value)
            join pull_requests pr
              on pr.repository_id = c.repository_id
             and (
                (
                  (source.value->>'number') ~ '^[0-9]+$'
                  and pr.number = (source.value->>'number')::int
                )
                or lower(trim(trailing '/' from pr.url)) = lower(
                  trim(trailing '/' from coalesce(source.value->>'url', ''))
                )
              )
          ),
          now()
        ),
        updated_at = now()
      from changelogs c
      where e.changelog_id = c.id
        and c.workspace_id = ${workspaceId}
        and e.id = ${entryId}
      returning e.*
    `;

    return rows[0] ? mapEntry(rows[0]) : null;
  }

  async updateEntry(input: UpdateEntryInput): Promise<StoredEntry | null> {
    const rows = await this.sql`
      update changelog_entries e
      set title = ${input.title},
        summary = ${input.summary},
        category = ${input.category},
        article_slug = ${input.articleSlug ?? null},
        article_markdown = ${input.articleMarkdown ?? null},
        published_at = coalesce(
          ${input.publishedAt ? new Date(input.publishedAt) : null},
          e.published_at
        ),
        updated_at = now()
      from changelogs c
      where e.changelog_id = c.id
        and c.workspace_id = ${input.workspaceId}
        and e.id = ${input.entryId}
      returning e.*
    `;

    return rows[0] ? mapEntry(rows[0]) : null;
  }

  async updateEntryImage(
    input: UpdateEntryImageInput,
  ): Promise<StoredEntry | null> {
    const rows = await this.sql`
      update changelog_entries e
      set image_url = ${input.imageUrl},
        image_generation_status = null,
        image_generation_error = null,
        image_generation_next_attempt_at = null,
        image_generation_claim_token = null,
        image_generation_claimed_at = null,
        updated_at = now()
      from changelogs c
      where e.changelog_id = c.id
        and c.workspace_id = ${input.workspaceId}
        and e.id = ${input.entryId}
      returning e.*
    `;

    return rows[0] ? mapEntry(rows[0]) : null;
  }

  async deleteEntry(workspaceId: string, entryId: string): Promise<boolean> {
    const rows = await this.sql`
      delete from changelog_entries e
      using changelogs c
      where e.changelog_id = c.id
        and c.workspace_id = ${workspaceId}
        and e.id = ${entryId}
      returning e.id
    `;

    return rows.length > 0;
  }

  async markEntryNotRelevant(
    input: MarkEntryNotRelevantInput,
  ): Promise<AiFeedback | null> {
    return this.sql.begin(async (sql) => {
      const existingRows = await sql`
        select e.*, c.workspace_id
        from changelog_entries e
        join changelogs c on c.id = e.changelog_id
        where e.id = ${input.entryId}
          and c.workspace_id = ${input.workspaceId}
        limit 1
      `;
      const entry = existingRows[0];

      if (!entry) {
        return null;
      }

      const id = crypto.randomUUID();
      const feedbackRows = await sql`
        insert into ai_feedback (
          id,
          workspace_id,
          changelog_id,
          entry_id,
          title,
          summary,
          category,
          note,
          feedback_kind,
          source_pull_requests
        )
        values (
          ${id},
          ${input.workspaceId},
          ${entry.changelog_id},
          ${entry.id},
          ${entry.title},
          ${entry.summary},
          ${entry.category},
          ${input.note?.trim() || null},
          ${input.feedbackKind ?? "dismissed"},
          ${sql.json(entry.source_pull_requests ?? [])}
        )
        returning *
      `;

      await sql`
        delete from changelog_entries
        where id = ${entry.id}
      `;

      return mapAiFeedback(feedbackRows[0]);
    });
  }

  async listAiFeedback(
    workspaceId: string,
    changelogId: string,
  ): Promise<AiFeedback[]> {
    const rows = await this.sql`
      select *
      from ai_feedback
      where workspace_id = ${workspaceId}
        and changelog_id = ${changelogId}
      order by created_at desc
      limit 100
    `;

    return rows.map(mapAiFeedback);
  }

  async markGenerated(changelogId: string, windowEnd: string): Promise<void> {
    await this.sql`
      update changelogs
      set last_generated_window_end = greatest(
        coalesce(last_generated_window_end, ${new Date(windowEnd)}),
        ${new Date(windowEnd)}
      ), updated_at = now()
      where id = ${changelogId}
    `;
  }

  async listDueChangelogs(now: Date): Promise<StoredChangelog[]> {
    const rows = await this.sql`
      select c.*, r.full_name as repository
      from changelogs c
      join repositories r on r.id = c.repository_id
    `;

    return rows.map(mapChangelog).filter(
      (changelog) =>
        changelog.settings.generationSource === "pull-requests" &&
        isChangelogDue({
          now,
          timeZone: changelog.settings.timeZone,
          publishTime: changelog.settings.publishTime,
          frequency: changelog.settings.scheduleFrequency,
          scheduleWeekday: changelog.settings.scheduleWeekday,
          scheduleMonthDay: changelog.settings.scheduleMonthDay,
          lastGeneratedWindowEnd: changelog.lastGeneratedWindowEnd,
        }),
    );
  }
}

function mapWorkspaceMembership(row: postgres.Row): WorkspaceMembership {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role === "owner" ? "owner" : "member",
    source: row.source === "github" ? "github" : "local",
  };
}

function mapGitHubInstallation(row: postgres.Row): GitHubInstallation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    installationId: row.installation_id,
    accountLogin: row.account_login,
    accountType: row.account_type,
    suspendedAt: row.suspended_at ? toIso(row.suspended_at) : null,
  };
}

function mapCliSetupSession(row: postgres.Row): CliSetupSession {
  return {
    id: row.id,
    browserCodeHash: row.browser_code_hash,
    pollTokenHash: row.poll_token_hash,
    targetRepository: row.target_repository,
    userId: row.user_id ?? null,
    workspaceId: row.workspace_id ?? null,
    changelogId: row.changelog_id ?? null,
    changelogUrl: row.changelog_url ?? null,
    status: row.status,
    error: row.error ?? null,
    expiresAt: toIso(row.expires_at),
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
  };
}

function mapWorkspace(row: postgres.Row): Workspace {
  return {
    id: row.id,
    name: row.name,
    billingMode: row.billing_mode,
    repositoryLimit: row.repository_limit,
    stripeCustomerId: row.stripe_customer_id ?? null,
  };
}

function mapBillingSubscription(row: postgres.Row): BillingSubscription {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCustomerId: row.stripe_customer_id,
    status: row.status,
    planId: row.plan_id,
    billingCadence: row.billing_cadence,
    priceId: row.price_id,
    repositoryLimit: row.repository_limit,
    currentPeriodStart: row.current_period_start
      ? toIso(row.current_period_start)
      : null,
    currentPeriodEnd: row.current_period_end
      ? toIso(row.current_period_end)
      : null,
    billingEmail: row.billing_email ?? null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    cancelAt: row.cancel_at ? toIso(row.cancel_at) : null,
    endedAt: row.ended_at ? toIso(row.ended_at) : null,
    lastPaymentFailedAt: row.last_payment_failed_at
      ? toIso(row.last_payment_failed_at)
      : null,
    autoRechargeEnabled: row.auto_recharge_enabled !== false,
  };
}

function mapComplimentaryAccessGrant(
  row: postgres.Row,
): ComplimentaryAccessGrant {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    planId: row.plan_id,
    reason: row.reason,
    grantedBy: row.granted_by,
    expiresAt: row.expires_at ? toIso(row.expires_at) : null,
    createdAt: toIso(row.created_at),
  };
}

function mapAiUsageEvent(row: postgres.Row): AiUsageEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    stripeCustomerId: row.stripe_customer_id,
    sourceId: row.source_id,
    inputTokens: Number(row.input_tokens),
    cachedInputTokens: Number(row.cached_input_tokens),
    outputTokens: Number(row.output_tokens),
    totalTokens: Number(row.total_tokens),
    rechargePacksReported: Number(row.recharge_packs_reported ?? 0),
    createdAt: toIso(row.created_at),
    reportedAt: row.reported_at?.toISOString?.() ?? row.reported_at ?? null,
  };
}

function mapGitHubRepository(row: postgres.Row): GitHubRepository {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    githubInstallationId: row.github_installation_id ?? null,
    owner: row.owner,
    name: row.name,
    fullName: row.full_name,
    private: row.private,
  };
}

function mapChangelog(row: postgres.Row): StoredChangelog {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    repositoryId: row.repository_id,
    repository: row.repository,
    slug: row.slug,
    name: row.name,
    description: row.description,
    publicUrl: row.public_url,
    customDomain: row.custom_domain ?? null,
    customHostnameId: row.custom_hostname_id ?? null,
    customHostnameStatus: row.custom_hostname_status ?? null,
    customHostnameSslStatus: row.custom_hostname_ssl_status ?? null,
    lastGeneratedWindowEnd: row.last_generated_window_end
      ? toIso(row.last_generated_window_end)
      : null,
    settings: {
      skipLabels: row.skip_labels ?? ["cooee:skip", "cooee:internal"],
      sensitiveLabels: row.sensitive_labels ?? ["security", "vulnerability"],
      categoryDefinitions: normalizeChangelogCategoryDefinitions(
        row.category_definitions,
        defaultChangelogCategoryDefinitions,
      ),
      groupEntriesByCategory: row.group_entries_by_category ?? true,
      generationSource:
        row.generation_source === "releases" ? "releases" : "pull-requests",
      scheduleFrequency: row.schedule_frequency ?? "daily",
      scheduleWeekday: row.schedule_weekday ?? 1,
      scheduleMonthDay: row.schedule_month_day ?? 1,
      publishTime: row.publish_time,
      timeZone: row.time_zone,
      includePullRequestLinks: row.include_pull_request_links,
      publicTheme: row.public_theme === "dark" ? "dark" : "light",
      postImageSettings: normalizePostImageSettings(row.image_settings),
    },
  };
}

function mapEntry(row: postgres.Row): StoredEntry {
  return {
    id: row.id,
    changelogId: row.changelog_id,
    title: row.title,
    summary: row.summary,
    category: row.category,
    status: row.status,
    holdReason: row.hold_reason ?? undefined,
    imageUrl: row.image_url ?? null,
    articleSlug: row.article_slug ?? null,
    articleMarkdown: row.article_markdown ?? null,
    imageGenerationStatus: row.image_generation_status ?? null,
    imageGenerationError: row.image_generation_error ?? null,
    imageGenerationAttemptCount: row.image_generation_attempt_count ?? 0,
    processedAt: row.created_at ? toIso(row.created_at) : undefined,
    windowEndedAt: toIso(row.window_ended_at),
    publishedAt: row.published_at ? toIso(row.published_at) : null,
    items: row.items ?? [],
    sourcePullRequests: row.source_pull_requests ?? [],
  };
}

function mapPostImageGenerationJob(row: postgres.Row): PostImageGenerationJob {
  return {
    entryId: row.id,
    changelogId: row.changelog_id,
    attemptCount: row.image_generation_attempt_count,
    claimToken: row.image_generation_claim_token,
  };
}

function mapMergeGenerationJob(row: postgres.Row): MergeGenerationJob {
  return {
    id: row.id,
    changelogId: row.changelog_id,
    pullRequestNumber: row.pull_request_number,
    generationKey: row.generation_key,
    windowStartedAt: toIso(row.window_started_at),
    windowEndedAt: toIso(row.window_ended_at),
    attemptCount: row.attempt_count,
    claimToken: row.claim_token,
  };
}

function mapAiFeedback(row: postgres.Row): AiFeedback {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    changelogId: row.changelog_id,
    entryId: row.entry_id,
    title: row.title,
    summary: row.summary,
    category: row.category,
    note: row.note ?? null,
    feedbackKind: row.feedback_kind ?? "dismissed",
    sourcePullRequests: row.source_pull_requests ?? [],
    createdAt: toIso(row.created_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
