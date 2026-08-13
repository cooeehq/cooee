import Stripe from "stripe";
import {
  aiCreditRecharge,
  getHostedPlanEntitlements,
  isBillingCadence,
  isEntitledSubscriptionStatus,
  isHostedPaidPlanId,
  type BillingCadence,
  type BillingCurrency,
  type HostedPaidPlanId,
} from "@cooee/shared";
import { getWorkspaceEntitlements } from "./entitlements";
import type { RuntimeConfig } from "../config";
import type { AiTokenUsage } from "./openai";
import type { Store } from "../store/types";

const tokensPerCredit = 1_000;

export type BillingCheckoutInput = {
  workspaceId: string;
  customerId?: string;
  customerEmail?: string;
  planId?: BillingPlanId;
  billingCadence?: BillingCadence;
  currency?: BillingCurrency;
};

export type BillingPlanId = HostedPaidPlanId;
export type { BillingCadence };

export type BillingPlanDefinition = {
  id: BillingPlanId;
  name: string;
  description: string;
  monthlyLookupKey: string;
  annualLookupKey: string;
  monthlyUsagePriceLookupKey: string;
  monthlyAmount: number;
  annualAmount: number;
  priceLabel: string;
  cadence: string;
  annualPriceLabel: string;
  annualCadence: string;
  repositoryLimit: number;
  monthlyPullRequestLimit: number;
  monthlyIncludedCredits: number;
  estimatedMonthlyPullRequests: number;
  features: string[];
};

export function isAutoRechargeEnabled(
  subscription: Pick<Stripe.Subscription, "metadata">,
): boolean {
  return subscription.metadata?.autoRechargeEnabled !== "false";
}

export const billingPlans: BillingPlanDefinition[] = [
  {
    id: "lobster",
    name: "Lobster",
    description: "For small teams and independent products getting started.",
    monthlyLookupKey: "cooee_lobster_monthly",
    annualLookupKey: "cooee_lobster_annual",
    monthlyUsagePriceLookupKey: "cooee_lobster_ai_credits_monthly",
    monthlyAmount: 20,
    annualAmount: 200,
    priceLabel: "$20",
    cadence: "month",
    annualPriceLabel: "$200",
    annualCadence: "year",
    repositoryLimit: getHostedPlanEntitlements("lobster").repositoryLimit,
    monthlyPullRequestLimit:
      getHostedPlanEntitlements("lobster").estimatedMonthlyPullRequests,
    monthlyIncludedCredits:
      getHostedPlanEntitlements("lobster").monthlyIncludedCredits,
    estimatedMonthlyPullRequests:
      getHostedPlanEntitlements("lobster").estimatedMonthlyPullRequests,
    features: [
      "100 AI credits / month (~25 PRs)",
      "1 repository",
      "Manual and AI-drafted posts",
      "Review-first drafts or opt-in auto-publishing",
      "Hosted changelog, JSON feed, and React embed",
      "Custom logo, custom domain, and product link",
      "Privacy checks and editorial review",
    ],
  },
  {
    id: "pineapple",
    name: "Pineapple",
    description: "For product teams with regular release volume.",
    monthlyLookupKey: "cooee_pineapple_monthly",
    annualLookupKey: "cooee_pineapple_annual",
    monthlyUsagePriceLookupKey: "cooee_pineapple_ai_credits_monthly",
    monthlyAmount: 50,
    annualAmount: 500,
    priceLabel: "$50",
    cadence: "month",
    annualPriceLabel: "$500",
    annualCadence: "year",
    repositoryLimit: getHostedPlanEntitlements("pineapple").repositoryLimit,
    monthlyPullRequestLimit:
      getHostedPlanEntitlements("pineapple").estimatedMonthlyPullRequests,
    monthlyIncludedCredits:
      getHostedPlanEntitlements("pineapple").monthlyIncludedCredits,
    estimatedMonthlyPullRequests:
      getHostedPlanEntitlements("pineapple").estimatedMonthlyPullRequests,
    features: [
      "Everything in Lobster",
      "Up to 3 repositories",
      "400 AI credits / month (~100 PRs)",
      "Better value for regular release volume",
    ],
  },
  {
    id: "watermelon",
    name: "Watermelon",
    description: "For teams managing multiple products or release streams.",
    monthlyLookupKey: "cooee_watermelon_monthly",
    annualLookupKey: "cooee_watermelon_annual",
    monthlyUsagePriceLookupKey: "cooee_watermelon_ai_credits_monthly",
    monthlyAmount: 100,
    annualAmount: 1_000,
    priceLabel: "$100",
    cadence: "month",
    annualPriceLabel: "$1,000",
    annualCadence: "year",
    repositoryLimit: getHostedPlanEntitlements("watermelon").repositoryLimit,
    monthlyPullRequestLimit:
      getHostedPlanEntitlements("watermelon").estimatedMonthlyPullRequests,
    monthlyIncludedCredits:
      getHostedPlanEntitlements("watermelon").monthlyIncludedCredits,
    estimatedMonthlyPullRequests:
      getHostedPlanEntitlements("watermelon").estimatedMonthlyPullRequests,
    features: [
      "Everything in Pineapple",
      "Up to 15 repositories",
      "1,000 AI credits / month (~250 PRs)",
      "Multiple changelogs for different products or audiences",
    ],
  },
];

