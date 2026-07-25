import {
  getHostedPlanEntitlements,
  isEntitledSubscriptionStatus,
  type HostedPlanEntitlements,
  type HostedPlanId,
} from "@cooee/shared";
import type { Store } from "../store/types";

export type WorkspaceEntitlements = HostedPlanEntitlements & {
  hosted: boolean;
  subscriptionStatus: string | null;
  accessSource: "complimentary" | "subscription" | "free" | "self-hosted";
  complimentaryExpiresAt: string | null;
};

const selfHostedEntitlements: WorkspaceEntitlements = {
  id: "watermelon",
  hosted: false,
  subscriptionStatus: null,
  accessSource: "self-hosted",
  complimentaryExpiresAt: null,
  repositoryLimit: Number.MAX_SAFE_INTEGER,
  monthlyIncludedCredits: Number.MAX_SAFE_INTEGER,
  estimatedMonthlyPullRequests: Number.MAX_SAFE_INTEGER,
  aiGeneration: true,
  scheduledPublishing: true,
  customDomain: true,
  customBranding: true,
};

export async function getWorkspaceEntitlements(
  store: Store,
  workspaceId: string,
): Promise<WorkspaceEntitlements> {
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace || workspace.billingMode === "self-hosted") {
    return selfHostedEntitlements;
  }

  const [complimentaryGrant, subscription] = await Promise.all([
    store.getActiveComplimentaryAccessGrant(workspaceId),
    store.getBillingSubscription(workspaceId),
  ]);
  if (complimentaryGrant) {
    return {
      ...getHostedPlanEntitlements(complimentaryGrant.planId),
      hosted: true,
      subscriptionStatus: null,
      accessSource: "complimentary",
      complimentaryExpiresAt: complimentaryGrant.expiresAt,
    };
  }

  const planId: HostedPlanId =
    subscription && isEntitledSubscriptionStatus(subscription.status)
      ? subscription.planId
      : "free";

  return {
    ...getHostedPlanEntitlements(planId),
    hosted: true,
    subscriptionStatus: subscription?.status ?? null,
    accessSource:
      subscription && isEntitledSubscriptionStatus(subscription.status)
        ? "subscription"
        : "free",
    complimentaryExpiresAt: null,
  };
}

export async function assertWorkspaceEntitlement(input: {
  store: Store;
  workspaceId: string;
  capability:
    | "aiGeneration"
    | "scheduledPublishing"
    | "customDomain"
    | "customBranding";
  message: string;
}): Promise<WorkspaceEntitlements> {
  const entitlements = await getWorkspaceEntitlements(
    input.store,
    input.workspaceId,
  );
  if (!entitlements[input.capability]) {
    throw Response.json({ error: input.message }, { status: 402 });
  }
  return entitlements;
}
