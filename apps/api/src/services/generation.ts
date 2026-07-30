import {
  compareChangelogCategories,
  filterPublishablePullRequests,
  getLastCompletedScheduleWindow,
  validateGeneratedEntry,
} from "@cooee/shared";
import type {
  AiWritingOptions,
  ChangelogEntry,
  GeneratedChangeItem,
  PullRequestMetadata,
} from "@cooee/shared";
import {
  unwrapAiSummaryResult,
  type AiSummarizer,
  type AiTokenUsage,
} from "./openai";
import type { Store, StoredChangelog, StoredEntry } from "../store/types";
import {
  assertWorkspaceEntitlement,
  getWorkspaceEntitlements,
} from "./entitlements";

export async function generateChangelogForWindow(input: {
  store: Store;
  summarizer: AiSummarizer;
  recordAiUsage?: (input: {
    workspaceId: string;
    sourceId: string;
    usage: AiTokenUsage;
  }) => Promise<void>;
  changelogId: string;
  pullRequestNumbers?: number[];
  generationKey?: string;
  windowStart?: string;
  windowEnd: string;
}): Promise<{
  status: ChangelogEntry["status"] | "empty";
  entry?: StoredEntry;
  entries?: StoredEntry[];
  holdReason?: string;
}> {
  const changelog = await input.store.getChangelogById(input.changelogId);
  if (!changelog) {
    throw new Response("Changelog not found", { status: 404 });
  }
  await assertWorkspaceEntitlement({
    store: input.store,
    workspaceId: changelog.workspaceId,
    capability: "aiGeneration",
    message: "A paid plan is required to generate posts with AI.",
  });
  await assertActiveRepositoryEntitlement(input.store, changelog);
  const window = input.windowStart
    ? { startedAt: input.windowStart, endedAt: input.windowEnd }
    : getLastCompletedScheduleWindow({
        now: new Date(input.windowEnd),
        timeZone: changelog.settings.timeZone,
        publishTime: changelog.settings.publishTime,
        frequency: changelog.settings.scheduleFrequency,
        scheduleWeekday: changelog.settings.scheduleWeekday,
        scheduleMonthDay: changelog.settings.scheduleMonthDay,
      });
  const windowStartedAt =
    typeof window.startedAt === "string"
      ? window.startedAt
      : window.startedAt.toISOString();
  const windowEndedAt =
    typeof window.endedAt === "string"
      ? window.endedAt
      : window.endedAt.toISOString();
  const acquired = await input.store.beginGenerationRun({
    changelogId: input.changelogId,
    windowStartedAt,
    windowEndedAt,
  });
  if (!acquired) {
    throw Response.json(
      { error: "This changelog window has already been generated." },
      { status: 409 },
    );
  }

  try {
    const result = await generateChangelogForWindowUnlocked({
      ...input,
      windowStart: windowStartedAt,
      windowEnd: windowEndedAt,
    });
    await input.store.completeGenerationRun({
      changelogId: input.changelogId,
      windowStartedAt,
      windowEndedAt,
      status:
        result.status === "published" ||
        result.status === "held" ||
        result.status === "empty"
          ? result.status
          : "failed",
      holdReason: result.holdReason,
    });
    return result;
  } catch (error) {
    await input.store.completeGenerationRun({
      changelogId: input.changelogId,
      windowStartedAt,
      windowEndedAt,
      status: "failed",
    });
    throw error;
  }
}

async function assertActiveRepositoryEntitlement(
  store: Store,
  changelog: StoredChangelog,
): Promise<void> {
  const workspace = await store.getWorkspace(changelog.workspaceId);
  if (!workspace || workspace.billingMode === "self-hosted") return;
  const entitlements = await getWorkspaceEntitlements(store, workspace.id);

  const allowedRepositoryIds = [
    ...new Set(
      (await store.listChangelogs(workspace.id)).map(
        (item) => item.repositoryId,
      ),
    ),
  ].slice(0, Math.max(0, entitlements.repositoryLimit));
  if (!allowedRepositoryIds.includes(changelog.repositoryId)) {
    throw Response.json(
      {
        error:
          "This repository is inactive because the workspace is over its repository limit.",
      },
      { status: 402 },
    );
  }
}