export function createStripeClient(config: RuntimeConfig): Stripe | null {
  if (!config.billingEnabled || !config.stripeSecretKey) {
    return null;
  }

  return new Stripe(config.stripeSecretKey, {
    apiVersion: "2026-02-25.clover",
  });
}

export async function createCheckoutUrl(input: {
  stripe: Stripe | null;
  config: RuntimeConfig;
  checkout: BillingCheckoutInput;
}): Promise<string | null> {
  if (!input.stripe) {
    return null;
  }

  const prices = await resolveCheckoutPrices({
    stripe: input.stripe,
    config: input.config,
    planId: input.checkout.planId,
    billingCadence: input.checkout.billingCadence,
  });

  if (!prices) {
    return null;
  }

  const session = await input.stripe.checkout.sessions.create({
    mode: "subscription",
    allow_promotion_codes: true,
    ...(input.checkout.currency ? { currency: input.checkout.currency } : {}),
    ...(input.checkout.customerId
      ? { customer: input.checkout.customerId }
      : input.checkout.customerEmail
        ? { customer_email: input.checkout.customerEmail }
        : {}),
    line_items: [
      { price: prices.basePriceId, quantity: 1 },
      ...(input.checkout.billingCadence === "annual"
        ? []
        : [{ price: prices.usagePriceId }]),
    ],
    subscription_data: {
      billing_mode: { type: "flexible" },
      metadata: {
        workspaceId: input.checkout.workspaceId,
        planId: input.checkout.planId ?? "pineapple",
        billingCadence: input.checkout.billingCadence ?? "monthly",
      },
    },
    success_url: `${input.config.appUrl}/changelog/billing?checkout=success`,
    cancel_url: `${input.config.appUrl}/changelog/billing?checkout=cancelled`,
    metadata: {
      workspaceId: input.checkout.workspaceId,
      planId: input.checkout.planId ?? "pineapple",
      billingCadence: input.checkout.billingCadence ?? "monthly",
    },
  });

  return session.url;
}

async function resolveCheckoutPrices(input: {
  stripe: Stripe;
  config: RuntimeConfig;
  planId?: BillingPlanId;
  billingCadence?: BillingCadence;
}): Promise<{ basePriceId: string; usagePriceId: string } | null> {
  if (!input.planId) {
    return null;
  }

  const plan = billingPlans.find((item) => item.id === input.planId);
  if (!plan) {
    return null;
  }

  const billingCadence = input.billingCadence ?? "monthly";
  const baseLookupKey =
    billingCadence === "annual" ? plan.annualLookupKey : plan.monthlyLookupKey;
  const usageLookupKey = plan.monthlyUsagePriceLookupKey;
  const prices = await input.stripe.prices.list({
    active: true,
    limit: 2,
    lookup_keys: [baseLookupKey, usageLookupKey],
  });
  const priceByLookupKey = new Map(
    prices.data.map((price) => [price.lookup_key, price.id]),
  );
  const basePriceId = priceByLookupKey.get(baseLookupKey);
  const usagePriceId = priceByLookupKey.get(usageLookupKey);

  return basePriceId && usagePriceId ? { basePriceId, usagePriceId } : null;
}

export function getSubscriptionPlan(input: Stripe.Subscription): {
  planId: BillingPlanId;
  billingCadence: BillingCadence;
  basePrice: Stripe.Price;
  usageItem: Stripe.SubscriptionItem | null;
} | null {
  const baseItem =
    input.items.data.find(
      (item) => item.price.metadata?.component === "base",
    ) ??
    input.items.data.find(
      (item) => item.price.recurring?.usage_type !== "metered",
    );
  if (!baseItem) return null;

  const rawPlanId = baseItem.price.metadata?.plan_id ?? input.metadata?.planId;
  if (!isHostedPaidPlanId(rawPlanId)) return null;

  const rawCadence =
    baseItem.price.metadata?.billing_cadence ??
    input.metadata?.billingCadence ??
    (baseItem.price.recurring?.interval === "year" ? "annual" : "monthly");
  if (!isBillingCadence(rawCadence)) return null;

  return {
    planId: rawPlanId,
    billingCadence: rawCadence,
    basePrice: baseItem.price,
    usageItem:
      input.items.data.find(
        (item) =>
          item.price.metadata?.component === "usage" ||
          item.price.recurring?.usage_type === "metered",
      ) ?? null,
  };
}

