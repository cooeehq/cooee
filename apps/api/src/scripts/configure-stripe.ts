import Stripe from "stripe";
import {
  aiCreditRecharge,
  getHostedPlanEntitlements,
  isHostedPaidPlanId,
  type HostedPaidPlanId,
} from "@cooee/shared";

const secretKey = Bun.env.STRIPE_SECRET_KEY?.trim();
if (!secretKey) throw new Error("STRIPE_SECRET_KEY is required.");
if (
  secretKey.startsWith("sk_live_") &&
  Bun.env.STRIPE_ALLOW_LIVE_CATALOG_CHANGES !== "true"
) {
  throw new Error(
    "Refusing live Stripe changes. Set STRIPE_ALLOW_LIVE_CATALOG_CHANGES=true after reviewing the catalog.",
  );
}

const stripe = new Stripe(secretKey, { apiVersion: "2026-02-25.clover" });
const currency = "usd";
const localizedCurrencies = ["aud", "gbp"] as const;
const meterEventName =
  Bun.env.STRIPE_AI_CREDIT_METER_EVENT_NAME?.trim() || "cooee_ai_credits";
const rechargeMeterEventName =
  Bun.env.STRIPE_AI_CREDIT_RECHARGE_METER_EVENT_NAME?.trim() ||
  "cooee_ai_credit_recharges";
const planPrices: Record<
  HostedPaidPlanId,
  { monthly: number; annual: number }
> = {
  lobster: { monthly: 2_000, annual: 20_000 },
  pineapple: { monthly: 5_000, annual: 50_000 },
  watermelon: { monthly: 10_000, annual: 100_000 },
};

const planNames: Record<HostedPaidPlanId, string> = {
  lobster: "Lobster",
  pineapple: "Pineapple",
  watermelon: "Watermelon",
};
const webhookEvents: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.updated",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.finalization_failed",
];

const products = await stripe.products.list({ active: true, limit: 100 });
let rechargeProduct = await ensureProduct("recharge", "AI credit recharge", {
  app: "cooee",
  component: "recharge",
  catalog_key: "recharge",
});
const rechargeProductDescription = `Adds ${aiCreditRecharge.credits} AI credits for each recharge.`;
if (
  rechargeProduct.unit_label !== "recharge" ||
  rechargeProduct.description !== rechargeProductDescription
) {
  rechargeProduct = await stripe.products.update(rechargeProduct.id, {
    unit_label: "recharge",
    description: rechargeProductDescription,
  });
  console.log("updated the AI credit recharge details");
}

const meters = await stripe.billing.meters.list({ limit: 100 });
let meter = meters.data.find(
  (item) => item.status === "active" && item.event_name === meterEventName,
);
if (!meter) {
  meter = await stripe.billing.meters.create({
    display_name: "AI credits",
    event_name: meterEventName,
    default_aggregation: { formula: "sum" },
    customer_mapping: {
      type: "by_id",
      event_payload_key: "stripe_customer_id",
    },
    value_settings: { event_payload_key: "value" },
  });
  console.log(`created meter ${meterEventName}`);
} else {
  console.log(`kept meter ${meterEventName}`);
}

let rechargeMeter = meters.data.find(
  (item) =>
    item.status === "active" && item.event_name === rechargeMeterEventName,
);
if (!rechargeMeter) {
  rechargeMeter = await stripe.billing.meters.create({
    display_name: "AI credit recharges",
    event_name: rechargeMeterEventName,
    default_aggregation: { formula: "sum" },
    customer_mapping: {
      type: "by_id",
      event_payload_key: "stripe_customer_id",
    },
    value_settings: { event_payload_key: "value" },
  });
  console.log(`created meter ${rechargeMeterEventName}`);
} else {
  console.log(`kept meter ${rechargeMeterEventName}`);
}