async function generateChangelogForWindowUnlocked(input: {
  store: Store;
  summarizer: AiSummarizer;
  recordAiUsage?: (input: {
    workspaceId: string;
    sourceId: string;
    usage: AiTokenUsage;
  }) => Promise<void>;
  changelogId: string;
  pullRequestNumbers?: number[];
  generationKey?: string;
  windowStart?: string;
  windowEnd: string;
}): Promise<{
  status: ChangelogEntry["status"] | "empty";
  entry?: StoredEntry;
  entries?: StoredEntry[];
  holdReason?: string;
}> {
  const changelog = await input.store.getChangelogById(input.changelogId);

  if (!changelog) {
    throw new Response("Changelog not found", { status: 404 });
  }

  const window = input.windowStart
    ? { startedAt: input.windowStart, endedAt: input.windowEnd }
    : getLastCompletedScheduleWindow({
        now: new Date(input.windowEnd),
        timeZone: changelog.settings.timeZone,
        publishTime: changelog.settings.publishTime,
        frequency: changelog.settings.scheduleFrequency,
        scheduleWeekday: changelog.settings.scheduleWeekday,
        scheduleMonthDay: changelog.settings.scheduleMonthDay,
      });
  const windowStart =
    typeof window.startedAt === "string"
      ? window.startedAt
      : window.startedAt.toISOString();
  const windowEnd =
    typeof window.endedAt === "string"
      ? window.endedAt
      : window.endedAt.toISOString();
  const requestedPullRequestNumbers = input.pullRequestNumbers
    ? new Set(input.pullRequestNumbers)
    : null;
  const pullRequests = (
    await input.store.listPullRequestsForRange(changelog, {
      startedAt: windowStart,
      endedAt: windowEnd,
    })
  ).filter(
    (pullRequest) =>
      !requestedPullRequestNumbers ||
      requestedPullRequestNumbers.has(pullRequest.number),
  );
  const existingEntries = await input.store.listEntries(changelog.id);
  const processedPullRequestKeys = getProcessedPullRequestKeys(existingEntries);
  const unprocessedPullRequests = pullRequests.filter((pullRequest) =>
    pullRequestKeys(pullRequest).every(
      (key) => !processedPullRequestKeys.has(key),
    ),
  );
  const filtered = filterPublishablePullRequests(unprocessedPullRequests, {
    skipLabels: changelog.settings.skipLabels,
    sensitiveLabels: changelog.settings.sensitiveLabels,
  });
  const reviewableHeldPullRequests = filtered.held.filter(
    (item) => item.reason !== "skip-label",
  );

  await assertMonthlyPullRequestEntitlement({
    changelog,
    pullRequests: [
      ...filtered.publishable,
      ...reviewableHeldPullRequests.map((item) => item.pr),
    ],
    store: input.store,
  });

  if (
    filtered.publishable.length === 0 &&
    reviewableHeldPullRequests.length === 0
  ) {
    await input.store.markGenerated(changelog.id, windowEnd);
    return { status: "empty" };
  }

  if (filtered.publishable.length === 0) {
    const entries = await createHeldPullRequestEntries({
      changelogId: changelog.id,
      heldPullRequests: reviewableHeldPullRequests,
      generationKey: input.generationKey,
      store: input.store,
      windowEnd,
    });
    await input.store.markGenerated(changelog.id, windowEnd);
    return {
      status: "held",
      entry: entries[0],
      entries,
      holdReason: entries[0]?.holdReason,
    };
  }

  await assertAiCreditRechargeAvailability({
    store: input.store,
    workspaceId: changelog.workspaceId,
  });

  const [learnings, writerOptions] = await Promise.all([
    input.store.listAiFeedback(changelog.workspaceId, changelog.id),
    resolveAiWritingOptions({ changelog, store: input.store }),
  ]);

  const summaryResult = await input.summarizer.summarize(filtered.publishable, {
    ...writerOptions,
    categoryDefinitions: changelog.settings.categoryDefinitions,
    learnings,
  });
  const { candidate, usage } = unwrapAiSummaryResult(summaryResult);
  if (usage) {
    await input.recordAiUsage?.({
      workspaceId: changelog.workspaceId,
      sourceId: `generation:${changelog.id}:${windowStart}:${windowEnd}`,
      usage,
    });
  }
  const validation = validateGeneratedEntry(candidate, {
    categoryDefinitions: changelog.settings.categoryDefinitions,
  });

  if (!validation.ok) {
    const holdReason = input.summarizer.disabledReason ?? validation.reason;
    const entries = await createGeneratedHoldEntries({
      changelogId: changelog.id,
      holdReason,
      pullRequests: filtered.publishable,
      generationKey: input.generationKey,
      store: input.store,
      windowEndedAt: windowEnd,
    });
    await input.store.markGenerated(changelog.id, windowEnd);
    return { status: "held", entry: entries[0], entries, holdReason };
  }

  const publishedAt = input.windowStart
    ? (getLatestMergedAt(filtered.publishable) ?? windowEnd)
    : windowEnd;
  const publishableItems: GeneratedChangeItem[] =
    validation.entry.items && validation.entry.items.length > 0
      ? validation.entry.items
      : [
          {
            title: validation.entry.title,
            summary: validation.entry.summary,
            category: validation.entry.category,
          },
        ];
  const entries: StoredEntry[] = [];
  const pullRequestsByNumber = new Map(
    filtered.publishable.map((pullRequest) => [
      pullRequest.number,
      pullRequest,
    ]),
  );
  const coveredPullRequestNumbers = new Set<number>();
  const skippedPullRequestNumbers = new Set(
    (validation.entry.skippedPullRequestNumbers ?? []).filter((number) =>
      pullRequestsByNumber.has(number),
    ),
  );

  for (const item of [...publishableItems].sort((left, right) =>
    compareChangelogCategories(
      left.category,
      right.category,
      changelog.settings.categoryDefinitions,
    ),
  )) {
    const itemPullRequests = getItemPullRequests(
      item,
      pullRequestsByNumber,
    ).filter(
      (pullRequest) => !coveredPullRequestNumbers.has(pullRequest.number),
    );
    if (itemPullRequests.length === 0) continue;

    for (const pullRequest of itemPullRequests) {
      coveredPullRequestNumbers.add(pullRequest.number);
    }
    const itemPublishedAt = input.windowStart
      ? (getLatestMergedAt(itemPullRequests) ?? publishedAt)
      : publishedAt;
    const entry = await input.store.createEntry({
      changelogId: changelog.id,
      title: item.title,
      summary: item.summary,
      category: item.category,
      status: "published",
      publishedAt: itemPublishedAt,
      windowEndedAt: windowEnd,
      items: [],
      sourcePullRequests: itemPullRequests.map(toSourcePullRequest),
      generationKey: input.generationKey,
    });
    entries.push(entry);
  }

  const uncoveredPullRequests = filtered.publishable.filter(
    (pullRequest) =>
      !coveredPullRequestNumbers.has(pullRequest.number) &&
      !skippedPullRequestNumbers.has(pullRequest.number),
  );
  if (uncoveredPullRequests.length === 1 && entries.length === 0) {
    const pullRequest = uncoveredPullRequests[0];
    const item = getPostForSinglePullRequest(validation.entry, pullRequest);
    entries.push(
      await input.store.createEntry({
        changelogId: changelog.id,
        title: item.title,
        summary: item.summary,
        category: item.category,
        status: "published",
        publishedAt: input.windowStart ? pullRequest.mergedAt : windowEnd,
        windowEndedAt: windowEnd,
        items: [],
        sourcePullRequests: [toSourcePullRequest(pullRequest)],
        generationKey: input.generationKey,
      }),
    );
  } else {
    for (const pullRequest of uncoveredPullRequests) {
      const fallbackResult = await input.summarizer.summarize([pullRequest], {
        ...writerOptions,
        categoryDefinitions: changelog.settings.categoryDefinitions,
        learnings,
      });
      const { candidate: fallbackCandidate, usage: fallbackUsage } =
        unwrapAiSummaryResult(fallbackResult);
      if (fallbackUsage) {
        await input.recordAiUsage?.({
          workspaceId: changelog.workspaceId,
          sourceId: `generation:${changelog.id}:${windowStart}:${windowEnd}:pr:${pullRequest.number}`,
          usage: fallbackUsage,
        });
      }
      const fallbackValidation = validateGeneratedEntry(fallbackCandidate, {
        categoryDefinitions: changelog.settings.categoryDefinitions,
      });
      if (!fallbackValidation.ok) {
        const holdReason =
          input.summarizer.disabledReason ?? fallbackValidation.reason;
        const [entry] = await createGeneratedHoldEntries({
          changelogId: changelog.id,
          holdReason,
          pullRequests: [pullRequest],
          store: input.store,
          windowEndedAt: windowEnd,
          generationKey: input.generationKey,
        });
        entries.push(entry);
        continue;
      }

      if (
        fallbackValidation.entry.skippedPullRequestNumbers?.includes(
          pullRequest.number,
        )
      ) {
        continue;
      }

      const item = getPostForSinglePullRequest(
        fallbackValidation.entry,
        pullRequest,
      );
      entries.push(
        await input.store.createEntry({
          changelogId: changelog.id,
          title: item.title,
          summary: item.summary,
          category: item.category,
          status: "published",
          publishedAt: input.windowStart ? pullRequest.mergedAt : windowEnd,
          windowEndedAt: windowEnd,
          items: [],
          sourcePullRequests: [toSourcePullRequest(pullRequest)],
          generationKey: input.generationKey,
        }),
      );
    }
  }

  await input.store.markGenerated(changelog.id, windowEnd);

  if (entries.length === 0) {
    return { status: "empty", entries: [] };
  }

  const heldEntry = entries.find((entry) => entry.status === "held");
  return {
    status: entries.some((entry) => entry.status === "published")
      ? "published"
      : "held",
    entry: entries[0],
    entries,
    holdReason: heldEntry?.holdReason,
  };
}

