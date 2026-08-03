import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  ChangelogCategory,
  ChangelogCategoryDefinition,
  PostImageSettings,
} from "@cooee/shared";

export const billingMode = pgEnum("billing_mode", ["hosted", "self-hosted"]);
export const changelogCategory = pgEnum("changelog_category", [
  "feature",
  "improvement",
  "fix",
  "maintenance",
]);
export const changelogEntryStatus = pgEnum("changelog_entry_status", [
  "draft",
  "held",
  "published",
  "discarded",
]);
export const generationRunStatus = pgEnum("generation_run_status", [
  "running",
  "published",
  "held",
  "empty",
  "failed",
]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  billingMode: billingMode("billing_mode").notNull().default("self-hosted"),
  repositoryLimit: integer("repository_limit").notNull().default(0),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("memberships_workspace_user_idx").on(
      table.workspaceId,
      table.userId,
    ),
  ],
);

export const githubInstallations = pgTable(
  "github_installations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    installationId: integer("installation_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type").notNull(),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("github_installations_installation_id_idx").on(
      table.installationId,
    ),
  ],
);

export const repositories = pgTable(
  "repositories",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    githubInstallationId: text("github_installation_id").references(
      () => githubInstallations.id,
      {
        onDelete: "set null",
      },
    ),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    private: boolean("private").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("repositories_full_name_idx").on(table.fullName)],
);

export const changelogs = pgTable(
  "changelogs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    publicUrl: text("public_url").notNull(),
    customDomain: text("custom_domain"),
    customHostnameId: text("custom_hostname_id"),
    customHostnameStatus: text("custom_hostname_status"),
    customHostnameSslStatus: text("custom_hostname_ssl_status"),
    timeZone: text("time_zone").notNull().default("UTC"),
    publishTime: text("publish_time").notNull().default("09:00"),
    scheduleFrequency: text("schedule_frequency").notNull().default("daily"),
    scheduleWeekday: integer("schedule_weekday").notNull().default(1),
    scheduleMonthDay: integer("schedule_month_day").notNull().default(1),
    skipLabels: jsonb("skip_labels")
      .$type<string[]>()
      .notNull()
      .default(["cooee:skip", "cooee:internal"]),
    sensitiveLabels: jsonb("sensitive_labels")
      .$type<string[]>()
      .notNull()
      .default(["security", "vulnerability"]),
    categoryDefinitions: jsonb("category_definitions")
      .$type<ChangelogCategoryDefinition[]>()
      .notNull()
      .default([
        {
          id: "feature",
          label: "Feature",
          displayType: "post",
          marketingCopy: true,
        },
        {
          id: "improvement",
          label: "Improvement",
          displayType: "callout",
          marketingCopy: false,
        },
        { id: "fix", label: "Fix", displayType: "text", marketingCopy: false },
        {
          id: "maintenance",
          label: "Maintenance",
          displayType: "text",
          marketingCopy: false,
        },
      ]),
    groupEntriesByCategory: boolean("group_entries_by_category")
      .notNull()
      .default(true),
    includePullRequestLinks: boolean("include_pull_request_links")
      .notNull()
      .default(false),
    publicTheme: text("public_theme").notNull().default("light"),
    imageSettings: jsonb("image_settings")
      .$type<PostImageSettings>()
      .notNull()
      .default({
        enabled: false,
        mode: "brand-card",
        accentColor: "#10B981",
        titleOverlay: true,
        backgroundPattern: "space",
        referenceAssetKey: null,
        illustrationStyle: "soft-3d",
        defaultPrompt: "",
      }),
    lastGeneratedWindowEnd: timestamp("last_generated_window_end", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("changelogs_slug_idx").on(table.slug),
    uniqueIndex("changelogs_custom_domain_idx").on(table.customDomain),
    uniqueIndex("changelogs_workspace_repository_idx").on(
      table.workspaceId,
      table.repositoryId,
    ),
  ],
);