const portalProducts: Array<{ product: string; prices: string[] }> = [];
const usagePriceIds = new Map<HostedPaidPlanId, string>();
for (const planId of ["lobster", "pineapple", "watermelon"] as const) {
  const entitlements = getHostedPlanEntitlements(planId);
  const baseProduct = await ensureProduct(
    `base:${planId}`,
    `Cooee ${planNames[planId]}`,
    {
      app: "cooee",
      component: "base",
      catalog_key: `base:${planId}`,
      plan_id: planId,
    },
  );
  const planBasePriceIds: string[] = [];
  for (const cadence of ["monthly", "annual"] as const) {
    const interval = cadence === "monthly" ? "month" : "year";
    const lookupKey = `cooee_${planId}_${cadence}`;
    const price = await ensurePrice(lookupKey, {
      currency,
      currency_options: createFixedCurrencyOptions(planPrices[planId][cadence]),
      product: baseProduct.id,
      unit_amount: planPrices[planId][cadence],
      recurring: { interval, usage_type: "licensed" },
      tax_behavior: "exclusive",
      nickname: `${planNames[planId]} ${cadence}`,
      metadata: {
        app: "cooee",
        component: "base",
        plan_id: planId,
        billing_cadence: cadence,
        repository_limit: String(entitlements.repositoryLimit),
        monthly_included_credits: String(entitlements.monthlyIncludedCredits),
      },
    });
    planBasePriceIds.push(price.id);
  }

  const usageLookupKey = `cooee_${planId}_ai_credits_monthly`;
  const usagePrice = await ensurePrice(usageLookupKey, {
    currency,
    currency_options: createFixedCurrencyOptions(aiCreditRecharge.amount * 100),
    product: rechargeProduct.id,
    unit_amount: aiCreditRecharge.amount * 100,
    recurring: {
      interval: "month",
      usage_type: "metered",
      meter: rechargeMeter.id,
    },
    tax_behavior: "exclusive",
    nickname: `${planNames[planId]} AI credit recharge`,
    metadata: {
      app: "cooee",
      component: "usage",
      plan_id: planId,
      monthly_included_credits: String(entitlements.monthlyIncludedCredits),
      recharge_credits: String(aiCreditRecharge.credits),
      recharge_amount: String(aiCreditRecharge.amount),
      supported_currencies: "usd,aud,gbp",
    },
  });
  usagePriceIds.set(planId, usagePrice.id);
  portalProducts.push({ product: baseProduct.id, prices: planBasePriceIds });
}

await migrateActiveSubscriptionsToCreditMeter(usagePriceIds);

const portalConfigurations = await stripe.billingPortal.configurations.list({
  limit: 100,
});
const defaultPortal = portalConfigurations.data.find((item) => item.is_default);
if (defaultPortal) {
  await stripe.billingPortal.configurations.update(defaultPortal.id, {
    features: {
      customer_update: {
        enabled: true,
        allowed_updates: ["email", "name", "address", "tax_id"],
      },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: {
          enabled: true,
          options: [
            "too_expensive",
            "missing_features",
            "unused",
            "switched_service",
            "other",
          ],
        },
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products: portalProducts.map((product) => ({
          ...product,
          adjustable_quantity: { enabled: false },
        })),
      },
    },
    business_profile: {
      headline: "Manage your Cooee plan and billing details.",
    },
  });
  console.log("updated the default customer portal configuration");
} else {
  console.log(
    "no default customer portal configuration was available to update",
  );
}

await reconcileWebhookEndpoint();

console.log("Stripe catalog is aligned with the Cooee pricing model.");

async function reconcileWebhookEndpoint(): Promise<void> {
  const configuredUrl = Bun.env.STRIPE_WEBHOOK_ENDPOINT_URL?.trim();
  if (!configuredUrl) {
    console.log(
      "kept webhook endpoints unchanged; set STRIPE_WEBHOOK_ENDPOINT_URL to reconcile one",
    );
    return;
  }
  const url = new URL(configuredUrl);
  if (url.protocol !== "https:") {
    throw new Error("STRIPE_WEBHOOK_ENDPOINT_URL must use HTTPS.");
  }
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const existing = endpoints.data.find((endpoint) => endpoint.url === url.href);
  if (existing) {
    await stripe.webhookEndpoints.update(existing.id, {
      enabled_events: webhookEvents,
      description: "Cooee subscription lifecycle",
      metadata: { app: "cooee", purpose: "billing_lifecycle" },
      disabled: false,
    });
    console.log("updated the Cooee billing webhook endpoint");
    return;
  }
  await stripe.webhookEndpoints.create({
    url: url.href,
    enabled_events: webhookEvents,
    description: "Cooee subscription lifecycle",
    metadata: { app: "cooee", purpose: "billing_lifecycle" },
  });
  console.log(
    "created the Cooee billing webhook endpoint; copy its signing secret from Workbench into STRIPE_WEBHOOK_SECRET",
  );
}

async function ensureProduct(
  catalogKey: string,
  name: string,
  metadata: Stripe.MetadataParam,
): Promise<Stripe.Product> {
  const existing = products.data.find(
    (product) =>
      product.metadata?.app === "cooee" &&
      product.metadata?.catalog_key === catalogKey,
  );
  if (existing) {
    if (existing.name !== name) {
      return stripe.products.update(existing.id, { name, metadata });
    }
    return existing;
  }
  const created = await stripe.products.create({ name, metadata });
  products.data.push(created);
  console.log(`created ${catalogKey} product`);
  return created;
}

