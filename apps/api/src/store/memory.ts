import {
  defaultChangelogCategoryDefinitions,
  getLastCompletedScheduleWindow,
  isChangelogDue,
} from "@cooee/shared";
import type { PullRequestMetadata } from "@cooee/shared";
import type {
  AiFeedback,
  AiUsageEvent,
  BillingNotificationType,
  BillingSubscription,
  ComplimentaryAccessGrant,
  CreateChangelogInput,
  EnsureGitHubInstallationMembershipsInput,
  GitHubInstallation,
  GitHubRepository,
  MarkEntryNotRelevantInput,
  MergeGenerationJob,
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
  WorkClaimResult,
} from "./types";

export class InMemoryStore implements Store {
  workspaces: Workspace[];
  memberships: WorkspaceMembership[];
  githubInstallations: GitHubInstallation[];
  repositories: GitHubRepository[];
  changelogs: StoredChangelog[];
  entries: StoredEntry[];
  aiFeedback: AiFeedback[];
  pullRequests: PullRequestMetadata[];
  workspaceSettings: Map<string, Partial<WorkspaceSettings>>;
  billingSubscriptions: BillingSubscription[];
  complimentaryAccessGrants: ComplimentaryAccessGrant[];
  generationRuns = new Map<
    string,
    "running" | "published" | "held" | "empty" | "failed"
  >();
  mergeGenerationJobs: Array<
    Omit<MergeGenerationJob, "claimToken"> & {
      status: "pending" | "processing" | "completed";
      nextAttemptAt: string;
      processingStartedAt: string | null;
      claimToken: string | null;
      lastError: string | null;
    }
  > = [];
  entryGenerationKeys = new Map<string, string>();
  processedPullRequestUsage: Array<{
    workspaceId: string;
    repositoryId: string;
    pullRequestNumber: number;
    periodStartedAt: string;
    processedAt: string;
  }> = [];
  webhookEvents: Array<{
    provider: "stripe";
    eventId: string;
    subjectId: string;
    eventType: string;
    createdAt: string;
    processingStartedAt: string | null;
    processedAt: string | null;
    attemptCount: number;
    lastError: string | null;
  }> = [];
  billingNotifications: Array<{
    workspaceId: string;
    dedupeKey: string;
    type: BillingNotificationType;
    recipient: string;
    status: "pending" | "sent" | "failed";
    providerMessageId: string | null;
    lastError: string | null;
    processingStartedAt: string;
  }> = [];
  aiUsageEvents: AiUsageEvent[] = [];

