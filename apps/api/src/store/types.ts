import type {
  ChangelogGenerationSource,
  BillingCadence,
  ChangelogCategoryDefinition,
  ChangelogEntry,
  ChangelogEntryStatus,
  ChangelogLogoAlignment,
  ChangelogPublicTheme,
  HostedPaidPlanId,
  PostImageSettings,
  PullRequestMetadata,
  PublicChangelog,
  ScheduleFrequency,
} from "@cooee/shared";

export type Workspace = {
  id: string;
  name: string;
  billingMode: "hosted" | "self-hosted";
  repositoryLimit: number;
  stripeCustomerId?: string | null;
};

export type WorkspaceMembership = {
  id: string;
  workspaceId: string;
  userId: string;
  role: "owner" | "member";
  source?: "local" | "github";
};

export type EnsureUserWorkspaceInput = {
  userId: string;
  userName: string;
  billingMode: Workspace["billingMode"];
  repositoryLimit: number;
};

export type EnsureGitHubInstallationMembershipsInput = {
  userId: string;
  installationIds: number[];
  repositoryFullNames: string[];
};

export type BillingSubscription = {
  id: string;
  workspaceId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string;
  planId: HostedPaidPlanId;
  billingCadence: BillingCadence;
  priceId: string;
  repositoryLimit: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  billingEmail: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  endedAt: string | null;
  lastPaymentFailedAt: string | null;
  autoRechargeEnabled?: boolean;
};

export type ComplimentaryAccessGrant = {
  id: string;
  workspaceId: string;
  planId: HostedPaidPlanId;
  reason: string;
  grantedBy: string;
  expiresAt: string | null;
  createdAt: string;
};

export type BillingNotificationType =
  | "subscription_started"
  | "plan_changed"
  | "payment_failed"
  | "payment_action_required"
  | "payment_recovered"
  | "invoice_finalization_failed"
  | "cancellation_scheduled"
  | "cancellation_reversed"
  | "subscription_canceled"
  | "account_restricted"
  | "account_restored"
  | "trial_ending";
export type WorkClaimResult = "claimed" | "completed" | "busy";

export type AiUsageEvent = {
  id: string;
  workspaceId: string;
  stripeCustomerId: string | null;
  sourceId: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  rechargePacksReported: number;
  createdAt: string;
  reportedAt: string | null;
};

export type UpdateWorkspaceBillingInput = {
  workspaceId: string;
  billingMode: Workspace["billingMode"];
  repositoryLimit: number;
  stripeCustomerId?: string | null;
};

export type UpsertBillingSubscriptionInput = {
  workspaceId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string;
  planId: HostedPaidPlanId;
  billingCadence: BillingCadence;
  priceId: string;
  repositoryLimit: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  billingEmail: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  endedAt: string | null;
  lastPaymentFailedAt: string | null;
  autoRechargeEnabled?: boolean;
};

export type WorkspaceSettings = {
  appName: string;
  publicChangelog: boolean;
  includePullRequestLinks: boolean;
  publicTheme: ChangelogPublicTheme;
  publicLogoAlignment: ChangelogLogoAlignment;
  logoAssetKey: string | null;
  logoDataUrl: string | null;
  logoUrl: string | null;
  lightLogoAssetKey: string | null;
  lightLogoDataUrl: string | null;
  lightLogoUrl: string | null;
  faviconAssetKey: string | null;
  faviconDataUrl: string | null;
  faviconUrl: string | null;
  publicAppUrl: string;
  publicAppLabel: string;
  aiMinimumConfidence: string;
  aiAudience: "product-users" | "technical-users";
  aiPersonality: "product-user" | "concise" | "technical";
  aiFailClosed: boolean;
  createImagesPerUpdate: boolean;
  generationSource: ChangelogGenerationSource;
  scheduleFrequency: ScheduleFrequency;
  scheduleWeekday?: number;
  scheduleMonthDay?: number;
  historicalBackfillDays: number;
  onboardingCompleted: boolean;
  publishTime: string;
  timeZone: string;
  publicSlug: string;
  customDomain: string;
  privacyLabels: string;
};

export type GitHubInstallation = {
  id: string;
  workspaceId: string;
  installationId: number;
  accountLogin: string;
  accountType: string;
  suspendedAt: string | null;
};

export type GitHubRepository = {
  id: string;
  workspaceId: string;
  githubInstallationId: string | null;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
};

export type CliSetupSessionStatus =
  | "pending"
  | "awaiting-installation"
  | "repository-not-granted"
  | "ready-to-complete"
  | "completed";

export type CliSetupSession = {
  id: string;
  browserCodeHash: string;
  pollTokenHash: string;
  targetRepository: string;
  userId: string | null;
  workspaceId: string | null;
  changelogId: string | null;
  changelogUrl: string | null;
  status: CliSetupSessionStatus;
  error: string | null;
  expiresAt: string;
  completedAt: string | null;
};

