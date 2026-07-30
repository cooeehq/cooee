import { describe, expect, test } from "bun:test";
import { getHistoricalScheduleWindows } from "@cooee/shared";
import type { PullRequestMetadata } from "@cooee/shared";
import { generateChangelogForWindow } from "../services/generation";
import { generateHistoricalChangelog } from "../services/historical";
import type { AiSummarizer } from "../services/openai";
import type { GitHubAppClient } from "../services/github";
import { InMemoryStore } from "../store/memory";

const summarizer: AiSummarizer = {
  summarize: async (pullRequests) => ({
    title: pullRequests.map((pr) => `PR ${pr.number}`).join(", "),
    summary:
      "Customer-facing updates were generated from historical pull requests.",
    category: "improvement",
    confidence: 0.95,
    sensitive: false,
  }),
};

describe("historical changelog generation", () => {
  test("calculates historical windows for the selected cadence", () => {
    const daily = getHistoricalScheduleWindows({
      now: new Date("2026-06-07T00:30:00.000Z"),
      timeZone: "Australia/Brisbane",
      publishTime: "09:00",
      frequency: "daily",
      days: 3,
    });

    expect(daily.map((window) => window.localDate)).toEqual([
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
    ]);
    expect(daily.map((window) => window.endedAt.toISOString())).toEqual([
      "2026-06-04T23:00:00.000Z",
      "2026-06-05T23:00:00.000Z",
      "2026-06-06T23:00:00.000Z",
    ]);

    const weekly = getHistoricalScheduleWindows({
      now: new Date("2026-06-07T00:30:00.000Z"),
      timeZone: "Australia/Brisbane",
      publishTime: "09:00",
      frequency: "weekly",
      days: 14,
    });
    expect(weekly.map((window) => window.endedAt.toISOString())).toEqual([
      "2026-05-30T23:00:00.000Z",
      "2026-06-06T23:00:00.000Z",
    ]);

    const monthly = getHistoricalScheduleWindows({
      now: new Date("2026-06-07T00:30:00.000Z"),
      timeZone: "Australia/Brisbane",
      publishTime: "09:00",
      frequency: "monthly",
      days: 40,
    });
    expect(
      monthly.map((window) => [
        window.startedAt.toISOString(),
        window.endedAt.toISOString(),
      ]),
    ).toEqual([
      ["2026-04-27T23:00:00.000Z", "2026-04-30T23:00:00.000Z"],
      ["2026-04-30T23:00:00.000Z", "2026-05-31T23:00:00.000Z"],
      ["2026-05-31T23:00:00.000Z", "2026-06-06T23:00:00.000Z"],
    ]);
  });

  test("generates a changelog entry from an explicit historical window", async () => {
    const store = InMemoryStore.seeded();
    store.pullRequests.push(
      pullRequest({
        id: "pr_40",
        number: 40,
        title: "Improve onboarding checklist",
        mergedAt: "2026-06-03T04:15:00.000Z",
      }),
    );

    const result = await generateChangelogForWindow({
      store,
      summarizer,
      changelogId: "cl_acme",
      windowStart: "2026-06-02T23:00:00.000Z",
      windowEnd: "2026-06-03T23:00:00.000Z",
    });

    expect(result.status).toBe("published");
    expect(result.entry?.sourcePullRequests).toEqual([
      {
        number: 40,
        title: "Improve onboarding checklist",
        url: "https://github.com/acme/app/pull/40",
        author: "octocat",
        mergedAt: "2026-06-03T04:15:00.000Z",
      },
    ]);
  });

  test("skips pull requests that already generated changelog entries", async () => {
    const store = InMemoryStore.seeded();
    store.pullRequests.push(
      pullRequest({
        id: "pr_43",
        number: 43,
        title: "Add export controls",
        mergedAt: "2026-06-05T04:15:00.000Z",
      }),
    );
    const seenPullRequestNumbers: number[][] = [];
    const recordingSummarizer: AiSummarizer = {
      summarize: async (pullRequests) => {
        seenPullRequestNumbers.push(pullRequests.map((pr) => pr.number));
        return {
          title: pullRequests.map((pr) => `PR ${pr.number}`).join(", "),
          summary:
            "Customer-facing updates were generated from historical pull requests.",
          category: "improvement",
          confidence: 0.95,
          sensitive: false,
        };
      },
    };

    const result = await generateChangelogForWindow({
      store,
      summarizer: recordingSummarizer,
      changelogId: "cl_acme",
      windowStart: "2026-06-04T23:00:00.000Z",
      windowEnd: "2026-06-05T23:00:00.000Z",
    });

    expect(result.status).toBe("published");
    expect(seenPullRequestNumbers).toEqual([[43]]);
    expect(result.entry?.sourcePullRequests).toEqual([
      {
        number: 43,
        title: "Add export controls",
        url: "https://github.com/acme/app/pull/43",
        author: "octocat",
        mergedAt: "2026-06-05T04:15:00.000Z",
      },
    ]);
  });

  test("passes workspace writer style and repository visibility to the summarizer", async () => {
    const store = InMemoryStore.seeded();
    const repository = store.repositories.find(
      (item) => item.id === "repo_acme",
    );
    if (repository) {
      repository.private = true;
    }
    store.workspaceSettings.set("ws_acme", {
      aiAudience: "technical-users",
      aiPersonality: "technical",
    });
    store.pullRequests.push(
      pullRequest({
        id: "pr_45",
        number: 45,
        title: "Add webhook event retries",
        mergedAt: "2026-06-06T04:15:00.000Z",
      }),
    );
    let seenOptions: Parameters<AiSummarizer["summarize"]>[1] | undefined;
    const recordingSummarizer: AiSummarizer = {
      summarize: async (pullRequests, options) => {
        seenOptions = options;
        return {
          title: pullRequests.map((pr) => `PR ${pr.number}`).join(", "),
          summary:
            "Customer-facing updates were generated from historical pull requests.",
          category: "improvement",
          confidence: 0.95,
          sensitive: false,
        };
      },
    };

    await generateChangelogForWindow({
      store,
      summarizer: recordingSummarizer,
      changelogId: "cl_acme",
      windowStart: "2026-06-05T23:00:00.000Z",
      windowEnd: "2026-06-06T23:00:00.000Z",
    });

    expect(seenOptions).toMatchObject({
      aiAudience: "technical-users",
      aiPersonality: "technical",
      repositoryVisibility: "private",
    });
  });

  test("returns empty when every pull request in the backfill window was already processed", async () => {
    const store = InMemoryStore.seeded();
    let summarizeCalls = 0;
    const recordingSummarizer: AiSummarizer = {
      summarize: async () => {
        summarizeCalls += 1;
        return {
          title: "Should not be generated",
          summary: "This should not be generated.",
          category: "improvement",
          confidence: 0.95,
          sensitive: false,
        };
      },
    };

    const result = await generateChangelogForWindow({
      store,
      summarizer: recordingSummarizer,
      changelogId: "cl_acme",
      windowStart: "2026-06-04T23:00:00.000Z",
      windowEnd: "2026-06-05T23:00:00.000Z",
    });

    expect(result.status).toBe("empty");
    expect(summarizeCalls).toBe(0);
    expect(store.entries.map((entry) => entry.id)).toEqual([
      "entry_saved_filters",
      "entry_login_fix",
    ]);
  });

  test("ignores pull requests skipped by label without creating a held draft", async () => {
    const store = InMemoryStore.seeded();
    store.entries = [];
    store.pullRequests.push(
      pullRequest({
        id: "pr_45",
        number: 45,
        title: "Internal billing import cleanup",
        mergedAt: "2026-06-03T04:15:00.000Z",
        labels: ["cooee:skip"],
      }),
    );

    const result = await generateChangelogForWindow({
      store,
      summarizer,
      changelogId: "cl_acme",
      windowStart: "2026-06-02T23:00:00.000Z",
      windowEnd: "2026-06-03T23:00:00.000Z",
    });

    expect(result.status).toBe("empty");
    expect(result.entry).toBeUndefined();
    expect(store.entries).toEqual([]);
  });

  test("creates a separate held draft for each reviewable held pull request", async () => {
    const store = InMemoryStore.seeded();
    store.entries = [];
    store.pullRequests.push(
      pullRequest({
        id: "pr_46",
        number: 46,
        title: "Harden account recovery",
        mergedAt: "2026-06-03T04:15:00.000Z",
        labels: ["security"],
      }),
      pullRequest({
        id: "pr_47",
        number: 47,
        title: "Patch invite disclosure",
        mergedAt: "2026-06-03T05:15:00.000Z",
        labels: ["vulnerability"],
      }),
    );

    const result = await generateChangelogForWindow({
      store,
      summarizer,
      changelogId: "cl_acme",
      windowStart: "2026-06-02T23:00:00.000Z",
      windowEnd: "2026-06-03T23:00:00.000Z",
    });

    expect(result.status).toBe("held");
    expect(result.entries).toHaveLength(2);
    expect(
      result.entries?.map((entry) => ({
        holdReason: entry.holdReason,
        sourcePullRequestNumbers: entry.sourcePullRequests.map(
          (pullRequest) => pullRequest.number,
        ),
      })),
    ).toEqual([
      {
        holdReason: "sensitive-label:security",
        sourcePullRequestNumbers: [46],
      },
      {
        holdReason: "sensitive-label:vulnerability",
        sourcePullRequestNumbers: [47],
      },
    ]);
    expect(
      store.entries
        .map((entry) =>
          entry.sourcePullRequests.map((pullRequest) => pullRequest.number),
        )
        .sort((left, right) => left[0] - right[0]),
    ).toEqual([[46], [47]]);
  });

  test("creates a separate held draft for each low-confidence pull request", async () => {
    const store = InMemoryStore.seeded();
    store.entries = [];
    store.pullRequests.push(
      pullRequest({
        id: "pr_48",
        number: 48,
        title: "Add quote address type picker",
        mergedAt: "2026-06-03T04:15:00.000Z",
      }),
      pullRequest({
        id: "pr_49",
        number: 49,
        title: "Improve Shopify metadata sync",
        mergedAt: "2026-06-03T05:15:00.000Z",
      }),
    );
    const lowConfidenceSummarizer: AiSummarizer = {
      summarize: async () => ({
        title: "Combined low-confidence update",
        summary: "This generated draft should not be shared across PRs.",
        category: "improvement",
        confidence: 0.42,
        sensitive: false,
      }),
    };

    const result = await generateChangelogForWindow({
      store,
      summarizer: lowConfidenceSummarizer,
      changelogId: "cl_acme",
      windowStart: "2026-06-02T23:00:00.000Z",
      windowEnd: "2026-06-03T23:00:00.000Z",
    });

    expect(result.status).toBe("held");
    expect(result.entries).toHaveLength(2);
    expect(
      result.entries?.map((entry) => ({
        title: entry.title,
        holdReason: entry.holdReason,
        sourcePullRequestNumbers: entry.sourcePullRequests.map(
          (pullRequest) => pullRequest.number,
        ),
      })),
    ).toEqual([
      {
        title: "Add quote address type picker",
        holdReason: "low-confidence",
        sourcePullRequestNumbers: [48],
      },
      {
        title: "Improve Shopify metadata sync",
        holdReason: "low-confidence",
        sourcePullRequestNumbers: [49],
      },
    ]);
    expect(
      store.entries
        .map((entry) =>
          entry.sourcePullRequests.map((pullRequest) => pullRequest.number),
        )
        .sort((left, right) => left[0] - right[0]),
    ).toEqual([[48], [49]]);
  });

  test("publishes each generated change item as a separate changelog post", async () => {
    const store = InMemoryStore.seeded();
    store.entries = [];
    store.pullRequests.push(
      pullRequest({
        id: "pr_50",
        number: 50,
        title: "Add saved report exports",
        mergedAt: "2026-06-03T04:15:00.000Z",
      }),
      pullRequest({
        id: "pr_51",
        number: 51,
        title: "Improve notification delivery",
        mergedAt: "2026-06-03T05:15:00.000Z",
      }),
    );
    const itemSummarizer: AiSummarizer = {
      summarize: async () => ({
        title: "Do not use this combined title",
        summary: "Do not use this combined summary.",
        category: "improvement",
        confidence: 0.95,
        sensitive: false,
        items: [
          {
            title: "Saved report exports",
            summary: "Customers can export saved reports.",
            category: "feature",
            sourcePullRequestNumbers: [50],
          },
          {
            title: "Notification delivery recovery",
            summary: "Notifications arrive more reliably.",
            category: "fix",
            sourcePullRequestNumbers: [51],
          },
        ],
      }),
    };

    const result = await generateChangelogForWindow({
      store,
      summarizer: itemSummarizer,
      changelogId: "cl_acme",
      windowStart: "2026-06-02T23:00:00.000Z",
      windowEnd: "2026-06-03T23:00:00.000Z",
    });

    expect(result.status).toBe("published");
    expect(result.entries?.map((entry) => entry.title)).toEqual([
      "Saved report exports",
      "Notification delivery recovery",
    ]);
    expect(store.entries.map((entry) => entry.title)).toEqual([
      "Notification delivery recovery",
      "Saved report exports",
    ]);
    expect(store.entries.map((entry) => entry.items)).toEqual([[], []]);
    expect(result.entries?.map((entry) => entry.publishedAt)).toEqual([
      "2026-06-03T04:15:00.000Z",
      "2026-06-03T05:15:00.000Z",
    ]);
    expect(
      result.entries?.map((entry) =>
        entry.sourcePullRequests.map((pullRequest) => pullRequest.number),
      ),
    ).toEqual([[50], [51]]);
    expect(
      store.entries.some((entry) =>
        entry.title.includes("Do not use this combined title"),
      ),
    ).toBe(false);
  });

  test("keeps directly related pull requests together in one post", async () => {
    const store = InMemoryStore.seeded();
    store.entries = [];
    store.pullRequests.push(
      pullRequest({
        id: "pr_52",
        number: 52,
        title: "Add report sharing permissions",
        mergedAt: "2026-06-03T04:15:00.000Z",
      }),
      pullRequest({
        id: "pr_53",
        number: 53,
        title: "Add report sharing audit events",
        mergedAt: "2026-06-03T05:15:00.000Z",
      }),
    );
    const itemSummarizer: AiSummarizer = {
      summarize: async () => ({
        title: "Report sharing",
        summary: "Report sharing is now easier to manage.",
        category: "feature",
        confidence: 0.95,
        sensitive: false,
        items: [
          {
            title: "Report sharing controls",
            summary: "You can manage sharing permissions and audit access.",
            category: "feature",
            sourcePullRequestNumbers: [52, 53],
          },
        ],
      }),
    };

    const result = await generateChangelogForWindow({
      store,
      summarizer: itemSummarizer,
      changelogId: "cl_acme",
      windowStart: "2026-06-02T23:00:00.000Z",
      windowEnd: "2026-06-03T23:00:00.000Z",
    });

    expect(result.entries).toHaveLength(1);
    expect(
      result.entries?.[0]?.sourcePullRequests.map((item) => item.number),
    ).toEqual([52, 53]);
  });

  test("creates individual posts for PRs omitted from a batch response", async () => {
    const store = InMemoryStore.seeded();
    store.entries = [];
    store.pullRequests.push(
      pullRequest({
        id: "pr_54",
        number: 54,
        title: "Add report exports",
        mergedAt: "2026-06-03T04:15:00.000Z",
      }),
      pullRequest({
        id: "pr_55",
        number: 55,
        title: "Improve report filters",
        mergedAt: "2026-06-03T05:15:00.000Z",
      }),
    );
    const summarizeCalls: number[][] = [];
    const itemSummarizer: AiSummarizer = {
      summarize: async (pullRequests) => {
        summarizeCalls.push(
          pullRequests.map((pullRequest) => pullRequest.number),
        );
        if (pullRequests.length > 1) {
          return {
            title: "Incomplete batch",
            summary: "This response does not map sources.",
            category: "improvement",
            confidence: 0.95,
            sensitive: false,
            items: [
              {
                title: "Unmapped change",
                summary: "This item omits its source PR.",
                category: "improvement",
              },
            ],
          };
        }

        const pullRequest = pullRequests[0];
        return {
          title: `Post for PR ${pullRequest.number}`,
          summary: `Customers can use ${pullRequest.title}.`,
          category: "improvement",
          confidence: 0.95,
          sensitive: false,
        };
      },
    };

    const result = await generateChangelogForWindow({
      store,
      summarizer: itemSummarizer,
      changelogId: "cl_acme",
      windowStart: "2026-06-02T23:00:00.000Z",
      windowEnd: "2026-06-03T23:00:00.000Z",
    });

    expect(summarizeCalls).toEqual([[54, 55], [54], [55]]);
    expect(
      result.entries?.map((entry) => ({
        title: entry.title,
        sourcePullRequestNumbers: entry.sourcePullRequests.map(
          (pullRequest) => pullRequest.number,
        ),
      })),
    ).toEqual([
      { title: "Post for PR 54", sourcePullRequestNumbers: [54] },
      { title: "Post for PR 55", sourcePullRequestNumbers: [55] },
    ]);
  });

  test("honors repository dismissal learnings without republishing skipped PRs", async () => {
    const store = InMemoryStore.seeded();
    store.entries = [];
    store.aiFeedback.push({
      id: "feedback_dependency_updates",
      workspaceId: "ws_acme",
      changelogId: "cl_acme",
      entryId: "entry_dependency_update",
      title: "Dependency refresh",
      summary: "Internal dependencies were updated.",
      category: "maintenance",
      note: "Dependency-only updates are not relevant to readers.",
      feedbackKind: "dismissed",
      sourcePullRequests: [
        {
          number: 39,
          title: "Refresh dependencies",
          url: "https://github.com/acme/app/pull/39",
        },
      ],
      createdAt: "2026-06-02T00:00:00.000Z",
    });
    store.pullRequests.push(
      pullRequest({
        id: "pr_60",
        number: 60,
        title: "Refresh internal dependencies",
        mergedAt: "2026-06-03T04:15:00.000Z",
      }),
      pullRequest({
        id: "pr_61",
        number: 61,
        title: "Add shipment status filters",
        mergedAt: "2026-06-03T05:15:00.000Z",
      }),
    );
    const summarizeCalls: number[][] = [];
    const learnedSummarizer: AiSummarizer = {
      summarize: async (pullRequests, options) => {
        summarizeCalls.push(
          pullRequests.map((pullRequest) => pullRequest.number),
        );
        expect(options?.learnings?.[0]?.feedbackKind).toBe("dismissed");
        return {
          title: "Shipment status filters",
          summary: "You can filter shipments by their current status.",
          category: "feature",
          confidence: 0.95,
          sensitive: false,
          items: [
            {
              title: "Shipment status filters",
              summary: "You can filter shipments by their current status.",
              category: "feature",
              sourcePullRequestNumbers: [61],
            },
          ],
          skippedPullRequestNumbers: [60],
        };
      },
    };

    const result = await generateChangelogForWindow({
      store,
      summarizer: learnedSummarizer,
      changelogId: "cl_acme",
      windowStart: "2026-06-02T23:00:00.000Z",
      windowEnd: "2026-06-03T23:00:00.000Z",
    });

    expect(summarizeCalls).toEqual([[60, 61]]);
    expect(result.status).toBe("published");
    expect(result.entries?.map((entry) => entry.title)).toEqual([
      "Shipment status filters",
    ]);
    expect(
      result.entries?.flatMap((entry) =>
        entry.sourcePullRequests.map((pullRequest) => pullRequest.number),
      ),
    ).toEqual([61]);
  });

  test("returns an empty window when repository learnings skip every PR", async () => {
    const store = InMemoryStore.seeded();
    store.entries = [];
    store.pullRequests.push(
      pullRequest({
        id: "pr_62",
        number: 62,
        title: "Refresh internal dependencies",
        mergedAt: "2026-06-03T04:15:00.000Z",
      }),
    );
    const learnedSummarizer: AiSummarizer = {
      summarize: async () => ({
        title: "No customer-facing changes",
        summary: "This window contains no customer-facing changes.",
        category: "maintenance",
        confidence: 0.95,
        sensitive: false,
        items: [],
        skippedPullRequestNumbers: [62],
      }),
    };

    const result = await generateChangelogForWindow({
      store,
      summarizer: learnedSummarizer,
      changelogId: "cl_acme",
      windowStart: "2026-06-02T23:00:00.000Z",
      windowEnd: "2026-06-03T23:00:00.000Z",
    });

    expect(result).toEqual({ status: "empty", entries: [] });
    expect(store.entries).toEqual([]);
  });

  test("runs historical generation across the last N completed windows", async () => {
    const store = InMemoryStore.seeded();
    store.changelogs[0].settings.scheduleFrequency = "weekly";
    store.pullRequests.push(
      pullRequest({
        id: "pr_40",
        number: 40,
        title: "Improve onboarding checklist",
        mergedAt: "2026-05-30T04:15:00.000Z",
      }),
      pullRequest({
        id: "pr_43",
        number: 43,
        title: "Add export controls",
        mergedAt: "2026-06-06T04:15:00.000Z",
      }),
    );

    const result = await generateHistoricalChangelog({
      store,
      summarizer,
      changelogId: "cl_acme",
      days: 14,
      now: new Date("2026-06-07T00:30:00.000Z"),
    });

    expect(result.windows.map((window) => window.status)).toEqual([
      "published",
      "published",
    ]);
    expect(
      store.entries
        .filter((entry) => entry.title.startsWith("PR "))
        .map((entry) => entry.title),
    ).toEqual(["PR 43", "PR 40"]);
  });

  test("runs manual backfill across a rolling window ending now", async () => {
    const store = InMemoryStore.seeded();
    store.entries = [];
    store.pullRequests.push(
      pullRequest({
        id: "pr_recent",
        number: 90,
        title: "Add current hour activity",
        mergedAt: "2026-06-07T00:05:00.000Z",
      }),
      pullRequest({
        id: "pr_old",
        number: 89,
        title: "Older than one day",
        mergedAt: "2026-06-05T23:59:59.000Z",
      }),
    );

    const result = await generateHistoricalChangelog({
      store,
      summarizer,
      changelogId: "cl_acme",
      days: 1,
      now: new Date("2026-06-07T00:30:00.000Z"),
      windowMode: "rolling",
    });

    expect(result.windows).toMatchObject([
      {
        startedAt: "2026-06-06T00:30:00.000Z",
        endedAt: "2026-06-07T00:30:00.000Z",
        status: "published",
      },
    ]);
    expect(store.entries.map((entry) => entry.title)).toEqual(["PR 90"]);
    expect(store.entries[0]?.publishedAt).toBe("2026-06-07T00:05:00.000Z");
  });

  test("hydrates missing historical pull requests from GitHub before generation", async () => {
    const store = InMemoryStore.seeded();
    store.pullRequests = [];
    const githubClient: GitHubAppClient = {
      syncInstallation: async () => {
        throw new Error("not used");
      },
      listMergedPullRequests: async (input) => {
        expect(input).toMatchObject({
          installationId: 12345,
          owner: "acme",
          repo: "app",
        });
        expect(input.since).toBe("2026-06-03T23:00:00.000Z");
        expect(input.until).toBe("2026-06-06T23:00:00.000Z");
        return [
          pullRequest({
            id: "github_pr_44",
            number: 44,
            title: "Add usage dashboard",
            mergedAt: "2026-06-06T04:15:00.000Z",
          }),
        ];
      },
    };

    const result = await generateHistoricalChangelog({
      store,
      summarizer,
      githubClient,
      changelogId: "cl_acme",
      days: 3,
      now: new Date("2026-06-07T00:30:00.000Z"),
    });

    expect(result.windows.map((window) => window.status)).toEqual([
      "empty",
      "empty",
      "published",
    ]);
    expect(store.pullRequests.map((pr) => pr.number)).toEqual([44]);
    expect(store.entries[0].title).toBe("PR 44");
  });
});

function pullRequest(
  input: Pick<PullRequestMetadata, "id" | "number" | "title" | "mergedAt"> & {
    labels?: string[];
  },
): PullRequestMetadata {
  return {
    ...input,
    body: `${input.title}.`,
    labels: input.labels ?? ["improvement"],
    url: `https://github.com/acme/app/pull/${input.number}`,
    repository: "acme/app",
    author: "octocat",
  };
}
