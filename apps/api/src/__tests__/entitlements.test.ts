import { describe, expect, test } from "bun:test";
import { getWorkspaceEntitlements } from "../services/entitlements";
import { assertAiCreditRechargeAvailability } from "../services/generation";
import { InMemoryStore } from "../store/memory";

describe("workspace entitlements", () => {
  test("uses a complimentary plan ahead of a saved subscription", async () => {
    const store = InMemoryStore.seeded();
    store.workspaces[0].billingMode = "hosted";
    store.billingSubscriptions.push({
      id: "billing_saved",
      workspaceId: "ws_acme",
      stripeSubscriptionId: "sub_saved",
      stripeCustomerId: "cus_saved",
      status: "active",
      planId: "lobster",
      billingCadence: "monthly",
      priceId: "price_saved",
      repositoryLimit: 1,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      billingEmail: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      endedAt: null,
      lastPaymentFailedAt: null,
    });
    store.complimentaryAccessGrants.push({
      id: "grant_friend",
      workspaceId: "ws_acme",
      planId: "watermelon",
      reason: "Launch partner",
      grantedBy: "operator@example.com",
      expiresAt: "2099-01-01T00:00:00.000Z",
      createdAt: "2026-07-22T00:00:00.000Z",
    });

    expect(await getWorkspaceEntitlements(store, "ws_acme")).toMatchObject({
      id: "watermelon",
      accessSource: "complimentary",
      repositoryLimit: 15,
      monthlyIncludedCredits: 300,
      subscriptionStatus: null,
      complimentaryExpiresAt: "2099-01-01T00:00:00.000Z",
    });
  });

  test("ignores an expired complimentary grant", async () => {
    const store = InMemoryStore.seeded();
    store.workspaces[0].billingMode = "hosted";
    store.complimentaryAccessGrants.push({
      id: "grant_expired",
      workspaceId: "ws_acme",
      planId: "watermelon",
      reason: "Expired trial",
      grantedBy: "operator@example.com",
      expiresAt: "2020-01-01T00:00:00.000Z",
      createdAt: "2019-01-01T00:00:00.000Z",
    });

    expect(await getWorkspaceEntitlements(store, "ws_acme")).toMatchObject({
      id: "free",
      accessSource: "free",
      repositoryLimit: 1,
    });
  });

  test("pauses complimentary AI runs after the plan allowance is used", async () => {
    const store = InMemoryStore.seeded();
    store.workspaces[0].billingMode = "hosted";
    store.complimentaryAccessGrants.push({
      id: "grant_friend",
      workspaceId: "ws_acme",
      planId: "watermelon",
      reason: "Launch partner",
      grantedBy: "operator@example.com",
      expiresAt: null,
      createdAt: new Date().toISOString(),
    });
    const now = new Date();
    store.aiUsageEvents.push({
      id: "usage_comp",
      workspaceId: "ws_acme",
      stripeCustomerId: null,
      sourceId: "generation:cl_acme:month",
      inputTokens: 300_000,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 300_000,
      rechargePacksReported: 0,
      createdAt: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2),
      ).toISOString(),
      reportedAt: null,
    });

    try {
      await assertAiCreditRechargeAvailability({
        store,
        workspaceId: "ws_acme",
      });
      throw new Error("Expected the complimentary allowance to be enforced.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(402);
      expect(await (error as Response).json()).toEqual({
        error:
          "The complimentary AI credit allowance is used. It resets next month.",
      });
    }
  });
});