export async function ensureSubscriptionUsagePrice(input: {
  stripe: Stripe;
  subscription: Stripe.Subscription;
}): Promise<Stripe.Subscription> {
  const resolved = getSubscriptionPlan(input.subscription);
  if (!resolved) return input.subscription;

  const plan = billingPlans.find((item) => item.id === resolved.planId);
  if (!plan) return input.subscription;

  const autoRechargeEnabled = isAutoRechargeEnabled(input.subscription);

  const existingUsageItems = input.subscription.items.data.filter(
    (item) =>
      item.price.metadata?.component === "usage" ||
      item.price.recurring?.usage_type === "metered",
  );

  // Webhook deliveries already contain the current price. Avoid a catalog
  // lookup in that path and, more importantly, avoid mutating a subscription
  // that is already attached to the fixed recharge meter.
  if (
    autoRechargeEnabled &&
    existingUsageItems.length === 1 &&
    existingUsageItems[0]?.price.metadata?.plan_id === resolved.planId &&
    existingUsageItems[0]?.price.metadata?.recharge_credits ===
      String(aiCreditRecharge.credits) &&
    input.subscription.metadata?.planId === resolved.planId &&
    input.subscription.metadata?.billingCadence === resolved.billingCadence
  ) {
    return input.subscription;
  }

  const prices = await input.stripe.prices.list({
    active: true,
    limit: 1,
    lookup_keys: [plan.monthlyUsagePriceLookupKey],
  });
  const desiredPrice = prices.data[0];
  if (!desiredPrice) return input.subscription;

  const usageItems = existingUsageItems;
  const matchingUsageItem = usageItems.find(
    (item) => item.price.id === desiredPrice.id,
  );
  const metadataMatches =
    input.subscription.metadata?.planId === resolved.planId &&
    input.subscription.metadata?.billingCadence === resolved.billingCadence;

  if (
    autoRechargeEnabled &&
    matchingUsageItem &&
    usageItems.length === 1 &&
    metadataMatches
  ) {
    return input.subscription;
  }

  if (!autoRechargeEnabled && usageItems.length === 0 && metadataMatches) {
    return input.subscription;
  }

  return input.stripe.subscriptions.update(input.subscription.id, {
    items: [
      ...usageItems
        .filter(
          (item) => !autoRechargeEnabled || item.id !== matchingUsageItem?.id,
        )
        .map((item) => ({ id: item.id, deleted: true as const })),
      ...(autoRechargeEnabled && !matchingUsageItem
        ? [{ price: desiredPrice.id }]
        : []),
    ],
    metadata: {
      ...input.subscription.metadata,
      planId: resolved.planId,
      billingCadence: resolved.billingCadence,
    },
    proration_behavior: "none",
  });
}

export async function setSubscriptionAutoRecharge(input: {
  stripe: Stripe;
  subscription: Stripe.Subscription;
  enabled: boolean;
}): Promise<Stripe.Subscription> {
  return input.stripe.subscriptions
    .update(input.subscription.id, {
      metadata: {
        ...input.subscription.metadata,
        autoRechargeEnabled: String(input.enabled),
      },
      proration_behavior: "none",
    })
    .then((subscription) =>
      ensureSubscriptionUsagePrice({ stripe: input.stripe, subscription }),
    );
}

