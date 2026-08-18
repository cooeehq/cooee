import {
  getHeldReviewExpiryCutoff,
  getLastCompletedScheduleWindow,
} from "@cooee/shared";
import { generateChangelogForWindow } from "../services/generation";
import {
  createDefaultImageGenerator,
  createDefaultSummarizer,
  type AiImageGenerator,
  type AiSummarizer,
} from "../services/openai";
import {
  createAiTokenUsageReporter,
  createStripeClient,
} from "../services/stripe";
import { loadConfig } from "../config";
import { createStore } from "../store";
import type { Store } from "../store/types";
import { createAssetStorage, type AssetStorage } from "../services/assets";
import { PostImageOrchestrator } from "../services/post-images";
import { processPostImageGenerationJobs } from "../services/post-image-jobs";
import { createGitHubAppClient } from "../services/github";

export type DailyCronResult = {
  processed: number;
};

type CronLogger = Pick<Console, "warn">;

const mergeGenerationBatchSize = 20;
const mergeGenerationRetryBaseMinutes = 5;

export async function runDailyChangelogCron(
  input: {
    env?: Record<string, string | undefined>;
    now?: Date;
    store?: Store;
    summarizer?: AiSummarizer;
    imageGenerator?: AiImageGenerator;
    assetStorage?: AssetStorage | null;
    logger?: CronLogger;
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
  const imageGenerator =
    input.imageGenerator ?? createDefaultImageGenerator(env);
  const assetStorage =
    input.assetStorage === undefined
      ? createAssetStorage(env)
      : input.assetStorage;
  const config = loadConfig(env);
  const githubClient = createGitHubAppClient(config);
  const logger = input.logger ?? console;
  const recordAiUsage = createAiTokenUsageReporter({
    config,
    store,
    stripe: createStripeClient(config),
  });

  try {
    await store.deleteHeldEntriesOlderThan(
      getHeldReviewExpiryCutoff(now).toISOString(),
    );

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
          githubClient,
          changelogId: job.changelogId,
          windowStart: job.windowStartedAt,
          windowEnd: job.windowEndedAt,
          pullRequestNumbers:
            job.pullRequestNumber === null
              ? undefined
              : [job.pullRequestNumber],
          generationKey: `${job.generationKey}:${job.changelogId}`,
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
    let scheduledChangelogsProcessed = 0;

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
          githubClient,
          changelogId: changelog.id,
          windowEnd: window.endedAt.toISOString(),
        });
        scheduledChangelogsProcessed += 1;
      } catch (error) {
        // Another worker may have completed this window after we listed it as due.
        // A generation-run conflict is therefore an idempotent no-op, not a cron failure.
        if (error instanceof Response && error.status === 409) {
          scheduledChangelogsProcessed += 1;
          continue;
        }
        if (error instanceof Response && error.status === 402) {
          logger.warn("Skipped entitlement-blocked changelog generation.", {
            changelogId: changelog.id,
            reason: await describeResponse(error),
            status: error.status,
          });
          continue;
        }
        throw error;
      }
    }

    const imageJobs = await processPostImageGenerationJobs({
      assetStorage,
      now,
      orchestrator: new PostImageOrchestrator(imageGenerator),
      recordAiUsage,
      store,
    });

    return {
      processed: mergeJobs.length + scheduledChangelogsProcessed + imageJobs,
    };
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

async function describeResponse(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) {
      return body.error.trim().slice(0, 2000);
    }
  } catch {
    // Fall back to the status when the response is not JSON.
  }
  return `HTTP ${response.status}`;
}
