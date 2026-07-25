export type RuntimeConfig = {
  appUrl: string;
  databaseUrl?: string;
  billingEnabled: boolean;
  openAiApiKey?: string;
  openAiModel: string;
  githubAppId?: string;
  githubAppPrivateKey?: string;
  githubAppSlug?: string;
  githubWebhookSecret?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripeAiCreditMeterEventName?: string;
  stripeAiCreditRechargeMeterEventName?: string;
  resendApiKey?: string;
  resendFromEmail?: string;
  resendReplyTo?: string;
};

export function isProductionRuntime(
  env: Record<string, string | undefined> = Bun.env,
): boolean {
  return (
    env.NODE_ENV === "production" ||
    env.COOEE_RUNTIME_MODE === "hosted" ||
    Boolean(
      env.RAILWAY_PROJECT_ID ||
      env.RAILWAY_ENVIRONMENT_ID ||
      env.RAILWAY_SERVICE_ID,
    )
  );
}

export function validateProductionConfig(
  env: Record<string, string | undefined> = Bun.env,
): void {
  if (!isProductionRuntime(env)) return;

  const missing = [
    "APP_URL",
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_SLUG",
    "GITHUB_WEBHOOK_SECRET",
    "OPENAI_API_KEY",
  ].filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required production configuration: ${missing.join(", ")}`,
    );
  }

  if ((env.BETTER_AUTH_SECRET?.length ?? 0) < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters.");
  }

  const appUrl = parseProductionOrigin("APP_URL", env.APP_URL);
  const authUrl = parseProductionOrigin("BETTER_AUTH_URL", env.BETTER_AUTH_URL);
  if (appUrl.origin !== authUrl.origin) {
    throw new Error(
      "APP_URL and BETTER_AUTH_URL must use the same production origin.",
    );
  }

  if (
    env.BILLING_ENABLED === "true" &&
    (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET)
  ) {
    throw new Error(
      "Hosted billing requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.",
    );
  }

  if (
    env.BILLING_ENABLED === "true" &&
    (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL)
  ) {
    throw new Error(
      "Hosted billing requires RESEND_API_KEY and RESEND_FROM_EMAIL for account notifications.",
    );
  }

  if (env.COOEE_RUNTIME_MODE === "hosted") {
    const storageGroups = [
      [
        "S3_BUCKET",
        "LOGO_BUCKET",
        "BUCKET",
        "AWS_S3_BUCKET_NAME",
        "BUCKET_NAME",
      ],
      ["S3_ENDPOINT", "ENDPOINT", "AWS_ENDPOINT_URL", "BUCKET_ENDPOINT"],
      [
        "S3_ACCESS_KEY_ID",
        "ACCESS_KEY_ID",
        "AWS_ACCESS_KEY_ID",
        "BUCKET_ACCESS_KEY_ID",
      ],
      [
        "S3_SECRET_ACCESS_KEY",
        "SECRET_ACCESS_KEY",
        "AWS_SECRET_ACCESS_KEY",
        "BUCKET_SECRET_ACCESS_KEY",
      ],
    ];
    if (storageGroups.some((keys) => !keys.some((key) => env[key]?.trim()))) {
      throw new Error(
        "Hosted production requires private object-storage credentials.",
      );
    }
    const supportUrl = env.VITE_SUPPORT_URL?.trim();
    if (!supportUrl || !isSafeSupportUrl(supportUrl)) {
      throw new Error(
        "Hosted production requires an HTTPS or mailto VITE_SUPPORT_URL.",
      );
    }
  }
}

export function loadConfig(
  env: Record<string, string | undefined> = Bun.env,
): RuntimeConfig {
  return {
    appUrl: env.APP_URL ?? `http://localhost:${env.PORT ?? 3000}`,
    databaseUrl: env.DATABASE_URL,
    billingEnabled: env.BILLING_ENABLED === "true",
    openAiApiKey: env.OPENAI_API_KEY,
    openAiModel: env.OPENAI_MODEL ?? "gpt-5.4-mini",
    githubAppId: env.GITHUB_APP_ID,
    githubAppPrivateKey: env.GITHUB_APP_PRIVATE_KEY,
    githubAppSlug: env.GITHUB_APP_SLUG,
    githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET,
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
    stripeAiCreditMeterEventName:
      env.STRIPE_AI_CREDIT_METER_EVENT_NAME ?? "cooee_ai_credits",
    stripeAiCreditRechargeMeterEventName:
      env.STRIPE_AI_CREDIT_RECHARGE_METER_EVENT_NAME ??
      "cooee_ai_credit_recharges",
    resendApiKey: env.RESEND_API_KEY,
    resendFromEmail: env.RESEND_FROM_EMAIL,
    resendReplyTo: env.RESEND_REPLY_TO,
  };
}

function parseProductionOrigin(name: string, value: string | undefined): URL {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL.`);
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be an HTTPS origin without a path.`);
  }
  return url;
}

function isSafeSupportUrl(value: string): boolean {
  try {
    return ["https:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