async function ensurePrice(
  lookupKey: string,
  params: Omit<Stripe.PriceCreateParams, "lookup_key">,
): Promise<Stripe.Price> {
  const existing = await stripe.prices.list({
    active: true,
    limit: 1,
    lookup_keys: [lookupKey],
  });
  const listed = existing.data[0];
  const current =
    listed?.billing_scheme === "tiered"
      ? await stripe.prices.retrieve(listed.id, { expand: ["tiers"] })
      : listed;
  if (current && priceMatches(current, params)) {
    await stripe.prices.update(current.id, {
      metadata: params.metadata,
      currency_options: params.currency_options,
    });
    console.log(`kept price ${lookupKey}`);
    return current;
  }

  const created = await stripe.prices.create({
    ...params,
    lookup_key: lookupKey,
    transfer_lookup_key: Boolean(current),
  });
  if (current) await stripe.prices.update(current.id, { active: false });
  console.log(`${current ? "replaced" : "created"} price ${lookupKey}`);
  return created;
}

function createFixedCurrencyOptions(
  unitAmount: number,
): Stripe.PriceCreateParams["currency_options"] {
  return Object.fromEntries(
    localizedCurrencies.map((localizedCurrency) => [
      localizedCurrency,
      { unit_amount: unitAmount, tax_behavior: "exclusive" as const },
    ]),
  );
}

function priceMatches(
  price: Stripe.Price,
  params: Omit<Stripe.PriceCreateParams, "lookup_key">,
): boolean {
  const expectedProduct = params.product;
  const actualProduct =
    typeof price.product === "string" ? price.product : price.product.id;
  return (
    price.currency === params.currency &&
    actualProduct === expectedProduct &&
    price.unit_amount === (params.unit_amount ?? null) &&
    price.billing_scheme === (params.billing_scheme ?? "per_unit") &&
    price.recurring?.interval === params.recurring?.interval &&
    price.recurring?.usage_type ===
      (params.recurring?.usage_type ?? "licensed") &&
    (price.recurring?.meter ?? null) === (params.recurring?.meter ?? null) &&
    price.tiers_mode === (params.tiers_mode ?? null) &&
    tiersMatch(price.tiers, params.tiers)
  );
}

function tiersMatch(
  actual: Stripe.Price.Tier[] | undefined,
  expected: Stripe.PriceCreateParams.Tier[] | undefined,
): boolean {
  if (!expected) return !actual?.length;
  if (!actual || actual.length !== expected.length) return false;
  return expected.every((tier, index) => {
    const current = actual[index];
    const expectedUpperBound = tier.up_to === "inf" ? null : tier.up_to;
    return (
      current?.up_to === expectedUpperBound &&
      current.unit_amount_decimal === (tier.unit_amount_decimal ?? null) &&
      current.flat_amount_decimal === (tier.flat_amount_decimal ?? null)
    );
  });
}

async function migrateActiveSubscriptionsToCreditMeter(
  desiredUsagePriceIds: Map<HostedPaidPlanId, string>,
): Promise<void> {
  let startingAfter: string | undefined;
  let migrated = 0;

  do {
    const subscriptions = await stripe.subscriptions.list({
      status: "all",
      limit: 100,
      starting_after: startingAfter,
      expand: ["data.items.data.price"],
    });

    for (const subscription of subscriptions.data) {
      if (!isBillableSubscriptionStatus(subscription.status)) continue;
      const baseItem = subscription.items.data.find(
        (item) => item.price.metadata?.component === "base",
      );
      const planId = baseItem?.price.metadata?.plan_id;
      if (!isHostedPaidPlanId(planId)) continue;

      const desiredPriceId = desiredUsagePriceIds.get(planId);
      const usageItems = subscription.items.data.filter(
        (item) => item.price.metadata?.component === "usage",
      );
      if (!desiredPriceId || usageItems.length !== 1) continue;

      const usageItem = usageItems[0];
      if (usageItem.price.id === desiredPriceId) continue;

      await stripe.subscriptionItems.update(usageItem.id, {
        price: desiredPriceId,
        proration_behavior: "none",
      });
      migrated += 1;
    }

    startingAfter = subscriptions.has_more
      ? subscriptions.data.at(-1)?.id
      : undefined;
  } while (startingAfter);

  console.log(
    migrated === 0
      ? "all active subscriptions already use the AI credit meter"
      : `migrated ${migrated} active subscription${migrated === 1 ? "" : "s"} to the AI credit meter`,
  );
}

function isBillableSubscriptionStatus(
  status: Stripe.Subscription.Status,
): boolean {
  return ["active", "trialing", "past_due", "unpaid"].includes(status);
}