export async function assertAiCreditRechargeAvailability(input: {
  store: Store;
  workspaceId: string;
}): Promise<void> {
  const [workspace, subscription, entitlements] = await Promise.all([
    input.store.getWorkspace(input.workspaceId),
    input.store.getBillingSubscription(input.workspaceId),
    getWorkspaceEntitlements(input.store, input.workspaceId),
  ]);
  if (entitlements.accessSource === "complimentary") {
    const period = getEntitlementPeriod(null);
    const usedCredits =
      (await input.store.sumAiTokensForWorkspaceRange(
        input.workspaceId,
        period,
      )) / 1_000;
    if (usedCredits < entitlements.monthlyIncludedCredits) return;

    throw Response.json(
      {
        error:
          "The complimentary AI credit allowance is used. It resets next month.",
      },
      { status: 402 },
    );
  }
  if (
    !workspace ||
    workspace.billingMode !== "hosted" ||
    !subscription ||
    subscription.autoRechargeEnabled !== false
  ) {
    return;
  }

  const period = getEntitlementPeriod(subscription);
  const usedCredits =
    (await input.store.sumAiTokensForWorkspaceRange(
      input.workspaceId,
      period,
    )) / 1_000;
  if (usedCredits < entitlements.monthlyIncludedCredits) return;

  throw Response.json(
    {
      error:
        "AI credits are used. Turn on automatic recharges in Billing to continue AI runs.",
    },
    { status: 402 },
  );
}