export const pullRequests = pgTable("pull_requests", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  githubId: bigint("github_id", { mode: "number" }).notNull(),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  labels: jsonb("labels").$type<string[]>().notNull().default([]),
  url: text("url").notNull(),
  mergedAt: timestamp("merged_at", { withTimezone: true }).notNull(),
  authorLogin: text("author_login"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const changelogEntries = pgTable(
  "changelog_entries",
  {
    id: text("id").primaryKey(),
    changelogId: text("changelog_id")
      .notNull()
      .references(() => changelogs.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    category: text("category").notNull(),
    status: changelogEntryStatus("status").notNull().default("draft"),
    holdReason: text("hold_reason"),
    imageUrl: text("image_url"),
    articleSlug: text("article_slug"),
    articleMarkdown: text("article_markdown"),
    imageGenerationStatus: text("image_generation_status"),
    imageGenerationError: text("image_generation_error"),
    imageGenerationAttemptCount: integer("image_generation_attempt_count")
      .notNull()
      .default(0),
    imageGenerationNextAttemptAt: timestamp(
      "image_generation_next_attempt_at",
      {
        withTimezone: true,
      },
    ),
    imageGenerationClaimToken: text("image_generation_claim_token"),
    imageGenerationClaimedAt: timestamp("image_generation_claimed_at", {
      withTimezone: true,
    }),
    items: jsonb("items")
      .$type<
        Array<{ title: string; summary: string; category: ChangelogCategory }>
      >()
      .notNull()
      .default([]),
    sourcePullRequests: jsonb("source_pull_requests")
      .$type<
        Array<{ number: number; title?: string; url: string; author?: string }>
      >()
      .notNull()
      .default([]),
    generationKey: text("generation_key").unique(),
    windowEndedAt: timestamp("window_ended_at", {
      withTimezone: true,
    }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("changelog_entries_article_slug_idx")
      .on(table.changelogId, table.articleSlug)
      .where(sql`${table.articleSlug} is not null`),
    index("changelog_entries_image_generation_due_idx").on(
      table.imageGenerationStatus,
      table.imageGenerationNextAttemptAt,
    ),
  ],
);

export const aiFeedback = pgTable(
  "ai_feedback",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    changelogId: text("changelog_id")
      .notNull()
      .references(() => changelogs.id, { onDelete: "cascade" }),
    entryId: text("entry_id").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    category: text("category").notNull(),
    note: text("note"),
    feedbackKind: text("feedback_kind").notNull().default("dismissed"),
    sourcePullRequests: jsonb("source_pull_requests")
      .$type<
        Array<{ number: number; title?: string; url: string; author?: string }>
      >()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ai_feedback_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

export const generationRuns = pgTable(
  "generation_runs",
  {
    id: text("id").primaryKey(),
    changelogId: text("changelog_id")
      .notNull()
      .references(() => changelogs.id, { onDelete: "cascade" }),
    status: generationRunStatus("status").notNull(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    windowEndedAt: timestamp("window_ended_at", {
      withTimezone: true,
    }).notNull(),
    model: text("model"),
    holdReason: text("hold_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("generation_runs_changelog_window_idx").on(
      table.changelogId,
      table.windowStartedAt,
      table.windowEndedAt,
    ),
  ],
);

export const mergeGenerationJobs = pgTable(
  "merge_generation_jobs",
  {
    id: text("id").primaryKey(),
    changelogId: text("changelog_id")
      .notNull()
      .references(() => changelogs.id, { onDelete: "cascade" }),
    pullRequestNumber: integer("pull_request_number").notNull(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    windowEndedAt: timestamp("window_ended_at", {
      withTimezone: true,
    }).notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processingStartedAt: timestamp("processing_started_at", {
      withTimezone: true,
    }),
    claimToken: text("claim_token"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("merge_generation_jobs_changelog_pr_idx").on(
      table.changelogId,
      table.pullRequestNumber,
    ),
    index("merge_generation_jobs_due_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
  ],
);

export const processedPullRequestUsage = pgTable(
  "processed_pull_request_usage",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    repositoryId: text("repository_id").notNull(),
    pullRequestNumber: integer("pull_request_number").notNull(),
    periodStartedAt: timestamp("period_started_at", {
      withTimezone: true,
    }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("processed_pull_request_usage_period_key").on(
      table.workspaceId,
      table.repositoryId,
      table.pullRequestNumber,
      table.periodStartedAt,
    ),
    index("processed_pull_request_usage_workspace_processed_idx").on(
      table.workspaceId,
      table.processedAt,
    ),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    subjectId: text("subject_id").notNull(),
    eventType: text("event_type").notNull(),
    eventCreatedAt: timestamp("event_created_at", {
      withTimezone: true,
    }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processingStartedAt: timestamp("processing_started_at", {
      withTimezone: true,
    }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(1),
    lastError: text("last_error"),
  },
  (table) => [
    uniqueIndex("webhook_events_provider_event_idx").on(
      table.provider,
      table.eventId,
    ),
    index("webhook_events_subject_created_idx").on(
      table.provider,
      table.subjectId,
      table.eventCreatedAt,
    ),
  ],
);

export const billingSubscriptions = pgTable("billing_subscriptions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  stripeSubscriptionId: text("stripe_subscription_id").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  status: text("status").notNull(),
  planId: text("plan_id").notNull(),
  billingCadence: text("billing_cadence").notNull(),
  priceId: text("price_id").notNull(),
  repositoryLimit: integer("repository_limit").notNull(),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  billingEmail: text("billing_email"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  cancelAt: timestamp("cancel_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  lastPaymentFailedAt: timestamp("last_payment_failed_at", {
    withTimezone: true,
  }),
  autoRechargeEnabled: boolean("auto_recharge_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const complimentaryAccessGrants = pgTable(
  "complimentary_access_grants",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    planId: text("plan_id").notNull(),
    reason: text("reason").notNull(),
    grantedBy: text("granted_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("complimentary_access_grants_workspace_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

export const billingNotifications = pgTable(
  "billing_notifications",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key").notNull(),
    type: text("type").notNull(),
    recipient: text("recipient").notNull(),
    status: text("status").notNull(),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    processingStartedAt: timestamp("processing_started_at", {
      withTimezone: true,
    }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_notifications_dedupe_idx").on(
      table.dedupeKey,
      table.type,
      table.recipient,
    ),
    index("billing_notifications_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").references(() => workspaces.id, {
    onDelete: "set null",
  }),
  actorUserId: text("actor_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id"),
  metadata: jsonb("metadata")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
