import type { AssetStorage } from "./assets";
import type { AiTokenUsage } from "./openai";
import { PostImageGenerationError, PostImageOrchestrator } from "./post-images";
import { postImageAssetKey, publicPostImageUrl } from "./post-image-assets";
import type { Store } from "../store/types";
import { getWorkspaceEntitlements } from "./entitlements";

export async function processPostImageGenerationJobs(input: {
  assetStorage: AssetStorage | null;
  now: Date;
  orchestrator: PostImageOrchestrator;
  recordAiUsage: (input: {
    workspaceId: string;
    sourceId: string;
    usage: AiTokenUsage;
  }) => Promise<void>;
  store: Store;
  limit?: number;
}): Promise<number> {
  const jobs = await input.store.claimPostImageGenerationJobs({
    now: input.now.toISOString(),
    limit: input.limit ?? 10,
  });

  for (const job of jobs) {
    const changelog = await input.store.getChangelogById(job.changelogId);
    const entry = (await input.store.listEntries(job.changelogId)).find(
      (candidate) => candidate.id === job.entryId,
    );
    if (!changelog || !entry || entry.imageUrl || !input.assetStorage) {
      await input.store.retryPostImageGeneration({
        entryId: job.entryId,
        claimToken: job.claimToken,
        error: input.assetStorage
          ? "The post is no longer available for image generation."
          : "Post image asset storage is not configured.",
      });
      continue;
    }

    try {
      const settings = changelog.settings.postImageSettings;
      if (settings.mode !== "brand-card") {
        const entitlements = await getWorkspaceEntitlements(
          input.store,
          changelog.workspaceId,
        );
        if (!entitlements.aiGeneration) {
          throw new PostImageGenerationError(
            "AI image generation is not available on the current plan.",
            false,
          );
        }
      }
      const reference = settings.referenceAssetKey
        ? await input.assetStorage.getObject(settings.referenceAssetKey)
        : null;
      const rendered = await input.orchestrator.render({
        category: entry.category,
        title: entry.title,
        summary: entry.summary,
        settings,
        reference,
      });
      if (rendered.requestId) {
        console.info("Automatic post image generated", {
          entryId: entry.id,
          requestId: rendered.requestId,
        });
      }
      if (rendered.usage) {
        await input.recordAiUsage({
          workspaceId: changelog.workspaceId,
          sourceId: `post-image:auto:${entry.id}:${job.attemptCount}`,
          usage: rendered.usage,
        });
      }

      const latest = (await input.store.listEntries(job.changelogId)).find(
        (candidate) => candidate.id === job.entryId,
      );
      if (latest?.imageUrl) continue;

      const imageUrl = publicPostImageUrl(
        changelog.workspaceId,
        entry.id,
        rendered.body,
      );
      await input.assetStorage.putObject({
        body: rendered.body,
        contentType: rendered.contentType,
        key: postImageAssetKey(changelog.workspaceId, entry.id),
      });
      await input.store.completePostImageGeneration({
        entryId: entry.id,
        claimToken: job.claimToken,
        imageUrl,
      });
    } catch (error) {
      const retryable =
        error instanceof PostImageGenerationError ? error.retryable : true;
      const shouldRetry = retryable && job.attemptCount < 3;
      await input.store.retryPostImageGeneration({
        entryId: job.entryId,
        claimToken: job.claimToken,
        error:
          error instanceof PostImageGenerationError
            ? error.message
            : "Image generation is temporarily unavailable.",
        ...(shouldRetry
          ? {
              nextAttemptAt: new Date(
                input.now.getTime() +
                  5 * 60 * 1000 * 2 ** (job.attemptCount - 1),
              ).toISOString(),
            }
          : {}),
      });
    }
  }

  return jobs.length;
}