export type CreateCliSetupSessionInput = Pick<
  CliSetupSession,
  "browserCodeHash" | "pollTokenHash" | "targetRepository" | "expiresAt"
>;

export type UpsertGitHubInstallationInput = {
  workspaceId: string;
  installationId: number;
  accountLogin: string;
  accountType: string;
  suspendedAt?: string | null;
};

export type UpsertGitHubRepositoryInput = {
  workspaceId: string;
  githubInstallationId: string;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
};

export type ChangelogSettings = {
  skipLabels: string[];
  sensitiveLabels: string[];
  categoryDefinitions: ChangelogCategoryDefinition[];
  groupEntriesByCategory: boolean;
  generationSource: ChangelogGenerationSource;
  scheduleFrequency: ScheduleFrequency;
  scheduleWeekday?: number;
  scheduleMonthDay?: number;
  publishTime: string;
  timeZone: string;
  includePullRequestLinks: boolean;
  publicTheme: ChangelogPublicTheme;
  postImageSettings: PostImageSettings;
};

export type StoredChangelog = PublicChangelog & {
  id: string;
  workspaceId: string;
  repositoryId: string;
  repository: string;
  customDomain: string | null;
  customHostnameId: string | null;
  customHostnameStatus: string | null;
  customHostnameSslStatus: string | null;
  settings: ChangelogSettings;
  lastGeneratedWindowEnd: string | null;
};

export type StoredEntry = ChangelogEntry & {
  changelogId: string;
  holdReason?: string;
  processedAt?: string;
  windowEndedAt: string;
  imageGenerationStatus?: "pending" | "generating" | "failed" | null;
  imageGenerationError?: string | null;
  imageGenerationAttemptCount?: number;
};

export type ListPublicEntriesInput = {
  changelogId: string;
  publishedAtOrAfter?: string;
  publishedBefore?: string;
  publishedAtOrBefore?: string;
  limit: number;
};

export type PostImageGenerationJob = {
  entryId: string;
  changelogId: string;
  attemptCount: number;
  claimToken: string;
};

export type MergeGenerationJob = {
  id: string;
  changelogId: string;
  pullRequestNumber: number | null;
  generationKey: string;
  windowStartedAt: string;
  windowEndedAt: string;
  attemptCount: number;
  claimToken: string;
};

export type NewEntryInput = {
  changelogId: string;
  title: string;
  summary: string;
  category: ChangelogEntry["category"];
  status: ChangelogEntryStatus;
  publishedAt: string | null;
  holdReason?: string;
  windowEndedAt: string;
  imageUrl?: string | null;
  articleSlug?: string | null;
  articleMarkdown?: string | null;
  items?: ChangelogEntry["items"];
  sourcePullRequests: ChangelogEntry["sourcePullRequests"];
  generationKey?: string;
};

export type UpdateEntryInput = {
  workspaceId: string;
  entryId: string;
  title: string;
  summary: string;
  category: ChangelogEntry["category"];
  publishedAt?: string;
  articleSlug?: string | null;
  articleMarkdown?: string | null;
};

export type UpdateEntryImageInput = {
  workspaceId: string;
  entryId: string;
  imageUrl: string | null;
};

export type EnqueuePostImageGenerationInput = {
  workspaceId: string;
  entryId: string;
};

export type AiFeedback = {
  id: string;
  workspaceId: string;
  changelogId: string;
  entryId: string;
  title: string;
  summary: string;
  category: ChangelogEntry["category"];
  note: string | null;
  feedbackKind: "dismissed" | "relevant" | "merged";
  sourcePullRequests: StoredEntry["sourcePullRequests"];
  createdAt: string;
};

export type MarkEntryNotRelevantInput = {
  workspaceId: string;
  entryId: string;
  note?: string | null;
  feedbackKind?: AiFeedback["feedbackKind"];
};

export type CreateChangelogInput = {
  workspaceId: string;
  repositoryId: string;
  slug: string;
  name: string;
  description: string;
  publicUrl: string;
  customDomain: string | null;
  customHostnameId?: string | null;
  customHostnameStatus?: string | null;
  customHostnameSslStatus?: string | null;
  settings: ChangelogSettings;
  repositoryLimit?: number | null;
};

export type UpdateChangelogSettingsInput = {
  workspaceId: string;
  changelogId: string;
  slug: string;
  name: string;
  description: string;
  publicUrl: string;
  customDomain: string | null;
  customHostnameId?: string | null;
  customHostnameStatus?: string | null;
  customHostnameSslStatus?: string | null;
  settings: ChangelogSettings;
};

