import { createDefaultSummarizer } from "../services/openai";
import { generateHistoricalChangelog } from "../services/historical";
import { loadConfig } from "../config";
import { createGitHubAppClient } from "../services/github";
import { createStore } from "../store";
import {
  createAiTokenUsageReporter,
  createStripeClient,
} from "../services/stripe";

const options = parseArgs(Bun.argv.slice(2), Bun.env);
const store = createStore(Bun.env);
const config = loadConfig(Bun.env);
const recordAiUsage = createAiTokenUsageReporter({
  config,
  store,
  stripe: createStripeClient(config),
});
const githubClient = createGitHubAppClient(loadConfig(Bun.env));
const summarizer = createDefaultSummarizer({
  OPENAI_API_KEY: Bun.env.OPENAI_API_KEY,
  OPENAI_MODEL: Bun.env.OPENAI_MODEL,
});
const changelogs = options.changelogId
  ? [await store.getChangelogById(options.changelogId)].filter(
      (item) => item !== null,
    )
  : await store.listChangelogs(options.workspaceId);

if (changelogs.length === 0) {
  throw new Error(
    options.changelogId
      ? `No changelog found for ${options.changelogId}.`
      : `No changelogs found for workspace ${options.workspaceId}.`,
  );
}

let processedWindows = 0;

for (const changelog of changelogs) {
  const result = await generateHistoricalChangelog({
    store,
    summarizer,
    recordAiUsage,
    githubClient,
    changelogId: changelog.id,
    days: options.days,
  });
  processedWindows += result.windows.length;

  const counts = result.windows.reduce<Record<string, number>>(
    (acc, window) => {
      acc[window.status] = (acc[window.status] ?? 0) + 1;
      return acc;
    },
    {},
  );

  console.log(
    `${changelog.name} (${changelog.id}): ${result.windows.length} window(s), ${formatCounts(counts)}`,
  );
}

console.log(
  `Processed ${processedWindows} historical window(s) across ${changelogs.length} changelog(s).`,
);

function parseArgs(
  argv: string[],
  env: Record<string, string | undefined>,
): {
  changelogId?: string;
  days: number;
  workspaceId: string;
} {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2) as [
      string,
      string | undefined,
    ];
    const value = inlineValue ?? argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}.`);
    }

    if (!inlineValue) {
      index += 1;
    }

    values.set(key, value);
  }

  const days = Number(values.get("days") ?? env.LAST_N_DAYS);

  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error(
      "Pass --days N or LAST_N_DAYS=N with an integer from 1 to 365.",
    );
  }

  return {
    changelogId: values.get("changelog-id") ?? env.CHANGELOG_ID,
    days,
    workspaceId: values.get("workspace-id") ?? env.WORKSPACE_ID ?? "ws_acme",
  };
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}=${count}`)
    .join(", ");
}
