import { describe, expect, test } from "bun:test";
import Stripe from "stripe";
import { createApp } from "../server";
import {
  renderBillingEmail,
  type BillingEmailSender,
} from "../services/billing-notifications";
import { InMemoryStore } from "../store/memory";

const webhookSecret = "whsec_billing_lifecycle_test";

describe("billing notification email", () => {
  test("uses the Cooee PNG wordmarks for light and dark email clients", () => {
    const html = renderBillingEmail({
      to: "owner@example.com",
      subject: "Billing update",
      headline: "Your plan is ready",
      message: "Your included credits are available.",
    });

    expect(html).toContain(
      'src="https://cooee.sh/logos/cooee-logo-dark.png?v=960de9ad"',
    );
    expect(html).toContain(
      'src="https://cooee.sh/logos/cooee-logo-light.png?v=9c613c05"',
    );
    expect(html.match(/alt="Cooee"/g)).toHaveLength(2);
    expect(html).toContain("@media (prefers-color-scheme:dark)");
  });
});

describe("billing lifecycle webhooks", () => {
  test("keeps past-due accounts in grace, notifies once, then restricts unpaid accounts", async () => {
    const store = InMemoryStore.seeded();
    store.workspaces[0].billingMode = "hosted";
    store.workspaces[0].repositoryLimit = 3;
    await store.upsertBillingSubscription({
      workspaceId: "ws_acme",
      stripeSubscriptionId: "sub_lifecycle",
      stripeCustomerId: "cus_lifecycle",
      status: "active",
      planId: "pineapple",
      billingCadence: "monthly",
      priceId: "price_pineapple",
      repositoryLimit: 3,
      currentPeriodStart: "2026-07-01T00:00:00.000Z",
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      billingEmail: "owner@example.com",
      cancelAtPeriodEnd: false,
      cancelAt: null,
      endedAt: null,
      lastPaymentFailedAt: null,
    });

    const sent: Array<{ subject: string; key: string }> = [];
    const sender: BillingEmailSender = {
      send: async (email, key) => {
        sent.push({ subject: email.subject, key });
        return `email_${sent.length}`;
      },
    };
    const stripe = new Stripe("sk_test_123", {
      apiVersion: "2026-02-25.clover",
    });
    stripe.subscriptions.retrieve = async () =>
      subscriptionPayload(
        "past_due",
      ) as unknown as Stripe.Response<Stripe.Subscription>;
    const app = createApp({
      store,
      stripeClient: stripe,
      billingEmailSender: sender,
      env: {
        BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_123",
        STRIPE_WEBHOOK_SECRET: webhookSecret,
        APP_URL: "https://cooee.test",
      },
    });
    const paymentFailed = {
      id: "evt_payment_failed",
      object: "event",
      created: 1785542400,
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_failed",
          object: "invoice",
          customer_email: "owner@example.com",
          next_payment_attempt: 1785628800,
          parent: {
            type: "subscription_details",
            subscription_details: { subscription: "sub_lifecycle" },
          },
        },
      },
    };

    const first = await signedWebhook(app, stripe, paymentFailed);
    const duplicate = await signedWebhook(app, stripe, paymentFailed);
    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toContain("couldn’t process");
    expect(await store.getWorkspace("ws_acme")).toMatchObject({
      repositoryLimit: 3,
    });
    expect(await store.getBillingSubscription("ws_acme")).toMatchObject({
      status: "past_due",
      lastPaymentFailedAt: "2026-08-01T00:00:00.000Z",
    });

    const unpaid = subscriptionPayload("unpaid");
    const restricted = await signedWebhook(app, stripe, {
      id: "evt_subscription_unpaid",
      object: "event",
      created: 1785542500,
      type: "customer.subscription.updated",
      data: { object: unpaid },
    });
    expect(restricted.status).toBe(200);
    expect(await store.getWorkspace("ws_acme")).toMatchObject({
      repositoryLimit: 1,
    });
    expect(sent.map((email) => email.subject)).toContain(
      "Paid Cooee features have been paused",
    );
  });

  test("records scheduled cancellation and sends a lifecycle notice", async () => {
    const store = InMemoryStore.seeded();
    store.workspaces[0].billingMode = "hosted";
    await store.upsertBillingSubscription({
      workspaceId: "ws_acme",
      stripeSubscriptionId: "sub_lifecycle",
      stripeCustomerId: "cus_lifecycle",
      status: "active",
      planId: "pineapple",
      billingCadence: "monthly",
      priceId: "price_pineapple",
      repositoryLimit: 3,
      currentPeriodStart: "2026-07-01T00:00:00.000Z",
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      billingEmail: "owner@example.com",
      cancelAtPeriodEnd: false,
      cancelAt: null,
      endedAt: null,
      lastPaymentFailedAt: null,
    });
    const subjects: string[] = [];
    const stripe = new Stripe("sk_test_123", {
      apiVersion: "2026-02-25.clover",
    });
    const app = createApp({
      store,
      stripeClient: stripe,
      billingEmailSender: {
        send: async (email) => {
          subjects.push(email.subject);
          return "email_cancellation";
        },
      },
      env: {
        BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_123",
        STRIPE_WEBHOOK_SECRET: webhookSecret,
        APP_URL: "https://cooee.test",
      },
    });
    const subscription = subscriptionPayload("active", {
      cancel_at_period_end: true,
      cancel_at: 1788220800,
    });
    stripe.subscriptions.retrieve = async () =>
      subscription as unknown as Stripe.Response<Stripe.Subscription>;
    const response = await signedWebhook(app, stripe, {
      id: "evt_cancellation_scheduled",
      object: "event",
      created: 1785542600,
      type: "customer.subscription.updated",
      data: { object: subscription },
    });

    expect(response.status).toBe(200);
    expect(await store.getBillingSubscription("ws_acme")).toMatchObject({
      cancelAtPeriodEnd: true,
      cancelAt: "2026-09-01T00:00:00.000Z",
    });
    expect(subjects).toEqual(["Your Cooee plan is scheduled to end"]);
  });
});

function subscriptionPayload(
  status: Stripe.Subscription.Status,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "sub_lifecycle",
    object: "subscription",
    customer: "cus_lifecycle",
    status,
    cancel_at_period_end: false,
    cancel_at: null,
    ended_at: null,
    metadata: {
      workspaceId: "ws_acme",
      planId: "pineapple",
      billingCadence: "monthly",
    },
    items: {
      data: [
        {
          id: "si_base",
          price: {
            id: "price_pineapple",
            metadata: {
              component: "base",
              plan_id: "pineapple",
              billing_cadence: "monthly",
            },
            recurring: { interval: "month", usage_type: "licensed" },
          },
          current_period_start: 1782864000,
          current_period_end: 1785542400,
        },
        {
          id: "si_usage",
          price: {
            id: "price_pineapple_usage",
            metadata: {
              component: "usage",
              plan_id: "pineapple",
              recharge_credits: "100",
            },
            recurring: { interval: "month", usage_type: "metered" },
          },
          current_period_start: 1782864000,
          current_period_end: 1785542400,
        },
      ],
    },
    ...overrides,
  };
}

async function signedWebhook(
  app: ReturnType<typeof createApp>,
  stripe: Stripe,
  event: Record<string, unknown>,
): Promise<Response> {
  const payload = JSON.stringify(event);
  const signature = await stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: webhookSecret,
  });
  return app.fetch(
    new Request("https://cooee.test/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: payload,
    }),
  );
}
