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
  CliSetupSession,
  ChangelogSettings,
  CreateCliSetupSessionInput,
  CreateChangelogInput,
  EnsureGitHubInstallationMembershipsInput,
  GitHubInstallation,
  GitHubRepository,
  MarkEntryNotRelevantInput,
  ResolveHeldEntryInput,
  ResolveHeldEntryResult,
  MergeGenerationJob,
  ListPublicEntriesInput,
  NewEntryInput,
  Store,
  StoredChangelog,
  StoredEntry,
  UpdateChangelogSettingsInput,
  UpdateEntryImageInput,
  UpdateEntryInput,
  EnsureUserWorkspaceInput,
  UpsertGitHubInstallationInput,
  UpsertPullRequestInput,
  UpsertGitHubRepositoryInput,
  Workspace,
  WorkspaceMembership,
  WorkspaceSettings,
  PostImageGenerationJob,
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
        insert into workspaces (id, name)
        values (${workspaceId}, ${input.userName.trim() || "My workspace"})
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

      const rows = await sql`
        insert into changelogs (
          id, workspace_id, repository_id, slug, name, description,
          public_url, custom_domain, custom_hostname_id,
          custom_hostname_status, custom_hostname_ssl_status, time_zone,
          publish_time, schedule_frequency, schedule_weekday,
          schedule_month_day, generation_source, skip_labels, sensitive_labels,
          category_definitions, group_entries_by_category,
          include_pull_request_links, public_theme, image_settings,
          configuration
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
          ${sql.json(input.settings.postImageSettings)},
          ${sql.json(changelogConfiguration(input.settings))}
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
        configuration = ${this.sql.json(changelogConfiguration(input.settings))},
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

  async deleteHeldEntriesOlderThan(cutoff: string): Promise<number> {
    const rows = await this.sql`
      delete from changelog_entries
      where status = 'held'
        and created_at <= ${new Date(cutoff)}
      returning id
    `;

    return rows.length;
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

  async resolveHeldEntry(
    input: ResolveHeldEntryInput,
  ): Promise<ResolveHeldEntryResult | null> {
    return this.sql.begin(async (sql) => {
      const existingRows = await sql`
        select e.*, c.workspace_id, c.repository_id
        from changelog_entries e
        join changelogs c on c.id = e.changelog_id
        where e.id = ${input.entryId}
          and c.workspace_id = ${input.workspaceId}
          and e.status = 'held'
        limit 1
        for update
      `;
      const entry = existingRows[0];
      if (!entry) {
        return null;
      }

      const shouldPublish = input.resolution === "should-publish";
      const title = shouldPublish ? (input.title ?? entry.title) : entry.title;
      const summary = shouldPublish
        ? (input.summary ?? entry.summary)
        : entry.summary;
      const category = shouldPublish
        ? (input.category ?? entry.category)
        : entry.category;
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
        ) values (
          ${crypto.randomUUID()},
          ${input.workspaceId},
          ${entry.changelog_id},
          ${entry.id},
          ${title},
          ${summary},
          ${category},
          ${input.note?.trim() || null},
          ${shouldPublish ? "relevant" : "dismissed"},
          ${sql.json(entry.source_pull_requests ?? [])}
        )
        returning *
      `;

      if (!shouldPublish) {
        await sql`
          delete from changelog_entries
          where id = ${entry.id}
        `;
        return { feedback: mapAiFeedback(feedbackRows[0]), entry: null };
      }

      const publishedRows = await sql`
        update changelog_entries e
        set status = 'published',
          title = ${title},
          summary = ${summary},
          category = ${category},
          hold_reason = null,
          published_at = coalesce(
            e.published_at,
            (
              select max(pr.merged_at)
              from jsonb_array_elements(e.source_pull_requests) source(value)
              join pull_requests pr
                on pr.repository_id = ${entry.repository_id}
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
        where e.id = ${entry.id}
        returning e.*
      `;

      return {
        feedback: mapAiFeedback(feedbackRows[0]),
        entry: mapEntry(publishedRows[0]),
      };
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
      ...((row.configuration as Partial<ChangelogSettings> | undefined) ?? {}),
    },
  };
}

function changelogConfiguration(
  settings: ChangelogSettings,
): Partial<ChangelogSettings> {
  const {
    skipLabels: _skipLabels,
    sensitiveLabels: _sensitiveLabels,
    categoryDefinitions: _categoryDefinitions,
    groupEntriesByCategory: _groupEntriesByCategory,
    generationSource: _generationSource,
    scheduleFrequency: _scheduleFrequency,
    scheduleWeekday: _scheduleWeekday,
    scheduleMonthDay: _scheduleMonthDay,
    publishTime: _publishTime,
    timeZone: _timeZone,
    includePullRequestLinks: _includePullRequestLinks,
    publicTheme: _publicTheme,
    postImageSettings: _postImageSettings,
    ...configuration
  } = settings;
  return configuration;
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
