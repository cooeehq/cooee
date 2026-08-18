import { getHistoricalScheduleWindows } from "@cooee/shared";
import type { ChangelogEntry } from "@cooee/shared";
import type { Store, StoredChangelog, StoredEntry } from "../store/types";
import type { AiSummarizer, AiTokenUsage } from "./openai";
import type { GitHubAppClient } from "./github";
import { generateChangelogForWindow } from "./generation";

export type HistoricalChangelogWindowResult = {
  startedAt: string;
  endedAt: string;
  status: ChangelogEntry["status"] | "empty";
  entry?: StoredEntry;
  entries?: StoredEntry[];
  holdReason?: string;
};

export async function generateHistoricalChangelog(input: {
  store: Store;
  summarizer: AiSummarizer;
  recordAiUsage?: (input: {
    workspaceId: string;
    sourceId: string;
    usage: AiTokenUsage;
  }) => Promise<void>;
  githubClient?: GitHubAppClient;
  changelogId: string;
  days?: number;
  now?: Date;
  range?: { startedAt: string; endedAt: string };
  windowMode?: "schedule" | "rolling";
}): Promise<{
  changelogId: string;
  windows: HistoricalChangelogWindowResult[];
}> {
  const days = input.days ?? 0;
  if (!input.range && (!Number.isInteger(days) || days < 1 || days > 365)) {
    throw new Error(
      "Historical changelog days must be an integer from 1 to 365.",
    );
  }

  const changelog = await input.store.getChangelogById(input.changelogId);

  if (!changelog) {
    throw new Response("Changelog not found", { status: 404 });
  }

  const now = input.now ?? new Date();
  const windows = input.range
    ? [
        {
          startedAt: new Date(input.range.startedAt),
          endedAt: new Date(input.range.endedAt),
        },
      ]
    : input.windowMode === "rolling"
      ? [
          {
            startedAt: new Date(now.getTime() - days * 24 * 60 * 60_000),
            endedAt: now,
          },
        ]
      : getHistoricalScheduleWindows({
          now,
          timeZone: changelog.settings.timeZone,
          publishTime: changelog.settings.publishTime,
          frequency:
            changelog.settings.scheduleFrequency === "on-merge"
              ? "daily"
              : changelog.settings.scheduleFrequency,
          scheduleWeekday: changelog.settings.scheduleWeekday,
          scheduleMonthDay: changelog.settings.scheduleMonthDay,
          days,
        });

  if (
    windows.some(
      (window) =>
        Number.isNaN(window.startedAt.getTime()) ||
        Number.isNaN(window.endedAt.getTime()) ||
        window.startedAt >= window.endedAt,
    )
  ) {
    throw new Error(
      "Historical changelog range must have a valid start and end.",
    );
  }

  if (changelog.settings.generationSource === "releases") {
    return generateHistoricalReleases({
      changelog,
      githubClient: input.githubClient,
      store: input.store,
      windows,
      summarizer: input.summarizer,
      recordAiUsage: input.recordAiUsage,
    });
  }

  const results: HistoricalChangelogWindowResult[] = [];

  if (input.githubClient && windows[0]) {
    await hydratePullRequestsFromGitHub({
      changelog,
      githubClient: input.githubClient,
      store: input.store,
      since: windows[0].startedAt.toISOString(),
      until: windows[windows.length - 1].endedAt.toISOString(),
    });
  }

  for (const window of windows) {
    const result = await generateChangelogForWindow({
      store: input.store,
      summarizer: input.summarizer,
      recordAiUsage: input.recordAiUsage,
      changelogId: changelog.id,
      windowStart: window.startedAt.toISOString(),
      windowEnd: window.endedAt.toISOString(),
    });

    results.push({
      startedAt: window.startedAt.toISOString(),
      endedAt: window.endedAt.toISOString(),
      status: result.status,
      entry: result.entry,
      entries: result.entries,
      holdReason: result.holdReason,
    });
  }

  return {
    changelogId: changelog.id,
    windows: results,
  };
}