export type UpsertPullRequestInput = {
  repositoryFullName: string;
  pullRequest: PullRequestMetadata;
};

export type Store = {
  healthCheck(): Promise<boolean>;
  beginGenerationRun(input: {
    changelogId: string;
    windowStartedAt: string;
    windowEndedAt: string;
  }): Promise<boolean>;
  completeGenerationRun(input: {
    changelogId: string;
    windowStartedAt: string;
    windowEndedAt: string;
    status: "published" | "held" | "empty" | "failed";
    holdReason?: string | null;
  }): Promise<void>;
  enqueueMergeGenerationJob(input: {
    changelogId: string;
    pullRequestNumber: number;
    windowStartedAt: string;
    windowEndedAt: string;
  }): Promise<void>;
  enqueueReleaseGenerationJob(input: {
    changelogId: string;
    tagName: string;
    windowStartedAt: string;
    windowEndedAt: string;
  }): Promise<void>;
  claimMergeGenerationJobs(input: {
    now: string;
    limit: number;
  }): Promise<MergeGenerationJob[]>;
  completeMergeGenerationJob(input: {
    jobId: string;
    claimToken: string;
  }): Promise<void>;
  retryMergeGenerationJob(input: {
    jobId: string;
    claimToken: string;
    error: string;
    nextAttemptAt: string;
  }): Promise<void>;
  enqueuePostImageGeneration(
    input: EnqueuePostImageGenerationInput,
  ): Promise<StoredEntry | null>;
  claimPostImageGenerationJobs(input: {
    now: string;
    limit: number;
  }): Promise<PostImageGenerationJob[]>;
  completePostImageGeneration(input: {
    entryId: string;
    claimToken: string;
    imageUrl: string;
  }): Promise<StoredEntry | null>;
  retryPostImageGeneration(input: {
    entryId: string;
    claimToken: string;
    error: string;
    nextAttemptAt?: string;
  }): Promise<void>;
  listWorkspaceMemberships(userId: string): Promise<WorkspaceMembership[]>;
  ensureUserWorkspace(
    input: EnsureUserWorkspaceInput,
  ): Promise<WorkspaceMembership>;
  ensureGitHubInstallationMemberships(
    input: EnsureGitHubInstallationMembershipsInput,
  ): Promise<WorkspaceMembership[]>;
  getWorkspace(workspaceId: string): Promise<Workspace | null>;
  getWorkspaceSettings(
    workspaceId: string,
  ): Promise<Partial<WorkspaceSettings> | null>;
  updateWorkspaceSettings(
    workspaceId: string,
    settings: WorkspaceSettings,
  ): Promise<WorkspaceSettings>;
  updateWorkspaceBilling(
    input: UpdateWorkspaceBillingInput,
  ): Promise<Workspace | null>;
  getBillingSubscription(
    workspaceId: string,
  ): Promise<BillingSubscription | null>;
  getActiveComplimentaryAccessGrant(
    workspaceId: string,
  ): Promise<ComplimentaryAccessGrant | null>;
  getBillingSubscriptionByStripeSubscriptionId(
    stripeSubscriptionId: string,
  ): Promise<BillingSubscription | null>;
  getBillingSubscriptionByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<BillingSubscription | null>;
  upsertBillingSubscription(
    input: UpsertBillingSubscriptionInput,
  ): Promise<BillingSubscription>;
  archiveBillingSubscription(
    stripeSubscriptionId: string,
    endedAt: string,
  ): Promise<void>;
  pruneCliSetupSessions(before: string): Promise<void>;
  createCliSetupSession(
    input: CreateCliSetupSessionInput,
  ): Promise<CliSetupSession>;
  getCliSetupSession(id: string): Promise<CliSetupSession | null>;
  getCliSetupSessionByBrowserCodeHash(
    browserCodeHash: string,
  ): Promise<CliSetupSession | null>;
  claimCliSetupSession(input: {
    id: string;
    userId: string;
    workspaceId: string;
  }): Promise<CliSetupSession | null>;
  updateCliSetupSession(input: {
    id: string;
    status: CliSetupSessionStatus;
    error?: string | null;
    changelogId?: string | null;
    changelogUrl?: string | null;
    completedAt?: string | null;
  }): Promise<CliSetupSession | null>;
  listGitHubInstallations(workspaceId: string): Promise<GitHubInstallation[]>;
  listRepositories(workspaceId: string): Promise<GitHubRepository[]>;
  upsertGitHubInstallation(
    input: UpsertGitHubInstallationInput,
  ): Promise<GitHubInstallation>;
  upsertGitHubRepositories(input: {
    workspaceId: string;
    githubInstallationId: string;
    repositories: UpsertGitHubRepositoryInput[];
  }): Promise<GitHubRepository[]>;
  listChangelogs(workspaceId: string): Promise<StoredChangelog[]>;
  createChangelog(input: CreateChangelogInput): Promise<StoredChangelog | null>;
  updateChangelogSettings(
    input: UpdateChangelogSettingsInput,
  ): Promise<StoredChangelog | null>;
  getChangelogBySlug(slug: string): Promise<StoredChangelog | null>;
  getChangelogByCustomDomain(domain: string): Promise<StoredChangelog | null>;
  getChangelogById(id: string): Promise<StoredChangelog | null>;
  getChangelogByRepositoryFullName(
    repositoryFullName: string,
  ): Promise<StoredChangelog | null>;
  listEntries(changelogId: string): Promise<StoredEntry[]>;
  listPublicEntries(input: ListPublicEntriesInput): Promise<StoredEntry[]>;
  hasPublicEntryBefore(
    changelogId: string,
    publishedBefore: string,
  ): Promise<boolean>;
  getPublishedArticleBySlug(
    changelogId: string,
    articleSlug: string,
  ): Promise<StoredEntry | null>;
  listPullRequestsForWindow(
    changelog: StoredChangelog,
    windowEnd: string,
  ): Promise<PullRequestMetadata[]>;
  listPullRequestsForRange(
    changelog: StoredChangelog,
    window: { startedAt: string; endedAt: string },
  ): Promise<PullRequestMetadata[]>;
  countPullRequestsForWorkspaceRange(
    workspaceId: string,
    window: { startedAt: string; endedAt: string },
  ): Promise<number>;
  countProcessedPullRequestsForWorkspaceRange(
    workspaceId: string,
    window: { startedAt: string; endedAt: string },
  ): Promise<number>;
  reserveProcessedPullRequests(input: {
    workspaceId: string;
    repositoryId: string;
    pullRequestNumbers: number[];
    period: { startedAt: string; endedAt: string };
    limit: number;
  }): Promise<boolean>;
  createAiUsageEvent(
    input: Omit<
      AiUsageEvent,
      "id" | "createdAt" | "reportedAt" | "rechargePacksReported"
    >,
  ): Promise<AiUsageEvent>;
  listUnreportedAiUsageEvents(
    workspaceId: string,
    limit: number,
  ): Promise<AiUsageEvent[]>;
  sumAiTokensForWorkspaceRange(
    workspaceId: string,
    window: { startedAt: string; endedAt: string },
  ): Promise<number>;
  sumAiRechargePacksForWorkspaceRange(
    workspaceId: string,
    window: { startedAt: string; endedAt: string },
  ): Promise<number>;
  markAiUsageEventReported(id: string): Promise<void>;
  markAiUsageEventRechargePacksReported(
    id: string,
    packCount: number,
  ): Promise<void>;
  claimWebhookEvent(input: {
    provider: "stripe";
    eventId: string;
    subjectId: string;
    eventType: string;
    createdAt: string;
  }): Promise<WorkClaimResult>;
  completeWebhookEvent(provider: "stripe", eventId: string): Promise<void>;
  failWebhookEvent(
    provider: "stripe",
    eventId: string,
    error: string,
  ): Promise<void>;
  releaseWebhookEvent(provider: "stripe", eventId: string): Promise<void>;
  claimBillingNotification(input: {
    workspaceId: string;
    dedupeKey: string;
    type: BillingNotificationType;
    recipient: string;
  }): Promise<WorkClaimResult>;
  completeBillingNotification(input: {
    dedupeKey: string;
    type: BillingNotificationType;
    recipient: string;
    providerMessageId: string | null;
  }): Promise<void>;
  failBillingNotification(input: {
    dedupeKey: string;
    type: BillingNotificationType;
    recipient: string;
    error: string;
  }): Promise<void>;
  upsertPullRequest(
    input: UpsertPullRequestInput,
  ): Promise<PullRequestMetadata | null>;
  createEntry(input: NewEntryInput): Promise<StoredEntry>;
  publishEntry(
    workspaceId: string,
    entryId: string,
  ): Promise<StoredEntry | null>;
  updateEntry(input: UpdateEntryInput): Promise<StoredEntry | null>;
  updateEntryImage(input: UpdateEntryImageInput): Promise<StoredEntry | null>;
  deleteEntry(workspaceId: string, entryId: string): Promise<boolean>;
  markEntryNotRelevant(
    input: MarkEntryNotRelevantInput,
  ): Promise<AiFeedback | null>;
  listAiFeedback(
    workspaceId: string,
    changelogId: string,
  ): Promise<AiFeedback[]>;
  markGenerated(changelogId: string, windowEnd: string): Promise<void>;
  listDueChangelogs(now: Date): Promise<StoredChangelog[]>;
  close?(): Promise<void>;
};