export function createAiTokenUsageReporter(input: {
  config: RuntimeConfig;
  store: Store;
  stripe: Stripe | null;
}): (input: {
  workspaceId: string;
  sourceId: string;
  usage: AiTokenUsage;
}) => Promise<void> {
  return async ({ workspaceId, sourceId, usage }) => {
    if (!input.config.billingEnabled) return;

    const entitlements = await getWorkspaceEntitlements(
      input.store,
      workspaceId,
    );
    if (entitlements.accessSource === "complimentary") {
      await input.store.createAiUsageEvent({
        workspaceId,
        stripeCustomerId: null,
        sourceId,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      });
      return;
    }
    if (!input.stripe) return;

    const [workspace, subscription] = await Promise.all([
      input.store.getWorkspace(workspaceId),
      input.store.getBillingSubscription(workspaceId),
    ]);
    if (workspace?.billingMode !== "hosted") return;
    if (!subscription || !isEntitledSubscriptionStatus(subscription.status)) {
      return;
    }

    const stripeCustomerId =
      subscription?.stripeCustomerId ?? workspace.stripeCustomerId;
    if (!stripeCustomerId) return;

    const usageEvent = await input.store.createAiUsageEvent({
      workspaceId,
      stripeCustomerId,
      sourceId,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    });

    const pending = await input.store.listUnreportedAiUsageEvents(
      workspaceId,
      100,
    );
    for (const event of pending) {
      if (!event.stripeCustomerId) continue;
      try {
        await input.stripe.billing.meterEvents.create({
          event_name:
            input.config.stripeAiCreditMeterEventName ?? "cooee_ai_credits",
          identifier: event.id,
          payload: {
            stripe_customer_id: event.stripeCustomerId,
            value: formatCreditsForMeter(event.totalTokens),
          },
        });
        await input.store.markAiUsageEventReported(event.id);
      } catch (error) {
        console.error("Unable to report AI token usage to billing.", {
          errorType: getSafeBillingErrorType(error),
        });
        break;
      }
    }

    if (
      !subscription.autoRechargeEnabled &&
      subscription.autoRechargeEnabled !== undefined
    ) {
      return;
    }

    const period = getCreditUsagePeriod(subscription);
    const [totalTokens, reportedPacks] = await Promise.all([
      input.store.sumAiTokensForWorkspaceRange(workspaceId, period),
      input.store.sumAiRechargePacksForWorkspaceRange(workspaceId, period),
    ]);
    const includedCredits = getHostedPlanEntitlements(
      subscription.planId,
    ).monthlyIncludedCredits;
    const requiredPacks = Math.max(
      0,
      Math.ceil(
        Math.max(0, totalTokens / tokensPerCredit - includedCredits) /
          aiCreditRecharge.credits,
      ),
    );
    const rechargePacks = requiredPacks - reportedPacks;
    if (rechargePacks <= 0 || usageEvent.rechargePacksReported > 0) return;

    try {
      await input.stripe.billing.meterEvents.create({
        event_name:
          input.config.stripeAiCreditRechargeMeterEventName ??
          "cooee_ai_credit_recharges",
        identifier: `${usageEvent.id}:recharge`,
        payload: {
          stripe_customer_id: stripeCustomerId,
          value: String(rechargePacks),
        },
      });
      await input.store.markAiUsageEventRechargePacksReported(
        usageEvent.id,
        rechargePacks,
      );
    } catch (error) {
      console.error("Unable to report AI credit recharge to billing.", {
        errorType: getSafeBillingErrorType(error),
      });
    }
  };
}

export function getSafeBillingErrorType(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";

  return /^[A-Za-z][A-Za-z0-9]*$/.test(error.name) ? error.name : "Error";
}

/**
 * Stripe's quantity is expressed in the same customer-facing unit that we
 * display in the app: one credit represents 1,000 AI tokens. Keeping three
 * decimal places preserves single-token accuracy without rounding each run.
 */
export function formatCreditsForMeter(totalTokens: number): string {
  const credits = Math.max(0, Math.trunc(totalTokens)) / tokensPerCredit;
  return credits.toFixed(3).replace(/\.?0+$/, "") || "0";
}

function getCreditUsagePeriod(subscription: {
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}): { startedAt: string; endedAt: string } {
  const now = new Date();
  const currentPeriodStart = subscription.currentPeriodStart
    ? new Date(subscription.currentPeriodStart)
    : null;
  const currentPeriodEnd = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd)
    : null;
  if (
    currentPeriodStart &&
    currentPeriodEnd &&
    currentPeriodStart <= now &&
    currentPeriodEnd > now
  ) {
    return {
      startedAt: currentPeriodStart.toISOString(),
      endedAt: currentPeriodEnd.toISOString(),
    };
  }
  const startedAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  return {
    startedAt: startedAt.toISOString(),
    endedAt: new Date(
      Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth() + 1, 1),
    ).toISOString(),
  };
}

export async function createPortalUrl(input: {
  stripe: Stripe | null;
  config: RuntimeConfig;
  customerId: string;
}): Promise<string | null> {
  if (!input.stripe) {
    return null;
  }

  const session = await input.stripe.billingPortal.sessions.create({
    customer: input.customerId,
    return_url: `${input.config.appUrl}/changelog/billing`,
  });

  return session.url;
}

export async function constructStripeWebhookEvent(input: {
  stripe: Stripe | null;
  config: RuntimeConfig;
  payload: string;
  signature: string | null;
}): Promise<Stripe.Event> {
  if (!input.stripe || !input.config.stripeWebhookSecret) {
    throw new Error("Stripe webhook verification is not configured.");
  }

  if (!input.signature) {
    throw new Error("Missing Stripe signature.");
  }

  return input.stripe.webhooks.constructEventAsync(
    input.payload,
    input.signature,
    input.config.stripeWebhookSecret,
  );
}

export function parseRepositoryLimitFromPrice(
  metadata: Stripe.Metadata | null | undefined,
): number {
  const value = metadata?.repository_limit;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