async function generateHistoricalReleases({
  changelog,
  githubClient,
  recordAiUsage,
  store,
  summarizer,
  windows,
}: {
  changelog: StoredChangelog;
  githubClient?: GitHubAppClient;
  recordAiUsage?: (input: {
    workspaceId: string;
    sourceId: string;
    usage: AiTokenUsage;
  }) => Promise<void>;
  store: Store;
  summarizer: AiSummarizer;
  windows: Array<{ startedAt: Date; endedAt: Date }>;
}): Promise<{
  changelogId: string;
  windows: HistoricalChangelogWindowResult[];
}> {
  const listPublishedReleases = githubClient?.listPublishedReleases;
  if (!listPublishedReleases || !windows[0]) {
    return { changelogId: changelog.id, windows: [] };
  }

  const repositoryContext = await getGitHubRepositoryContext({
    changelog,
    store,
  });
  if (!repositoryContext) {
    return { changelogId: changelog.id, windows: [] };
  }

  const range = {
    since: windows[0].startedAt.toISOString(),
    until: windows[windows.length - 1].endedAt.toISOString(),
  };
  const releases = (
    await listPublishedReleases({
      ...repositoryContext,
      ...range,
    })
  )
    .filter(
      (release) =>
        isStableSemverTag(release.tagName) &&
        !Number.isNaN(Date.parse(release.publishedAt)) &&
        Date.parse(release.publishedAt) >= Date.parse(range.since) &&
        Date.parse(release.publishedAt) < Date.parse(range.until),
    )
    .sort(
      (left, right) =>
        Date.parse(left.publishedAt) - Date.parse(right.publishedAt),
    );
  if (releases.length === 0) {
    return { changelogId: changelog.id, windows: [] };
  }

  await hydratePullRequestsFromGitHub({
    changelog,
    githubClient,
    store,
    since: range.since,
    until: range.until,
  });

  const results: HistoricalChangelogWindowResult[] = [];
  let windowStartedAt = range.since;

  for (const release of releases) {
    if (Date.parse(windowStartedAt) >= Date.parse(release.publishedAt)) {
      continue;
    }

    const result = await generateChangelogForWindow({
      store,
      summarizer,
      recordAiUsage,
      changelogId: changelog.id,
      windowStart: windowStartedAt,
      windowEnd: release.publishedAt,
      generationKey: `release:${release.tagName}:${changelog.id}`,
    });

    results.push({
      startedAt: windowStartedAt,
      endedAt: release.publishedAt,
      status: result.status,
      entry: result.entry,
      entries: result.entries,
      holdReason: result.holdReason,
    });
    windowStartedAt = release.publishedAt;
  }

  return { changelogId: changelog.id, windows: results };
}

async function hydratePullRequestsFromGitHub({
  changelog,
  githubClient,
  since,
  store,
  until,
}: {
  changelog: StoredChangelog;
  githubClient: GitHubAppClient;
  since: string;
  store: Store;
  until: string;
}) {
  const repositories = await store.listRepositories(changelog.workspaceId);
  const repository = repositories.find(
    (item) => item.id === changelog.repositoryId,
  );

  if (!repository?.githubInstallationId) {
    return;
  }

  const installations = await store.listGitHubInstallations(
    changelog.workspaceId,
  );
  const installation = installations.find(
    (item) => item.id === repository.githubInstallationId,
  );

  if (!installation) {
    return;
  }

  const pullRequests = await githubClient.listMergedPullRequests({
    installationId: installation.installationId,
    owner: repository.owner,
    repo: repository.name,
    since,
    until,
  });

  for (const pullRequest of pullRequests) {
    await store.upsertPullRequest({
      repositoryFullName: repository.fullName,
      pullRequest,
    });
  }
}

async function getGitHubRepositoryContext({
  changelog,
  store,
}: {
  changelog: StoredChangelog;
  store: Store;
}): Promise<{
  installationId: number;
  owner: string;
  repo: string;
  repositoryFullName: string;
} | null> {
  const repositories = await store.listRepositories(changelog.workspaceId);
  const repository = repositories.find(
    (item) => item.id === changelog.repositoryId,
  );
  if (!repository?.githubInstallationId) return null;

  const installations = await store.listGitHubInstallations(
    changelog.workspaceId,
  );
  const installation = installations.find(
    (item) => item.id === repository.githubInstallationId,
  );
  if (!installation) return null;

  return {
    installationId: installation.installationId,
    owner: repository.owner,
    repo: repository.name,
    repositoryFullName: repository.fullName,
  };
}

function isStableSemverTag(value: string): boolean {
  return /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    value,
  );
}
