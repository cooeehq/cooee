import { getLastCompletedScheduleWindow } from "@cooee/shared";
import { generateChangelogForWindow } from "../services/generation";
import { createDefaultSummarizer, type AiSummarizer } from "../services/openai";
import {
  createAiTokenUsageReporter,
  createStripeClient,
} from "../services/stripe";
import { loadConfig } from "../config";
import { createStore } from "../store";
import type { Store } from "../store/types";

export type DailyCronResult = {
  processed: number;
};

const mergeGenerationBatchSize = 20;
const mergeGenerationRetryBaseMinutes = 5;

export async function runDailyChangelogCron(
  input: {
    env?: Record<string, string | undefined>;
    now?: Date;
    store?: Store;
    summarizer?: AiSummarizer;
  } = {},
): Promise<DailyCronResult> {
  const env = input.env ?? Bun.env;
  const store = input.store ?? createStore(env);
  const summarizer =
    input.summarizer ??
    createDefaultSummarizer({
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      OPENAI_MODEL: env.OPENAI_MODEL,
    });
  const now = input.now ?? new Date();
  const config = loadConfig(env);
  const recordAiUsage = createAiTokenUsageReporter({
    config,
    store,
    stripe: createStripeClient(config),
  });

  try {
    const mergeJobs = await store.claimMergeGenerationJobs({
      now: now.toISOString(),
      limit: mergeGenerationBatchSize,
    });

    for (const job of mergeJobs) {
      try {
        await generateChangelogForWindow({
          store,
          summarizer,
          recordAiUsage,
          changelogId: job.changelogId,
          windowStart: job.windowStartedAt,
          windowEnd: job.windowEndedAt,
          pullRequestNumbers: [job.pullRequestNumber],
          generationKey: `merge:${job.changelogId}:${job.pullRequestNumber}`,
        });
        await store.completeMergeGenerationJob({
          jobId: job.id,
          claimToken: job.claimToken,
        });
      } catch (error) {
        if (error instanceof Response && error.status === 409) {
          await store.completeMergeGenerationJob({
            jobId: job.id,
            claimToken: job.claimToken,
          });
          continue;
        }

        const delayMinutes = Math.min(
          6 * 60,
          mergeGenerationRetryBaseMinutes * 2 ** (job.attemptCount - 1),
        );
        await store.retryMergeGenerationJob({
          jobId: job.id,
          claimToken: job.claimToken,
          error: describeError(error),
          nextAttemptAt: new Date(
            now.getTime() + delayMinutes * 60 * 1000,
          ).toISOString(),
        });
      }
    }

    const due = await store.listDueChangelogs(now);

    for (const changelog of due) {
      const window = getLastCompletedScheduleWindow({
        now,
        timeZone: changelog.settings.timeZone,
        publishTime: changelog.settings.publishTime,
        frequency: changelog.settings.scheduleFrequency,
        scheduleWeekday: changelog.settings.scheduleWeekday,
        scheduleMonthDay: changelog.settings.scheduleMonthDay,
      });

      try {
        await generateChangelogForWindow({
          store,
          summarizer,
          recordAiUsage,
          changelogId: changelog.id,
          windowEnd: window.endedAt.toISOString(),
        });
      } catch (error) {
        // Another worker may have completed this window after we listed it as due.
        // A generation-run conflict is therefore an idempotent no-op, not a cron failure.
        if (error instanceof Response && error.status === 409) continue;
        throw error;
      }
    }

    return { processed: mergeJobs.length + due.length };
  } finally {
    await store.close?.();
  }
}

function describeError(error: unknown): string {
  if (error instanceof Response) {
    return `HTTP ${error.status}`;
  }
  if (error instanceof Error) {
    return error.message.slice(0, 2000);
  }
  return "Unknown merge generation error";
}
