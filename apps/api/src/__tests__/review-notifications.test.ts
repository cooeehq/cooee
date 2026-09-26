import { describe, expect, test } from "bun:test";
import {
  createReviewNotificationSender,
  sendPendingReviewNotifications,
} from "../services/review-notifications";
import { InMemoryStore } from "../store/memory";

describe("pending review notifications", () => {
  test("submits all recipient messages in one provider batch", async () => {
    let requestedUrl = "";
    let requestedBody: unknown;
    const sender = createReviewNotificationSender(
      {
        RESEND_API_KEY: "test-key",
        REVIEW_EMAIL_FROM: "Cooee <notifications@example.com>",
      },
      (async (input, init) => {
        requestedUrl = String(input);
        requestedBody = JSON.parse(String(init?.body));
        return Response.json({ data: [{ id: "email_1" }, { id: "email_2" }] });
      }) as typeof fetch,
    );

    await sender?.sendBatch([
      { to: "one@example.com", subject: "Review", html: "One", text: "One" },
      { to: "two@example.com", subject: "Review", html: "Two", text: "Two" },
    ]);

    expect(requestedUrl).toBe("https://api.resend.com/emails/batch");
    expect(requestedBody).toEqual([
      {
        from: "Cooee <notifications@example.com>",
        to: "one@example.com",
        subject: "Review",
        html: "One",
        text: "One",
      },
      {
        from: "Cooee <notifications@example.com>",
        to: "two@example.com",
        subject: "Review",
        html: "Two",
        text: "Two",
      },
    ]);
  });

  test("emails owners once when pending posts are waiting", async () => {
    const store = InMemoryStore.seeded();
    store.workspaceSettings.set("ws_acme", { autoPublish: false });
    store.notificationRecipients.push({
      workspaceId: "ws_acme",
      userId: "user_1",
      name: "Owner",
      email: "owner@example.com",
    });
    store.entries.unshift({
      ...store.entries[0]!,
      id: "entry_pending_review",
      status: "pending",
      publishedAt: null,
      holdReason: undefined,
      title: "Safer exports",
      summary: "Exports now omit hidden fields.",
    });
    const messages: Array<{ to: string; subject: string; html: string }> = [];
    const sender = {
      async sendBatch(
        batch: Array<(typeof messages)[number] & { text: string }>,
      ) {
        messages.push(...batch);
      },
    };

    await expect(
      sendPendingReviewNotifications({
        appUrl: "https://app.cooee.test",
        now: new Date("2026-09-26T02:00:00.000Z"),
        sender,
        store,
      }),
    ).resolves.toBe(1);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      to: "owner@example.com",
      subject: "1 changelog post waiting for review",
    });
    expect(messages[0]?.html).toContain("Safer exports");
    expect(messages[0]?.html).toContain(
      "https://app.cooee.test/changelog/privacy",
    );
    expect(
      store.entries.find((entry) => entry.id === "entry_pending_review")
        ?.reviewNotifiedAt,
    ).toBe("2026-09-26T02:00:00.000Z");

    store.entries.unshift({
      ...store.entries[0]!,
      id: "entry_new_pending_review",
      status: "pending",
      publishedAt: null,
      reviewNotifiedAt: undefined,
      title: "Faster reviews",
      summary: "Review pages now load faster.",
    });
    await sendPendingReviewNotifications({
      appUrl: "https://app.cooee.test",
      now: new Date("2026-09-26T02:15:00.000Z"),
      sender,
      store,
    });
    expect(messages).toHaveLength(2);
    expect(messages[1]?.subject).toBe("1 changelog post waiting for review");
    expect(messages[1]?.html).toContain("Faster reviews");
    expect(messages[1]?.html).not.toContain("Safer exports");

    await sendPendingReviewNotifications({
      appUrl: "https://app.cooee.test",
      now: new Date("2026-09-26T02:30:00.000Z"),
      sender,
      store,
    });
    expect(messages).toHaveLength(2);
  });

  test("splits large recipient lists into provider-sized batches", async () => {
    const store = InMemoryStore.seeded();
    store.entries.unshift({
      ...store.entries[0]!,
      id: "entry_pending_large_workspace",
      status: "pending",
      publishedAt: null,
      holdReason: undefined,
    });
    store.notificationRecipients.push(
      ...Array.from({ length: 205 }, (_, index) => ({
        workspaceId: "ws_acme",
        userId: `user_${index}`,
        name: `Owner ${index}`,
        email: `owner-${index}@example.com`,
      })),
    );
    const batchSizes: number[] = [];

    await expect(
      sendPendingReviewNotifications({
        appUrl: "https://app.cooee.test",
        now: new Date("2026-09-26T02:00:00.000Z"),
        sender: {
          async sendBatch(batch) {
            batchSizes.push(batch.length);
          },
        },
        store,
      }),
    ).resolves.toBe(205);

    expect(batchSizes).toEqual([100, 100, 5]);
    expect(
      store.entries.find(
        (entry) => entry.id === "entry_pending_large_workspace",
      )?.reviewNotifiedAt,
    ).toBe("2026-09-26T02:00:00.000Z");
  });

  test("does not resend recipients from successful batches after a later batch fails", async () => {
    const store = InMemoryStore.seeded();
    store.entries.unshift({
      ...store.entries[0]!,
      id: "entry_pending_partial_delivery",
      status: "pending",
      publishedAt: null,
      holdReason: undefined,
    });
    store.notificationRecipients.push(
      ...Array.from({ length: 101 }, (_, index) => ({
        workspaceId: "ws_acme",
        userId: `user_${index}`,
        name: `Owner ${index}`,
        email: `owner-${index}@example.com`,
      })),
    );
    const deliveries = new Map<string, number>();
    let batchNumber = 0;
    const sender = {
      async sendBatch(batch: Array<{ to: string }>) {
        batchNumber += 1;
        if (batchNumber === 2) throw new Error("Provider unavailable");
        for (const message of batch) {
          deliveries.set(message.to, (deliveries.get(message.to) ?? 0) + 1);
        }
      },
    };

    await expect(
      sendPendingReviewNotifications({
        appUrl: "https://app.cooee.test",
        now: new Date("2026-09-26T02:00:00.000Z"),
        sender,
        store,
        logger: { warn() {} },
      }),
    ).resolves.toBe(100);

    await expect(
      sendPendingReviewNotifications({
        appUrl: "https://app.cooee.test",
        now: new Date("2026-09-26T02:15:00.000Z"),
        sender,
        store,
      }),
    ).resolves.toBe(1);

    expect(deliveries.size).toBe(101);
    expect([...deliveries.values()].every((count) => count === 1)).toBe(true);
    expect(
      store.entries.find(
        (entry) => entry.id === "entry_pending_partial_delivery",
      )?.reviewNotifiedAt,
    ).toBe("2026-09-26T02:15:00.000Z");
  });

  test("does not notify for held entries", async () => {
    const store = InMemoryStore.seeded();
    store.notificationRecipients.push({
      workspaceId: "ws_acme",
      userId: "user_1",
      name: "Owner",
      email: "owner@example.com",
    });
    store.entries.unshift({
      ...store.entries[0]!,
      id: "entry_skipped",
      status: "held",
      publishedAt: null,
      holdReason: "skip-label:cooee:skip",
    });
    store.entries.unshift({
      ...store.entries[0]!,
      id: "entry_guardrail_hold",
      status: "held",
      publishedAt: null,
      holdReason: "publication-eligibility-review",
    });
    const messages: unknown[] = [];

    await expect(
      sendPendingReviewNotifications({
        appUrl: "https://app.cooee.test",
        now: new Date("2026-09-26T02:00:00.000Z"),
        sender: {
          async sendBatch(batch) {
            messages.push(...batch);
          },
        },
        store,
      }),
    ).resolves.toBe(0);
    expect(messages).toHaveLength(0);
  });

  test("still notifies existing pending posts after autopublish is enabled", async () => {
    const store = InMemoryStore.seeded();
    store.workspaceSettings.set("ws_acme", { autoPublish: true });
    store.notificationRecipients.push({
      workspaceId: "ws_acme",
      userId: "user_1",
      name: "Owner",
      email: "owner@example.com",
    });
    store.entries.unshift({
      ...store.entries[0]!,
      id: "entry_pending_before_setting_change",
      status: "pending",
      publishedAt: null,
      holdReason: undefined,
    });
    const messages: unknown[] = [];

    await expect(
      sendPendingReviewNotifications({
        appUrl: "https://app.cooee.test",
        now: new Date("2026-09-26T02:00:00.000Z"),
        sender: {
          async sendBatch(batch) {
            messages.push(...batch);
          },
        },
        store,
      }),
    ).resolves.toBe(1);
    expect(messages).toHaveLength(1);
  });
});
