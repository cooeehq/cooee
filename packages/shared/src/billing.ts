export type BillingMode = "hosted" | "self-hosted";
export type HostedPlanId = "free" | "lobster" | "pineapple" | "watermelon";
export type HostedPaidPlanId = Exclude<HostedPlanId, "free">;
export type BillingCadence = "monthly" | "annual";
export type BillingCurrency = "usd" | "aud" | "gbp";
export type SubscriptionAccessState =
  | "active"
  | "grace"
  | "restricted"
  | "canceled";

export const aiCreditRecharge = {
  credits: 100,
  amount: 10,
} as const;

export function getBillingCurrencyForCountry(
  countryCode: string | null | undefined,
): BillingCurrency {
  const country = countryCode?.trim().toUpperCase();
  if (country === "AU" || country === "NZ") return "aud";
  if (country === "GB" || country === "UK") return "gbp";
  return "usd";
}

export function getCountryCodeFromLocale(
  locale: string | null | undefined,
): string | null {
  if (!locale) return null;
  try {
    return new Intl.Locale(locale).region?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}

export function formatBillingAmount(
  amount: number,
  currency: BillingCurrency,
): string {
  const symbol: Record<BillingCurrency, string> = {
    usd: "$",
    aud: "A$",
    gbp: "£",
  };
  return `${symbol[currency]}${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(amount)}`;
}

export type HostedPlanEntitlements = {
  id: HostedPlanId;
  repositoryLimit: number;
  monthlyIncludedCredits: number;
  estimatedMonthlyPullRequests: number;
  aiGeneration: boolean;
  scheduledPublishing: boolean;
  customDomain: boolean;
  customBranding: boolean;
};

export const hostedPlanEntitlements: Record<
  HostedPlanId,
  HostedPlanEntitlements
> = {
  free: {
    id: "free",
    repositoryLimit: 1,
    monthlyIncludedCredits: 0,
    estimatedMonthlyPullRequests: 0,
    aiGeneration: false,
    scheduledPublishing: false,
    customDomain: false,
    customBranding: false,
  },
  lobster: {
    id: "lobster",
    repositoryLimit: 1,
    monthlyIncludedCredits: 100,
    estimatedMonthlyPullRequests: 25,
    aiGeneration: true,
    scheduledPublishing: true,
    customDomain: true,
    customBranding: true,
  },
  pineapple: {
    id: "pineapple",
    repositoryLimit: 3,
    monthlyIncludedCredits: 400,
    estimatedMonthlyPullRequests: 100,
    aiGeneration: true,
    scheduledPublishing: true,
    customDomain: true,
    customBranding: true,
  },
  watermelon: {
    id: "watermelon",
    repositoryLimit: 15,
    monthlyIncludedCredits: 1_000,
    estimatedMonthlyPullRequests: 250,
    aiGeneration: true,
    scheduledPublishing: true,
    customDomain: true,
    customBranding: true,
  },
};

export type RepositoryEntitlementInput = {
  billingMode: BillingMode;
  connectedRepositories: number;
  repositoryLimit: number;
};

export function canConnectRepository(
  input: RepositoryEntitlementInput,
): boolean {
  if (input.billingMode === "self-hosted") {
    return true;
  }

  return input.connectedRepositories < input.repositoryLimit;
}

export function isHostedPaidPlanId(value: unknown): value is HostedPaidPlanId {
  return value === "lobster" || value === "pineapple" || value === "watermelon";
}

export function isBillingCadence(value: unknown): value is BillingCadence {
  return value === "monthly" || value === "annual";
}

export function isEntitledSubscriptionStatus(status: string): boolean {
  return (
    getSubscriptionAccessState(status) === "active" ||
    getSubscriptionAccessState(status) === "grace"
  );
}

export function getSubscriptionAccessState(
  status: string | null | undefined,
): SubscriptionAccessState {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due") return "grace";
  if (status === "canceled" || status === "incomplete_expired") {
    return "canceled";
  }
  return "restricted";
}

export function getHostedPlanEntitlements(
  planId: HostedPlanId,
): HostedPlanEntitlements {
  return hostedPlanEntitlements[planId];
}
