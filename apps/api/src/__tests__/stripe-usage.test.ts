import { describe, expect, test } from "bun:test";
import type Stripe from "stripe";
import { InMemoryStore } from "../store/memory";
import {
  createAiTokenUsageReporter,
  createCheckoutUrl,
  ensureSubscriptionUsagePrice,
  formatCreditsForMeter,
  getSafeBillingErrorType,
} from "../services/stripe";

describe("AI credit billing", () => {
  test("does not meter complimentary workspace usage", async () => {
    const store = InMemoryStore.seeded();
    store.workspaces[0].billingMode = "hosted";
    store.workspaces[0].stripeCustomerId = "cus_saved";
    store.complimentaryAccessGrants.push({
      id: "grant_friend",
      workspaceId: "ws_acme",
      planId: "watermelon",
      reason: "Launch partner",
      grantedBy: "operator@example.com",
      expiresAt: null,
      createdAt: "2026-07-22T00:00:00.000Z",
    });
    const events: Array<Record<string, unknown>> = [];
    const stripe = {
      billing: {
        meterEvents: {
          create: async (event: Record<string, unknown>) => events.push(event),
        },
      },
    } as unknown as Stripe;
    const report = createAiTokenUsageReporter({
      config: {
        appUrl: "http://cooee.test",
        billingEnabled: true,
        openAiModel: "gpt-5.4-mini",
      },
      store,
      stripe,
    });

    await report({
      workspaceId: "ws_acme",
      sourceId: "generation:cl_acme:complimentary",
      usage: {
        inputTokens: 2_000,
        cachedInputTokens: 0,
        outputTokens: 100,
        totalTokens: 2_100,
      },
    });

    expect(events).toHaveLength(0);
    expect(store.aiUsageEvents).toHaveLength(1);
    expect(store.aiUsageEvents[0]).toMatchObject({
      stripeCustomerId: null,
      totalTokens: 2_100,
      reportedAt: null,
    });
    expect(await store.listUnreportedAiUsageEvents("ws_acme", 100)).toEqual([]);
  });

  test("reports precise customer-facing credits to the configured Stripe meter", async () => {
    const store = InMemoryStore.seeded();
    store.workspaces[0].billingMode = "hosted";
    store.workspaces[0].stripeCustomerId = "cus_test";
    store.billingSubscriptions.push({
      id: "billing_test",
      workspaceId: "ws_acme",
      stripeSubscriptionId: "sub_test",
      stripeCustomerId: "cus_test",
      status: "active",
      planId: "lobster",
      billingCadence: "monthly",
      priceId: "price_test",
      repositoryLimit: 1,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      billingEmail: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      endedAt: null,
      lastPaymentFailedAt: null,
    });
    const events: Array<Record<string, unknown>> = [];
    const stripe = {
      billing: {
        meterEvents: {
          create: async (event: Record<string, unknown>) => {
            events.push(event);
          },
        },
      },
    } as unknown as Stripe;
    const report = createAiTokenUsageReporter({
      config: {
        appUrl: "http://cooee.test",
        billingEnabled: true,
        openAiModel: "gpt-5.4-mini",
        stripeAiCreditMeterEventName: "cooee_ai_credits",
      },
      store,
      stripe,
    });

    await report({
      workspaceId: "ws_acme",
      sourceId: "generation:cl_acme:window",
      usage: {
        inputTokens: 1_121,
        cachedInputTokens: 173,
        outputTokens: 64,
        totalTokens: 1_185,
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_name: "cooee_ai_credits",
      payload: { stripe_customer_id: "cus_test", value: "1.185" },
    });
    expect(store.aiUsageEvents).toHaveLength(1);
    expect(store.aiUsageEvents[0]?.reportedAt).not.toBeNull();
  });

  test("retains token-level precision when formatting usage as credits", () => {
    expect(formatCreditsForMeter(0)).toBe("0");
    expect(formatCreditsForMeter(1)).toBe("0.001");
    expect(formatCreditsForMeter(1_000)).toBe("1");
    expect(formatCreditsForMeter(1_185)).toBe("1.185");
  });

  test("reports only a safe billing error type to operational logs", () => {
    const error = new Error("No such customer: 'cus_sensitive'");
    error.name = "StripeInvalidRequestError";

    expect(getSafeBillingErrorType(error)).toBe("StripeInvalidRequestError");
    error.name = "unsafe name: cus_sensitive";
    expect(getSafeBillingErrorType(error)).toBe("Error");
    expect(getSafeBillingErrorType("cus_sensitive")).toBe("unknown");
  });

  test("reports one fixed recharge pack when usage exceeds included credits", async () => {
    const store = InMemoryStore.seeded();
    store.workspaces[0].billingMode = "hosted";
    store.workspaces[0].stripeCustomerId = "cus_test";
    store.billingSubscriptions.push({
      id: "billing_test",
      workspaceId: "ws_acme",
      stripeSubscriptionId: "sub_test",
      stripeCustomerId: "cus_test",
      status: "active",
      planId: "lobster",
      billingCadence: "monthly",
      priceId: "price_test",
      repositoryLimit: 1,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      billingEmail: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      endedAt: null,
      lastPaymentFailedAt: null,
      autoRechargeEnabled: true,
    });
    const events: Array<Record<string, unknown>> = [];
    const stripe = {
      billing: {
        meterEvents: {
          create: async (event: Record<string, unknown>) => {
            events.push(event);
          },
        },
      },
    } as unknown as Stripe;
    const report = createAiTokenUsageReporter({
      config: {
        appUrl: "http://cooee.test",
        billingEnabled: true,
        openAiModel: "gpt-5.4-mini",
      },
      store,
      stripe,
    });

    await report({
      workspaceId: "ws_acme",
      sourceId: "generation:cl_acme:overage",
      usage: {
        inputTokens: 30_001,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 30_001,
      },
    });

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      event_name: "cooee_ai_credit_recharges",
      payload: { stripe_customer_id: "cus_test", value: "1" },
    });
    expect(store.aiUsageEvents[0]?.rechargePacksReported).toBe(1);
  });

  test("starts annual checkout with the annual base before webhook metering setup", async () => {
    const priceCalls: Array<Record<string, unknown>> = [];
    const checkoutCalls: Array<Record<string, unknown>> = [];
    const stripe = {
      prices: {
        list: async (input: Record<string, unknown>) => {
          priceCalls.push(input);
          return {
            data: [
              {
                id: "price_pineapple_annual",
                lookup_key: "cooee_pineapple_annual",
              },
              {
                id: "price_pineapple_credits_monthly",
                lookup_key: "cooee_pineapple_ai_credits_monthly",
              },
            ],
          };
        },
      },
      checkout: {
        sessions: {
          create: async (input: Record<string, unknown>) => {
            checkoutCalls.push(input);
            return { url: "https://checkout.stripe.test/session" };
          },
        },
      },
    } as unknown as Stripe;

    const url = await createCheckoutUrl({
      config: {
        appUrl: "http://cooee.test",
        billingEnabled: true,
        openAiModel: "gpt-5.4-mini",
      },
      stripe,
      checkout: {
        workspaceId: "ws_acme",
        customerEmail: "owner@example.com",
        planId: "pineapple",
        billingCadence: "annual",
        currency: "aud",
      },
    });

    expect(url).toBe("https://checkout.stripe.test/session");
    expect(priceCalls).toEqual([
      {
        active: true,
        limit: 2,
        lookup_keys: [
          "cooee_pineapple_annual",
          "cooee_pineapple_ai_credits_monthly",
        ],
      },
    ]);
    expect(checkoutCalls[0]).toMatchObject({
      allow_promotion_codes: true,
      cancel_url: "http://cooee.test/changelog/billing?checkout=cancelled",
      currency: "aud",
      line_items: [{ price: "price_pineapple_annual", quantity: 1 }],
      subscription_data: {
        billing_mode: { type: "flexible" },
      },
      metadata: {
        workspaceId: "ws_acme",
        planId: "pineapple",
        billingCadence: "annual",
      },
      success_url: "http://cooee.test/changelog/billing?checkout=success",
    });
  });

  test("attaches the monthly usage item after annual checkout", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const subscription = {
      id: "sub_annual",
      status: "active",
      metadata: {
        workspaceId: "ws_acme",
        planId: "pineapple",
        billingCadence: "annual",
      },
      items: {
        data: [
          {
            id: "si_base",
            price: {
              id: "price_pineapple_annual",
              metadata: {
                component: "base",
                plan_id: "pineapple",
                billing_cadence: "annual",
              },
              recurring: { interval: "year", usage_type: "licensed" },
            },
          },
        ],
      },
    } as unknown as Stripe.Subscription;
    const stripe = {
      prices: {
        list: async () => ({
          data: [{ id: "price_pineapple_usage_monthly" }],
        }),
      },
      subscriptions: {
        update: async (_id: string, input: Record<string, unknown>) => {
          updateCalls.push(input);
          return subscription;
        },
      },
    } as unknown as Stripe;

    await ensureSubscriptionUsagePrice({ stripe, subscription });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      items: [{ price: "price_pineapple_usage_monthly" }],
      metadata: {
        workspaceId: "ws_acme",
        planId: "pineapple",
        billingCadence: "annual",
      },
      proration_behavior: "none",
    });
  });

  test("replaces an old token-meter price even when the plan metadata matches", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const subscription = {
      id: "sub_monthly",
      status: "active",
      metadata: {
        workspaceId: "ws_acme",
        planId: "watermelon",
        billingCadence: "monthly",
      },
      items: {
        data: [
          {
            id: "si_base",
            price: {
              id: "price_watermelon_monthly",
              metadata: {
                component: "base",
                plan_id: "watermelon",
                billing_cadence: "monthly",
              },
              recurring: { interval: "month", usage_type: "licensed" },
            },
          },
          {
            id: "si_old_usage",
            price: {
              id: "price_watermelon_token_usage",
              metadata: { component: "usage", plan_id: "watermelon" },
              recurring: { interval: "month", usage_type: "metered" },
            },
          },
        ],
      },
    } as unknown as Stripe.Subscription;
    const stripe = {
      prices: {
        list: async () => ({ data: [{ id: "price_watermelon_credit_usage" }] }),
      },
      subscriptions: {
        update: async (_id: string, input: Record<string, unknown>) => {
          updateCalls.push(input);
          return subscription;
        },
      },
    } as unknown as Stripe;

    await ensureSubscriptionUsagePrice({ stripe, subscription });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.items).toEqual([
      { id: "si_old_usage", deleted: true },
      { price: "price_watermelon_credit_usage" },
    ]);
  });

  test("removes the recharge meter from a subscription that opts out", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const subscription = {
      id: "sub_no_recharge",
      status: "active",
      metadata: {
        workspaceId: "ws_acme",
        planId: "lobster",
        billingCadence: "monthly",
        autoRechargeEnabled: "false",
      },
      items: {
        data: [
          {
            id: "si_base",
            price: {
              id: "price_lobster_monthly",
              metadata: {
                component: "base",
                plan_id: "lobster",
                billing_cadence: "monthly",
              },
              recurring: { interval: "month", usage_type: "licensed" },
            },
          },
          {
            id: "si_recharge",
            price: {
              id: "price_lobster_recharge",
              metadata: { component: "usage", plan_id: "lobster" },
              recurring: { interval: "month", usage_type: "metered" },
            },
          },
        ],
      },
    } as unknown as Stripe.Subscription;
    const stripe = {
      prices: {
        list: async () => ({ data: [{ id: "price_lobster_recharge" }] }),
      },
      subscriptions: {
        update: async (_id: string, input: Record<string, unknown>) => {
          updateCalls.push(input);
          return subscription;
        },
      },
    } as unknown as Stripe;

    await ensureSubscriptionUsagePrice({ stripe, subscription });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.items).toEqual([
      { id: "si_recharge", deleted: true },
    ]);
  });
});