async function assertMonthlyPullRequestEntitlement(input: {
  changelog: StoredChangelog;
  pullRequests: PullRequestMetadata[];
  store: Store;
}): Promise<void> {
  if (input.pullRequests.length === 0) return;

  const workspace = await input.store.getWorkspace(input.changelog.workspaceId);
  if (!workspace || workspace.billingMode === "self-hosted") return;

  const [subscription, entitlements] = await Promise.all([
    input.store.getBillingSubscription(workspace.id),
    getWorkspaceEntitlements(input.store, workspace.id),
  ]);
  const period = getEntitlementPeriod(
    entitlements.accessSource === "complimentary" ? null : subscription,
  );
  await input.store.reserveProcessedPullRequests({
    workspaceId: workspace.id,
    repositoryId: input.changelog.repositoryId,
    pullRequestNumbers: input.pullRequests.map((item) => item.number),
    period,
    // Token allowances, rather than PR count, determine overage billing.
    limit: Number.MAX_SAFE_INTEGER,
  });
}

function getEntitlementPeriod(
  subscription: Awaited<ReturnType<Store["getBillingSubscription"]>>,
): { startedAt: string; endedAt: string } {
  const now = new Date();
  if (
    subscription?.currentPeriodStart &&
    subscription.currentPeriodEnd &&
    !Number.isNaN(Date.parse(subscription.currentPeriodStart)) &&
    !Number.isNaN(Date.parse(subscription.currentPeriodEnd)) &&
    Date.parse(subscription.currentPeriodStart) <= now.getTime() &&
    Date.parse(subscription.currentPeriodEnd) > now.getTime()
  ) {
    return {
      startedAt: subscription.currentPeriodStart,
      endedAt: subscription.currentPeriodEnd,
    };
  }

  const safeDate = now;
  return {
    startedAt: new Date(
      Date.UTC(safeDate.getUTCFullYear(), safeDate.getUTCMonth(), 1),
    ).toISOString(),
    endedAt: new Date(
      Date.UTC(safeDate.getUTCFullYear(), safeDate.getUTCMonth() + 1, 1),
    ).toISOString(),
  };
}

