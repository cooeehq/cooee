import type { Store, StoredChangelog, StoredEntry } from "../store/types";
import { renderPendingReviewEmail } from "./review-notification-email";

export type ReviewNotificationMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type ReviewNotificationSender = {
  sendBatch(messages: ReviewNotificationMessage[]): Promise<void>;
};

const reviewNotificationBatchSize = 100;

export function createReviewNotificationSender(
  env: Record<string, string | undefined> = Bun.env,
  fetcher: typeof fetch = fetch,
): ReviewNotificationSender | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.REVIEW_EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;

  return {
    async sendBatch(messages) {
      const response = await fetcher("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(messages.map((message) => ({ from, ...message }))),
      });
      if (!response.ok) {
        throw new Error(
          `Review notification delivery failed (${response.status}).`,
        );
      }
    },
  };
}

export async function sendPendingReviewNotifications(input: {
  appUrl: string;
  now: Date;
  sender: ReviewNotificationSender | null;
  store: Store;
  logger?: Pick<Console, "warn">;
}): Promise<number> {
  if (!input.sender) return 0;

  const logger = input.logger ?? console;
  const workspaceIds = new Set<string>();
  const candidateChangelogs = new Map<
    string,
    Array<{ changelog: StoredChangelog; entries: StoredEntry[] }>
  >();

  for (const workspaceId of await listWorkspaceIds(input.store)) {
    for (const changelog of await input.store.listChangelogs(workspaceId)) {
      const entries = await input.store.listPendingEntries(changelog.id);
      if (entries.some((entry) => !entry.reviewNotifiedAt)) {
        workspaceIds.add(workspaceId);
        const existing = candidateChangelogs.get(workspaceId) ?? [];
        existing.push({ changelog, entries });
        candidateChangelogs.set(workspaceId, existing);
      }
    }
  }

  let sent = 0;
  for (const workspaceId of workspaceIds) {
    const groups = candidateChangelogs.get(workspaceId) ?? [];
    const recipients =
      await input.store.listWorkspaceNotificationRecipients(workspaceId);
    if (recipients.length === 0) continue;
    const workspace = await input.store.getWorkspace(workspaceId);
    const unnotifiedGroups = groups
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) => !entry.reviewNotifiedAt),
      }))
      .filter((group) => group.entries.length > 0);
    const unnotified = unnotifiedGroups.flatMap((group) => group.entries);
    const deliveries = await input.store.listReviewNotificationDeliveries({
      workspaceId,
      entryIds: unnotified.map((entry) => entry.id),
    });
    const delivered = new Set(
      deliveries.map((delivery) =>
        deliveryKey(delivery.entryId, delivery.recipientEmail),
      ),
    );
    try {
      const pendingMessages = (
        await Promise.all(
          recipients.map(async (recipient) => {
            const recipientGroups = unnotifiedGroups
              .map((group) => ({
                ...group,
                entries: group.entries.filter(
                  (entry) =>
                    !delivered.has(deliveryKey(entry.id, recipient.email)),
                ),
              }))
              .filter((group) => group.entries.length > 0);
            const recipientEntries = recipientGroups.flatMap(
              (group) => group.entries,
            );
            if (recipientEntries.length === 0) return null;
            return {
              entryIds: recipientEntries.map((entry) => entry.id),
              message: {
                ...(await renderPendingReviewEmail({
                  appUrl: input.appUrl,
                  groups: recipientGroups.map((group) => ({
                    changelogName: group.changelog.name,
                    entries: group.entries.map((entry) => ({
                      category: entry.category,
                      id: entry.id,
                      summary: entry.summary,
                      title: entry.title,
                    })),
                  })),
                  pendingCount: recipientEntries.length,
                  workspaceName: workspace?.name ?? "your workspace",
                })),
                to: recipient.email,
              },
            };
          }),
        )
      ).filter((message) => message !== null);

      for (
        let offset = 0;
        offset < pendingMessages.length;
        offset += reviewNotificationBatchSize
      ) {
        const batch = pendingMessages.slice(
          offset,
          offset + reviewNotificationBatchSize,
        );
        await input.sender.sendBatch(batch.map((item) => item.message));
        const batchDeliveries = batch.flatMap((item) =>
          item.entryIds.map((entryId) => ({
            entryId,
            recipientEmail: item.message.to.toLowerCase(),
          })),
        );
        await input.store.recordReviewNotificationDeliveries({
          workspaceId,
          deliveries: batchDeliveries,
          deliveredAt: input.now.toISOString(),
        });
        for (const delivery of batchDeliveries) {
          delivered.add(deliveryKey(delivery.entryId, delivery.recipientEmail));
        }
        sent += batch.length;
      }
      const fullyNotifiedEntryIds = unnotified
        .filter((entry) =>
          recipients.every((recipient) =>
            delivered.has(deliveryKey(entry.id, recipient.email)),
          ),
        )
        .map((entry) => entry.id);
      await input.store.markEntriesReviewNotified({
        workspaceId,
        entryIds: fullyNotifiedEntryIds,
        notifiedAt: input.now.toISOString(),
      });
    } catch (error) {
      logger.warn("Could not send pending changelog review notification.", {
        workspaceId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  return sent;
}

function deliveryKey(entryId: string, recipientEmail: string): string {
  return `${entryId}\0${recipientEmail.toLowerCase()}`;
}

async function listWorkspaceIds(store: Store): Promise<string[]> {
  return store.listWorkspaceIdsForNotifications();
}