  constructor(input?: {
    workspaces?: Workspace[];
    memberships?: WorkspaceMembership[];
    githubInstallations?: GitHubInstallation[];
    repositories?: GitHubRepository[];
    changelogs?: StoredChangelog[];
    entries?: StoredEntry[];
    aiFeedback?: AiFeedback[];
    pullRequests?: PullRequestMetadata[];
    workspaceSettings?: Array<[string, Partial<WorkspaceSettings>]>;
    billingSubscriptions?: BillingSubscription[];
    complimentaryAccessGrants?: ComplimentaryAccessGrant[];
  }) {
    this.workspaces = input?.workspaces ?? [];
    this.memberships = input?.memberships ?? [];
    this.githubInstallations = input?.githubInstallations ?? [];
    this.repositories = input?.repositories ?? [];
    this.changelogs = input?.changelogs ?? [];
    this.entries = input?.entries ?? [];
    this.aiFeedback = input?.aiFeedback ?? [];
    this.pullRequests = input?.pullRequests ?? [];
    this.workspaceSettings = new Map(input?.workspaceSettings ?? []);
    this.billingSubscriptions = input?.billingSubscriptions ?? [];
    this.complimentaryAccessGrants = input?.complimentaryAccessGrants ?? [];
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  static seeded(): InMemoryStore {
    return new InMemoryStore({
      workspaces: [
        {
          id: "ws_acme",
          name: "Acme",
          billingMode: "self-hosted",
          repositoryLimit: 0,
          stripeCustomerId: null,
        },
      ],
      githubInstallations: [
        {
          id: "ghi_acme",
          workspaceId: "ws_acme",
          installationId: 12345,
          accountLogin: "acme",
          accountType: "Organization",
          suspendedAt: null,
        },
      ],
      repositories: [
        {
          id: "repo_acme",
          workspaceId: "ws_acme",
          githubInstallationId: "ghi_acme",
          owner: "acme",
          name: "app",
          fullName: "acme/app",
          private: false,
        },
      ],
      changelogs: [
        {
          id: "cl_acme",
          workspaceId: "ws_acme",
          repositoryId: "repo_acme",
          slug: "acme-app",
          name: "Acme App",
          description: "Latest product updates",
          publicUrl: "https://cooee.test/changelog/acme-app",
          customDomain: null,
          customHostnameId: null,
          customHostnameStatus: null,
          customHostnameSslStatus: null,
          repository: "acme/app",
          lastGeneratedWindowEnd: null,
          settings: {
            skipLabels: ["cooee:skip", "cooee:internal"],
            sensitiveLabels: ["security", "vulnerability"],
            categoryDefinitions: defaultChangelogCategoryDefinitions,
            groupEntriesByCategory: true,
            scheduleFrequency: "daily",
            scheduleWeekday: 1,
            scheduleMonthDay: 1,
            publishTime: "09:00",
            timeZone: "Australia/Brisbane",
            includePullRequestLinks: false,
            publicTheme: "light",
          },
        },
      ],
      entries: [
        {
          id: "entry_saved_filters",
          changelogId: "cl_acme",
          title: "Saved filters",
          summary: "You can now save filters and reuse them later.",
          category: "feature",
          status: "published",
          publishedAt: "2026-06-05T23:00:00.000Z",
          imageUrl: null,
          windowEndedAt: "2026-06-05T23:00:00.000Z",
          sourcePullRequests: [
            {
              number: 42,
              url: "https://github.com/acme/app/pull/42",
              author: "octocat",
            },
          ],
        },
        {
          id: "entry_login_fix",
          changelogId: "cl_acme",
          title: "More reliable login",
          summary: "Login now recovers cleanly after an expired session.",
          category: "fix",
          status: "published",
          publishedAt: "2026-06-04T23:00:00.000Z",
          imageUrl: null,
          windowEndedAt: "2026-06-04T23:00:00.000Z",
          sourcePullRequests: [
            {
              number: 41,
              url: "https://github.com/acme/app/pull/41",
              author: "mona",
            },
          ],
        },
      ],
      pullRequests: [
        {
          id: "pr_42",
          number: 42,
          title: "Add saved filters",
          body: "Users can save a filter view and reuse it later.",
          labels: ["feature"],
          mergedAt: "2026-06-05T03:15:00.000Z",
          url: "https://github.com/acme/app/pull/42",
          repository: "acme/app",
          author: "octocat",
        },
      ],
    });
  }

  async beginGenerationRun(input: {
    changelogId: string;
    windowStartedAt: string;
    windowEndedAt: string;
  }): Promise<boolean> {
    const key = `${input.changelogId}:${input.windowStartedAt}:${input.windowEndedAt}`;
    const existing = this.generationRuns.get(key);
    if (existing && existing !== "failed") return false;
    this.generationRuns.set(key, "running");
    return true;
  }

  async completeGenerationRun(input: {
    changelogId: string;
    windowStartedAt: string;
    windowEndedAt: string;
    status: "published" | "held" | "empty" | "failed";
  }): Promise<void> {
    const key = `${input.changelogId}:${input.windowStartedAt}:${input.windowEndedAt}`;
    this.generationRuns.set(key, input.status);
  }

  async enqueueMergeGenerationJob(input: {
    changelogId: string;
    pullRequestNumber: number;
    windowStartedAt: string;
    windowEndedAt: string;
  }): Promise<void> {
    const duplicate = this.mergeGenerationJobs.some(
      (job) =>
        job.changelogId === input.changelogId &&
        job.pullRequestNumber === input.pullRequestNumber,
    );
    if (duplicate) return;

    this.mergeGenerationJobs.push({
      id: `merge_job_${crypto.randomUUID()}`,
      ...input,
      attemptCount: 0,
      status: "pending",
      nextAttemptAt: new Date(0).toISOString(),
      processingStartedAt: null,
      claimToken: null,
      lastError: null,
    });
  }

  async claimMergeGenerationJobs(input: {
    now: string;
    limit: number;
  }): Promise<MergeGenerationJob[]> {
    const now = new Date(input.now);
    const staleBefore = new Date(now.getTime() - 60 * 60 * 1000);
    const claimed = this.mergeGenerationJobs
      .filter(
        (job) =>
          (job.status === "pending" &&
            new Date(job.nextAttemptAt).getTime() <= now.getTime()) ||
          (job.status === "processing" &&
            job.processingStartedAt !== null &&
            new Date(job.processingStartedAt).getTime() <
              staleBefore.getTime()),
      )
      .slice(0, input.limit);

    for (const job of claimed) {
      job.status = "processing";
      job.processingStartedAt = now.toISOString();
      job.attemptCount += 1;
      job.claimToken = `${job.id}:${job.attemptCount}`;
    }

    return claimed.map(({ status: _status, claimToken, ...job }) => ({
      ...job,
      claimToken: claimToken!,
    }));
  }

  async completeMergeGenerationJob(input: {
    jobId: string;
    claimToken: string;
  }): Promise<void> {
    const job = this.mergeGenerationJobs.find(
      (item) =>
        item.id === input.jobId &&
        item.status === "processing" &&
        item.claimToken === input.claimToken,
    );
    if (!job) return;
    job.status = "completed";
    job.processingStartedAt = null;
    job.claimToken = null;
    job.lastError = null;
  }

  async retryMergeGenerationJob(input: {
    jobId: string;
    claimToken: string;
    error: string;
    nextAttemptAt: string;
  }): Promise<void> {
    const job = this.mergeGenerationJobs.find(
      (item) =>
        item.id === input.jobId &&
        item.status === "processing" &&
        item.claimToken === input.claimToken,
    );
    if (!job) return;
    job.status = "pending";
    job.processingStartedAt = null;
    job.claimToken = null;
    job.nextAttemptAt = input.nextAttemptAt;
    job.lastError = input.error;
  }

  async listWorkspaceMemberships(
    userId: string,
  ): Promise<WorkspaceMembership[]> {
    return this.memberships.filter(
      (membership) => membership.userId === userId,
    );
  }

  async ensureUserWorkspace(
    input: EnsureUserWorkspaceInput,
  ): Promise<WorkspaceMembership> {
    const existing = (await this.listWorkspaceMemberships(input.userId))[0];
    if (existing) return existing;

    const workspaceId = `ws_${crypto.randomUUID()}`;
    this.workspaces.push({
      id: workspaceId,
      name: input.userName.trim() || "My workspace",
      billingMode: input.billingMode,
      repositoryLimit: input.repositoryLimit,
      stripeCustomerId: null,
    });
    const membership: WorkspaceMembership = {
      id: `membership_${crypto.randomUUID()}`,
      workspaceId,
      userId: input.userId,
      role: "owner",
    };
    this.memberships.push(membership);
    return membership;
  }

  async ensureGitHubInstallationMemberships(
    input: EnsureGitHubInstallationMembershipsInput,
  ): Promise<WorkspaceMembership[]> {
    const accessibleInstallationIds = new Set(input.installationIds);
    const workspaceIds = new Set(
      this.githubInstallations
        .filter((installation) =>
          accessibleInstallationIds.has(installation.installationId),
        )
        .map((installation) => installation.workspaceId),
    );

    for (const workspaceId of workspaceIds) {
      const existing = this.memberships.find(
        (membership) =>
          membership.userId === input.userId &&
          membership.workspaceId === workspaceId,
      );
      if (!existing) {
        this.memberships.push({
          id: `membership_${crypto.randomUUID()}`,
          workspaceId,
          userId: input.userId,
          role: "member",
        });
      }
    }

    return this.listWorkspaceMemberships(input.userId);
  }

  async getWorkspace(workspaceId: string): Promise<Workspace | null> {
    return (
      this.workspaces.find((workspace) => workspace.id === workspaceId) ?? null
    );
  }

  async getWorkspaceSettings(
    workspaceId: string,
  ): Promise<Partial<WorkspaceSettings> | null> {
    return this.workspaceSettings.get(workspaceId) ?? null;
  }

  async updateWorkspaceSettings(
    workspaceId: string,
    settings: WorkspaceSettings,
  ): Promise<WorkspaceSettings> {
    this.workspaceSettings.set(workspaceId, settings);
    return settings;
  }

  async updateWorkspaceBilling(
    input: UpdateWorkspaceBillingInput,
  ): Promise<Workspace | null> {
    const workspace = await this.getWorkspace(input.workspaceId);
    if (!workspace) {
      return null;
    }

    workspace.billingMode = input.billingMode;
    workspace.repositoryLimit = input.repositoryLimit;
    workspace.stripeCustomerId = input.stripeCustomerId ?? null;

    return workspace;
  }

  async getBillingSubscription(
    workspaceId: string,
  ): Promise<BillingSubscription | null> {
    return (
      this.billingSubscriptions.find(
        (subscription) => subscription.workspaceId === workspaceId,
      ) ?? null
    );
  }

  async getActiveComplimentaryAccessGrant(
    workspaceId: string,
  ): Promise<ComplimentaryAccessGrant | null> {
    const now = Date.now();
    return (
      this.complimentaryAccessGrants
        .filter(
          (grant) =>
            grant.workspaceId === workspaceId &&
            (!grant.expiresAt || Date.parse(grant.expiresAt) > now),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  }

  async getBillingSubscriptionByStripeSubscriptionId(
    stripeSubscriptionId: string,
  ): Promise<BillingSubscription | null> {
    return (
      this.billingSubscriptions.find(
        (subscription) =>
          subscription.stripeSubscriptionId === stripeSubscriptionId,
      ) ?? null
    );
  }

  async getBillingSubscriptionByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<BillingSubscription | null> {
    return (
      this.billingSubscriptions.find(
        (subscription) => subscription.stripeCustomerId === stripeCustomerId,
      ) ?? null
    );
  }

  async upsertBillingSubscription(
    input: UpsertBillingSubscriptionInput,
  ): Promise<BillingSubscription> {
    const existing = this.billingSubscriptions.find(
      (subscription) =>
        subscription.stripeSubscriptionId === input.stripeSubscriptionId,
    );

    if (existing) {
      existing.workspaceId = input.workspaceId;
      existing.stripeCustomerId = input.stripeCustomerId;
      existing.status = input.status;
      existing.planId = input.planId;
      existing.billingCadence = input.billingCadence;
      existing.priceId = input.priceId;
      existing.repositoryLimit = input.repositoryLimit;
      existing.currentPeriodStart = input.currentPeriodStart;
      existing.currentPeriodEnd = input.currentPeriodEnd;
      existing.billingEmail = input.billingEmail;
      existing.cancelAtPeriodEnd = input.cancelAtPeriodEnd;
      existing.cancelAt = input.cancelAt;
      existing.endedAt = input.endedAt;
      existing.lastPaymentFailedAt = input.lastPaymentFailedAt;
      existing.autoRechargeEnabled = input.autoRechargeEnabled ?? true;
      return existing;
    }

    const subscription: BillingSubscription = {
      id: `billing_${input.stripeSubscriptionId}`,
      workspaceId: input.workspaceId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      stripeCustomerId: input.stripeCustomerId,
      status: input.status,
      planId: input.planId,
      billingCadence: input.billingCadence,
      priceId: input.priceId,
      repositoryLimit: input.repositoryLimit,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      billingEmail: input.billingEmail,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
      cancelAt: input.cancelAt,
      endedAt: input.endedAt,
      lastPaymentFailedAt: input.lastPaymentFailedAt,
      autoRechargeEnabled: input.autoRechargeEnabled ?? true,
    };
    this.billingSubscriptions.push(subscription);
    return subscription;
  }

  async archiveBillingSubscription(
    stripeSubscriptionId: string,
    endedAt: string,
  ): Promise<void> {
    const subscription = this.billingSubscriptions.find(
      (item) => item.stripeSubscriptionId === stripeSubscriptionId,
    );
    if (
      !subscription ||
      ["canceled", "incomplete_expired"].includes(subscription.status)
    ) {
      return;
    }

    subscription.status = "canceled";
    subscription.cancelAtPeriodEnd = false;
    subscription.cancelAt = null;
    subscription.endedAt = endedAt;
  }

  async listGitHubInstallations(
    workspaceId: string,
  ): Promise<GitHubInstallation[]> {
    return this.githubInstallations.filter(
      (installation) => installation.workspaceId === workspaceId,
    );
  }

  async listRepositories(workspaceId: string): Promise<GitHubRepository[]> {
    return this.repositories.filter(
      (repository) => repository.workspaceId === workspaceId,
    );
  }

  async upsertGitHubInstallation(
    input: UpsertGitHubInstallationInput,
  ): Promise<GitHubInstallation> {
    const existing = this.githubInstallations.find(
      (installation) => installation.installationId === input.installationId,
    );

    if (existing) {
      if (existing.workspaceId !== input.workspaceId) {
        throw new Error("GitHub installation is already assigned.");
      }
      existing.accountLogin = input.accountLogin;
      existing.accountType = input.accountType;
      existing.suspendedAt = input.suspendedAt ?? null;
      return existing;
    }

    const installation: GitHubInstallation = {
      id: `ghi_${input.installationId}`,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      accountLogin: input.accountLogin,
      accountType: input.accountType,
      suspendedAt: input.suspendedAt ?? null,
    };
    this.githubInstallations.push(installation);
    return installation;
  }

  async upsertGitHubRepositories(input: {
    workspaceId: string;
    githubInstallationId: string;
    repositories: UpsertGitHubRepositoryInput[];
  }): Promise<GitHubRepository[]> {
    const upserted = input.repositories.map((repositoryInput) => {
      const existing = this.repositories.find(
        (repository) => repository.fullName === repositoryInput.fullName,
      );

      if (existing) {
        existing.workspaceId = input.workspaceId;
        existing.githubInstallationId = input.githubInstallationId;
        existing.owner = repositoryInput.owner;
        existing.name = repositoryInput.name;
        existing.private = repositoryInput.private;
        return existing;
      }

      const repository: GitHubRepository = {
        id: `repo_${repositoryInput.fullName.replaceAll("/", "_")}`,
        workspaceId: input.workspaceId,
        githubInstallationId: input.githubInstallationId,
        owner: repositoryInput.owner,
        name: repositoryInput.name,
        fullName: repositoryInput.fullName,
        private: repositoryInput.private,
      };
      this.repositories.push(repository);
      return repository;
    });

    return upserted;
  }

  async listChangelogs(workspaceId: string): Promise<StoredChangelog[]> {
    return this.changelogs.filter(
      (changelog) => changelog.workspaceId === workspaceId,
    );
  }

  async createChangelog(
    input: CreateChangelogInput,
  ): Promise<StoredChangelog | null> {
    const existing = this.changelogs.find(
      (changelog) =>
        changelog.workspaceId === input.workspaceId &&
        changelog.repositoryId === input.repositoryId,
    );

    if (existing) {
      return existing;
    }

    if (
      input.repositoryLimit !== null &&
      input.repositoryLimit !== undefined &&
      new Set(
        this.changelogs
          .filter((changelog) => changelog.workspaceId === input.workspaceId)
          .map((changelog) => changelog.repositoryId),
      ).size >= input.repositoryLimit
    ) {
      return null;
    }

    const repository = this.repositories.find(
      (item) => item.id === input.repositoryId,
    );

    if (!repository) {
      throw new Error(`Repository ${input.repositoryId} does not exist.`);
    }

    const changelog: StoredChangelog = {
      id: `cl_${input.slug.replaceAll("-", "_")}`,
      workspaceId: input.workspaceId,
      repositoryId: input.repositoryId,
      repository: repository.fullName,
      slug: input.slug,
      name: input.name,
      description: input.description,
      publicUrl: input.publicUrl,
      customDomain: input.customDomain,
      customHostnameId: input.customHostnameId ?? null,
      customHostnameStatus: input.customHostnameStatus ?? null,
      customHostnameSslStatus: input.customHostnameSslStatus ?? null,
      lastGeneratedWindowEnd: null,
      settings: input.settings,
    };
    this.changelogs.push(changelog);
    return changelog;
  }

  async updateChangelogSettings(
    input: UpdateChangelogSettingsInput,
  ): Promise<StoredChangelog | null> {
    const changelog = this.changelogs.find(
      (item) =>
        item.id === input.changelogId && item.workspaceId === input.workspaceId,
    );

    if (!changelog) {
      return null;
    }

    changelog.slug = input.slug;
    changelog.name = input.name;
    changelog.description = input.description;
    changelog.publicUrl = input.publicUrl;
    changelog.customDomain = input.customDomain;
    changelog.customHostnameId = input.customHostnameId ?? null;
    changelog.customHostnameStatus = input.customHostnameStatus ?? null;
    changelog.customHostnameSslStatus = input.customHostnameSslStatus ?? null;
    changelog.settings = input.settings;
    return changelog;
  }

  async getChangelogBySlug(slug: string): Promise<StoredChangelog | null> {
    return this.changelogs.find((changelog) => changelog.slug === slug) ?? null;
  }

  async getChangelogByCustomDomain(
    domain: string,
  ): Promise<StoredChangelog | null> {
    return (
      this.changelogs.find(
        (changelog) => changelog.customDomain?.toLowerCase() === domain,
      ) ?? null
    );
  }

  async getChangelogById(id: string): Promise<StoredChangelog | null> {
    return this.changelogs.find((changelog) => changelog.id === id) ?? null;
  }

  async getChangelogByRepositoryFullName(
    repositoryFullName: string,
  ): Promise<StoredChangelog | null> {
    return (
      this.changelogs.find(
        (changelog) => changelog.repository === repositoryFullName,
      ) ?? null
    );
  }

  async listEntries(changelogId: string): Promise<StoredEntry[]> {
    const changelog = this.changelogs.find((item) => item.id === changelogId);
    return this.entries
      .filter((entry) => entry.changelogId === changelogId)
      .map((entry) => this.withSourcePullRequestMergedAt(entry, changelog));
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
    return this.pullRequests.filter((pr) => {
      const mergedAt = new Date(pr.mergedAt).getTime();
      return (
        pr.repository === changelog.repository &&
        mergedAt >= new Date(window.startedAt).getTime() &&
        mergedAt < new Date(window.endedAt).getTime()
      );
    });
  }

  async countPullRequestsForWorkspaceRange(
    workspaceId: string,
    window: { startedAt: string; endedAt: string },
  ): Promise<number> {
    const repositoryNames = new Set(
      this.changelogs
        .filter((changelog) => changelog.workspaceId === workspaceId)
        .map((changelog) => changelog.repository),
    );
    const startedAt = new Date(window.startedAt).getTime();
    const endedAt = new Date(window.endedAt).getTime();
    const pullRequestKeys = new Set<string>();

    for (const pullRequest of this.pullRequests) {
      const mergedAt = new Date(pullRequest.mergedAt).getTime();
      if (
        repositoryNames.has(pullRequest.repository) &&
        mergedAt >= startedAt &&
        mergedAt < endedAt
      ) {
        pullRequestKeys.add(
          pullRequest.id || `${pullRequest.repository}:${pullRequest.number}`,
        );
      }
    }

    return pullRequestKeys.size;
  }

  async upsertPullRequest(
    input: UpsertPullRequestInput,
  ): Promise<PullRequestMetadata | null> {
    const repository = this.repositories.find(
      (item) => item.fullName === input.repositoryFullName,
    );

    if (!repository) {
      return null;
    }

    const pullRequest = {
      ...input.pullRequest,
      repository: repository.fullName,
    };
    const existing = this.pullRequests.find(
      (item) => item.id === pullRequest.id,
    );

    if (existing) {
      Object.assign(existing, pullRequest);
      return existing;
    }

    this.pullRequests.push(pullRequest);
    return pullRequest;
  }

  async createEntry(input: NewEntryInput): Promise<StoredEntry> {
    if (input.generationKey) {
      const existingId = this.entryGenerationKeys.get(input.generationKey);
      const existing = this.entries.find((entry) => entry.id === existingId);
      if (existing) return existing;
    }

    const { generationKey, ...entryInput } = input;
    const entry: StoredEntry = {
      id: `entry_${this.entries.length + 1}_${Date.now()}`,
      ...entryInput,
      imageUrl: input.imageUrl ?? null,
      processedAt: new Date().toISOString(),
    };
    this.entries.unshift(entry);
    if (generationKey) this.entryGenerationKeys.set(generationKey, entry.id);
    return entry;
  }

  async countProcessedPullRequestsForWorkspaceRange(
    workspaceId: string,
    window: { startedAt: string; endedAt: string },
  ): Promise<number> {
    return this.processedPullRequestUsage.filter(
      (item) =>
        item.workspaceId === workspaceId &&
        item.processedAt >= window.startedAt &&
        item.processedAt < window.endedAt,
    ).length;
  }

  async reserveProcessedPullRequests(input: {
    workspaceId: string;
    repositoryId: string;
    pullRequestNumbers: number[];
    period: { startedAt: string; endedAt: string };
    limit: number;
  }): Promise<boolean> {
    const uniqueNumbers = [...new Set(input.pullRequestNumbers)];
    const alreadyUsed = this.processedPullRequestUsage.filter(
      (item) =>
        item.workspaceId === input.workspaceId &&
        item.processedAt >= input.period.startedAt &&
        item.processedAt < input.period.endedAt,
    );
    const existingKeys = new Set(
      alreadyUsed.map(
        (item) => `${item.repositoryId}:${item.pullRequestNumber}`,
      ),
    );
    const newNumbers = uniqueNumbers.filter(
      (number) => !existingKeys.has(`${input.repositoryId}:${number}`),
    );
    if (alreadyUsed.length + newNumbers.length > input.limit) return false;

    const processedAt = new Date().toISOString();
    for (const pullRequestNumber of newNumbers) {
      this.processedPullRequestUsage.push({
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId,
        pullRequestNumber,
        periodStartedAt: input.period.startedAt,
        processedAt,
      });
    }
    return true;
  }

  async createAiUsageEvent(
    input: Omit<
      AiUsageEvent,
      "id" | "createdAt" | "reportedAt" | "rechargePacksReported"
    >,
  ): Promise<AiUsageEvent> {
    const existing = this.aiUsageEvents.find(
      (event) => event.sourceId === input.sourceId,
    );
    if (existing) return existing;

    const event: AiUsageEvent = {
      id: crypto.randomUUID(),
      ...input,
      rechargePacksReported: 0,
      createdAt: new Date().toISOString(),
      reportedAt: null,
    };
    this.aiUsageEvents.push(event);
    return event;
  }

  async listUnreportedAiUsageEvents(
    workspaceId: string,
    limit: number,
  ): Promise<AiUsageEvent[]> {
    return this.aiUsageEvents
      .filter((event) => event.workspaceId === workspaceId && !event.reportedAt)
      .filter((event) => event.stripeCustomerId !== null)
      .slice(0, limit);
  }

  async sumAiTokensForWorkspaceRange(
    workspaceId: string,
    window: { startedAt: string; endedAt: string },
  ): Promise<number> {
    return this.aiUsageEvents
      .filter(
        (event) =>
          event.workspaceId === workspaceId &&
          event.createdAt >= window.startedAt &&
          event.createdAt < window.endedAt,
      )
      .reduce((total, event) => total + event.totalTokens, 0);
  }

  async sumAiRechargePacksForWorkspaceRange(
    workspaceId: string,
    window: { startedAt: string; endedAt: string },
  ): Promise<number> {
    return this.aiUsageEvents
      .filter(
        (event) =>
          event.workspaceId === workspaceId &&
          event.createdAt >= window.startedAt &&
          event.createdAt < window.endedAt,
      )
      .reduce((total, event) => total + event.rechargePacksReported, 0);
  }

  async markAiUsageEventReported(id: string): Promise<void> {
    const event = this.aiUsageEvents.find((item) => item.id === id);
    if (event) event.reportedAt = new Date().toISOString();
  }

  async markAiUsageEventRechargePacksReported(
    id: string,
    packCount: number,
  ): Promise<void> {
    const event = this.aiUsageEvents.find((item) => item.id === id);
    if (event) event.rechargePacksReported = packCount;
  }

  async claimWebhookEvent(input: {
    provider: "stripe";
    eventId: string;
    subjectId: string;
    eventType: string;
    createdAt: string;
  }): Promise<WorkClaimResult> {
    const now = new Date();
    const duplicate = this.webhookEvents.find(
      (item) =>
        item.provider === input.provider && item.eventId === input.eventId,
    );
    if (duplicate) {
      if (duplicate.processedAt) return "completed";
      const stale =
        !duplicate.processingStartedAt ||
        now.getTime() - Date.parse(duplicate.processingStartedAt) >= 5 * 60_000;
      if (!duplicate.lastError && !stale) return "busy";
      duplicate.processingStartedAt = now.toISOString();
      duplicate.attemptCount += 1;
      duplicate.lastError = null;
      return "claimed";
    }
    const latest = this.webhookEvents
      .filter(
        (item) =>
          item.provider === input.provider &&
          item.subjectId === input.subjectId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    const shouldProcess =
      !latest ||
      input.createdAt > latest.createdAt ||
      (input.createdAt === latest.createdAt &&
        (latest.eventType !== "customer.subscription.deleted" ||
          input.eventType === "customer.subscription.deleted"));
    this.webhookEvents.push({
      ...input,
      processingStartedAt: shouldProcess ? now.toISOString() : null,
      processedAt: shouldProcess ? null : now.toISOString(),
      attemptCount: 1,
      lastError: null,
    });
    return shouldProcess ? "claimed" : "completed";
  }

  async completeWebhookEvent(
    provider: "stripe",
    eventId: string,
  ): Promise<void> {
    const event = this.webhookEvents.find(
      (item) => item.provider === provider && item.eventId === eventId,
    );
    if (event) {
      event.processedAt = new Date().toISOString();
      event.lastError = null;
    }
  }

  async failWebhookEvent(
    provider: "stripe",
    eventId: string,
    error: string,
  ): Promise<void> {
    const event = this.webhookEvents.find(
      (item) => item.provider === provider && item.eventId === eventId,
    );
    if (event) event.lastError = error;
  }

  async releaseWebhookEvent(
    provider: "stripe",
    eventId: string,
  ): Promise<void> {
    this.webhookEvents = this.webhookEvents.filter(
      (item) => item.provider !== provider || item.eventId !== eventId,
    );
  }

  async claimBillingNotification(input: {
    workspaceId: string;
    dedupeKey: string;
    type: BillingNotificationType;
    recipient: string;
  }): Promise<WorkClaimResult> {
    const now = new Date();
    const existing = this.billingNotifications.find(
      (item) =>
        item.dedupeKey === input.dedupeKey &&
        item.type === input.type &&
        item.recipient === input.recipient,
    );
    if (existing?.status === "sent") return "completed";
    if (existing) {
      const stale =
        now.getTime() - Date.parse(existing.processingStartedAt) >= 5 * 60_000;
      if (existing.status === "pending" && !stale) return "busy";
      existing.status = "pending";
      existing.processingStartedAt = now.toISOString();
      existing.lastError = null;
      return "claimed";
    }
    this.billingNotifications.push({
      ...input,
      status: "pending",
      providerMessageId: null,
      lastError: null,
      processingStartedAt: now.toISOString(),
    });
    return "claimed";
  }

  async completeBillingNotification(input: {
    dedupeKey: string;
    type: BillingNotificationType;
    recipient: string;
    providerMessageId: string | null;
  }): Promise<void> {
    const notification = this.billingNotifications.find(
      (item) =>
        item.dedupeKey === input.dedupeKey &&
        item.type === input.type &&
        item.recipient === input.recipient,
    );
    if (notification) {
      notification.status = "sent";
      notification.providerMessageId = input.providerMessageId;
      notification.lastError = null;
    }
  }

  async failBillingNotification(input: {
    dedupeKey: string;
    type: BillingNotificationType;
    recipient: string;
    error: string;
  }): Promise<void> {
    const notification = this.billingNotifications.find(
      (item) =>
        item.dedupeKey === input.dedupeKey &&
        item.type === input.type &&
        item.recipient === input.recipient,
    );
    if (notification) {
      notification.status = "failed";
      notification.lastError = input.error;
    }
  }

  async publishEntry(
    workspaceId: string,
    entryId: string,
  ): Promise<StoredEntry | null> {
    const entry = this.entries.find((item) => item.id === entryId);
    if (!entry) {
      return null;
    }

    const changelog = this.changelogs.find(
      (item) => item.id === entry.changelogId,
    );
    if (changelog?.workspaceId !== workspaceId) {
      return null;
    }

    entry.status = "published";
    entry.publishedAt =
      entry.publishedAt ?? this.getEntrySourcePullRequestMergedAt(entry);
    entry.holdReason = undefined;
    return entry;
  }

  async updateEntry(input: UpdateEntryInput): Promise<StoredEntry | null> {
    const entry = this.entries.find((item) => item.id === input.entryId);
    if (!entry) {
      return null;
    }

    const changelog = this.changelogs.find(
      (item) => item.id === entry.changelogId,
    );
    if (changelog?.workspaceId !== input.workspaceId) {
      return null;
    }

    entry.title = input.title;
    entry.summary = input.summary;
    entry.category = input.category;
    if (input.publishedAt) {
      entry.publishedAt = input.publishedAt;
    }
    return entry;
  }

  async updateEntryImage(
    input: UpdateEntryImageInput,
  ): Promise<StoredEntry | null> {
    const entry = this.entries.find((item) => item.id === input.entryId);
    if (!entry) {
      return null;
    }

    const changelog = this.changelogs.find(
      (item) => item.id === entry.changelogId,
    );
    if (changelog?.workspaceId !== input.workspaceId) {
      return null;
    }

    entry.imageUrl = input.imageUrl;
    return entry;
  }

  async deleteEntry(workspaceId: string, entryId: string): Promise<boolean> {
    const entry = this.entries.find((item) => item.id === entryId);
    if (!entry) {
      return false;
    }

    const changelog = this.changelogs.find(
      (item) => item.id === entry.changelogId,
    );
    if (changelog?.workspaceId !== workspaceId) {
      return false;
    }

    this.entries = this.entries.filter((item) => item.id !== entryId);
    return true;
  }

  async markEntryNotRelevant(
    input: MarkEntryNotRelevantInput,
  ): Promise<AiFeedback | null> {
    const entry = this.entries.find((item) => item.id === input.entryId);
    if (!entry) {
      return null;
    }

    const changelog = this.changelogs.find(
      (item) => item.id === entry.changelogId,
    );
    if (changelog?.workspaceId !== input.workspaceId) {
      return null;
    }

    const feedback: AiFeedback = {
      id: `ai_feedback_${this.aiFeedback.length + 1}_${Date.now()}`,
      workspaceId: input.workspaceId,
      changelogId: entry.changelogId,
      entryId: entry.id,
      title: entry.title,
      summary: entry.summary,
      category: entry.category,
      note: input.note?.trim() || null,
      feedbackKind: input.feedbackKind ?? "dismissed",
      sourcePullRequests: entry.sourcePullRequests,
      createdAt: new Date().toISOString(),
    };

    this.aiFeedback.unshift(feedback);
    this.entries = this.entries.filter((item) => item.id !== entry.id);
    return feedback;
  }

  async listAiFeedback(
    workspaceId: string,
    changelogId: string,
  ): Promise<AiFeedback[]> {
    return this.aiFeedback.filter(
      (item) =>
        item.workspaceId === workspaceId && item.changelogId === changelogId,
    );
  }

  async markGenerated(changelogId: string, windowEnd: string): Promise<void> {
    const changelog = this.changelogs.find((item) => item.id === changelogId);

    if (changelog) {
      changelog.lastGeneratedWindowEnd = windowEnd;
    }
  }

  async listDueChangelogs(now: Date): Promise<StoredChangelog[]> {
    return this.changelogs.filter((changelog) =>
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

  async close(): Promise<void> {}

  private getEntrySourcePullRequestMergedAt(entry: StoredEntry): string {
    const changelog = this.changelogs.find(
      (item) => item.id === entry.changelogId,
    );
    const sourceKeys = new Set(
      entry.sourcePullRequests.flatMap((pullRequest) =>
        sourcePullRequestKeys(pullRequest),
      ),
    );
    const latest = this.pullRequests
      .filter(
        (pullRequest) =>
          pullRequest.repository === changelog?.repository &&
          pullRequestKeys(pullRequest).some((key) => sourceKeys.has(key)),
      )
      .map((pullRequest) => new Date(pullRequest.mergedAt))
      .filter((mergedAt) => !Number.isNaN(mergedAt.getTime()))
      .sort((left, right) => right.getTime() - left.getTime())[0];

    return latest ? latest.toISOString() : new Date().toISOString();
  }

  private withSourcePullRequestMergedAt(
    entry: StoredEntry,
    changelog: StoredChangelog | undefined,
  ): StoredEntry {
    return {
      ...entry,
      sourcePullRequests: entry.sourcePullRequests.map((sourcePullRequest) => {
        if (sourcePullRequest.mergedAt) {
          return sourcePullRequest;
        }

        const sourceKeys = new Set(sourcePullRequestKeys(sourcePullRequest));
        const pullRequest = this.pullRequests.find(
          (item) =>
            item.repository === changelog?.repository &&
            pullRequestKeys(item).some((key) => sourceKeys.has(key)),
        );

        return pullRequest?.mergedAt
          ? { ...sourcePullRequest, mergedAt: pullRequest.mergedAt }
          : sourcePullRequest;
      }),
    };
  }
}

function pullRequestKeys(pullRequest: PullRequestMetadata): string[] {
  return [
    `number:${pullRequest.number}`,
    pullRequest.url ? `url:${normalizePullRequestUrl(pullRequest.url)}` : null,
  ].filter((key): key is string => Boolean(key));
}

function sourcePullRequestKeys(
  pullRequest: StoredEntry["sourcePullRequests"][number],
): string[] {
  return [
    `number:${pullRequest.number}`,
    pullRequest.url ? `url:${normalizePullRequestUrl(pullRequest.url)}` : null,
  ].filter((key): key is string => Boolean(key));
}

function normalizePullRequestUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return url
      .trim()
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }
}