export async function resolveAiWritingOptions(input: {
  changelog: StoredChangelog;
  store: Store;
}): Promise<Required<AiWritingOptions>> {
  const [settings, repositories] = await Promise.all([
    input.store.getWorkspaceSettings(input.changelog.workspaceId),
    input.store.listRepositories(input.changelog.workspaceId),
  ]);
  const repository = repositories.find(
    (item) => item.id === input.changelog.repositoryId,
  );

  return {
    aiAudience:
      settings?.aiAudience === "technical-users"
        ? "technical-users"
        : "product-users",
    aiPersonality:
      settings?.aiPersonality === "technical" ||
      settings?.aiPersonality === "concise"
        ? settings.aiPersonality
        : "product-user",
    repositoryVisibility: repository?.private === false ? "public" : "private",
  };
}

function getItemPullRequests(
  item: GeneratedChangeItem,
  pullRequestsByNumber: Map<number, PullRequestMetadata>,
): PullRequestMetadata[] {
  const sourcePullRequestNumbers = item.sourcePullRequestNumbers;

  if (!sourcePullRequestNumbers?.length) {
    return [];
  }

  const selected = sourcePullRequestNumbers
    .map((number) => pullRequestsByNumber.get(number))
    .filter((pullRequest): pullRequest is PullRequestMetadata =>
      Boolean(pullRequest),
    );

  return selected;
}

function getPostForSinglePullRequest(
  entry: {
    title: string;
    summary: string;
    category: ChangelogEntry["category"];
    items?: GeneratedChangeItem[];
  },
  pullRequest: PullRequestMetadata,
): GeneratedChangeItem {
  return (
    entry.items?.find((item) =>
      item.sourcePullRequestNumbers?.includes(pullRequest.number),
    ) ??
    entry.items?.[0] ?? {
      title: entry.title,
      summary: entry.summary,
      category: entry.category,
    }
  );
}

function getLatestMergedAt(pullRequests: PullRequestMetadata[]): string | null {
  const latest = pullRequests
    .map((pullRequest) => new Date(pullRequest.mergedAt))
    .filter((mergedAt) => !Number.isNaN(mergedAt.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0];

  return latest ? latest.toISOString() : null;
}

function toSourcePullRequest(pr: PullRequestMetadata) {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author: pr.author,
    mergedAt: pr.mergedAt,
  };
}

async function createHeldPullRequestEntries(input: {
  changelogId: string;
  heldPullRequests: ReturnType<typeof filterPublishablePullRequests>["held"];
  store: Store;
  windowEnd: string;
  generationKey?: string;
}): Promise<StoredEntry[]> {
  const entries: StoredEntry[] = [];

  for (const held of input.heldPullRequests) {
    const entry = await input.store.createEntry({
      changelogId: input.changelogId,
      title: "Update held for review",
      summary:
        "This pull request matched privacy controls and needs review before publishing.",
      category: "maintenance",
      status: "held",
      publishedAt: null,
      holdReason: formatHeldPullRequestReason(held),
      windowEndedAt: input.windowEnd,
      sourcePullRequests: [toSourcePullRequest(held.pr)],
      generationKey: input.generationKey,
    });
    entries.push(entry);
  }

  return entries;
}

async function createGeneratedHoldEntries(input: {
  changelogId: string;
  holdReason: string;
  pullRequests: PullRequestMetadata[];
  store: Store;
  windowEndedAt: string;
  generationKey?: string;
}): Promise<StoredEntry[]> {
  const entries: StoredEntry[] = [];

  for (const pullRequest of input.pullRequests) {
    const entry = await input.store.createEntry({
      changelogId: input.changelogId,
      title: pullRequest.title || "Update held for review",
      summary:
        "Draft held for review. Review the source PR and draft before publishing.",
      category: "maintenance",
      status: "held",
      publishedAt: null,
      holdReason: input.holdReason,
      windowEndedAt: input.windowEndedAt,
      sourcePullRequests: [toSourcePullRequest(pullRequest)],
      generationKey: input.generationKey,
    });
    entries.push(entry);
  }

  return entries;
}

function formatHeldPullRequestReason(
  held:
    | ReturnType<typeof filterPublishablePullRequests>["held"][number]
    | undefined,
): string {
  if (!held) {
    return "privacy-hold";
  }

  return held.matchedLabel
    ? `${held.reason}:${held.matchedLabel}`
    : held.reason;
}

function getProcessedPullRequestKeys(entries: StoredEntry[]): Set<string> {
  return new Set(
    entries.flatMap((entry) =>
      entry.sourcePullRequests.flatMap((pullRequest) =>
        sourcePullRequestKeys(pullRequest),
      ),
    ),
  );
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
