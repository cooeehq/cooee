import { describe, expect, test } from "bun:test";
import {
  canConnectRepository,
  formatBillingAmount,
  getBillingCurrencyForCountry,
  getCountryCodeFromLocale,
  getHostedPlanEntitlements,
  getSubscriptionAccessState,
  isEntitledSubscriptionStatus,
} from "../billing";

describe("hosted billing entitlements", () => {
  test("allows self-hosted deployments without billing and limits hosted plans by repo count", () => {
    expect(
      canConnectRepository({
        billingMode: "self-hosted",
        connectedRepositories: 100,
        repositoryLimit: 0,
      }),
    ).toBe(true);
    expect(
      canConnectRepository({
        billingMode: "hosted",
        connectedRepositories: 2,
        repositoryLimit: 3,
      }),
    ).toBe(true);
    expect(
      canConnectRepository({
        billingMode: "hosted",
        connectedRepositories: 3,
        repositoryLimit: 3,
      }),
    ).toBe(false);
  });

  test("distinguishes Free and Lobster despite the shared repository limit", () => {
    expect(getHostedPlanEntitlements("free")).toMatchObject({
      repositoryLimit: 1,
      aiGeneration: false,
      customDomain: false,
      customBranding: false,
    });
    expect(getHostedPlanEntitlements("lobster")).toMatchObject({
      repositoryLimit: 1,
      aiGeneration: true,
      customDomain: true,
      customBranding: true,
    });
  });

  test("keeps paid access during past-due retries and restricts terminal states", () => {
    expect(isEntitledSubscriptionStatus("active")).toBe(true);
    expect(isEntitledSubscriptionStatus("trialing")).toBe(true);
    expect(isEntitledSubscriptionStatus("past_due")).toBe(true);
    expect(isEntitledSubscriptionStatus("canceled")).toBe(false);
    expect(isEntitledSubscriptionStatus("unpaid")).toBe(false);
    expect(getSubscriptionAccessState("past_due")).toBe("grace");
    expect(getSubscriptionAccessState("paused")).toBe("restricted");
  });

  test("uses AUD only for Australia and New Zealand, GBP only for the UK", () => {
    expect(getBillingCurrencyForCountry("AU")).toBe("aud");
    expect(getBillingCurrencyForCountry("NZ")).toBe("aud");
    expect(getBillingCurrencyForCountry("GB")).toBe("gbp");
    expect(getBillingCurrencyForCountry("UK")).toBe("gbp");
    expect(getBillingCurrencyForCountry("BG")).toBe("usd");
    expect(getBillingCurrencyForCountry("DE")).toBe("usd");
    expect(getBillingCurrencyForCountry("CA")).toBe("usd");
    expect(getCountryCodeFromLocale("en-NZ")).toBe("NZ");
    expect(formatBillingAmount(1000, "aud")).toBe("A$1,000");
    expect(formatBillingAmount(20, "gbp")).toBe("£20");
  });
});
