import { isIP } from "node:net";
import {
  compareChangelogCategories,
  canConnectRepository,
  defaultChangelogCategoryDefinitions,
  formatBillingAmount,
  getBillingCurrencyForCountry,
  getHistoricalDateRangeWindow,
  getHostedPlanEntitlements,
  getSubscriptionAccessState,
  isBillingCadence,
  isEntitledSubscriptionStatus,
  isHostedPaidPlanId,
  getChangelogCategoryDefinition,
  normalizeChangelogCategoryDefinitions,
  normalizeChangelogCategoryId,
  parsePublicFeedQuery,
  publicApiOpenApiDocument,
  publicFeedSchema,
  serializePublicFeed,
  validateGeneratedEntry,
} from "@cooee/shared";
import type {
  ChangelogCategory,
  PublicFeedPagination,
  PullRequestMetadata,
  BillingCurrency,
} from "@cooee/shared";
import { createAuth, isGitHubOAuthConfigured, type AuthRuntime } from "./auth";
import { isProductionRuntime, loadConfig } from "./config";
import { createAssetStorage, type AssetStorage } from "./services/assets";
import {
  createCloudflareCustomHostnameProvisioner,
  type CustomHostnameProvisioner,
} from "./services/cloudflare";
import {
  generateChangelogForWindow,
  resolveAiWritingOptions,
} from "./services/generation";
import { generateHistoricalChangelog } from "./services/historical";
import {
  createGitHubAppClient,
  getGitHubAppInstallUrl,
  isGitHubAppConfigured,
  type GitHubAppClient,
  verifyGitHubSignature,
} from "./services/github";
import {
  createDefaultImageGenerator,
  createDefaultSummarizer,
  unwrapAiSummaryResult,
  type AiImageGenerator,
  type AiSummarizer,
  type AiTokenUsage,
} from "./services/openai";
import {
  billingPlans,
  type BillingCadence,
  constructStripeWebhookEvent,
  createCheckoutUrl,
  createPortalUrl,
  createStripeClient,
  createAiTokenUsageReporter,
  ensureSubscriptionUsagePrice,
  setSubscriptionAutoRecharge,
  getSubscriptionPlan,
  type BillingPlanId,
} from "./services/stripe";
import {
  assertWorkspaceEntitlement,
  getWorkspaceEntitlements,
} from "./services/entitlements";
import {
  createResendBillingEmailSender,
  sendBillingNotification,
  type BillingEmail,
  type BillingEmailSender,
} from "./services/billing-notifications";
import { createStore } from "./store";
import type {
  BillingNotificationType,
  BillingSubscription,
  ChangelogSettings,
  GitHubInstallation,
  GitHubRepository,
  Store,
  StoredChangelog,
  StoredEntry,
  WorkspaceSettings,
} from "./store/types";
import type Stripe from "stripe";

export type App = {
  fetch(request: Request): Promise<Response>;
};

export type AppOptions = {
  auth?: AuthRuntime | null;
  store?: Store;
  githubClient?: GitHubAppClient;
  summarizer?: AiSummarizer;
  imageGenerator?: AiImageGenerator;
  assetStorage?: AssetStorage | null;
  customHostnameProvisioner?: CustomHostnameProvisioner | null;
  staticRoot?: string;
  env?: Record<string, string | undefined>;
  billingEmailSender?: BillingEmailSender | null;
  stripeClient?: ReturnType<typeof createStripeClient>;
};

const defaultWorkspaceId = "ws_acme";
const maxLogoSizeBytes = 512 * 1024;
const maxFaviconSizeBytes = 256 * 1024;
const maxPostImageSizeBytes = 3 * 1024 * 1024;
const postImageGenerationNotConfiguredMessage =
  "Post image generation is not configured.";
const postImageGenerationUnavailableMessage =
  "Post image generation is temporarily unavailable.";
const publicFeedCacheHeaders = {
  "cache-control": "public, max-age=60, stale-while-revalidate=300",
};
const publicChangelogThemeCookieName = "cooee_public_changelog_theme";
const logoContentTypes = new Map([
  ["image/gif", "gif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/svg+xml", "svg"],
  ["image/webp", "webp"],
]);
const faviconContentTypes = new Map([
  ["image/png", "png"],
  ["image/svg+xml", "svg"],
  ["image/x-icon", "ico"],
  ["image/vnd.microsoft.icon", "ico"],
]);
const postImageContentTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const defaultWorkspaceSettings: WorkspaceSettings = {
  appName: "",
  publicChangelog: true,
  includePullRequestLinks: false,
  publicTheme: "light",
  publicLogoAlignment: "left",
  logoAssetKey: null,
  logoDataUrl: null,
  logoUrl: null,
  lightLogoAssetKey: null,
  lightLogoDataUrl: null,
  lightLogoUrl: null,
  faviconAssetKey: null,
  faviconDataUrl: null,
  faviconUrl: null,
  publicAppUrl: "",
  publicAppLabel: "Open app",
  aiMinimumConfidence: "0.80",
  aiAudience: "product-users",
  aiPersonality: "product-user",
  aiFailClosed: true,
  createImagesPerUpdate: false,
  scheduleFrequency: "daily",
  scheduleWeekday: 1,
  scheduleMonthDay: 1,
  historicalBackfillDays: 14,
  onboardingCompleted: false,
  publishTime: "09:00",
  timeZone: "Australia/Brisbane",
  publicSlug: "changelog",
  customDomain: "",
  privacyLabels: "cooee:skip, cooee:internal, security",
};

export function createApp(options: AppOptions = {}): App {
  const env = options.env ?? Bun.env;
  const config = loadConfig(env);
  const productionRuntime = isProductionRuntime(env);
  const store = options.store ?? createStore(env);
  const githubClient = options.githubClient ?? createGitHubAppClient(config);
  const summarizer = options.summarizer ?? createDefaultSummarizer(env);
  const imageGenerator =
    options.imageGenerator ?? createDefaultImageGenerator(env);
  const assetStorage =
    options.assetStorage === undefined
      ? createAssetStorage(env)
      : options.assetStorage;
  const customHostnameProvisioner =
    options.customHostnameProvisioner === undefined
      ? createCloudflareCustomHostnameProvisioner(env)
      : options.customHostnameProvisioner;
  const customHostnameCnameTarget =
    env.CLOUDFLARE_CUSTOM_HOSTNAME_CNAME_TARGET ?? "cloud.cooee.sh";
  const stripe =
    options.stripeClient === undefined
      ? createStripeClient(config)
      : options.stripeClient;
  const billingEmailSender =
    options.billingEmailSender === undefined
      ? createResendBillingEmailSender(config)
      : options.billingEmailSender;
  const recordAiUsage = createAiTokenUsageReporter({ config, store, stripe });
  const auth =
    options.auth ?? (isGitHubOAuthConfigured(env) ? createAuth(env) : null);
  const staticRoot = options.staticRoot ?? `${import.meta.dir}/../../web/dist`;
  const allowInjectedStoreTestAccess = Boolean(
    options.store && !productionRuntime,
  );
  const rateLimitBuckets = new Map<
    string,
    { count: number; resetAt: number }
  >();
  const trustedClientIpHeader =
    env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase() ??
    (env.RAILWAY_PROJECT_ID ? "x-real-ip" : undefined);

  return {
    async fetch(request: Request): Promise<Response> {
      const requestId = crypto.randomUUID();
      const startedAt = performance.now();
      const requestPath = new URL(request.url).pathname;
      let responseStatus = 500;
      try {
        const response = await (async () => {
          const url = new URL(request.url);
          const canonicalRedirect = getCanonicalCooeeRedirect(url, request);
          if (canonicalRedirect) {
            return secureResponse(
              new Response(null, {
                status: 301,
                headers: { location: canonicalRedirect },
              }),
            );
          }
          const contentLength = Number(
            request.headers.get("content-length") ?? 0,
          );
          if (
            Number.isFinite(contentLength) &&
            contentLength > 4 * 1024 * 1024
          ) {
            return json(
              { error: "Request body is too large." },
              { status: 413 },
            );
          }
          if (
            productionRuntime &&
            (url.pathname.startsWith("/api/admin/") ||
              url.pathname.startsWith("/api/webhooks/")) &&
            isRateLimited(
              rateLimitBuckets,
              request,
              url.pathname,
              trustedClientIpHeader,
            )
          ) {
            return json(
              { error: "Too many requests. Try again shortly." },
              { status: 429, headers: { "retry-after": "60" } },
            );
          }

          if (request.method === "GET" && url.pathname === "/api/health") {
            return json({ ok: true, service: "cooee-api" });
          }

          if (request.method === "GET" && url.pathname === "/api/ready") {
            const ready = await store.healthCheck();
            return json(
              { ok: ready, service: "cooee-api" },
              { status: ready ? 200 : 503 },
            );
          }

          if (
            request.method === "GET" &&
            url.pathname === "/api/public/billing/currency"
          ) {
            const countryCode = getRequestCountryCode(
              request,
              url.searchParams.get("countryCode"),
            );
            return json(
              {
                countryCode,
                currency: getBillingCurrencyForCountry(countryCode),
              },
              {
                headers: {
                  "cache-control": "private, no-store",
                  vary: "CF-IPCountry, X-Vercel-IP-Country, CloudFront-Viewer-Country",
                },
              },
            );
          }

          if (
            (request.method === "GET" || request.method === "HEAD") &&
            url.pathname === "/api/public/openapi.json"
          ) {
            return publicCorsResponse(
              respondToHead(
                request,
                json(publicApiOpenApiDocument, {
                  headers: {
                    "cache-control":
                      "public, max-age=3600, stale-while-revalidate=86400",
                  },
                }),
              ),
            );
          }

          if (url.pathname.startsWith("/api/auth/")) {
            if (!auth) {
              return json(
                {
                  error:
                    "GitHub OAuth requires DATABASE_URL, GITHUB_CLIENT_ID, and GITHUB_CLIENT_SECRET.",
                },
                { status: 409 },
              );
            }

            return secureResponse(await auth.handler(request));
          }

          const requiresAdminSession =
            url.pathname.startsWith("/api/admin/") ||
            url.pathname === "/api/github/callback" ||
            url.pathname === "/api/onboarding/github";
          let authenticatedEmail: string | null = null;
          let authenticatedUserId: string | null = null;
          let authenticatedWorkspaceRole: "owner" | "member" | null = null;
          if (requiresAdminSession && !allowInjectedStoreTestAccess) {
            if (!auth) {
              return json(
                { error: "Authentication is not configured." },
                { status: 503 },
              );
            }

            const session = await auth.getSession(request.headers);
            if (!session) {
              return json(
                { error: "Authentication required." },
                { status: 401 },
              );
            }
            authenticatedEmail = session.user.email;
            authenticatedUserId = session.user.id;

            let memberships = await store.listWorkspaceMemberships(
              session.user.id,
            );
            let preferredWorkspaceId = await findConnectedWorkspaceId(
              store,
              memberships,
            );
            if (
              !preferredWorkspaceId &&
              auth.listAccessibleGitHubInstallationIds
            ) {
              const installationIds =
                await auth.listAccessibleGitHubInstallationIds(request.headers);
              if (
                installationIds === null &&
                memberships.length === 0 &&
                env.NODE_ENV === "production"
              ) {
                return json(
                  {
                    error:
                      "GitHub access could not be verified. Please try again.",
                  },
                  { status: 503 },
                );
              }
              if (installationIds) {
                memberships = await store.ensureGitHubInstallationMemberships({
                  userId: session.user.id,
                  installationIds,
                });
                preferredWorkspaceId = await findConnectedWorkspaceId(
                  store,
                  memberships,
                );
              }
            }
            if (memberships.length === 0) {
              memberships = [
                await store.ensureUserWorkspace({
                  userId: session.user.id,
                  userName: session.user.name,
                  billingMode: config.billingEnabled ? "hosted" : "self-hosted",
                  repositoryLimit: config.billingEnabled
                    ? getFreeRepositoryLimit()
                    : 0,
                }),
              ];
            }

            const requestedWorkspaceId = url.searchParams.get("workspaceId");
            const membership = requestedWorkspaceId
              ? memberships.find(
                  (item) => item.workspaceId === requestedWorkspaceId,
                )
              : (memberships.find(
                  (item) => item.workspaceId === preferredWorkspaceId,
                ) ?? memberships[0]);
            if (!membership) {
              return json(
                { error: "You do not have access to this workspace." },
                { status: 403 },
              );
            }
            if (
              membership.role !== "owner" &&
              !canWorkspaceMemberAccess(request.method, url.pathname)
            ) {
              return json(
                { error: "Workspace owner access is required." },
                { status: 403 },
              );
            }
            url.searchParams.set("workspaceId", membership.workspaceId);
            authenticatedWorkspaceRole = membership.role;
          }

          if (
            request.method === "GET" &&
            url.pathname === "/api/admin/post-image-generation/availability"
          ) {
            const entitlements = await getWorkspaceEntitlements(
              store,
              getWorkspaceId(url),
            );
            if (!entitlements.aiGeneration) {
              return json({
                status: "unavailable",
                reason: "A paid plan is required to use AI features.",
              });
            }
            return json(getPostImageGenerationAvailability(imageGenerator));
          }

          if (
            request.method === "GET" &&
            url.pathname === "/api/admin/held-entry-count"
          ) {
            return json({
              count: await getReviewableHeldEntryCount({
                store,
                workspaceId: getWorkspaceId(url),
              }),
            });
          }

          if (
            request.method === "POST" &&
            url.pathname === "/api/webhooks/github"
          ) {
            if (!config.githubWebhookSecret) {
              return json(
                { error: "GitHub webhook verification is not configured." },
                { status: 503 },
              );
            }
            const payload = await request.text();
            const valid = await verifyGitHubSignature({
              payload,
              signature: request.headers.get("x-hub-signature-256"),
              secret: config.githubWebhookSecret,
            });

            if (!valid) {
              return json(
                { error: "Invalid GitHub signature" },
                { status: 401 },
              );
            }

            await storeMergedPullRequestWebhook({
              payload,
              store,
            });

            return json({ ok: true }, { status: 202 });
          }

          if (
            request.method === "GET" &&
            url.pathname === "/api/admin/github/app"
          ) {
            return json(
              await githubConnectionStatus({
                store,
                workspaceId: getWorkspaceId(url),
                billingEnabled: config.billingEnabled,
                configured: isGitHubAppConfigured(config),
                installUrl: getGitHubAppInstallUrl(config),
              }),
            );
          }

          if (
            request.method === "GET" &&
            url.pathname === "/api/admin/settings"
          ) {
            const workspaceId = getWorkspaceId(url);
            const settings = await store.getWorkspaceSettings(workspaceId);
            const repositories = await store.listRepositories(workspaceId);
            const changelogs = await store.listChangelogs(workspaceId);
            const workspaceSettings = normalizeWorkspaceSettings(
              settings,
              getDefaultAppName(repositories),
            );
            if (changelogs.length === 1) {
              return json({
                settings: serializeChangelogSettings(
                  changelogs[0],
                  workspaceSettings,
                  customHostnameCnameTarget,
                ),
              });
            }

            return json({
              settings: workspaceSettings,
            });
          }

          if (
            request.method === "PUT" &&
            url.pathname === "/api/admin/settings"
          ) {
            const workspaceId = getWorkspaceId(url);
            const body = (await request.json().catch(() => ({}))) as {
              settings?: unknown;
            };
            const repositories = await store.listRepositories(workspaceId);
            const changelogs = await store.listChangelogs(workspaceId);
            const existingSettings = normalizeWorkspaceSettings(
              await store.getWorkspaceSettings(workspaceId),
              getDefaultAppName(repositories),
            );

            if (changelogs.length === 1) {
              const changelog = changelogs[0];
              const requestedSlug = await allocateUniqueChangelogSlug({
                currentChangelogId: changelog.id,
                requestedSlug: readRequestedChangelogSlug(
                  body.settings,
                  changelog.slug,
                ),
                store,
              });
              const normalized = normalizeChangelogSettings({
                appUrl: config.appUrl,
                changelog,
                input: body.settings,
                slug: requestedSlug,
                workspaceSettings: existingSettings,
              });
              await assertCustomDomainEntitlement({
                customDomain: normalized.customDomain,
                store,
                workspaceId,
              });
              const customHostname = await provisionChangelogCustomHostname({
                changelog,
                cnameTarget: customHostnameCnameTarget,
                customDomain: normalized.customDomain,
                provisioner: customHostnameProvisioner,
              });
              const savedWorkspaceSettings =
                await store.updateWorkspaceSettings(
                  workspaceId,
                  normalized.workspaceSettings,
                );
              const updated = await store.updateChangelogSettings({
                workspaceId,
                changelogId: changelog.id,
                slug: normalized.slug,
                name: normalized.name,
                description: normalized.description,
                publicUrl: normalized.publicUrl,
                customDomain: normalized.customDomain,
                customHostnameId: customHostname.customHostnameId,
                customHostnameStatus: customHostname.customHostnameStatus,
                customHostnameSslStatus: customHostname.customHostnameSslStatus,
                settings: normalized.settings,
              });

              if (!updated) {
                return json({ error: "Changelog not found" }, { status: 404 });
              }

              return json({
                changelog: serializeChangelog(updated),
                settings: serializeChangelogSettings(
                  updated,
                  savedWorkspaceSettings,
                  customHostnameCnameTarget,
                ),
              });
            }

            const settings = normalizeWorkspaceSettings(
              body.settings,
              getDefaultAppName(repositories),
            );
            await assertCustomDomainEntitlement({
              customDomain: settings.customDomain,
              store,
              workspaceId,
            });
            const saved = await store.updateWorkspaceSettings(workspaceId, {
              ...settings,
              logoAssetKey: existingSettings.logoAssetKey,
              logoDataUrl: null,
              logoUrl: existingSettings.logoUrl,
              lightLogoAssetKey: existingSettings.lightLogoAssetKey,
              lightLogoDataUrl: null,
              lightLogoUrl: existingSettings.lightLogoUrl,
              faviconAssetKey: existingSettings.faviconAssetKey,
              faviconDataUrl: null,
              faviconUrl: existingSettings.faviconUrl,
            });
            return json({
              settings: normalizeWorkspaceSettings(
                saved,
                getDefaultAppName(repositories),
              ),
            });
          }

          if (
            request.method === "POST" &&
            url.pathname === "/api/admin/onboarding/complete"
          ) {
            const workspaceId = getWorkspaceId(url);
            const repositories = await store.listRepositories(workspaceId);
            const existingSettings = normalizeWorkspaceSettings(
              await store.getWorkspaceSettings(workspaceId),
              getDefaultAppName(repositories),
            );
            const saved = await store.updateWorkspaceSettings(workspaceId, {
              ...existingSettings,
              onboardingCompleted: true,
            });

            return json({
              settings: normalizeWorkspaceSettings(
                saved,
                getDefaultAppName(repositories),
              ),
            });
          }

          if (
            request.method === "POST" &&
            url.pathname === "/api/admin/settings/logo"
          ) {
            return uploadWorkspaceLogo({
              assetStorage,
              request,
              store,
              workspaceId: getWorkspaceId(url),
            });
          }

          if (
            request.method === "DELETE" &&
            url.pathname === "/api/admin/settings/logo"
          ) {
            return deleteWorkspaceLogo({
              assetStorage,
              store,
              workspaceId: getWorkspaceId(url),
            });
          }

          for (const asset of ["light-logo", "favicon"] as const) {
            if (
              (request.method === "POST" || request.method === "DELETE") &&
              url.pathname === `/api/admin/settings/${asset}`
            ) {
              const workspaceId = getWorkspaceId(url);
              await assertWorkspaceEntitlement({
                store,
                workspaceId,
                capability: "customBranding",
                message:
                  "A paid plan is required to use theme logos and a custom favicon.",
              });
              return request.method === "POST"
                ? uploadWorkspaceBrandAsset({
                    assetStorage,
                    kind: asset === "light-logo" ? "lightLogo" : "favicon",
                    request,
                    store,
                    workspaceId,
                  })
                : deleteWorkspaceBrandAsset({
                    assetStorage,
                    kind: asset === "light-logo" ? "lightLogo" : "favicon",
                    store,
                    workspaceId,
                  });
            }
          }

          if (
            request.method === "GET" &&
            url.pathname === "/api/admin/github/install"
          ) {
            const installUrl = getGitHubAppInstallUrl(config);
            if (!isGitHubAppConfigured(config) || !installUrl) {
              return json(
                {
                  error:
                    "GitHub App is not configured. Set GITHUB_APP_SLUG, GITHUB_APP_ID, and GITHUB_APP_PRIVATE_KEY.",
                },
                { status: 409 },
              );
            }

            const destination = new URL(installUrl);
            if (!allowInjectedStoreTestAccess) {
              if (!authenticatedUserId || !env.BETTER_AUTH_SECRET) {
                return json(
                  { error: "GitHub installation verification is unavailable." },
                  { status: 503 },
                );
              }
              destination.searchParams.set(
                "state",
                await createGitHubInstallationState({
                  secret: env.BETTER_AUTH_SECRET,
                  userId: authenticatedUserId,
                  workspaceId: getWorkspaceId(url),
                }),
              );
            }

            return Response.redirect(destination, 302);
          }

          if (
            request.method === "POST" &&
            url.pathname === "/api/admin/github/sync"
          ) {
            if (!isGitHubAppConfigured(config)) {
              return json(
                {
                  error:
                    "GitHub App is not configured. Set GITHUB_APP_SLUG, GITHUB_APP_ID, and GITHUB_APP_PRIVATE_KEY.",
                },
                { status: 409 },
              );
            }

            const body = (await request.json().catch(() => ({}))) as {
              installationId?: number;
            };
            const workspaceId = getWorkspaceId(url);
            const storedInstallations =
              await store.listGitHubInstallations(workspaceId);
            if (
              body.installationId &&
              !storedInstallations.some(
                (item) => item.installationId === body.installationId,
              )
            ) {
              return json(
                { error: "GitHub installation not found." },
                { status: 404 },
              );
            }
            const synced = await syncStoredGitHubInstallations({
              githubClient,
              store,
              workspaceId,
              installationIds: body.installationId
                ? [body.installationId]
                : storedInstallations.map((item) => item.installationId),
            });

            return json({ synced });
          }

          const selectRepositoryMatch =
            /^\/api\/admin\/github\/repositories\/([^/]+)\/select$/.exec(
              url.pathname,
            );
          if (request.method === "POST" && selectRepositoryMatch) {
            const selected = await selectRepositoryForChangelog({
              appUrl: config.appUrl,
              repositoryId: decodeURIComponent(selectRepositoryMatch[1]),
              store,
              workspaceId: getWorkspaceId(url),
            });

            if (!selected) {
              return json({ error: "Repository not found" }, { status: 404 });
            }

            return json(selected);
          }

          if (
            request.method === "GET" &&
            (url.pathname === "/api/github/callback" ||
              url.pathname === "/api/onboarding/github")
          ) {
            const callbackAppUrl =
              env.NODE_ENV !== "production" && env.VITE_PUBLIC_SITE_URL
                ? env.VITE_PUBLIC_SITE_URL
                : config.appUrl;
            const installationId = Number(
              url.searchParams.get("installation_id"),
            );

            if (!Number.isInteger(installationId) || installationId <= 0) {
              return Response.redirect(
                githubAppCallbackRedirect(
                  callbackAppUrl,
                  "missing-installation",
                ),
                302,
              );
            }

            if (!isGitHubAppConfigured(config)) {
              return Response.redirect(
                githubAppCallbackRedirect(callbackAppUrl, "not-configured"),
                302,
              );
            }

            if (!allowInjectedStoreTestAccess) {
              const stateValid =
                authenticatedUserId &&
                env.BETTER_AUTH_SECRET &&
                (await verifyGitHubInstallationState({
                  secret: env.BETTER_AUTH_SECRET,
                  state: url.searchParams.get("state"),
                  userId: authenticatedUserId,
                  workspaceId: getWorkspaceId(url),
                }));
              const installationAccessible =
                stateValid &&
                (env.NODE_ENV !== "production" ||
                  (auth &&
                    (await auth.canAccessGitHubInstallation(
                      request.headers,
                      installationId,
                    ))));
              if (!installationAccessible) {
                return Response.redirect(
                  githubAppCallbackRedirect(
                    callbackAppUrl,
                    "invalid-installation",
                  ),
                  302,
                );
              }
            }

            try {
              await syncGitHubInstallation({
                githubClient,
                installationId,
                store,
                workspaceId: getWorkspaceId(url),
              });
              return Response.redirect(
                githubAppCallbackRedirect(callbackAppUrl, "connected"),
                302,
              );
            } catch {
              return Response.redirect(
                githubAppCallbackRedirect(callbackAppUrl, "sync-error"),
                302,
              );
            }
          }

          const changelogSettingsMatch =
            /^\/api\/admin\/changelogs\/([^/]+)\/settings$/.exec(url.pathname);
          if (request.method === "GET" && changelogSettingsMatch) {
            const workspaceId = getWorkspaceId(url);
            const changelog = await store.getChangelogById(
              decodeURIComponent(changelogSettingsMatch[1]),
            );

            if (!changelog || changelog.workspaceId !== workspaceId) {
              return json({ error: "Changelog not found" }, { status: 404 });
            }

            const repositories = await store.listRepositories(workspaceId);
            const workspaceSettings = normalizeWorkspaceSettings(
              await store.getWorkspaceSettings(workspaceId),
              getDefaultAppName(repositories),
            );
            return json({
              changelog: serializeChangelog(changelog),
              settings: serializeChangelogSettings(
                changelog,
                workspaceSettings,
                customHostnameCnameTarget,
              ),
            });
          }

          const adminChangelogEntriesMatch =
            /^\/api\/admin\/changelogs\/([^/]+)\/entries$/.exec(url.pathname);
          if (request.method === "POST" && adminChangelogEntriesMatch) {
            const workspaceId = getWorkspaceId(url);
            const changelog = await store.getChangelogById(
              decodeURIComponent(adminChangelogEntriesMatch[1]),
            );
            if (!changelog || changelog.workspaceId !== workspaceId) {
              return json({ error: "Changelog not found" }, { status: 404 });
            }

            const body = (await request.json().catch(() => ({}))) as Record<
              string,
              unknown
            >;
            const normalized = normalizeEntryUpdate(body);
            if (!normalized) {
              return json(
                { error: "Title, summary, and category are required." },
                { status: 400 },
              );
            }
            const publishedAt =
              normalized.publishedAt ?? new Date().toISOString();
            const entry = await store.createEntry({
              changelogId: changelog.id,
              title: normalized.title,
              summary: normalized.summary,
              category: normalized.category,
              status: "published",
              publishedAt,
              windowEndedAt: publishedAt,
              items: [],
              sourcePullRequests: [],
            });
            return json(serializeAdminChangelogEntry(entry), { status: 201 });
          }
          if (request.method === "GET" && adminChangelogEntriesMatch) {
            const workspaceId = getWorkspaceId(url);
            const changelog = await store.getChangelogById(
              decodeURIComponent(adminChangelogEntriesMatch[1]),
            );

            if (!changelog || changelog.workspaceId !== workspaceId) {
              return json({ error: "Changelog not found" }, { status: 404 });
            }

            return json(
              paginateAdminChangelogEntries(
                await store.listEntries(changelog.id),
                url.searchParams,
                changelog.settings.timeZone,
                changelog.settings.categoryDefinitions,
              ),
            );
          }

          if (request.method === "PUT" && changelogSettingsMatch) {
            const workspaceId = getWorkspaceId(url);
            const changelog = await store.getChangelogById(
              decodeURIComponent(changelogSettingsMatch[1]),
            );

            if (!changelog || changelog.workspaceId !== workspaceId) {
              return json({ error: "Changelog not found" }, { status: 404 });
            }

            const body = (await request.json().catch(() => ({}))) as {
              settings?: unknown;
            };
            const repositories = await store.listRepositories(workspaceId);
            const workspaceSettings = normalizeWorkspaceSettings(
              await store.getWorkspaceSettings(workspaceId),
              getDefaultAppName(repositories),
            );
            const requestedSlug = await allocateUniqueChangelogSlug({
              currentChangelogId: changelog.id,
              requestedSlug: readRequestedChangelogSlug(
                body.settings,
                changelog.slug,
              ),
              store,
            });
            const normalized = normalizeChangelogSettings({
              appUrl: config.appUrl,
              changelog,
              input: body.settings,
              slug: requestedSlug,
              workspaceSettings,
            });
            await assertCustomDomainEntitlement({
              customDomain: normalized.customDomain,
              store,
              workspaceId,
            });
            const customHostname = await provisionChangelogCustomHostname({
              changelog,
              cnameTarget: customHostnameCnameTarget,
              customDomain: normalized.customDomain,
              provisioner: customHostnameProvisioner,
            });
            const savedWorkspaceSettings = await store.updateWorkspaceSettings(
              workspaceId,
              normalized.workspaceSettings,
            );
            const updated = await store.updateChangelogSettings({
              workspaceId,
              changelogId: changelog.id,
              slug: normalized.slug,
              name: normalized.name,
              description: normalized.description,
              publicUrl: normalized.publicUrl,
              customDomain: normalized.customDomain,
              customHostnameId: customHostname.customHostnameId,
              customHostnameStatus: customHostname.customHostnameStatus,
              customHostnameSslStatus: customHostname.customHostnameSslStatus,
              settings: normalized.settings,
            });

            if (!updated) {
              return json({ error: "Changelog not found" }, { status: 404 });
            }

            return json({
              changelog: serializeChangelog(updated),
              settings: serializeChangelogSettings(
                updated,
                savedWorkspaceSettings,
                customHostnameCnameTarget,
              ),
            });
          }

          const changelogCustomDomainRefreshMatch =
            /^\/api\/admin\/changelogs\/([^/]+)\/custom-domain\/refresh$/.exec(
              url.pathname,
            );
          if (request.method === "POST" && changelogCustomDomainRefreshMatch) {
            const workspaceId = getWorkspaceId(url);
            const changelog = await store.getChangelogById(
              decodeURIComponent(changelogCustomDomainRefreshMatch[1]),
            );

            if (!changelog || changelog.workspaceId !== workspaceId) {
              return json({ error: "Changelog not found" }, { status: 404 });
            }

            if (!changelog.customDomain) {
              return json(
                { error: "No custom domain is configured." },
                { status: 409 },
              );
            }

            if (
              !changelog.customHostnameId ||
              !customHostnameProvisioner?.getCustomHostname
            ) {
              return json(
                {
                  error:
                    "Cloudflare custom hostname status checks are not configured.",
                },
                { status: 409 },
              );
            }

            const refreshed = await customHostnameProvisioner.getCustomHostname(
              changelog.customHostnameId,
            );
            const updated = await store.updateChangelogSettings({
              workspaceId,
              changelogId: changelog.id,
              slug: changelog.slug,
              name: changelog.name,
              description: changelog.description ?? "",
              publicUrl: changelog.publicUrl,
              customDomain: changelog.customDomain,
              customHostnameId: refreshed.id,
              customHostnameStatus: refreshed.status,
              customHostnameSslStatus: refreshed.sslStatus,
              settings: changelog.settings,
            });

            if (!updated) {
              return json({ error: "Changelog not found" }, { status: 404 });
            }

            const repositories = await store.listRepositories(workspaceId);
            const workspaceSettings = normalizeWorkspaceSettings(
              await store.getWorkspaceSettings(workspaceId),
              getDefaultAppName(repositories),
            );

            return json({
              changelog: serializeChangelog(updated),
              settings: serializeChangelogSettings(
                updated,
                workspaceSettings,
                customHostnameCnameTarget,
              ),
            });
          }

          const feedMatch =
            /^\/api\/public\/changelogs\/([^/]+)\/feed\.json$/.exec(
              url.pathname,
            );
          const rssFeedMatch =
            /^\/api\/public\/changelogs\/([^/]+)\/feed\.xml$/.exec(
              url.pathname,
            );
          if (
            request.method === "OPTIONS" &&
            url.pathname.startsWith("/api/public/")
          ) {
            return publicCorsResponse(new Response(null, { status: 204 }));
          }
          if (
            (request.method === "GET" || request.method === "HEAD") &&
            feedMatch
          ) {
            return publicCorsResponse(
              respondToHead(
                request,
                await publicFeed(
                  store,
                  decodeURIComponent(feedMatch[1]),
                  url.searchParams,
                ),
              ),
            );
          }

          if (
            (request.method === "GET" || request.method === "HEAD") &&
            rssFeedMatch
          ) {
            return publicCorsResponse(
              respondToHead(
                request,
                await publicRssFeed(
                  store,
                  decodeURIComponent(rssFeedMatch[1]),
                  url.searchParams,
                ),
              ),
            );
          }

          const latestMatch =
            /^\/api\/public\/changelogs\/([^/]+)\/latest$/.exec(url.pathname);
          if (
            (request.method === "GET" || request.method === "HEAD") &&
            latestMatch
          ) {
            const query = parsePublicFeedQuery(url.searchParams, {
              includeLimit: true,
            });
            if (!query.success) {
              return publicCorsResponse(
                respondToHead(
                  request,
                  json({ error: query.error }, { status: 400 }),
                ),
              );
            }
            const response = await publicFeed(
              store,
              decodeURIComponent(latestMatch[1]),
              url.searchParams,
              query.data.limit,
            );
            return publicCorsResponse(respondToHead(request, response));
          }

          if (
            (request.method === "GET" || request.method === "HEAD") &&
            url.pathname === "/api/public/changelog/feed.json"
          ) {
            return publicCorsResponse(
              respondToHead(
                request,
                await publicFeedByHost(store, request, url.searchParams),
              ),
            );
          }

          if (
            (request.method === "GET" || request.method === "HEAD") &&
            url.pathname === "/api/public/changelog/feed.xml"
          ) {
            return publicCorsResponse(
              respondToHead(
                request,
                await publicRssFeedByHost(store, request, url.searchParams),
              ),
            );
          }

          if (
            (request.method === "GET" || request.method === "HEAD") &&
            url.pathname === "/api/public/changelog/latest"
          ) {
            const query = parsePublicFeedQuery(url.searchParams, {
              includeLimit: true,
            });
            if (!query.success) {
              return publicCorsResponse(
                respondToHead(
                  request,
                  json({ error: query.error }, { status: 400 }),
                ),
              );
            }
            const response = await publicFeedByHost(
              store,
              request,
              url.searchParams,
              query.data.limit,
            );
            return publicCorsResponse(respondToHead(request, response));
          }

          const changelogLogoMatch =
            /^\/api\/public\/changelogs\/([^/]+)\/logo$/.exec(url.pathname);
          if (request.method === "GET" && changelogLogoMatch) {
            return publicCorsResponse(
              await publicChangelogLogo({
                assetStorage,
                slug: decodeURIComponent(changelogLogoMatch[1]),
                store,
              }),
            );
          }

          const changelogBrandAssetMatch =
            /^\/api\/public\/changelogs\/([^/]+)\/(light-logo|favicon)$/.exec(
              url.pathname,
            );
          if (request.method === "GET" && changelogBrandAssetMatch) {
            const changelog = await store.getChangelogBySlug(
              decodeURIComponent(changelogBrandAssetMatch[1]),
            );
            if (!changelog) {
              return json({ error: "Brand asset not found" }, { status: 404 });
            }
            return publicCorsResponse(
              await publicWorkspaceBrandAsset({
                assetStorage,
                kind:
                  changelogBrandAssetMatch[2] === "light-logo"
                    ? "lightLogo"
                    : "favicon",
                store,
                workspaceId: changelog.workspaceId,
              }),
            );
          }

          const changelogPostImageMatch =
            /^\/api\/public\/changelogs\/([^/]+)\/entries\/([^/]+)\/image$/.exec(
              url.pathname,
            );
          if (request.method === "GET" && changelogPostImageMatch) {
            return publicCorsResponse(
              await publicChangelogEntryImageBySlug({
                assetStorage,
                entryId: decodeURIComponent(changelogPostImageMatch[2]),
                slug: decodeURIComponent(changelogPostImageMatch[1]),
                store,
              }),
            );
          }

          const logoMatch = /^\/api\/public\/workspaces\/([^/]+)\/logo$/.exec(
            url.pathname,
          );
          if (request.method === "GET" && logoMatch) {
            return publicCorsResponse(
              await publicWorkspaceLogo({
                assetStorage,
                store,
                workspaceId: decodeURIComponent(logoMatch[1]),
              }),
            );
          }

          const workspaceBrandAssetMatch =
            /^\/api\/public\/workspaces\/([^/]+)\/(light-logo|favicon)$/.exec(
              url.pathname,
            );
          if (request.method === "GET" && workspaceBrandAssetMatch) {
            return publicCorsResponse(
              await publicWorkspaceBrandAsset({
                assetStorage,
                kind:
                  workspaceBrandAssetMatch[2] === "light-logo"
                    ? "lightLogo"
                    : "favicon",
                store,
                workspaceId: decodeURIComponent(workspaceBrandAssetMatch[1]),
              }),
            );
          }

          const postImageMatch =
            /^\/api\/public\/workspaces\/([^/]+)\/changelog-entries\/([^/]+)\/image$/.exec(
              url.pathname,
            );
          if (request.method === "GET" && postImageMatch) {
            return publicCorsResponse(
              await publicChangelogEntryImage({
                assetStorage,
                entryId: decodeURIComponent(postImageMatch[2]),
                store,
                workspaceId: decodeURIComponent(postImageMatch[1]),
              }),
            );
          }

          const generateMatch =
            /^\/api\/admin\/changelogs\/([^/]+)\/generate$/.exec(url.pathname);
          if (request.method === "POST" && generateMatch) {
            const workspaceId = getWorkspaceId(url);
            const changelog = await store.getChangelogById(
              decodeURIComponent(generateMatch[1]),
            );
            if (!changelog || changelog.workspaceId !== workspaceId) {
              return json({ error: "Changelog not found" }, { status: 404 });
            }
            const body = (await request.json().catch(() => ({}))) as {
              windowEnd?: string;
            };
            const result = await generateChangelogForWindow({
              store,
              summarizer,
              recordAiUsage,
              changelogId: decodeURIComponent(generateMatch[1]),
              windowEnd: body.windowEnd ?? new Date().toISOString(),
            });
            return json(result, {
              status: result.status === "published" ? 201 : 202,
            });
          }

          const historicalGenerateMatch =
            /^\/api\/admin\/changelogs\/([^/]+)\/generate-historical$/.exec(
              url.pathname,
            );
          if (request.method === "POST" && historicalGenerateMatch) {
            const workspaceId = getWorkspaceId(url);
            const changelog = await store.getChangelogById(
              decodeURIComponent(historicalGenerateMatch[1]),
            );
            if (!changelog || changelog.workspaceId !== workspaceId) {
              return json({ error: "Changelog not found" }, { status: 404 });
            }
            const body = (await request.json().catch(() => ({}))) as {
              days?: unknown;
              now?: unknown;
              startDate?: unknown;
              endDate?: unknown;
            };
            const repositories = await store.listRepositories(workspaceId);
            const workspaceSettings = normalizeWorkspaceSettings(
              await store.getWorkspaceSettings(workspaceId),
              getDefaultAppName(repositories),
            );
            const days = readInteger(
              body.days,
              workspaceSettings.historicalBackfillDays,
              1,
              365,
            );
            const startDate =
              typeof body.startDate === "string" ? body.startDate : undefined;
            const endDate =
              typeof body.endDate === "string" ? body.endDate : undefined;
            if ((startDate !== undefined) !== (endDate !== undefined)) {
              return json(
                { error: "Choose both a backfill start and end date." },
                { status: 400 },
              );
            }
            let range: { startedAt: string; endedAt: string } | undefined;
            if (startDate !== undefined && endDate !== undefined) {
              try {
                const window = getHistoricalDateRangeWindow({
                  startDate,
                  endDate,
                  timeZone: changelog.settings.timeZone,
                });
                range = {
                  startedAt: window.startedAt.toISOString(),
                  endedAt: window.endedAt.toISOString(),
                };
              } catch (error) {
                return json(
                  {
                    error:
                      error instanceof Error
                        ? error.message
                        : "Choose a valid backfill date range.",
                  },
                  { status: 400 },
                );
              }
            }
            const now =
              typeof body.now === "string" &&
              !Number.isNaN(Date.parse(body.now))
                ? new Date(body.now)
                : new Date();
            const result = await generateHistoricalChangelog({
              store,
              summarizer,
              recordAiUsage,
              githubClient: isGitHubAppConfigured(config)
                ? githubClient
                : undefined,
              changelogId: decodeURIComponent(historicalGenerateMatch[1]),
              days,
              now,
              range,
              windowMode: "rolling",
            });

            return json(result, { status: 202 });
          }

          if (
            request.method === "POST" &&
            url.pathname === "/api/admin/changelog-entries/merge"
          ) {
            await assertAiFeatureEntitlement(store, getWorkspaceId(url));
            const body = (await request.json().catch(() => ({}))) as {
              entryIds?: unknown;
            };
            const entryIds = normalizeEntryIds(body.entryIds);
            if (entryIds.length < 2) {
              return json(
                { error: "At least two changelog entries are required." },
                { status: 400 },
              );
            }

            const merged = await mergeChangelogEntries({
              store,
              summarizer,
              recordAiUsage,
              workspaceId: getWorkspaceId(url),
              entryIds,
            });

            if (merged.status !== "published") {
              return merged.status === "not-found"
                ? json(
                    { error: "One or more changelog entries were not found." },
                    { status: 404 },
                  )
                : json(
                    {
                      error: "AI merge output needs review before publishing.",
                    },
                    { status: 422 },
                  );
            }

            return json(merged.entry, { status: 201 });
          }

          const changelogEntryNotRelevantMatch =
            /^\/api\/admin\/changelog-entries\/([^/]+)\/not-relevant$/.exec(
              url.pathname,
            );
          if (request.method === "POST" && changelogEntryNotRelevantMatch) {
            const body = (await request.json().catch(() => ({}))) as {
              note?: unknown;
            };
            const note =
              typeof body.note === "string"
                ? body.note.trim().slice(0, 500)
                : null;
            const feedback = await store.markEntryNotRelevant({
              workspaceId: getWorkspaceId(url),
              entryId: decodeURIComponent(changelogEntryNotRelevantMatch[1]),
              note,
            });

            if (!feedback) {
              return json(
                { error: "Changelog entry not found" },
                { status: 404 },
              );
            }

            return new Response(null, { status: 204 });
          }

          if (
            request.method === "POST" &&
            url.pathname === "/api/webhooks/stripe"
          ) {
            const payload = await request.text();
            let event: Stripe.Event;

            try {
              event = await constructStripeWebhookEvent({
                stripe,
                config,
                payload,
                signature: request.headers.get("stripe-signature"),
              });
            } catch {
              return json(
                { error: "Invalid Stripe signature" },
                { status: 400 },
              );
            }

            await handleStripeWebhookEvent({
              event,
              store,
              stripe,
              config,
              billingEmailSender,
            });

            return json({ received: true });
          }

          const changelogEntryRelevantMatch =
            /^\/api\/admin\/changelog-entries\/([^/]+)\/relevant$/.exec(
              url.pathname,
            );
          if (request.method === "POST" && changelogEntryRelevantMatch) {
            const body = (await request.json().catch(() => ({}))) as {
              note?: unknown;
            };
            const note =
              typeof body.note === "string"
                ? body.note.trim().slice(0, 500)
                : "";
            const feedback = await store.markEntryNotRelevant({
              workspaceId: getWorkspaceId(url),
              entryId: decodeURIComponent(changelogEntryRelevantMatch[1]),
              note: `Marked relevant.${note ? ` ${note}` : ""}`,
            });

            if (!feedback) {
              return json(
                { error: "Changelog entry not found" },
                { status: 404 },
              );
            }

            return new Response(null, { status: 204 });
          }

          const changelogEntryPublishMatch =
            /^\/api\/admin\/changelog-entries\/([^/]+)\/publish$/.exec(
              url.pathname,
            );
          if (request.method === "POST" && changelogEntryPublishMatch) {
            const workspaceId = getWorkspaceId(url);
            const entryId = decodeURIComponent(changelogEntryPublishMatch[1]);
            const body = (await request.json().catch(() => ({}))) as Record<
              string,
              unknown
            >;
            if (Object.keys(body).length > 0) {
              const input = normalizeEntryUpdate(body);
              if (!input) {
                return json(
                  { error: "Title, summary, and category are required." },
                  { status: 400 },
                );
              }

              const updated = await store.updateEntry({
                ...input,
                entryId,
                workspaceId,
              });
              if (!updated) {
                return json(
                  { error: "Changelog entry not found" },
                  { status: 404 },
                );
              }
            }

            const entry = await store.publishEntry(workspaceId, entryId);

            if (!entry) {
              return json(
                { error: "Changelog entry not found" },
                { status: 404 },
              );
            }

            return json(serializeAdminChangelogEntry(entry));
          }

          const changelogEntryRegenerateMarketingMatch =
            /^\/api\/admin\/changelog-entries\/([^/]+)\/regenerate-marketing-copy$/.exec(
              url.pathname,
            );
          if (
            request.method === "POST" &&
            changelogEntryRegenerateMarketingMatch
          ) {
            await assertAiFeatureEntitlement(store, getWorkspaceId(url));
            const body = (await request.json().catch(() => ({}))) as Record<
              string,
              unknown
            >;
            const result = await regenerateChangelogEntryMarketingCopy({
              category: body.category,
              entryId: decodeURIComponent(
                changelogEntryRegenerateMarketingMatch[1],
              ),
              rewriteInstructions:
                typeof body.rewriteInstructions === "string"
                  ? body.rewriteInstructions.trim().slice(0, 1000)
                  : undefined,
              store,
              summarizer,
              recordAiUsage,
              workspaceId: getWorkspaceId(url),
            });

            if (result.status === "not-found") {
              return json(
                { error: "Changelog entry not found" },
                { status: 404 },
              );
            }

            if (result.status === "invalid-output") {
              return json(
                { error: "Could not regenerate safe marketing copy" },
                { status: 422 },
              );
            }

            if (result.status === "ok") {
              return json(result.entry);
            }

            return json(
              { error: "Could not regenerate safe marketing copy" },
              { status: 422 },
            );
          }

          const changelogEntryRegenerateMatch =
            /^\/api\/admin\/changelog-entries\/([^/]+)\/regenerate$/.exec(
              url.pathname,
            );
          if (request.method === "POST" && changelogEntryRegenerateMatch) {
            await assertAiFeatureEntitlement(store, getWorkspaceId(url));
            const result = await regenerateHeldChangelogEntry({
              entryId: decodeURIComponent(changelogEntryRegenerateMatch[1]),
              store,
              summarizer,
              recordAiUsage,
              workspaceId: getWorkspaceId(url),
            });

            if (result.status === "not-found") {
              return json(
                { error: "Changelog entry not found" },
                { status: 404 },
              );
            }

            if (result.status === "not-held") {
              return json(
                { error: "Only held drafts can be regenerated." },
                { status: 409 },
              );
            }

            if (result.status === "missing-source") {
              return json(
                {
                  error: "Source pull request is required to regenerate copy.",
                },
                { status: 409 },
              );
            }

            if (result.status === "invalid-output") {
              return json(
                { error: "Could not regenerate safe post copy." },
                { status: 422 },
              );
            }

            if (result.status === "ok") {
              return json(serializeAdminChangelogEntry(result.entry));
            }

            return json(
              { error: "Could not regenerate safe post copy." },
              { status: 422 },
            );
          }

          const changelogEntryGenerateImageMatch =
            /^\/api\/admin\/changelog-entries\/([^/]+)\/generate-image$/.exec(
              url.pathname,
            );
          if (request.method === "POST" && changelogEntryGenerateImageMatch) {
            await assertAiFeatureEntitlement(store, getWorkspaceId(url));
            if (imageGenerator.disabledReason) {
              return json(
                {
                  error: postImageGenerationNotConfiguredMessage,
                  unavailable: true,
                },
                { status: 503 },
              );
            }

            const body = (await request.json().catch(() => ({}))) as Record<
              string,
              unknown
            >;
            const result = await generateChangelogEntryPostImage({
              assetStorage,
              category: body.category,
              entryId: decodeURIComponent(changelogEntryGenerateImageMatch[1]),
              imageGenerator,
              store,
              summary: body.summary,
              title: body.title,
              workspaceId: getWorkspaceId(url),
            });

            if (result.status === "not-found") {
              return json(
                { error: "Changelog entry not found" },
                { status: 404 },
              );
            }

            if (result.status === "not-post-category") {
              return json(
                { error: "Entry category is not configured as a post" },
                { status: 409 },
              );
            }

            if (result.status === "invalid-output") {
              return json(
                { error: "Could not generate a safe post image" },
                { status: 422 },
              );
            }

            if (result.status === "provider-error") {
              return json(
                {
                  error: postImageGenerationUnavailableMessage,
                  unavailable: true,
                },
                { status: 502 },
              );
            }

            if (result.status === "ok") {
              return json(serializeAdminChangelogEntry(result.entry));
            }

            return json(
              { error: "Could not generate a safe post image" },
              { status: 422 },
            );
          }

          const changelogEntryUploadImageMatch =
            /^\/api\/admin\/changelog-entries\/([^/]+)\/image$/.exec(
              url.pathname,
            );
          if (request.method === "POST" && changelogEntryUploadImageMatch) {
            return uploadChangelogEntryImage({
              assetStorage,
              entryId: decodeURIComponent(changelogEntryUploadImageMatch[1]),
              request,
              store,
              workspaceId: getWorkspaceId(url),
            });
          }

          const changelogEntryMatch =
            /^\/api\/admin\/changelog-entries\/([^/]+)$/.exec(url.pathname);
          if (request.method === "PATCH" && changelogEntryMatch) {
            const body = (await request.json().catch(() => ({}))) as Record<
              string,
              unknown
            >;
            const input = normalizeEntryUpdate(body);

            if (!input) {
              return json(
                { error: "Title, summary, and category are required." },
                { status: 400 },
              );
            }

            const updated = await store.updateEntry({
              ...input,
              entryId: decodeURIComponent(changelogEntryMatch[1]),
              workspaceId: getWorkspaceId(url),
            });

            if (!updated) {
              return json(
                { error: "Changelog entry not found" },
                { status: 404 },
              );
            }

            return json(updated);
          }

          if (request.method === "DELETE" && changelogEntryMatch) {
            const deleted = await store.deleteEntry(
              getWorkspaceId(url),
              decodeURIComponent(changelogEntryMatch[1]),
            );

            if (!deleted) {
              return json(
                { error: "Changelog entry not found" },
                { status: 404 },
              );
            }

            return new Response(null, { status: 204 });
          }

          if (
            request.method === "GET" &&
            url.pathname === "/api/admin/billing/usage"
          ) {
            return json(
              await billingUsageDetails({
                config,
                store,
                workspaceId: getWorkspaceId(url),
              }),
            );
          }

          if (
            request.method === "GET" &&
            url.pathname === "/api/admin/billing/subscription"
          ) {
            return json(
              await billingSubscriptionDetails({
                config,
                store,
                stripe,
                workspaceId: getWorkspaceId(url),
                canManageBilling:
                  allowInjectedStoreTestAccess ||
                  authenticatedWorkspaceRole === "owner",
                currency: getBillingCurrencyForCountry(
                  getRequestCountryCode(
                    request,
                    url.searchParams.get("countryCode"),
                  ),
                ),
              }),
            );
          }

          if (
            request.method === "POST" &&
            url.pathname === "/api/admin/billing/checkout"
          ) {
            const body = (await request.json().catch(() => ({}))) as {
              customerEmail?: string;
              planId?: string;
              billingCadence?: string;
              countryCode?: string;
              recoverSubscription?: boolean;
            };
            const workspaceId = getWorkspaceId(url);
            const checkoutEntitlements = await getWorkspaceEntitlements(
              store,
              workspaceId,
            );
            if (checkoutEntitlements.accessSource === "complimentary") {
              return json(
                {
                  error:
                    "Complimentary access is managed by the workspace operator.",
                },
                { status: 409 },
              );
            }
            const [workspace, existingSubscription] = await Promise.all([
              store.getWorkspace(workspaceId),
              store.getBillingSubscription(workspaceId),
            ]);
            const hasManageableSubscription = Boolean(
              existingSubscription &&
              !["canceled", "incomplete_expired"].includes(
                existingSubscription.status,
              ),
            );
            let canRecoverSubscription = Boolean(
              hasManageableSubscription &&
              existingSubscription &&
              (await isBillingCustomerUnavailable({
                stripe,
                customerId: existingSubscription.stripeCustomerId,
              })),
            );
            if (
              hasManageableSubscription &&
              existingSubscription &&
              !canRecoverSubscription
            ) {
              let portalUrl: string | null = null;
              try {
                portalUrl = await createPortalUrl({
                  stripe,
                  config,
                  customerId: existingSubscription.stripeCustomerId,
                });
              } catch (error) {
                const customerMissing = isMissingBillingCustomerError(error);
                console.error("Billing portal session could not be created", {
                  requestId,
                  errorType:
                    error instanceof Error ? error.name : "UnknownError",
                  errorCode: getBillingProviderErrorCode(error),
                  customerMissing,
                });
                canRecoverSubscription ||= customerMissing;
              }
              if (portalUrl) {
                return json({ enabled: true, url: portalUrl });
              }
              if (!canRecoverSubscription) {
                return json(
                  { error: "Billing management is temporarily unavailable." },
                  { status: 503 },
                );
              }
            }
            let checkoutUrl: string | null = null;
            try {
              checkoutUrl = await createCheckoutUrl({
                stripe,
                config,
                checkout: {
                  workspaceId,
                  customerId: canRecoverSubscription
                    ? undefined
                    : hasManageableSubscription
                      ? existingSubscription?.stripeCustomerId
                      : (workspace?.stripeCustomerId ?? undefined),
                  customerEmail: authenticatedEmail ?? body.customerEmail,
                  planId: parseBillingPlanId(body.planId),
                  billingCadence: parseBillingCadence(body.billingCadence),
                  currency: getBillingCurrencyForCountry(
                    getRequestCountryCode(request, body.countryCode),
                  ),
                },
              });
            } catch (error) {
              console.error("Billing checkout session could not be created", {
                requestId,
                errorType: error instanceof Error ? error.name : "UnknownError",
              });
              return json(
                {
                  error:
                    "Billing checkout is temporarily unavailable. Please try again shortly.",
                },
                { status: 503 },
              );
            }
            return json({ enabled: Boolean(checkoutUrl), url: checkoutUrl });
          }

          if (
            request.method === "POST" &&
            url.pathname === "/api/admin/billing/auto-recharge"
          ) {
            if (authenticatedWorkspaceRole !== "owner") {
              return json(
                { error: "Only workspace owners can change auto-recharge." },
                { status: 403 },
              );
            }
            const body = (await request.json().catch(() => ({}))) as {
              enabled?: unknown;
            };
            if (typeof body.enabled !== "boolean") {
              return json(
                { error: "Choose whether automatic recharges are enabled." },
                { status: 400 },
              );
            }
            if (!stripe || !config.billingEnabled) {
              return json(
                { error: "Billing is not configured." },
                { status: 409 },
              );
            }
            const workspaceId = getWorkspaceId(url);
            const entitlements = await getWorkspaceEntitlements(
              store,
              workspaceId,
            );
            if (entitlements.accessSource === "complimentary") {
              return json(
                {
                  error:
                    "Complimentary access does not use automatic recharges.",
                },
                { status: 409 },
              );
            }
            const stored = await store.getBillingSubscription(workspaceId);
            if (!stored || !isEntitledSubscriptionStatus(stored.status)) {
              return json(
                { error: "An active paid subscription is required." },
                { status: 409 },
              );
            }
            const subscription = await stripe.subscriptions.retrieve(
              stored.stripeSubscriptionId,
            );
            const updated = await setSubscriptionAutoRecharge({
              stripe,
              subscription,
              enabled: body.enabled,
            });
            await syncStripeSubscription({ store, subscription: updated });
            return json(
              await billingSubscriptionDetails({
                config,
                store,
                stripe,
                workspaceId,
                canManageBilling: true,
                currency: getBillingCurrencyForCountry(
                  getRequestCountryCode(request, null),
                ),
              }),
            );
          }

          if (
            request.method === "POST" &&
            url.pathname === "/api/admin/billing/recovery"
          ) {
            const body = (await request.json().catch(() => ({}))) as {
              action?: string;
              countryCode?: string;
            };
            if (body.action !== "downgrade_to_free") {
              return json(
                { error: "Choose a billing recovery action." },
                { status: 400 },
              );
            }

            const workspaceId = getWorkspaceId(url);
            const recoveryEntitlements = await getWorkspaceEntitlements(
              store,
              workspaceId,
            );
            if (recoveryEntitlements.accessSource === "complimentary") {
              return json(
                {
                  error:
                    "Complimentary access is managed by the workspace operator.",
                },
                { status: 409 },
              );
            }
            const [workspace, subscription] = await Promise.all([
              store.getWorkspace(workspaceId),
              store.getBillingSubscription(workspaceId),
            ]);
            const billingManagement = subscription
              ? await resolveBillingManagement({
                  stripe,
                  config,
                  customerId: subscription.stripeCustomerId,
                })
              : { state: "unavailable" as const, url: null };
            const canRecover = Boolean(
              subscription &&
              !["canceled", "incomplete_expired"].includes(
                subscription.status,
              ) &&
              billingManagement.state === "recovery_required",
            );
            if (!workspace || !subscription || !canRecover) {
              return json(
                { error: "The saved subscription is still manageable." },
                { status: 409 },
              );
            }

            await store.archiveBillingSubscription(
              subscription.stripeSubscriptionId,
              new Date().toISOString(),
            );
            await store.updateWorkspaceBilling({
              workspaceId,
              billingMode: "hosted",
              repositoryLimit: getFreeRepositoryLimit(),
              stripeCustomerId: null,
            });

            return json(
              await billingSubscriptionDetails({
                config,
                store,
                stripe,
                workspaceId,
                canManageBilling: true,
                currency: getBillingCurrencyForCountry(
                  getRequestCountryCode(request, body.countryCode),
                ),
              }),
            );
          }

          if (
            request.method === "POST" &&
            url.pathname === "/api/admin/billing/portal"
          ) {
            const workspaceId = getWorkspaceId(url);
            const entitlements = await getWorkspaceEntitlements(
              store,
              workspaceId,
            );
            if (entitlements.accessSource === "complimentary") {
              return json({ enabled: false, url: null });
            }
            const workspace = await store.getWorkspace(workspaceId);
            const subscription =
              await store.getBillingSubscription(workspaceId);
            const customerId =
              subscription?.stripeCustomerId ?? workspace?.stripeCustomerId;
            const billingManagement =
              config.billingEnabled && customerId
                ? await resolveBillingManagement({
                    stripe,
                    config,
                    customerId,
                  })
                : { state: "unavailable" as const, url: null };
            return json({
              enabled: Boolean(billingManagement.url),
              url: billingManagement.url,
            });
          }

          if (
            (request.method === "GET" || request.method === "HEAD") &&
            !url.pathname.startsWith("/api/")
          ) {
            const legacyAdminPath = getLegacyAdminRedirectPath(url.pathname);
            if (legacyAdminPath) {
              return secureResponse(
                new Response(null, {
                  status: 308,
                  headers: { location: `${legacyAdminPath}${url.search}` },
                }),
              );
            }

            const trustPageShell = await serveTrustPageShell({
              pathname: url.pathname,
              request,
              staticRoot,
            });

            if (trustPageShell) {
              return trustPageShell;
            }

            const developerDocsShell = await serveDeveloperDocsShell({
              pathname: url.pathname,
              request,
              staticRoot,
            });

            if (developerDocsShell) {
              return developerDocsShell;
            }

            const publicChangelogShell = await servePublicChangelogShell({
              pathname: url.pathname,
              request,
              staticRoot,
              store,
            });

            if (publicChangelogShell) {
              return publicChangelogShell;
            }
            if (
              await isDisabledPublicChangelogRequest({
                pathname: url.pathname,
                request,
                store,
              })
            ) {
              return json({ error: "Changelog not found" }, { status: 404 });
            }

            return serveStatic(url.pathname, staticRoot);
          }

          return json({ error: "Not found" }, { status: 404 });
        })();
        responseStatus = response.status;
        return response;
      } catch (error) {
        if (error instanceof Response) {
          const response = secureResponse(error);
          responseStatus = response.status;
          return response;
        }

        console.error("Unhandled API request error", {
          requestId,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
        return json(
          { error: "Internal server error", requestId },
          { status: 500 },
        );
      } finally {
        if (productionRuntime && !options.store) {
          console.info("API request completed", {
            durationMs: Math.round(performance.now() - startedAt),
            method: request.method,
            path: requestPath,
            requestId,
            status: responseStatus,
          });
        }
      }
    },
  };
}

async function findConnectedWorkspaceId(
  store: Store,
  memberships: Array<{ workspaceId: string }>,
): Promise<string | null> {
  for (const membership of memberships) {
    const installations = await store.listGitHubInstallations(
      membership.workspaceId,
    );
    if (installations.length > 0) return membership.workspaceId;
  }
  return null;
}

async function githubConnectionStatus({
  billingEnabled,
  configured,
  installUrl,
  store,
  workspaceId,
}: {
  billingEnabled: boolean;
  configured: boolean;
  installUrl: string | null;
  store: Store;
  workspaceId: string;
}) {
  const installations = await store.listGitHubInstallations(workspaceId);
  const repositories = await store.listRepositories(workspaceId);
  const changelogs = await store.listChangelogs(workspaceId);
  const workspace = await store.getWorkspace(workspaceId);
  const entitlements = await getWorkspaceEntitlements(store, workspaceId);

  return {
    configured,
    installUrl,
    billingEnabled,
    billingMode: workspace?.billingMode ?? "self-hosted",
    repositoryLimit:
      workspace?.billingMode === "self-hosted"
        ? null
        : entitlements.repositoryLimit,
    installations: installations.map((installation) => ({
      id: installation.id,
      installationId: installation.installationId,
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      suspendedAt: installation.suspendedAt,
    })),
    repositories: repositories.map((repository) =>
      serializeGitHubRepository({
        changelogs,
        installations,
        repository,
      }),
    ),
  };
}

async function billingSubscriptionDetails({
  config,
  store,
  stripe,
  workspaceId,
  canManageBilling,
  currency,
}: {
  config: ReturnType<typeof loadConfig>;
  store: Store;
  stripe: ReturnType<typeof createStripeClient>;
  workspaceId: string;
  canManageBilling: boolean;
  currency: BillingCurrency;
}) {
  const { details, subscription, workspace } = await resolveBillingUsageDetails(
    {
      config,
      store,
      workspaceId,
    },
  );
  const complimentary = details.accessSource === "complimentary";
  const hasManageableSubscription = Boolean(
    !complimentary &&
    subscription &&
    !["canceled", "incomplete_expired"].includes(subscription.status),
  );
  const customerId =
    (hasManageableSubscription ? subscription?.stripeCustomerId : null) ??
    workspace?.stripeCustomerId;
  const billingManagement =
    canManageBilling && config.billingEnabled && customerId
      ? await resolveBillingManagement({
          stripe,
          config,
          customerId,
        })
      : { state: "unavailable" as const, url: null };

  return {
    ...details,
    currency,
    plans: billingPlans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      monthlyAmount: plan.monthlyAmount,
      annualAmount: plan.annualAmount,
      priceLabel: formatBillingAmount(plan.monthlyAmount, currency),
      cadence: plan.cadence,
      annualPriceLabel: formatBillingAmount(plan.annualAmount, currency),
      annualCadence: plan.annualCadence,
      repositoryLimit: plan.repositoryLimit,
      monthlyPullRequestLimit: plan.monthlyPullRequestLimit,
      monthlyIncludedCredits: plan.monthlyIncludedCredits,
      estimatedMonthlyPullRequests: plan.estimatedMonthlyPullRequests,
      features: plan.features,
    })),
    managementState: billingManagement.state,
    portalUrl: billingManagement.url,
    subscription:
      !complimentary && subscription
        ? {
            status: subscription.status,
            accessState: getSubscriptionAccessState(subscription.status),
            planId: subscription.planId,
            billingCadence: subscription.billingCadence,
            repositoryLimit: subscription.repositoryLimit,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            cancelAt: subscription.cancelAt,
            lastPaymentFailedAt: subscription.lastPaymentFailedAt,
            autoRechargeEnabled: subscription.autoRechargeEnabled !== false,
          }
        : null,
  };
}

async function billingUsageDetails({
  config,
  store,
  workspaceId,
}: {
  config: ReturnType<typeof loadConfig>;
  store: Store;
  workspaceId: string;
}) {
  const { details } = await resolveBillingUsageDetails({
    config,
    store,
    workspaceId,
  });
  return details;
}

async function resolveBillingUsageDetails({
  config,
  store,
  workspaceId,
}: {
  config: ReturnType<typeof loadConfig>;
  store: Store;
  workspaceId: string;
}) {
  const workspace = await store.getWorkspace(workspaceId);
  const subscription = config.billingEnabled
    ? await store.getBillingSubscription(workspaceId)
    : null;
  const entitlements = await getWorkspaceEntitlements(store, workspaceId);
  const repositories = await store.listRepositories(workspaceId);
  const changelogs = await store.listChangelogs(workspaceId);
  const repositoryIds = new Set(
    repositories.map((repository) => repository.id),
  );
  const connectedRepositoryCount = new Set(
    changelogs
      .filter((changelog) => repositoryIds.has(changelog.repositoryId))
      .map((changelog) => changelog.repositoryId),
  ).size;
  const usagePeriod = getBillingUsagePeriod(
    entitlements.accessSource === "complimentary" ? null : subscription,
  );
  const pullRequestsThisPeriod =
    await store.countProcessedPullRequestsForWorkspaceRange(workspaceId, {
      startedAt: usagePeriod.startedAt,
      endedAt: usagePeriod.usageEndedAt,
    });
  const aiTokensThisPeriod = await store.sumAiTokensForWorkspaceRange(
    workspaceId,
    {
      startedAt: usagePeriod.startedAt,
      endedAt: usagePeriod.usageEndedAt,
    },
  );

  return {
    details: {
      enabled: config.billingEnabled,
      billingMode: workspace?.billingMode ?? "self-hosted",
      planId: entitlements.hosted ? entitlements.id : null,
      accessSource: entitlements.accessSource,
      complimentaryAccess:
        entitlements.accessSource === "complimentary"
          ? {
              planId: entitlements.id,
              expiresAt: entitlements.complimentaryExpiresAt,
            }
          : null,
      entitlements: {
        aiGeneration: entitlements.aiGeneration,
        scheduledPublishing: entitlements.scheduledPublishing,
        customDomain: entitlements.customDomain,
        customBranding: entitlements.customBranding,
      },
      repositoryLimit: entitlements.repositoryLimit,
      usage: {
        connectedRepositories: connectedRepositoryCount,
        pullRequestsThisPeriod,
        aiCreditsThisPeriod: aiTokensThisPeriod / 1_000,
        includedCredits: entitlements.monthlyIncludedCredits,
        periodStartedAt: usagePeriod.startedAt,
        periodEndedAt: usagePeriod.endedAt,
      },
    },
    subscription,
    workspace,
  };
}

async function handleStripeWebhookEvent({
  event,
  store,
  stripe,
  config,
  billingEmailSender,
}: {
  event: Stripe.Event;
  store: Store;
  stripe: ReturnType<typeof createStripeClient>;
  config: ReturnType<typeof loadConfig>;
  billingEmailSender: BillingEmailSender | null;
}): Promise<void> {
  if (!stripe) {
    return;
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode !== "subscription") {
      return;
    }

    const subscription = await resolveCheckoutSessionSubscription({
      session,
      stripe,
    });

    if (!subscription) {
      return;
    }
    let checkoutSubscription = subscription;

    await processClaimedStripeEvent({
      event,
      store,
      subjectId: checkoutSubscription.id,
      process: async () => {
        checkoutSubscription = await ensureSubscriptionUsagePrice({
          stripe,
          subscription: checkoutSubscription,
        });
        const synced = await syncStripeSubscription({
          store,
          subscription: checkoutSubscription,
          workspaceIdOverride: session.metadata?.workspaceId ?? null,
          billingEmailOverride: session.customer_details?.email ?? undefined,
        });
        if (synced?.billingEmail) {
          await notifyBillingLifecycle({
            store,
            sender: billingEmailSender,
            config,
            workspaceId: synced.workspaceId,
            dedupeKey: session.id,
            type: "subscription_started",
            recipient: synced.billingEmail,
            planId: synced.planId,
          });
        }
      },
    });
    return;
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted" ||
    event.type === "customer.subscription.paused" ||
    event.type === "customer.subscription.resumed" ||
    event.type === "customer.subscription.trial_will_end"
  ) {
    let subscription = event.data.object as Stripe.Subscription;
    await processClaimedStripeEvent({
      event,
      store,
      subjectId: subscription.id,
      process: async () => {
        const previousStored =
          await store.getBillingSubscriptionByStripeSubscriptionId(
            subscription.id,
          );
        const previous = previousStored ? { ...previousStored } : null;
        if (
          event.type !== "customer.subscription.deleted" &&
          event.type !== "customer.subscription.trial_will_end" &&
          isEntitledSubscriptionStatus(subscription.status)
        ) {
          subscription = await ensureSubscriptionUsagePrice({
            stripe,
            subscription,
          });
        }
        const billingEmail = await resolveSubscriptionBillingEmail({
          stripe,
          subscription,
          existing: previous?.billingEmail ?? null,
          shouldRetrieve: Boolean(billingEmailSender),
        });
        const synced = await syncStripeSubscription({
          store,
          subscription,
          billingEmailOverride: billingEmail ?? undefined,
        });
        if (synced?.billingEmail) {
          await notifySubscriptionTransition({
            event,
            previous,
            current: synced,
            store,
            sender: billingEmailSender,
            config,
          });
        }
      },
    });
    return;
  }

  if (
    event.type === "invoice.payment_failed" ||
    event.type === "invoice.payment_action_required" ||
    event.type === "invoice.paid" ||
    event.type === "invoice.finalization_failed"
  ) {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = getInvoiceSubscriptionId(invoice);
    if (!subscriptionId) return;
    await processClaimedStripeEvent({
      event,
      store,
      subjectId: invoice.id,
      process: async () => {
        const previousStored =
          await store.getBillingSubscriptionByStripeSubscriptionId(
            subscriptionId,
          );
        const previous = previousStored ? { ...previousStored } : null;
        const subscription =
          await stripe.subscriptions.retrieve(subscriptionId);
        const synced = await syncStripeSubscription({
          store,
          subscription,
          workspaceIdOverride: previous?.workspaceId,
          billingEmailOverride:
            invoice.customer_email ?? previous?.billingEmail ?? undefined,
          lastPaymentFailedAtOverride:
            event.type === "invoice.payment_failed"
              ? new Date(event.created * 1000).toISOString()
              : event.type === "invoice.paid"
                ? null
                : undefined,
        });
        if (!synced?.billingEmail) return;
        const type =
          event.type === "invoice.payment_failed"
            ? "payment_failed"
            : event.type === "invoice.payment_action_required"
              ? "payment_action_required"
              : event.type === "invoice.finalization_failed"
                ? "invoice_finalization_failed"
                : previous?.lastPaymentFailedAt ||
                    previous?.status === "past_due" ||
                    previous?.status === "unpaid"
                  ? "payment_recovered"
                  : null;
        if (!type) return;
        await notifyBillingLifecycle({
          store,
          sender: billingEmailSender,
          config,
          workspaceId: synced.workspaceId,
          dedupeKey: invoice.id,
          type,
          recipient: synced.billingEmail,
          planId: synced.planId,
          nextPaymentAttempt:
            invoice.next_payment_attempt != null
              ? new Date(invoice.next_payment_attempt * 1000).toISOString()
              : null,
        });
      },
    });
    return;
  }

  if (event.type === "customer.updated") {
    const customer = event.data.object as Stripe.Customer;
    const existing = await store.getBillingSubscriptionByStripeCustomerId(
      customer.id,
    );
    if (!existing) return;
    await processClaimedStripeEvent({
      event,
      store,
      subjectId: customer.id,
      process: async () => {
        const subscription = await stripe.subscriptions.retrieve(
          existing.stripeSubscriptionId,
        );
        await syncStripeSubscription({
          store,
          subscription,
          workspaceIdOverride: existing.workspaceId,
          billingEmailOverride: customer.email ?? existing.billingEmail,
        });
      },
    });
  }
}

async function processClaimedStripeEvent({
  event,
  store,
  subjectId,
  process,
}: {
  event: Stripe.Event;
  store: Store;
  subjectId: string;
  process: () => Promise<void>;
}): Promise<void> {
  const claim = await store.claimWebhookEvent({
    provider: "stripe",
    eventId: event.id,
    subjectId,
    eventType: event.type,
    createdAt: new Date(event.created * 1000).toISOString(),
  });
  if (claim === "completed") return;
  if (claim === "busy") {
    throw new Error("This webhook event is already being processed.");
  }
  try {
    await process();
    await store.completeWebhookEvent("stripe", event.id);
  } catch (error) {
    await store.failWebhookEvent(
      "stripe",
      event.id,
      error instanceof Error ? error.message : "Unknown webhook error",
    );
    throw error;
  }
}

async function resolveCheckoutSessionSubscription({
  session,
  stripe,
}: {
  session: Stripe.Checkout.Session;
  stripe: NonNullable<ReturnType<typeof createStripeClient>>;
}): Promise<Stripe.Subscription | null> {
  if (!session.subscription) {
    return null;
  }

  if (typeof session.subscription !== "string") {
    return session.subscription;
  }

  return stripe.subscriptions.retrieve(session.subscription);
}

async function syncStripeSubscription({
  store,
  subscription,
  workspaceIdOverride,
  billingEmailOverride,
  lastPaymentFailedAtOverride,
}: {
  store: Store;
  subscription: Stripe.Subscription;
  workspaceIdOverride?: string | null;
  billingEmailOverride?: string | null;
  lastPaymentFailedAtOverride?: string | null;
}): Promise<Awaited<ReturnType<Store["getBillingSubscription"]>>> {
  const existing = await store.getBillingSubscriptionByStripeSubscriptionId(
    subscription.id,
  );
  const workspaceId =
    workspaceIdOverride ??
    subscription.metadata?.workspaceId ??
    existing?.workspaceId;
  const customerId = getStripeObjectId(subscription.customer);
  const resolvedPlan = getSubscriptionPlan(subscription);

  if (!workspaceId || !customerId || !resolvedPlan) {
    return null;
  }

  const complimentaryGrant =
    await store.getActiveComplimentaryAccessGrant(workspaceId);
  if (complimentaryGrant) return existing;

  const entitlements = getHostedPlanEntitlements(resolvedPlan.planId);
  const repositoryLimit = entitlements.repositoryLimit;
  const effectiveRepositoryLimit = isEntitledSubscriptionStatus(
    subscription.status,
  )
    ? repositoryLimit
    : getFreeRepositoryLimit();

  await store.updateWorkspaceBilling({
    workspaceId,
    billingMode: "hosted",
    repositoryLimit: effectiveRepositoryLimit,
    stripeCustomerId: customerId,
  });

  return store.upsertBillingSubscription({
    workspaceId,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId,
    status: subscription.status,
    planId: resolvedPlan.planId,
    billingCadence: resolvedPlan.billingCadence,
    priceId: resolvedPlan.basePrice.id,
    repositoryLimit,
    currentPeriodStart: getSubscriptionCurrentPeriodStart(
      subscription,
      resolvedPlan.usageItem,
    ),
    currentPeriodEnd: getSubscriptionCurrentPeriodEnd(
      subscription,
      resolvedPlan.usageItem,
    ),
    billingEmail:
      billingEmailOverride === undefined
        ? (existing?.billingEmail ?? null)
        : billingEmailOverride,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    cancelAt: toStripeTimestamp(subscription.cancel_at),
    endedAt: toStripeTimestamp(subscription.ended_at),
    lastPaymentFailedAt:
      lastPaymentFailedAtOverride === undefined
        ? (existing?.lastPaymentFailedAt ?? null)
        : lastPaymentFailedAtOverride,
    autoRechargeEnabled: subscription.metadata?.autoRechargeEnabled !== "false",
  });
}

async function resolveSubscriptionBillingEmail({
  stripe,
  subscription,
  existing,
  shouldRetrieve,
}: {
  stripe: NonNullable<ReturnType<typeof createStripeClient>>;
  subscription: Stripe.Subscription;
  existing: string | null;
  shouldRetrieve: boolean;
}): Promise<string | null> {
  if (typeof subscription.customer !== "string") {
    return "deleted" in subscription.customer
      ? existing
      : (subscription.customer.email ?? existing);
  }
  if (existing || !shouldRetrieve) return existing;
  try {
    const customer = await stripe.customers.retrieve(subscription.customer);
    return "deleted" in customer ? null : customer.email;
  } catch {
    return null;
  }
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription;
  return subscription ? getStripeObjectId(subscription) : null;
}

function toStripeTimestamp(value: number | null | undefined): string | null {
  return typeof value === "number"
    ? new Date(value * 1000).toISOString()
    : null;
}

async function notifySubscriptionTransition(input: {
  event: Stripe.Event;
  previous: BillingSubscription | null;
  current: BillingSubscription;
  store: Store;
  sender: BillingEmailSender | null;
  config: ReturnType<typeof loadConfig>;
}): Promise<void> {
  const shared = {
    store: input.store,
    sender: input.sender,
    config: input.config,
    workspaceId: input.current.workspaceId,
    dedupeKey: input.event.id,
    recipient: input.current.billingEmail ?? "",
    planId: input.current.planId,
  };

  if (input.event.type === "customer.subscription.trial_will_end") {
    await notifyBillingLifecycle({ ...shared, type: "trial_ending" });
    return;
  }
  if (input.event.type === "customer.subscription.deleted") {
    await notifyBillingLifecycle({ ...shared, type: "subscription_canceled" });
    return;
  }
  if (!input.previous) return;

  if (
    input.previous.planId !== input.current.planId ||
    input.previous.billingCadence !== input.current.billingCadence
  ) {
    await notifyBillingLifecycle({ ...shared, type: "plan_changed" });
  }
  if (!input.previous.cancelAtPeriodEnd && input.current.cancelAtPeriodEnd) {
    await notifyBillingLifecycle({
      ...shared,
      type: "cancellation_scheduled",
      effectiveAt: input.current.cancelAt ?? input.current.currentPeriodEnd,
    });
  } else if (
    input.previous.cancelAtPeriodEnd &&
    !input.current.cancelAtPeriodEnd
  ) {
    await notifyBillingLifecycle({ ...shared, type: "cancellation_reversed" });
  }

  const previousAccess = getSubscriptionAccessState(input.previous.status);
  const currentAccess = getSubscriptionAccessState(input.current.status);
  if (
    (previousAccess === "active" || previousAccess === "grace") &&
    currentAccess === "restricted"
  ) {
    await notifyBillingLifecycle({ ...shared, type: "account_restricted" });
  } else if (
    previousAccess === "restricted" &&
    (currentAccess === "active" || currentAccess === "grace")
  ) {
    await notifyBillingLifecycle({ ...shared, type: "account_restored" });
  }
}

async function notifyBillingLifecycle(input: {
  store: Store;
  sender: BillingEmailSender | null;
  config: ReturnType<typeof loadConfig>;
  workspaceId: string;
  dedupeKey: string;
  type: BillingNotificationType;
  recipient: string;
  planId: string;
  effectiveAt?: string | null;
  nextPaymentAttempt?: string | null;
}): Promise<void> {
  const billingUrl = new URL(
    "/changelog/billing",
    input.config.appUrl,
  ).toString();
  const planName = input.planId.charAt(0).toUpperCase() + input.planId.slice(1);
  const content = getBillingNotificationContent({
    type: input.type,
    planName,
    billingUrl,
    effectiveAt: input.effectiveAt,
    nextPaymentAttempt: input.nextPaymentAttempt,
  });
  await sendBillingNotification({
    store: input.store,
    sender: input.sender,
    workspaceId: input.workspaceId,
    dedupeKey: input.dedupeKey,
    type: input.type,
    email: { to: input.recipient, ...content },
  });
}

function getBillingNotificationContent(input: {
  type: BillingNotificationType;
  planName: string;
  billingUrl: string;
  effectiveAt?: string | null;
  nextPaymentAttempt?: string | null;
}): Omit<BillingEmail, "to"> {
  const manage = {
    actionLabel: "Manage billing",
    actionUrl: input.billingUrl,
  };
  const effectiveDate = formatBillingNotificationDate(input.effectiveAt);
  const retryDate = formatBillingNotificationDate(input.nextPaymentAttempt);
  switch (input.type) {
    case "subscription_started":
      return {
        subject: `Your ${input.planName} plan is ready`,
        headline: "You’re all set",
        message: `Your ${input.planName} plan is active and its included credits and features are ready to use.`,
        ...manage,
      };
    case "plan_changed":
      return {
        subject: `Your plan changed to ${input.planName}`,
        headline: "Your plan has changed",
        message: `Your workspace is now on the ${input.planName} plan. Your limits and included credits have been updated.`,
        ...manage,
      };
    case "payment_failed":
      return {
        subject: "We couldn’t process your Cooee payment",
        headline: "Your payment didn’t go through",
        message:
          "Your paid features remain available during the retry period. Please check your payment method to avoid an interruption.",
        detail: retryDate ? `The next automatic retry is ${retryDate}.` : null,
        ...manage,
      };
    case "payment_action_required":
      return {
        subject: "Your Cooee payment needs confirmation",
        headline: "One more step is needed",
        message:
          "Your bank needs you to confirm this payment. Open billing to complete it and keep your plan current.",
        ...manage,
      };
    case "payment_recovered":
      return {
        subject: "Your Cooee payment is back on track",
        headline: "Payment received",
        message:
          "Your latest payment was successful. Your account is current and no further action is needed.",
        ...manage,
      };
    case "invoice_finalization_failed":
      return {
        subject: "There’s a problem preparing your Cooee invoice",
        headline: "We need updated billing details",
        message:
          "We couldn’t prepare your latest invoice. Please review your billing details so future payments can be collected.",
        ...manage,
      };
    case "cancellation_scheduled":
      return {
        subject: "Your Cooee plan is scheduled to end",
        headline: "Cancellation scheduled",
        message: `Your ${input.planName} plan will remain available until the end of the current billing period.`,
        detail: effectiveDate
          ? `Paid access is scheduled to end ${effectiveDate}.`
          : null,
        ...manage,
      };
    case "cancellation_reversed":
      return {
        subject: "Your Cooee plan will continue",
        headline: "Cancellation undone",
        message: `Your ${input.planName} plan will continue and renew normally.`,
        ...manage,
      };
    case "subscription_canceled":
      return {
        subject: "Your Cooee plan has ended",
        headline: "Your paid plan has ended",
        message:
          "Your workspace has moved to Free. Your existing changelog remains available, but paid features and limits no longer apply.",
        ...manage,
      };
    case "account_restricted":
      return {
        subject: "Paid Cooee features have been paused",
        headline: "Your account needs attention",
        message:
          "Paid features have been paused because the subscription is no longer current. Update billing to restore access.",
        ...manage,
      };
    case "account_restored":
      return {
        subject: "Your Cooee access has been restored",
        headline: "You’re back in business",
        message: `Your ${input.planName} features and limits are available again.`,
        ...manage,
      };
    case "trial_ending":
      return {
        subject: "Your Cooee trial is ending soon",
        headline: "Your trial is nearly over",
        message:
          "Check your payment details now so your plan can continue without interruption.",
        ...manage,
      };
  }
}

function formatBillingNotificationDate(value?: string | null): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "long",
    timeZone: "Australia/Brisbane",
  }).format(new Date(value));
}

function getStripeObjectId(
  value: string | { id?: string } | null,
): string | null {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : (value.id ?? null);
}

function getSubscriptionCurrentPeriodEnd(
  subscription: Stripe.Subscription,
  preferredItem: Stripe.SubscriptionItem | null = null,
): string | null {
  const value =
    (preferredItem as { current_period_end?: number | null } | null)
      ?.current_period_end ??
    (subscription as { current_period_end?: number | null })
      .current_period_end ??
    (subscription.items.data[0] as { current_period_end?: number | null })
      ?.current_period_end;
  return typeof value === "number"
    ? new Date(value * 1000).toISOString()
    : null;
}

function getSubscriptionCurrentPeriodStart(
  subscription: Stripe.Subscription,
  preferredItem: Stripe.SubscriptionItem | null = null,
): string | null {
  const value =
    (preferredItem as { current_period_start?: number | null } | null)
      ?.current_period_start ??
    (subscription as { current_period_start?: number | null })
      .current_period_start ??
    (subscription.items.data[0] as { current_period_start?: number | null })
      ?.current_period_start;
  return typeof value === "number"
    ? new Date(value * 1000).toISOString()
    : null;
}

function getBillingUsagePeriod(
  subscription: Awaited<ReturnType<Store["getBillingSubscription"]>>,
  now = new Date(),
): { startedAt: string; endedAt: string; usageEndedAt: string } {
  const currentPeriodEnd = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd)
    : null;
  const currentPeriodStart = subscription?.currentPeriodStart
    ? new Date(subscription.currentPeriodStart)
    : null;
  const startedAt =
    currentPeriodStart ??
    (currentPeriodEnd
      ? addUtcMonths(currentPeriodEnd, -1)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const endedAt =
    currentPeriodEnd ??
    new Date(
      Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth() + 1, 1),
    );
  const usageEndedAt = now < endedAt ? now : endedAt;

  return {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    usageEndedAt: usageEndedAt.toISOString(),
  };
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + months,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

function getFreeRepositoryLimit(): number {
  return getHostedPlanEntitlements("free").repositoryLimit;
}

function canWorkspaceMemberAccess(method: string, pathname: string): boolean {
  if (method === "GET") {
    return ![
      "/api/admin/github/install",
      "/api/github/callback",
      "/api/onboarding/github",
    ].includes(pathname);
  }

  if (!pathname.startsWith("/api/admin/changelog-entries")) {
    return (
      /^\/api\/admin\/changelogs\/[^/]+\/(entries|generate|generate-historical)$/.test(
        pathname,
      ) && method === "POST"
    );
  }

  return ["POST", "PATCH", "DELETE"].includes(method);
}

function parseBillingPlanId(
  value: string | undefined,
): BillingPlanId | undefined {
  return isHostedPaidPlanId(value) ? value : undefined;
}

function parseBillingCadence(
  value: string | undefined,
): BillingCadence | undefined {
  return isBillingCadence(value) ? value : undefined;
}

async function resolveBillingManagement({
  config,
  customerId,
  stripe,
}: {
  config: ReturnType<typeof loadConfig>;
  customerId: string;
  stripe: ReturnType<typeof createStripeClient>;
}): Promise<{
  state: "available" | "recovery_required" | "unavailable";
  url: string | null;
}> {
  try {
    const url = await createPortalUrl({
      stripe,
      config,
      customerId,
    });
    return {
      state: url ? "available" : "unavailable",
      url,
    };
  } catch (error) {
    return {
      state: isMissingBillingCustomerError(error)
        ? "recovery_required"
        : "unavailable",
      url: null,
    };
  }
}

async function isBillingCustomerUnavailable({
  customerId,
  stripe,
}: {
  customerId: string;
  stripe: ReturnType<typeof createStripeClient>;
}): Promise<boolean> {
  if (!stripe) return false;

  try {
    const customer = await stripe.customers.retrieve(customerId);
    return Boolean("deleted" in customer && customer.deleted);
  } catch (error) {
    return isMissingBillingCustomerError(error);
  }
}

function isMissingBillingCustomerError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    code?: unknown;
    param?: unknown;
    raw?: { code?: unknown; param?: unknown };
  };
  const code = candidate.code ?? candidate.raw?.code;
  const param = candidate.param ?? candidate.raw?.param;

  return code === "resource_missing" && (param === "customer" || !param);
}

function getBillingProviderErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;

  const candidate = error as {
    code?: unknown;
    raw?: { code?: unknown };
  };
  const code = candidate.code ?? candidate.raw?.code;
  return typeof code === "string" ? code : null;
}

async function syncStoredGitHubInstallations({
  githubClient,
  installationIds,
  store,
  workspaceId,
}: {
  githubClient: GitHubAppClient;
  installationIds: number[];
  store: Store;
  workspaceId: string;
}) {
  const synced = [];

  for (const installationId of new Set(installationIds)) {
    synced.push(
      await syncGitHubInstallation({
        githubClient,
        installationId,
        store,
        workspaceId,
      }),
    );
  }

  return synced;
}

async function syncGitHubInstallation({
  githubClient,
  installationId,
  store,
  workspaceId,
}: {
  githubClient: GitHubAppClient;
  installationId: number;
  store: Store;
  workspaceId: string;
}) {
  const synced = await githubClient.syncInstallation(installationId);
  const installation = await store.upsertGitHubInstallation({
    workspaceId,
    installationId: synced.installation.installationId,
    accountLogin: synced.installation.accountLogin,
    accountType: synced.installation.accountType,
    suspendedAt: synced.installation.suspendedAt,
  });
  const repositories = await store.upsertGitHubRepositories({
    workspaceId,
    githubInstallationId: installation.id,
    repositories: synced.repositories.map((repository) => ({
      ...repository,
      workspaceId,
      githubInstallationId: installation.id,
    })),
  });

  return {
    installation,
    repositories: repositories.map((repository) =>
      serializeGitHubRepository({
        changelogs: [],
        installations: [installation],
        repository,
      }),
    ),
  };
}

async function selectRepositoryForChangelog({
  appUrl,
  repositoryId,
  store,
  workspaceId,
}: {
  appUrl: string;
  repositoryId: string;
  store: Store;
  workspaceId: string;
}) {
  const repositories = await store.listRepositories(workspaceId);
  const repository = repositories.find((item) => item.id === repositoryId);

  if (!repository) {
    return null;
  }

  const changelogs = await store.listChangelogs(workspaceId);
  const existing = changelogs.find(
    (changelog) => changelog.repositoryId === repository.id,
  );
  const workspace = await store.getWorkspace(workspaceId);
  const entitlements = await getWorkspaceEntitlements(store, workspaceId);
  if (
    !existing &&
    workspace &&
    !canConnectRepository({
      billingMode: workspace.billingMode,
      connectedRepositories: new Set(
        changelogs.map((changelog) => changelog.repositoryId),
      ).size,
      repositoryLimit: entitlements.repositoryLimit,
    })
  ) {
    throw json(
      { error: "Your repository limit has been reached." },
      { status: 409 },
    );
  }
  const slug =
    existing?.slug ??
    (await allocateUniqueChangelogSlug({
      requestedSlug: slugifyRepository(repository.fullName),
      store,
    }));
  const workspaceSettings = normalizeWorkspaceSettings(
    await store.getWorkspaceSettings(workspaceId),
    getDefaultAppName(repositories),
  );
  const changelog =
    existing ??
    (await store.createChangelog({
      workspaceId,
      repositoryId: repository.id,
      slug,
      name: repository.name,
      description: `Latest updates from ${repository.fullName}`,
      publicUrl: `${trimTrailingSlash(appUrl)}/changelog/${slug}`,
      customDomain: null,
      repositoryLimit:
        workspace?.billingMode === "hosted"
          ? entitlements.repositoryLimit
          : null,
      settings: {
        skipLabels: ["cooee:skip", "cooee:internal"],
        sensitiveLabels: ["security", "vulnerability"],
        categoryDefinitions: defaultChangelogCategoryDefinitions,
        groupEntriesByCategory: true,
        scheduleFrequency: workspaceSettings.scheduleFrequency,
        scheduleWeekday: workspaceSettings.scheduleWeekday,
        scheduleMonthDay: workspaceSettings.scheduleMonthDay,
        publishTime: workspaceSettings.publishTime,
        timeZone: workspaceSettings.timeZone,
        includePullRequestLinks: workspaceSettings.includePullRequestLinks,
        publicTheme: workspaceSettings.publicTheme,
      },
    }));
  if (!changelog) {
    throw json(
      { error: "Your repository limit has been reached." },
      { status: 409 },
    );
  }
  const installations = await store.listGitHubInstallations(workspaceId);

  return {
    changelog: serializeChangelog(changelog),
    repository: serializeGitHubRepository({
      changelogs: [changelog],
      installations,
      repository,
    }),
  };
}

function serializeGitHubRepository({
  changelogs,
  installations,
  repository,
}: {
  changelogs: StoredChangelog[];
  installations: GitHubInstallation[];
  repository: GitHubRepository;
}) {
  const installation = installations.find(
    (item) => item.id === repository.githubInstallationId,
  );
  const changelog = changelogs.find(
    (item) => item.repositoryId === repository.id,
  );

  return {
    id: repository.id,
    fullName: repository.fullName,
    owner: repository.owner,
    name: repository.name,
    private: repository.private,
    installationId: installation?.installationId ?? null,
    accountLogin: installation?.accountLogin ?? null,
    selected: Boolean(changelog),
    changelogId: changelog?.id ?? null,
    changelogSlug: changelog?.slug ?? null,
  };
}

function serializeChangelog(changelog: StoredChangelog) {
  return {
    id: changelog.id,
    workspaceId: changelog.workspaceId,
    repositoryId: changelog.repositoryId,
    repository: changelog.repository,
    slug: changelog.slug,
    name: changelog.name,
    description: changelog.description ?? "",
    publicUrl: changelog.publicUrl,
    customDomain: changelog.customDomain,
    customHostnameStatus: changelog.customHostnameStatus,
    customHostnameSslStatus: changelog.customHostnameSslStatus,
  };
}

function paginateAdminChangelogEntries(
  entries: StoredEntry[],
  searchParams: URLSearchParams,
  timeZone: string,
  categoryDefinitions = defaultChangelogCategoryDefinitions,
) {
  const query = searchParams.get("query")?.trim().toLowerCase() ?? "";
  const date = normalizeDateFilter(searchParams.get("date"));
  const from = normalizeDateFilter(searchParams.get("from"));
  const to = normalizeDateFilter(searchParams.get("to"));
  const limit = readInteger(searchParams.get("limit"), 10, 1, 50);
  const requestedPage = readInteger(searchParams.get("page"), 1, 1, 100000);
  const filteredEntries = entries
    .filter(
      (entry): entry is StoredEntry & { publishedAt: string } =>
        entry.status === "published" && typeof entry.publishedAt === "string",
    )
    .filter((entry) => adminEntryMatchesQuery(entry, query))
    .filter((entry) =>
      adminEntryMatchesDate(entry, { date, from, timeZone, to }),
    )
    .sort(
      (a, b) =>
        b.publishedAt.localeCompare(a.publishedAt) ||
        compareChangelogCategories(a.category, b.category, categoryDefinitions),
    );
  const total = filteredEntries.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * limit;

  return {
    entries: filteredEntries
      .slice(offset, offset + limit)
      .map(serializeAdminChangelogEntry),
    heldEntries: entries
      .filter(
        (entry) => entry.status === "held" && !isLabelSkippedHeldEntry(entry),
      )
      .sort((a, b) => b.windowEndedAt.localeCompare(a.windowEndedAt))
      .map(serializeAdminChangelogEntry),
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
}

function isLabelSkippedHeldEntry(entry: StoredEntry) {
  return entry.holdReason?.startsWith("skip-label") ?? false;
}

async function getReviewableHeldEntryCount(input: {
  store: Store;
  workspaceId: string;
}): Promise<number> {
  const changelogs = await input.store.listChangelogs(input.workspaceId);
  const entriesByChangelog = await Promise.all(
    changelogs.map((changelog) => input.store.listEntries(changelog.id)),
  );

  return entriesByChangelog
    .flat()
    .filter(
      (entry) => entry.status === "held" && !isLabelSkippedHeldEntry(entry),
    ).length;
}

function serializeAdminChangelogEntry(entry: StoredEntry) {
  return {
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    category: entry.category,
    status: entry.status,
    publishedAt: entry.publishedAt,
    processedAt: entry.processedAt ?? null,
    windowEndedAt: entry.windowEndedAt,
    imageUrl: entry.imageUrl ?? null,
    holdReason: entry.holdReason ?? null,
    items: entry.items ?? [],
    sourcePullRequests: entry.sourcePullRequests,
  };
}

function adminEntryMatchesQuery(entry: StoredEntry, query: string): boolean {
  if (!query) {
    return true;
  }

  return [
    entry.title,
    entry.summary,
    entry.category,
    ...(entry.items ?? []).flatMap((item) => [
      item.title,
      item.summary,
      item.category,
    ]),
  ].some((value) => value.toLowerCase().includes(query));
}

function adminEntryMatchesDate(
  entry: StoredEntry & { publishedAt: string },
  filters: {
    date: string | null;
    from: string | null;
    timeZone: string;
    to: string | null;
  },
): boolean {
  const publishedDate = formatDateInTimeZone(
    entry.publishedAt,
    filters.timeZone,
  );

  if (filters.date && publishedDate !== filters.date) {
    return false;
  }

  if (filters.from && publishedDate < filters.from) {
    return false;
  }

  if (filters.to && publishedDate > filters.to) {
    return false;
  }

  return true;
}

function normalizeDateFilter(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function formatDateInTimeZone(value: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    }).formatToParts(new Date(value));
    const lookup = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );

    if (lookup.year && lookup.month && lookup.day) {
      return `${lookup.year}-${lookup.month}-${lookup.day}`;
    }
  } catch {
    // Fall back to the stored UTC date if the configured timezone is invalid.
  }

  return value.slice(0, 10);
}

function serializeChangelogSettings(
  changelog: StoredChangelog,
  workspaceSettings: WorkspaceSettings,
  customHostnameCnameTarget: string,
) {
  return {
    ...workspaceSettings,
    appName: changelog.name,
    includePullRequestLinks: changelog.settings.includePullRequestLinks,
    publicTheme: changelog.settings.publicTheme,
    categoryDefinitions: changelog.settings.categoryDefinitions,
    groupEntriesByCategory: changelog.settings.groupEntriesByCategory,
    scheduleFrequency: changelog.settings.scheduleFrequency,
    scheduleWeekday: changelog.settings.scheduleWeekday ?? 1,
    scheduleMonthDay: changelog.settings.scheduleMonthDay ?? 1,
    publishTime: changelog.settings.publishTime,
    timeZone: changelog.settings.timeZone,
    publicSlug: changelog.slug,
    customDomain: changelog.customDomain ?? "",
    customHostnameStatus: changelog.customHostnameStatus ?? "",
    customHostnameSslStatus: changelog.customHostnameSslStatus ?? "",
    customHostnameCnameTarget,
    privacyLabels: labelListToString([
      ...changelog.settings.skipLabels,
      ...changelog.settings.sensitiveLabels,
    ]),
  };
}

async function assertCustomDomainEntitlement(input: {
  customDomain: string | null;
  store: Store;
  workspaceId: string;
}): Promise<void> {
  if (!input.customDomain) return;
  await assertWorkspaceEntitlement({
    store: input.store,
    workspaceId: input.workspaceId,
    capability: "customDomain",
    message: "A paid plan is required to use a custom domain.",
  });
}

async function assertAiFeatureEntitlement(
  store: Store,
  workspaceId: string,
): Promise<void> {
  await assertWorkspaceEntitlement({
    store,
    workspaceId,
    capability: "aiGeneration",
    message: "A paid plan is required to use AI features.",
  });
}

async function provisionChangelogCustomHostname({
  changelog,
  cnameTarget,
  customDomain,
  provisioner,
}: {
  changelog: StoredChangelog;
  cnameTarget: string;
  customDomain: string | null;
  provisioner: CustomHostnameProvisioner | null;
}): Promise<{
  customHostnameId: string | null;
  customHostnameStatus: string | null;
  customHostnameSslStatus: string | null;
}> {
  if (!customDomain) {
    if (changelog.customHostnameId) {
      await provisioner?.deleteCustomHostname?.(changelog.customHostnameId);
    }

    return {
      customHostnameId: null,
      customHostnameStatus: null,
      customHostnameSslStatus: null,
    };
  }

  if (customDomain === changelog.customDomain && changelog.customHostnameId) {
    return {
      customHostnameId: changelog.customHostnameId,
      customHostnameStatus: changelog.customHostnameStatus,
      customHostnameSslStatus: changelog.customHostnameSslStatus,
    };
  }

  if (!provisioner) {
    return {
      customHostnameId: null,
      customHostnameStatus: `cname ${cnameTarget}`,
      customHostnameSslStatus: null,
    };
  }

  const provisioned = await provisioner.createCustomHostname({
    hostname: customDomain,
  });

  return {
    customHostnameId: provisioned.id,
    customHostnameStatus: provisioned.status,
    customHostnameSslStatus: provisioned.sslStatus,
  };
}

function normalizeChangelogSettings({
  appUrl,
  changelog,
  input,
  slug,
  workspaceSettings,
}: {
  appUrl: string;
  changelog: StoredChangelog;
  input: unknown;
  slug: string;
  workspaceSettings: WorkspaceSettings;
}): {
  description: string;
  name: string;
  publicUrl: string;
  customDomain: string | null;
  settings: ChangelogSettings;
  slug: string;
  workspaceSettings: WorkspaceSettings;
} {
  const settings = isRecord(input) ? input : {};
  const requestedWorkspaceSettings = normalizeWorkspaceSettings(
    {
      ...workspaceSettings,
      ...settings,
    },
    workspaceSettings.appName || "Cooee",
  );
  const labels = readLabelList(
    settings.privacyLabels,
    labelListToString([
      ...changelog.settings.skipLabels,
      ...changelog.settings.sensitiveLabels,
    ]),
  );
  const customDomain = readRequestedCustomDomain(settings.customDomain);

  return {
    description: changelog.description ?? "",
    name: readString(settings.appName, changelog.name).trim() || changelog.name,
    publicUrl: getChangelogPublicUrl({ appUrl, customDomain, slug }),
    customDomain,
    settings: {
      skipLabels: labels,
      sensitiveLabels: [],
      categoryDefinitions: normalizeChangelogCategoryDefinitions(
        settings.categoryDefinitions,
        changelog.settings.categoryDefinitions,
      ),
      groupEntriesByCategory: readBoolean(
        settings.groupEntriesByCategory,
        changelog.settings.groupEntriesByCategory,
      ),
      scheduleFrequency: readEnum(
        settings.scheduleFrequency,
        ["daily", "weekly", "monthly", "on-merge"],
        changelog.settings.scheduleFrequency,
      ),
      scheduleWeekday: readInteger(
        settings.scheduleWeekday,
        changelog.settings.scheduleWeekday ?? 1,
        0,
        6,
      ),
      scheduleMonthDay: readInteger(
        settings.scheduleMonthDay,
        changelog.settings.scheduleMonthDay ?? 1,
        1,
        31,
      ),
      publishTime: readString(
        settings.publishTime,
        changelog.settings.publishTime,
      ),
      timeZone: readString(settings.timeZone, changelog.settings.timeZone),
      includePullRequestLinks: readBoolean(
        settings.includePullRequestLinks,
        changelog.settings.includePullRequestLinks,
      ),
      publicTheme: readEnum(
        settings.publicTheme,
        ["light", "dark"],
        changelog.settings.publicTheme,
      ),
    },
    slug,
    workspaceSettings: {
      ...requestedWorkspaceSettings,
      appName: workspaceSettings.appName,
      includePullRequestLinks: workspaceSettings.includePullRequestLinks,
      publicTheme: workspaceSettings.publicTheme,
      logoAssetKey: workspaceSettings.logoAssetKey,
      logoDataUrl: null,
      logoUrl: workspaceSettings.logoUrl,
      lightLogoAssetKey: workspaceSettings.lightLogoAssetKey,
      lightLogoDataUrl: null,
      lightLogoUrl: workspaceSettings.lightLogoUrl,
      faviconAssetKey: workspaceSettings.faviconAssetKey,
      faviconDataUrl: null,
      faviconUrl: workspaceSettings.faviconUrl,
      scheduleFrequency: workspaceSettings.scheduleFrequency,
      scheduleWeekday: workspaceSettings.scheduleWeekday,
      scheduleMonthDay: workspaceSettings.scheduleMonthDay,
      publishTime: workspaceSettings.publishTime,
      timeZone: workspaceSettings.timeZone,
      publicSlug: workspaceSettings.publicSlug,
      customDomain: workspaceSettings.customDomain,
      privacyLabels: workspaceSettings.privacyLabels,
    },
  };
}

function readRequestedChangelogSlug(input: unknown, fallback: string): string {
  const settings = isRecord(input) ? input : {};
  return slugifyRepository(readString(settings.publicSlug, fallback));
}

function slugifyRepository(fullName: string): string {
  return (
    fullName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "repository"
  );
}

async function allocateUniqueChangelogSlug({
  currentChangelogId,
  requestedSlug,
  store,
}: {
  currentChangelogId?: string;
  requestedSlug: string;
  store: Store;
}): Promise<string> {
  const baseSlug = slugifyRepository(requestedSlug);
  const existing = await store.getChangelogBySlug(baseSlug);
  if (!existing || existing.id === currentChangelogId) {
    return baseSlug;
  }

  let suffix = 2;
  while (true) {
    const candidate = `${baseSlug}-${suffix}`;
    const matching = await store.getChangelogBySlug(candidate);
    if (!matching || matching.id === currentChangelogId) {
      return candidate;
    }

    suffix += 1;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function getChangelogPublicUrl({
  appUrl,
  customDomain,
  slug,
}: {
  appUrl: string;
  customDomain: string | null;
  slug: string;
}): string {
  return customDomain
    ? `https://${customDomain}`
    : `${trimTrailingSlash(appUrl)}/changelog/${slug}`;
}

function readCustomDomain(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const domain = trimmed
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  if (
    !domain ||
    domain.includes(":") ||
    domain.length > 253 ||
    !/^[a-z0-9.-]+$/.test(domain) ||
    domain.split(".").some((part) => !part || part.length > 63) ||
    !domain.includes(".")
  ) {
    return null;
  }

  return domain;
}

function readRequestedCustomDomain(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const domain = readCustomDomain(value);
  if (!domain) {
    throw json(
      {
        error:
          "Enter a valid custom domain subdomain, such as changelog.example.com.",
      },
      { status: 400 },
    );
  }

  if (domain.split(".").length < 3) {
    throw json(
      {
        error:
          "Custom domains must be subdomains, such as changelog.example.com. Apex domains are not supported.",
      },
      { status: 400 },
    );
  }

  return domain;
}

function requestHost(request: Request): string | null {
  return readCustomDomain(
    request.headers.get("x-cooee-custom-host") ??
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      new URL(request.url).host,
  );
}

function getCanonicalCooeeRedirect(url: URL, request: Request): string | null {
  if (
    (request.method !== "GET" && request.method !== "HEAD") ||
    requestHost(request) !== "www.cooee.sh"
  ) {
    return null;
  }

  return new URL(`${url.pathname}${url.search}`, "https://cooee.sh").toString();
}

async function storeMergedPullRequestWebhook({
  payload,
  store,
}: {
  payload: string;
  store: Store;
}): Promise<void> {
  const parsed = safeJsonParse(payload);
  const pullRequest = parseMergedPullRequestWebhook(parsed);

  if (!pullRequest) {
    return;
  }

  const storedPullRequest = await store.upsertPullRequest(pullRequest);
  if (!storedPullRequest) {
    return;
  }

  const changelog = await store.getChangelogByRepositoryFullName(
    pullRequest.repositoryFullName,
  );
  if (!changelog || changelog.settings.scheduleFrequency !== "on-merge") {
    return;
  }

  const windowStartedAt = new Date(storedPullRequest.mergedAt);
  const windowEndedAt = new Date(
    windowStartedAt.getTime() + Math.max(1, storedPullRequest.number),
  );

  await store.enqueueMergeGenerationJob({
    changelogId: changelog.id,
    pullRequestNumber: storedPullRequest.number,
    windowStartedAt: windowStartedAt.toISOString(),
    windowEndedAt: windowEndedAt.toISOString(),
  });
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseMergedPullRequestWebhook(
  payload: unknown,
): { repositoryFullName: string; pullRequest: PullRequestMetadata } | null {
  if (!isRecord(payload) || payload.action !== "closed") {
    return null;
  }

  const repository = payload.repository;
  const pullRequest = payload.pull_request;

  if (!isRecord(repository) || !isRecord(pullRequest)) {
    return null;
  }

  const repositoryFullName = readString(repository.full_name, "");
  const mergedAt = readString(pullRequest.merged_at, "");

  if (
    !repositoryFullName ||
    pullRequest.merged !== true ||
    !mergedAt ||
    Number.isNaN(Date.parse(mergedAt))
  ) {
    return null;
  }

  return {
    repositoryFullName,
    pullRequest: {
      id: `github_${readNumber(pullRequest.id, pullRequest.number)}`,
      number: readNumber(pullRequest.number, 0),
      title: readString(pullRequest.title, "Untitled pull request"),
      body: readString(pullRequest.body, ""),
      labels: Array.isArray(pullRequest.labels)
        ? pullRequest.labels
            .map((label) => (isRecord(label) ? readString(label.name, "") : ""))
            .filter(Boolean)
        : [],
      mergedAt: new Date(mergedAt).toISOString(),
      url: stripUrlQuery(readString(pullRequest.html_url, "")),
      repository: repositoryFullName,
      author: isRecord(pullRequest.user)
        ? readString(pullRequest.user.login, "")
        : undefined,
    },
  };
}

async function uploadWorkspaceLogo({
  assetStorage,
  request,
  store,
  workspaceId,
}: {
  assetStorage: AssetStorage | null;
  request: Request;
  store: Store;
  workspaceId: string;
}): Promise<Response> {
  if (!assetStorage) {
    return json(
      { error: "Logo asset storage is not configured." },
      { status: 503 },
    );
  }

  const form = await request.formData().catch(() => null);
  const logo = form?.get("logo");

  if (!(logo instanceof File)) {
    return json({ error: "Logo file is required." }, { status: 400 });
  }

  const contentType = logo.type.toLowerCase().split(";")[0].trim();
  const extension = logoContentTypes.get(contentType);

  if (!extension) {
    return json(
      { error: "Logo must be a PNG, JPEG, WebP, GIF, or SVG image." },
      { status: 415 },
    );
  }

  if (logo.size > maxLogoSizeBytes) {
    return json({ error: "Logo must be 512 KB or smaller." }, { status: 413 });
  }

  const body = new Uint8Array(await logo.arrayBuffer());

  if (contentType === "image/svg+xml") {
    const validationError = validateSvgLogo(body);
    if (validationError) {
      return json({ error: validationError }, { status: 400 });
    }
  }

  const key = `workspaces/${workspaceId}/logo/${crypto.randomUUID()}.${extension}`;
  const repositories = await store.listRepositories(workspaceId);
  const existingSettings = normalizeWorkspaceSettings(
    await store.getWorkspaceSettings(workspaceId),
    getDefaultAppName(repositories),
  );

  await assetStorage.putObject({
    body,
    contentType,
    key,
  });

  const saved = await store.updateWorkspaceSettings(workspaceId, {
    ...existingSettings,
    logoAssetKey: key,
    logoDataUrl: null,
    logoUrl: publicLogoUrl(workspaceId),
  });

  if (
    existingSettings.logoAssetKey &&
    existingSettings.logoAssetKey !== key &&
    assetStorage.deleteObject
  ) {
    await assetStorage.deleteObject(existingSettings.logoAssetKey);
  }

  return json({
    settings: normalizeWorkspaceSettings(
      saved,
      getDefaultAppName(repositories),
    ),
  });
}

async function deleteWorkspaceLogo({
  assetStorage,
  store,
  workspaceId,
}: {
  assetStorage: AssetStorage | null;
  store: Store;
  workspaceId: string;
}): Promise<Response> {
  const repositories = await store.listRepositories(workspaceId);
  const existingSettings = normalizeWorkspaceSettings(
    await store.getWorkspaceSettings(workspaceId),
    getDefaultAppName(repositories),
  );

  if (existingSettings.logoAssetKey && assetStorage?.deleteObject) {
    await assetStorage.deleteObject(existingSettings.logoAssetKey);
  }

  const saved = await store.updateWorkspaceSettings(workspaceId, {
    ...existingSettings,
    logoAssetKey: null,
    logoDataUrl: null,
    logoUrl: null,
  });

  return json({
    settings: normalizeWorkspaceSettings(
      saved,
      getDefaultAppName(repositories),
    ),
  });
}

type CustomBrandAssetKind = "lightLogo" | "favicon";

async function uploadWorkspaceBrandAsset({
  assetStorage,
  kind,
  request,
  store,
  workspaceId,
}: {
  assetStorage: AssetStorage | null;
  kind: CustomBrandAssetKind;
  request: Request;
  store: Store;
  workspaceId: string;
}): Promise<Response> {
  const label = kind === "lightLogo" ? "Light mode logo" : "Favicon";
  if (!assetStorage) {
    return json(
      { error: `${label} asset storage is not configured.` },
      { status: 503 },
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get(kind === "lightLogo" ? "logo" : "favicon");
  if (!(file instanceof File)) {
    return json({ error: `${label} file is required.` }, { status: 400 });
  }

  const contentType = file.type.toLowerCase().split(";")[0].trim();
  const supportedTypes =
    kind === "lightLogo" ? logoContentTypes : faviconContentTypes;
  const extension = supportedTypes.get(contentType);
  if (!extension) {
    return json(
      {
        error:
          kind === "lightLogo"
            ? "Light mode logo must be a PNG, JPEG, WebP, GIF, or SVG image."
            : "Favicon must be a PNG, SVG, or ICO image.",
      },
      { status: 415 },
    );
  }

  const maxSize = kind === "lightLogo" ? maxLogoSizeBytes : maxFaviconSizeBytes;
  if (file.size > maxSize) {
    return json(
      {
        error: `${label} must be ${kind === "lightLogo" ? "512" : "256"} KB or smaller.`,
      },
      { status: 413 },
    );
  }

  const body = new Uint8Array(await file.arrayBuffer());
  if (contentType === "image/svg+xml") {
    const validationError = validateSvgLogo(body);
    if (validationError) {
      return json(
        { error: validationError.replaceAll("logo", label.toLowerCase()) },
        { status: 400 },
      );
    }
  }

  const assetPath = kind === "lightLogo" ? "light-logo" : "favicon";
  const key = `workspaces/${workspaceId}/${assetPath}/${crypto.randomUUID()}.${extension}`;
  const repositories = await store.listRepositories(workspaceId);
  const existingSettings = normalizeWorkspaceSettings(
    await store.getWorkspaceSettings(workspaceId),
    getDefaultAppName(repositories),
  );

  await assetStorage.putObject({ body, contentType, key });
  const previousKey =
    kind === "lightLogo"
      ? existingSettings.lightLogoAssetKey
      : existingSettings.faviconAssetKey;
  const saved = await store.updateWorkspaceSettings(workspaceId, {
    ...existingSettings,
    ...(kind === "lightLogo"
      ? {
          lightLogoAssetKey: key,
          lightLogoDataUrl: null,
          lightLogoUrl: publicLightLogoUrl(workspaceId, key),
        }
      : {
          faviconAssetKey: key,
          faviconDataUrl: null,
          faviconUrl: publicFaviconUrl(workspaceId, key),
        }),
  });

  if (previousKey && previousKey !== key && assetStorage.deleteObject) {
    await assetStorage.deleteObject(previousKey);
  }

  return json({
    settings: normalizeWorkspaceSettings(
      saved,
      getDefaultAppName(repositories),
    ),
  });
}

async function deleteWorkspaceBrandAsset({
  assetStorage,
  kind,
  store,
  workspaceId,
}: {
  assetStorage: AssetStorage | null;
  kind: CustomBrandAssetKind;
  store: Store;
  workspaceId: string;
}): Promise<Response> {
  const repositories = await store.listRepositories(workspaceId);
  const existingSettings = normalizeWorkspaceSettings(
    await store.getWorkspaceSettings(workspaceId),
    getDefaultAppName(repositories),
  );
  const key =
    kind === "lightLogo"
      ? existingSettings.lightLogoAssetKey
      : existingSettings.faviconAssetKey;
  if (key && assetStorage?.deleteObject) {
    await assetStorage.deleteObject(key);
  }

  const saved = await store.updateWorkspaceSettings(workspaceId, {
    ...existingSettings,
    ...(kind === "lightLogo"
      ? {
          lightLogoAssetKey: null,
          lightLogoDataUrl: null,
          lightLogoUrl: null,
        }
      : {
          faviconAssetKey: null,
          faviconDataUrl: null,
          faviconUrl: null,
        }),
  });

  return json({
    settings: normalizeWorkspaceSettings(
      saved,
      getDefaultAppName(repositories),
    ),
  });
}

async function publicWorkspaceLogo({
  assetStorage,
  store,
  workspaceId,
}: {
  assetStorage: AssetStorage | null;
  store: Store;
  workspaceId: string;
}): Promise<Response> {
  if (!assetStorage) {
    return json({ error: "Logo not found" }, { status: 404 });
  }

  const settings = normalizeWorkspaceSettings(
    await store.getWorkspaceSettings(workspaceId),
  );

  if (!settings.publicChangelog || !settings.logoAssetKey) {
    return json({ error: "Logo not found" }, { status: 404 });
  }

  const logo = await assetStorage.getObject(settings.logoAssetKey);

  if (!logo) {
    return json({ error: "Logo not found" }, { status: 404 });
  }

  const headers = new Headers({
    "cache-control": "public, max-age=3600",
    "content-type": logo.contentType,
  });
  if (logo.contentType.toLowerCase().split(";")[0].trim() === "image/svg+xml") {
    headers.set(
      "content-security-policy",
      "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
    );
  }

  return new Response(toArrayBuffer(logo.body), { headers });
}

async function publicWorkspaceBrandAsset({
  assetStorage,
  kind,
  store,
  workspaceId,
}: {
  assetStorage: AssetStorage | null;
  kind: CustomBrandAssetKind;
  store: Store;
  workspaceId: string;
}): Promise<Response> {
  if (!assetStorage) {
    return json({ error: "Brand asset not found" }, { status: 404 });
  }

  const settings = normalizeWorkspaceSettings(
    await store.getWorkspaceSettings(workspaceId),
  );
  const key =
    kind === "lightLogo"
      ? settings.lightLogoAssetKey
      : settings.faviconAssetKey;
  if (!settings.publicChangelog || !key) {
    return json({ error: "Brand asset not found" }, { status: 404 });
  }

  const asset = await assetStorage.getObject(key);
  if (!asset) {
    return json({ error: "Brand asset not found" }, { status: 404 });
  }

  const headers = new Headers({
    "cache-control": "public, max-age=3600",
    "content-type": asset.contentType,
  });
  if (
    asset.contentType.toLowerCase().split(";")[0].trim() === "image/svg+xml"
  ) {
    headers.set(
      "content-security-policy",
      "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
    );
  }

  return new Response(toArrayBuffer(asset.body), { headers });
}

async function publicChangelogLogo({
  assetStorage,
  slug,
  store,
}: {
  assetStorage: AssetStorage | null;
  slug: string;
  store: Store;
}): Promise<Response> {
  const changelog = await store.getChangelogBySlug(slug);
  if (!changelog) {
    return json({ error: "Logo not found" }, { status: 404 });
  }

  return publicWorkspaceLogo({
    assetStorage,
    store,
    workspaceId: changelog.workspaceId,
  });
}

async function uploadChangelogEntryImage({
  assetStorage,
  entryId,
  request,
  store,
  workspaceId,
}: {
  assetStorage: AssetStorage | null;
  entryId: string;
  request: Request;
  store: Store;
  workspaceId: string;
}): Promise<Response> {
  if (!assetStorage) {
    return json(
      { error: "Post image asset storage is not configured." },
      { status: 503 },
    );
  }

  const form = await request.formData().catch(() => null);
  const image = form?.get("image");

  if (!(image instanceof File)) {
    return json({ error: "Image file is required." }, { status: 400 });
  }

  const selected = await findWorkspaceEntry({ entryId, store, workspaceId });
  if (!selected) {
    return json({ error: "Changelog entry not found" }, { status: 404 });
  }

  const selectedCategory =
    normalizeChangelogCategory(form?.get("category")) ??
    selected.entry.category;
  const categoryDefinition = getChangelogCategoryDefinition(
    selectedCategory,
    selected.changelog.settings.categoryDefinitions,
  );

  if (categoryDefinition.displayType !== "post") {
    return json(
      { error: "Entry category is not configured as a post" },
      { status: 409 },
    );
  }

  const contentType = image.type.toLowerCase().split(";")[0].trim();
  if (!postImageContentTypes.has(contentType)) {
    return json(
      { error: "Post image must be a PNG, JPEG, WebP, or GIF image." },
      { status: 415 },
    );
  }

  if (image.size > maxPostImageSizeBytes) {
    return json(
      { error: "Post image must be 3 MB or smaller." },
      { status: 413 },
    );
  }

  const body = new Uint8Array(await image.arrayBuffer());
  const key = postImageAssetKey(workspaceId, entryId);
  const imageUrl = publicPostImageUrl(workspaceId, entryId);

  await assetStorage.putObject({
    body,
    contentType,
    key,
  });

  const entry = await store.updateEntryImage({
    entryId,
    imageUrl,
    workspaceId,
  });

  if (!entry) {
    return json({ error: "Changelog entry not found" }, { status: 404 });
  }

  return json(serializeAdminChangelogEntry(entry));
}

async function publicChangelogEntryImage({
  assetStorage,
  changelogId,
  entryId,
  store,
  workspaceId,
}: {
  assetStorage: AssetStorage | null;
  changelogId?: string;
  entryId: string;
  store: Store;
  workspaceId: string;
}): Promise<Response> {
  if (!assetStorage) {
    return json({ error: "Post image not found" }, { status: 404 });
  }

  const selected = await findWorkspaceEntry({ entryId, store, workspaceId });
  const expectedUrl = publicPostImageUrl(workspaceId, entryId);
  const settings = normalizeWorkspaceSettings(
    await store.getWorkspaceSettings(workspaceId),
  );
  if (
    !settings.publicChangelog ||
    !selected ||
    (changelogId !== undefined && selected.changelog.id !== changelogId) ||
    selected.entry.status !== "published" ||
    !selected.entry.publishedAt ||
    !Number.isFinite(Date.parse(selected.entry.publishedAt)) ||
    Date.parse(selected.entry.publishedAt) > Date.now()
  ) {
    return json({ error: "Post image not found" }, { status: 404 });
  }

  if (selected.entry.imageUrl !== expectedUrl) {
    const legacyImage = await readGeneratedPostImage(
      selected.entry.imageUrl ?? "",
      false,
    );
    if (!legacyImage) {
      return json({ error: "Post image not found" }, { status: 404 });
    }

    await assetStorage.putObject({
      ...legacyImage,
      key: postImageAssetKey(workspaceId, entryId),
    });
    const migratedEntry = await store.updateEntryImage({
      entryId,
      imageUrl: expectedUrl,
      workspaceId,
    });
    if (!migratedEntry) {
      return json({ error: "Post image not found" }, { status: 404 });
    }

    return postImageResponse(legacyImage);
  }

  const image = await assetStorage.getObject(
    postImageAssetKey(workspaceId, entryId),
  );
  if (!image) {
    return json({ error: "Post image not found" }, { status: 404 });
  }

  return postImageResponse(image);
}

function postImageResponse(image: {
  body: Uint8Array;
  contentType: string;
}): Response {
  return new Response(toArrayBuffer(image.body), {
    headers: new Headers({
      "cache-control": "public, max-age=3600",
      "content-type": image.contentType,
    }),
  });
}

async function publicChangelogEntryImageBySlug({
  assetStorage,
  entryId,
  slug,
  store,
}: {
  assetStorage: AssetStorage | null;
  entryId: string;
  slug: string;
  store: Store;
}): Promise<Response> {
  const changelog = await store.getChangelogBySlug(slug);
  if (!changelog) {
    return json({ error: "Post image not found" }, { status: 404 });
  }

  const entry = (await store.listEntries(changelog.id)).find(
    (candidate) => candidate.id === entryId,
  );
  if (!entry) {
    return json({ error: "Post image not found" }, { status: 404 });
  }

  return publicChangelogEntryImage({
    assetStorage,
    changelogId: changelog.id,
    entryId,
    store,
    workspaceId: changelog.workspaceId,
  });
}

async function findWorkspaceEntry({
  entryId,
  store,
  workspaceId,
}: {
  entryId: string;
  store: Store;
  workspaceId: string;
}): Promise<{ changelog: StoredChangelog; entry: StoredEntry } | null> {
  const changelogs = await store.listChangelogs(workspaceId);

  for (const changelog of changelogs) {
    const entry = (await store.listEntries(changelog.id)).find(
      (item) => item.id === entryId,
    );
    if (entry) {
      return { changelog, entry };
    }
  }

  return null;
}

function validateSvgLogo(body: Uint8Array): string | null {
  let svg: string;
  try {
    svg = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return "SVG logo must be valid UTF-8 text.";
  }

  if (!/<\s*svg(?:\s|>)/i.test(svg)) {
    return "SVG logo must contain an SVG root element.";
  }

  const unsafePatterns: Array<[RegExp, string]> = [
    [/<\s*script(?:\s|>)/i, "SVG logos cannot contain scripts."],
    [/<\s*foreignObject(?:\s|>)/i, "SVG logos cannot contain foreignObject."],
    [
      /<\s*(?:iframe|object|embed|audio|video|canvas|link)(?:\s|>)/i,
      "SVG logos cannot contain embedded active content.",
    ],
    [/<\s*image(?:\s|>)/i, "SVG logos cannot embed external images."],
    [/\son[a-z]+\s*=/i, "SVG logos cannot contain event handlers."],
    [/\bjavascript\s*:/i, "SVG logos cannot contain javascript URLs."],
    [/@import\b/i, "SVG logos cannot import external styles."],
    [/\burl\(\s*(?!['"]?#)/i, "SVG logos cannot reference external URLs."],
    [
      /\b(?:href|xlink:href)\s*=\s*["']\s*(?!#)/i,
      "SVG logos can only reference internal SVG fragments.",
    ],
  ];

  for (const [pattern, message] of unsafePatterns) {
    if (pattern.test(svg)) {
      return message;
    }
  }

  return null;
}

function publicLogoUrl(workspaceId: string): string {
  return `/api/public/workspaces/${encodeURIComponent(workspaceId)}/logo`;
}

function publicLightLogoUrl(workspaceId: string, assetKey?: string): string {
  return versionPublicAssetUrl(
    `/api/public/workspaces/${encodeURIComponent(workspaceId)}/light-logo`,
    assetKey,
  );
}

function publicFaviconUrl(workspaceId: string, assetKey?: string): string {
  return versionPublicAssetUrl(
    `/api/public/workspaces/${encodeURIComponent(workspaceId)}/favicon`,
    assetKey,
  );
}

function publicChangelogLogoUrl(slug: string): string {
  return `/api/public/changelogs/${encodeURIComponent(slug)}/logo`;
}

function publicChangelogLightLogoUrl(slug: string, assetKey?: string): string {
  return versionPublicAssetUrl(
    `/api/public/changelogs/${encodeURIComponent(slug)}/light-logo`,
    assetKey,
  );
}

function publicChangelogFaviconUrl(slug: string, assetKey?: string): string {
  return versionPublicAssetUrl(
    `/api/public/changelogs/${encodeURIComponent(slug)}/favicon`,
    assetKey,
  );
}

function versionPublicAssetUrl(path: string, assetKey?: string): string {
  if (!assetKey) return path;

  let hash = 2166136261;
  for (let index = 0; index < assetKey.length; index += 1) {
    hash ^= assetKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${path}?v=${(hash >>> 0).toString(36)}`;
}

function postImageAssetKey(workspaceId: string, entryId: string): string {
  return `workspaces/${workspaceId}/changelog-entries/${entryId}/image`;
}

function publicPostImageUrl(workspaceId: string, entryId: string): string {
  return `/api/public/workspaces/${encodeURIComponent(workspaceId)}/changelog-entries/${encodeURIComponent(entryId)}/image`;
}

function publicChangelogPostImageUrl(slug: string, entryId: string): string {
  return `/api/public/changelogs/${encodeURIComponent(slug)}/entries/${encodeURIComponent(entryId)}/image`;
}

function getPostImageGenerationAvailability(
  imageGenerator: AiImageGenerator,
): { available: true } | { available: false; reason: string } {
  if (!imageGenerator.disabledReason) {
    return { available: true };
  }

  return {
    available: false,
    reason: postImageGenerationNotConfiguredMessage,
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function publicFeed(
  store: Store,
  slug: string,
  searchParams: URLSearchParams = new URLSearchParams(),
  limit?: number,
): Promise<Response> {
  const changelog = await store.getChangelogBySlug(slug);

  if (!changelog) {
    return json({ error: "Changelog not found" }, { status: 404 });
  }

  return publicFeedForChangelog(store, changelog, searchParams, limit);
}

async function publicFeedByHost(
  store: Store,
  request: Request,
  searchParams: URLSearchParams = new URL(request.url).searchParams,
  limit?: number,
): Promise<Response> {
  const host = requestHost(request);
  const changelog = host ? await store.getChangelogByCustomDomain(host) : null;

  if (!changelog) {
    return json({ error: "Changelog not found" }, { status: 404 });
  }

  return publicFeedForChangelog(store, changelog, searchParams, limit);
}

async function publicRssFeed(
  store: Store,
  slug: string,
  searchParams: URLSearchParams = new URLSearchParams(),
): Promise<Response> {
  return publicRssResponse(await publicFeed(store, slug, searchParams));
}

async function publicRssFeedByHost(
  store: Store,
  request: Request,
  searchParams: URLSearchParams = new URL(request.url).searchParams,
): Promise<Response> {
  return publicRssResponse(
    await publicFeedByHost(store, request, searchParams),
  );
}

async function publicRssResponse(feedResponse: Response): Promise<Response> {
  if (!feedResponse.ok) {
    return feedResponse;
  }

  const feed = publicFeedSchema.parse(await feedResponse.json());
  return xml(renderRssFeed(feed), { headers: publicFeedCacheHeaders });
}

async function publicFeedForChangelog(
  store: Store,
  changelog: StoredChangelog,
  searchParams: URLSearchParams,
  limit?: number,
): Promise<Response> {
  const query = parsePublicFeedQuery(searchParams);
  if (!query.success) {
    return json({ error: query.error }, { status: 400 });
  }

  const publicUrl = changelog.customDomain
    ? `https://${changelog.customDomain}`
    : changelog.publicUrl;

  const workspaceSettings = normalizeWorkspaceSettings(
    await store.getWorkspaceSettings(changelog.workspaceId),
  );
  if (!workspaceSettings.publicChangelog) {
    return json({ error: "Changelog not found" }, { status: 404 });
  }
  const entries = await store.listEntries(changelog.id);
  const feedWindow = getPublicFeedWindow(
    entries,
    changelog.settings.scheduleFrequency,
    query.data.before,
  );
  const feed = publicFeedSchema.parse(
    serializePublicFeed({
      changelog: {
        slug: changelog.slug,
        name: changelog.name,
        description: changelog.description,
        publicUrl,
        logoUrl: resolvePublicAssetUrl(
          workspaceSettings.logoAssetKey
            ? publicChangelogLogoUrl(changelog.slug)
            : workspaceSettings.logoUrl,
          publicUrl,
        ),
        lightLogoUrl: resolvePublicAssetUrl(
          workspaceSettings.lightLogoAssetKey
            ? publicChangelogLightLogoUrl(
                changelog.slug,
                workspaceSettings.lightLogoAssetKey,
              )
            : workspaceSettings.lightLogoUrl,
          publicUrl,
        ),
        faviconUrl: resolvePublicAssetUrl(
          workspaceSettings.faviconAssetKey
            ? publicChangelogFaviconUrl(
                changelog.slug,
                workspaceSettings.faviconAssetKey,
              )
            : workspaceSettings.faviconUrl,
          publicUrl,
        ),
        publicTheme: changelog.settings.publicTheme,
        publicLogoAlignment: workspaceSettings.publicLogoAlignment,
        publicAppUrl: workspaceSettings.publicAppUrl,
        publicAppLabel: workspaceSettings.publicAppLabel,
        categoryDefinitions: changelog.settings.categoryDefinitions,
        groupEntriesByCategory: changelog.settings.groupEntriesByCategory,
      },
      entries: feedWindow.entries
        .slice(0, limit ?? feedWindow.entries.length)
        .map((entry) => ({
          ...entry,
          imageUrl: resolvePublicAssetUrl(
            entry.imageUrl
              ? publicChangelogPostImageUrl(changelog.slug, entry.id)
              : null,
            publicUrl,
          ),
        })),
      includePullRequestLinks: changelog.settings.includePullRequestLinks,
      pagination: feedWindow.pagination,
    }),
  );

  return json(feed, { headers: publicFeedCacheHeaders });
}

function resolvePublicAssetUrl(
  assetUrl: string | null | undefined,
  publicUrl: string,
): string | null {
  if (!assetUrl) {
    return null;
  }

  try {
    const publicOrigin = new URL(publicUrl).origin;
    const resolved = new URL(assetUrl, `${publicOrigin}/`);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.toString()
      : null;
  } catch {
    return null;
  }
}

function getPublicFeedWindow(
  entries: StoredEntry[],
  frequency: ChangelogSettings["scheduleFrequency"],
  before: string | null,
): { entries: StoredEntry[]; pagination: PublicFeedPagination } {
  const now = new Date();
  const publishedEntries = entries
    .map((entry) => ({ entry, publishedAt: parsePublicFeedDate(entry) }))
    .filter(
      (
        item,
      ): item is {
        entry: StoredEntry;
        publishedAt: Date;
      } => Boolean(item.publishedAt),
    )
    .filter(({ publishedAt }) => publishedAt.getTime() <= now.getTime())
    .sort(
      (left, right) => right.publishedAt.getTime() - left.publishedAt.getTime(),
    );

  if (publishedEntries.length === 0) {
    return {
      entries: [],
      pagination: {
        hasMore: false,
        nextBefore: null,
        windowEndedAt: null,
        windowStartedAt: null,
      },
    };
  }

  const cursorDate = parsePublicFeedCursor(before);
  const windowEndedAt = cursorDate ?? publishedEntries[0].publishedAt;
  const windowStartedAt = subtractPublicFeedWindow(windowEndedAt, frequency);
  const windowEntries = publishedEntries
    .filter(({ publishedAt }) => {
      const timestamp = publishedAt.getTime();
      const windowEndTimestamp = windowEndedAt.getTime();
      return (
        timestamp >= windowStartedAt.getTime() &&
        (cursorDate
          ? timestamp < windowEndTimestamp
          : timestamp <= windowEndTimestamp)
      );
    })
    .map(({ entry }) => entry);
  const hasMore = publishedEntries.some(
    ({ publishedAt }) => publishedAt.getTime() < windowStartedAt.getTime(),
  );

  return {
    entries: windowEntries,
    pagination: {
      hasMore,
      nextBefore: hasMore ? windowStartedAt.toISOString() : null,
      windowEndedAt: windowEndedAt.toISOString(),
      windowStartedAt: windowStartedAt.toISOString(),
    },
  };
}

function parsePublicFeedDate(entry: StoredEntry): Date | null {
  if (entry.status !== "published" || !entry.publishedAt) {
    return null;
  }

  return parsePublicFeedCursor(entry.publishedAt);
}

function parsePublicFeedCursor(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function subtractPublicFeedWindow(
  date: Date,
  frequency: ChangelogSettings["scheduleFrequency"],
): Date {
  if (frequency === "monthly") {
    return subtractUtcMonths(date, 3);
  }

  const days = frequency === "weekly" ? 28 : 7;
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

function subtractUtcMonths(date: Date, months: number): Date {
  const result = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() - months,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
  const lastDayOfMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();

  result.setUTCDate(Math.min(date.getUTCDate(), lastDayOfMonth));
  return result;
}

async function servePublicChangelogShell({
  pathname,
  request,
  staticRoot,
  store,
}: {
  pathname: string;
  request: Request;
  staticRoot: string;
  store: Store;
}): Promise<Response | null> {
  const changelog = await getPublicChangelogForShell(store, request, pathname);

  if (!changelog) {
    return null;
  }

  const fallback = Bun.file(`${staticRoot}/index.html`);
  if (!(await fallback.exists())) {
    return null;
  }

  const html = await fallback.text();
  const body = injectPublicChangelogSeoMetadata(
    html,
    await getPublicChangelogSeoMetadata(changelog, request, store),
  );

  return secureResponse(
    new Response(request.method === "HEAD" ? null : body, {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  );
}

async function serveDeveloperDocsShell({
  pathname,
  request,
  staticRoot,
}: {
  pathname: string;
  request: Request;
  staticRoot: string;
}): Promise<Response | null> {
  if (pathname !== "/docs" && pathname !== "/docs/") {
    return null;
  }

  const fallback = Bun.file(`${staticRoot}/index.html`);
  if (!(await fallback.exists())) {
    return null;
  }

  const html = await fallback.text();
  const body = injectPublicChangelogSeoMetadata(html, {
    title: "Cooee Developer Docs",
    description:
      "Integrate Cooee changelogs with React, the public API, and MCP.",
    publicUrl: `${getCanonicalRequestOrigin(request)}/docs`,
    theme: "light",
  });

  return secureResponse(
    new Response(request.method === "HEAD" ? null : body, {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  );
}

const trustPageSeoMetadata: Record<
  string,
  { description: string; title: string }
> = {
  "/privacy": {
    title: "Privacy Policy",
    description:
      "What information Cooee handles, why it is needed, and what can become public.",
  },
  "/terms": {
    title: "Terms of Use",
    description:
      "The practical terms that apply when you use Cooee's hosted service.",
  },
  "/cookies": {
    title: "Cookies",
    description:
      "How Cooee uses essential storage and optional analytics cookies.",
  },
  "/security": {
    title: "Security",
    description:
      "How Cooee limits sensitive data, where the boundaries are, and how to report a vulnerability.",
  },
};

async function serveTrustPageShell({
  pathname,
  request,
  staticRoot,
}: {
  pathname: string;
  request: Request;
  staticRoot: string;
}): Promise<Response | null> {
  const normalizedPathname = pathname.endsWith("/")
    ? pathname.slice(0, -1) || "/"
    : pathname;
  const metadata = trustPageSeoMetadata[normalizedPathname];

  if (!metadata) {
    return null;
  }

  const fallback = Bun.file(`${staticRoot}/index.html`);
  if (!(await fallback.exists())) {
    return null;
  }

  const html = await fallback.text();
  const body = injectPublicChangelogSeoMetadata(html, {
    title: `${metadata.title} | Cooee`,
    description: metadata.description,
    publicUrl: `${getCanonicalRequestOrigin(request)}${normalizedPathname}`,
    theme: "light",
  });

  return secureResponse(
    new Response(request.method === "HEAD" ? null : body, {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  );
}

function getCanonicalRequestOrigin(request: Request): string {
  const url = new URL(request.url);
  if (
    url.protocol === "https:" ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]"
  ) {
    return url.origin;
  }

  return `https://${url.host}`;
}

async function getPublicChangelogForShell(
  store: Store,
  request: Request,
  pathname: string,
): Promise<StoredChangelog | null> {
  const slug = getPublicChangelogShellSlug(pathname);

  if (slug) {
    const changelog = await store.getChangelogBySlug(slug);
    return changelog && (await isPublicChangelogEnabled(store, changelog))
      ? changelog
      : null;
  }

  if (pathname !== "/") {
    return null;
  }

  const host = requestHost(request);
  const changelog = host ? await store.getChangelogByCustomDomain(host) : null;
  return changelog && (await isPublicChangelogEnabled(store, changelog))
    ? changelog
    : null;
}

async function isDisabledPublicChangelogRequest(input: {
  pathname: string;
  request: Request;
  store: Store;
}): Promise<boolean> {
  const slug = getPublicChangelogShellSlug(input.pathname);
  let changelog: StoredChangelog | null = null;
  if (slug) {
    changelog = await input.store.getChangelogBySlug(slug);
  } else if (input.pathname === "/") {
    const host = requestHost(input.request);
    changelog = host
      ? await input.store.getChangelogByCustomDomain(host)
      : null;
  }
  return Boolean(
    changelog && !(await isPublicChangelogEnabled(input.store, changelog)),
  );
}

async function isPublicChangelogEnabled(
  store: Store,
  changelog: StoredChangelog,
): Promise<boolean> {
  return normalizeWorkspaceSettings(
    await store.getWorkspaceSettings(changelog.workspaceId),
  ).publicChangelog;
}

function getPublicChangelogShellSlug(pathname: string): string | null {
  const match = /^\/changelog\/([^/]+)\/?$/.exec(pathname);
  if (!match) {
    return null;
  }

  try {
    const slug = decodeURIComponent(match[1]);
    return adminChangelogViewSegments.has(slug) ? null : slug;
  } catch {
    return null;
  }
}

const adminChangelogViewSegments = new Set([
  "dashboard",
  "repositories",
  "privacy",
  "billing",
  "settings",
]);

function getLegacyAdminRedirectPath(pathname: string): string | null {
  const match = /^\/app(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!match) {
    return null;
  }

  const view = match[1];
  if (!view || view === "dashboard") {
    return "/changelog";
  }

  return adminChangelogViewSegments.has(view) ? `/changelog/${view}` : null;
}

async function getPublicChangelogSeoMetadata(
  changelog: StoredChangelog,
  request: Request,
  store: Store,
): Promise<{
  title: string;
  description: string;
  publicUrl: string | null;
  theme: "light" | "dark";
  faviconUrl: string | null;
}> {
  const publicUrl = changelog.customDomain
    ? `https://${changelog.customDomain}`
    : changelog.publicUrl;
  const workspaceSettings = normalizeWorkspaceSettings(
    await store.getWorkspaceSettings(changelog.workspaceId),
  );

  return {
    title: getPublicChangelogSeoTitle(changelog.name),
    description: getPublicChangelogSeoDescription(
      changelog.name,
      changelog.description,
    ),
    publicUrl: normalizePublicChangelogSeoUrl(publicUrl),
    theme: getPublicChangelogShellTheme(
      request,
      changelog.settings.publicTheme,
    ),
    faviconUrl: resolvePublicAssetUrl(
      workspaceSettings.faviconAssetKey
        ? publicChangelogFaviconUrl(
            changelog.slug,
            workspaceSettings.faviconAssetKey,
          )
        : workspaceSettings.faviconUrl,
      publicUrl,
    ),
  };
}

function injectPublicChangelogSeoMetadata(
  html: string,
  metadata: {
    title: string;
    description: string;
    publicUrl: string | null;
    theme: "light" | "dark";
    faviconUrl?: string | null;
  },
): string {
  const tags = renderPublicChangelogSeoTags(metadata);
  const withoutExistingMetadata = injectPublicChangelogInitialTheme(
    html,
    metadata.theme,
  )
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(
      /<meta\s+(?:name|property)=["'](?:description|og:locale|og:site_name|og:type|og:title|og:description|og:url|og:image|og:image:type|og:image:width|og:image:height|og:image:alt|twitter:card|twitter:title|twitter:description|twitter:image|twitter:image:alt)["'][^>]*>\s*/gi,
      "",
    )
    .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, "");

  const withoutExistingFavicon = metadata.faviconUrl
    ? withoutExistingMetadata.replace(
        /<link\s+[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*>\s*/gi,
        "",
      )
    : withoutExistingMetadata;

  if (/<head[^>]*>/i.test(withoutExistingFavicon)) {
    return withoutExistingFavicon.replace(
      /<head([^>]*)>/i,
      `<head$1>\n${tags}`,
    );
  }

  return `<!doctype html><html data-theme="${metadata.theme}"><head>${tags}</head><body>${withoutExistingFavicon}</body></html>`;
}

function injectPublicChangelogInitialTheme(
  html: string,
  theme: "light" | "dark",
): string {
  if (!/<html\b/i.test(html)) {
    return html;
  }

  return html.replace(/<html([^>]*)>/i, (_match, attributes: string) => {
    const cleanAttributes = attributes.replace(
      /\sdata-theme=(?:"[^"]*"|'[^']*'|[^\s>]*)/i,
      "",
    );
    return `<html${cleanAttributes} data-theme="${theme}">`;
  });
}

function renderPublicChangelogSeoTags({
  title,
  description,
  publicUrl,
  faviconUrl,
}: {
  title: string;
  description: string;
  publicUrl: string | null;
  faviconUrl?: string | null;
}): string {
  const escapedTitle = escapeHtml(title);
  const escapedDescription = escapeHtml(description);
  const socialImageUrl = getCooeeSocialImageUrl(publicUrl);
  const canonicalTags = publicUrl
    ? [
        `<link rel="canonical" href="${escapeHtml(publicUrl)}" />`,
        `<meta property="og:url" content="${escapeHtml(publicUrl)}" />`,
      ]
    : [];
  const socialImageTags = socialImageUrl
    ? [
        `<meta property="og:image" content="${escapeHtml(socialImageUrl)}" />`,
        '<meta property="og:image:type" content="image/png" />',
        '<meta property="og:image:width" content="512" />',
        '<meta property="og:image:height" content="512" />',
        '<meta property="og:image:alt" content="Cooee logo" />',
        `<meta name="twitter:image" content="${escapeHtml(socialImageUrl)}" />`,
        '<meta name="twitter:image:alt" content="Cooee logo" />',
      ]
    : [];

  return [
    `<title>${escapedTitle}</title>`,
    ...(faviconUrl
      ? [`<link rel="icon" href="${escapeHtml(faviconUrl)}" />`]
      : []),
    `<meta name="description" content="${escapedDescription}" />`,
    ...canonicalTags,
    '<meta property="og:locale" content="en_AU" />',
    '<meta property="og:site_name" content="Cooee" />',
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${escapedTitle}" />`,
    `<meta property="og:description" content="${escapedDescription}" />`,
    ...socialImageTags,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escapedTitle}" />`,
    `<meta name="twitter:description" content="${escapedDescription}" />`,
  ].join("\n");
}

function getCooeeSocialImageUrl(publicUrl: string | null): string | null {
  if (!publicUrl) {
    return null;
  }

  try {
    return new URL("/cooee-icon.png", publicUrl).toString();
  } catch {
    return null;
  }
}

function getPublicChangelogShellTheme(
  request: Request,
  fallback: unknown,
): "light" | "dark" {
  return (
    readPublicChangelogThemeCookie(request.headers.get("cookie")) ??
    normalizePublicChangelogTheme(fallback)
  );
}

function readPublicChangelogThemeCookie(
  cookieHeader: string | null,
): "light" | "dark" | null {
  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const [name, value] = cookie.trim().split("=");
    if (name === publicChangelogThemeCookieName) {
      return value === "dark" || value === "light" ? value : null;
    }
  }

  return null;
}

function normalizePublicChangelogTheme(value: unknown): "light" | "dark" {
  return value === "dark" ? "dark" : "light";
}

function normalizePublicChangelogAppName(appName: string): string {
  return appName.trim();
}

function normalizePublicChangelogSeoText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function truncatePublicChangelogMetaDescription(description: string): string {
  return description.length <= 160
    ? description
    : `${description.slice(0, 157).trimEnd()}...`;
}

function getPublicChangelogSeoTitle(appName: string): string {
  const normalizedAppName = normalizePublicChangelogAppName(appName);
  return normalizedAppName ? `${normalizedAppName} Changelog` : "Changelog";
}

function getPublicChangelogSeoDescription(
  appName: string,
  description?: string | null,
): string {
  const explicitDescription = normalizePublicChangelogSeoText(description);
  const normalizedAppName = normalizePublicChangelogAppName(appName);
  const fallbackDescription = normalizedAppName
    ? `Latest product updates, improvements, and fixes from ${normalizedAppName}.`
    : "Latest product updates, improvements, and fixes.";
  return truncatePublicChangelogMetaDescription(
    explicitDescription || fallbackDescription,
  );
}

function normalizePublicChangelogSeoUrl(
  publicUrl: string | null | undefined,
): string | null {
  const trimmedUrl = publicUrl?.trim() ?? "";
  return /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function serveStatic(
  pathname: string,
  staticRoot: string,
): Promise<Response> {
  const path = pathname === "/" ? "/index.html" : pathname;
  const file = Bun.file(`${staticRoot}${path}`);

  if (await file.exists()) {
    return withStaticCacheControl(new Response(file), path);
  }

  const fallback = Bun.file(`${staticRoot}/index.html`);
  if (await fallback.exists()) {
    return withStaticCacheControl(new Response(fallback), "/index.html");
  }

  return json({ error: "Frontend build not found" }, { status: 404 });
}

function withStaticCacheControl(
  response: Response,
  pathname: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", getStaticCacheControl(pathname));
  return secureResponse(
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  );
}

function getStaticCacheControl(pathname: string): string {
  if (pathname === "/index.html") {
    return "no-cache";
  }

  if (pathname.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }

  return "public, max-age=3600";
}

function json(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-frame-options", "DENY");
  headers.set("cache-control", headers.get("cache-control") ?? "no-store");
  return Response.json(body, { ...init, headers });
}

function xml(body: string, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/rss+xml; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-frame-options", "DENY");
  headers.set("cache-control", headers.get("cache-control") ?? "no-store");
  return new Response(body, { ...init, headers });
}

function renderRssFeed(
  feed: ReturnType<typeof publicFeedSchema.parse>,
): string {
  const changelog = feed.changelog;
  const description =
    changelog.description?.trim() || `${changelog.name} updates`;
  const items = feed.entries
    .map(
      (entry) => `
      <item>
        <title>${escapeXml(entry.title)}</title>
        <description>${escapeXml(entry.summary)}</description>
        <link>${escapeXml(changelog.publicUrl)}</link>
        <guid isPermaLink="false">${escapeXml(entry.id)}</guid>
        <pubDate>${escapeXml(toRssDate(entry.publishedAt))}</pubDate>
        <category>${escapeXml(entry.category)}</category>
      </item>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(`${changelog.name} changelog`)}</title>
    <description>${escapeXml(description)}</description>
    <link>${escapeXml(changelog.publicUrl)}</link>
    <lastBuildDate>${escapeXml(toRssDate(feed.generatedAt))}</lastBuildDate>${items}
  </channel>
</rss>`;
}

function toRssDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toUTCString();
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function secureResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  const cspNonce = Buffer.from(
    crypto.getRandomValues(new Uint8Array(16)),
  ).toString("base64");
  headers.set(
    "content-security-policy",
    `default-src 'self'; base-uri 'self'; connect-src 'self' https://*.posthog.com; font-src 'self' https://fonts.gstatic.com; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self' 'nonce-${cspNonce}' https://static.cloudflareinsights.com https://*.posthog.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; worker-src 'self' blob: data:; upgrade-insecure-requests`,
  );
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  if (response.status >= 400 && !headers.has("cache-control")) {
    headers.set("cache-control", "no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function publicCorsResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, HEAD, OPTIONS");
  headers.set("access-control-allow-headers", "Accept, Content-Type");
  headers.set("access-control-max-age", "86400");
  headers.set("vary", appendVary(headers.get("vary"), "Origin"));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function respondToHead(request: Request, response: Response): Response {
  if (request.method !== "HEAD") {
    return response;
  }

  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function appendVary(current: string | null, value: string): string {
  const values = new Set(
    (current ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  values.add(value);
  return [...values].join(", ");
}

function isRateLimited(
  buckets: Map<string, { count: number; resetAt: number }>,
  request: Request,
  pathname: string,
  trustedClientIpHeader: string | undefined,
): boolean {
  const now = Date.now();
  if (buckets.size > 10_000) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }
  const client = getTrustedClientIp(request, trustedClientIpHeader);
  const scope = pathname.startsWith("/api/webhooks/") ? "webhook" : "admin";
  const max = scope === "webhook" ? 600 : 300;
  const key = `${scope}:${client}`;
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > max;
}

export function getTrustedClientIp(
  request: Request,
  trustedClientIpHeader: string | undefined,
): string {
  if (!trustedClientIpHeader) return "shared";

  const value = request.headers.get(trustedClientIpHeader)?.trim() ?? "";
  return isIP(value) ? value : "unknown";
}

function getWorkspaceId(url: URL): string {
  return url.searchParams.get("workspaceId") ?? defaultWorkspaceId;
}

function getRequestCountryCode(
  request: Request,
  clientHint?: unknown,
): string | null {
  for (const header of [
    "cf-ipcountry",
    "x-vercel-ip-country",
    "cloudfront-viewer-country",
  ]) {
    const country = normalizeCountryCode(request.headers.get(header));
    if (country) return country;
  }

  const hintedCountry = normalizeCountryCode(clientHint);
  if (hintedCountry) return hintedCountry;

  return null;
}

function normalizeCountryCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) && normalized !== "XX"
    ? normalized
    : null;
}

type GitHubInstallationState = {
  expiresAt: number;
  userId: string;
  workspaceId: string;
};

async function createGitHubInstallationState(input: {
  secret: string;
  userId: string;
  workspaceId: string;
}): Promise<string> {
  const payload = encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        expiresAt: Date.now() + 10 * 60 * 1000,
        userId: input.userId,
        workspaceId: input.workspaceId,
      } satisfies GitHubInstallationState),
    ),
  );
  const signature = await signGitHubInstallationState(payload, input.secret);
  return `${payload}.${encodeBase64Url(signature)}`;
}

async function verifyGitHubInstallationState(input: {
  secret: string;
  state: string | null;
  userId: string;
  workspaceId: string;
}): Promise<boolean> {
  const [payload, signature, extra] = input.state?.split(".") ?? [];
  if (!payload || !signature || extra) return false;

  try {
    const key = await importGitHubInstallationStateKey(input.secret, [
      "verify",
    ]);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(signature),
      new TextEncoder().encode(payload),
    );
    if (!valid) return false;
    const parsed = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(payload)),
    ) as Partial<GitHubInstallationState>;
    return (
      parsed.userId === input.userId &&
      parsed.workspaceId === input.workspaceId &&
      typeof parsed.expiresAt === "number" &&
      parsed.expiresAt >= Date.now() &&
      parsed.expiresAt <= Date.now() + 10 * 60 * 1000
    );
  } catch {
    return false;
  }
}

async function signGitHubInstallationState(
  payload: string,
  secret: string,
): Promise<ArrayBuffer> {
  const key = await importGitHubInstallationStateKey(secret, ["sign"]);
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
}

function importGitHubInstallationStateKey(
  secret: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

function githubAppCallbackRedirect(appUrl: string, status: string): string {
  return `${appUrl.replace(/\/$/, "")}/changelog?github=${encodeURIComponent(status)}`;
}

function normalizeWorkspaceSettings(
  input: unknown,
  defaultAppName = "Cooee",
): WorkspaceSettings {
  const settings = isRecord(input) ? input : {};

  return {
    appName:
      readString(settings.appName, defaultAppName).trim() || defaultAppName,
    publicChangelog: readBoolean(
      settings.publicChangelog,
      defaultWorkspaceSettings.publicChangelog,
    ),
    includePullRequestLinks: readBoolean(
      settings.includePullRequestLinks,
      defaultWorkspaceSettings.includePullRequestLinks,
    ),
    publicTheme: readEnum(
      settings.publicTheme,
      ["light", "dark"],
      defaultWorkspaceSettings.publicTheme,
    ),
    publicLogoAlignment: readEnum(
      settings.publicLogoAlignment,
      ["left", "center", "right"],
      defaultWorkspaceSettings.publicLogoAlignment,
    ),
    logoAssetKey: readNullableString(settings.logoAssetKey),
    logoDataUrl: null,
    logoUrl: readNullableString(settings.logoUrl),
    lightLogoAssetKey: readNullableString(settings.lightLogoAssetKey),
    lightLogoDataUrl: null,
    lightLogoUrl: readNullableString(settings.lightLogoUrl),
    faviconAssetKey: readNullableString(settings.faviconAssetKey),
    faviconDataUrl: null,
    faviconUrl: readNullableString(settings.faviconUrl),
    publicAppUrl: readString(
      settings.publicAppUrl,
      defaultWorkspaceSettings.publicAppUrl,
    ),
    publicAppLabel:
      readString(
        settings.publicAppLabel,
        defaultWorkspaceSettings.publicAppLabel,
      ).trim() || defaultWorkspaceSettings.publicAppLabel,
    aiMinimumConfidence: readEnum(
      settings.aiMinimumConfidence,
      ["0.70", "0.80", "0.90"],
      "0.80",
    ),
    aiAudience: readEnum(
      settings.aiAudience,
      ["product-users", "technical-users"],
      "product-users",
    ),
    aiPersonality: readEnum(
      settings.aiPersonality,
      ["product-user", "concise", "technical"],
      "product-user",
    ),
    aiFailClosed: readBoolean(
      settings.aiFailClosed,
      defaultWorkspaceSettings.aiFailClosed,
    ),
    createImagesPerUpdate: readBoolean(
      settings.createImagesPerUpdate,
      defaultWorkspaceSettings.createImagesPerUpdate,
    ),
    scheduleFrequency: readEnum(
      settings.scheduleFrequency,
      ["daily", "weekly", "monthly", "on-merge"],
      "daily",
    ),
    scheduleWeekday: readInteger(
      settings.scheduleWeekday,
      defaultWorkspaceSettings.scheduleWeekday ?? 1,
      0,
      6,
    ),
    scheduleMonthDay: readInteger(
      settings.scheduleMonthDay,
      defaultWorkspaceSettings.scheduleMonthDay ?? 1,
      1,
      31,
    ),
    historicalBackfillDays: readInteger(
      settings.historicalBackfillDays,
      defaultWorkspaceSettings.historicalBackfillDays,
      1,
      365,
    ),
    onboardingCompleted: readBoolean(
      settings.onboardingCompleted,
      defaultWorkspaceSettings.onboardingCompleted,
    ),
    publishTime: readString(
      settings.publishTime,
      defaultWorkspaceSettings.publishTime,
    ),
    timeZone: readString(settings.timeZone, defaultWorkspaceSettings.timeZone),
    publicSlug: readString(
      settings.publicSlug,
      defaultWorkspaceSettings.publicSlug,
    ),
    customDomain: readString(
      settings.customDomain,
      defaultWorkspaceSettings.customDomain,
    ),
    privacyLabels: readString(
      settings.privacyLabels,
      defaultWorkspaceSettings.privacyLabels,
    ),
  };
}

function normalizeEntryUpdate(input: Record<string, unknown>): {
  title: string;
  summary: string;
  category: ChangelogCategory;
  publishedAt?: string;
} | null {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  const category = normalizeChangelogCategory(input.category);
  const publishedAt = normalizeOptionalPublishedAt(input.publishedAt);

  if (
    !title ||
    !summary ||
    !category ||
    ("publishedAt" in input && !publishedAt)
  ) {
    return null;
  }

  return publishedAt
    ? { title, summary, category, publishedAt }
    : { title, summary, category };
}

function normalizeOptionalPublishedAt(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeEntryIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean),
    ),
  );
}

async function regenerateChangelogEntryMarketingCopy({
  category,
  entryId,
  rewriteInstructions,
  store,
  summarizer,
  recordAiUsage,
  workspaceId,
}: {
  category: unknown;
  entryId: string;
  rewriteInstructions?: string;
  store: Store;
  summarizer: AiSummarizer;
  recordAiUsage: (input: {
    workspaceId: string;
    sourceId: string;
    usage: AiTokenUsage;
  }) => Promise<void>;
  workspaceId: string;
}): Promise<
  | {
      status: "ok";
      entry: { title: string; summary: string; category: ChangelogCategory };
    }
  | {
      status: "not-found" | "invalid-output";
    }
> {
  const changelogs = await store.listChangelogs(workspaceId);
  const changelogsById = new Map(
    changelogs.map((changelog) => [changelog.id, changelog]),
  );
  let selectedEntry: StoredEntry | null = null;
  let selectedChangelog: StoredChangelog | null = null;

  for (const changelog of changelogs) {
    const entry = (await store.listEntries(changelog.id)).find(
      (item) => item.id === entryId,
    );
    if (entry) {
      selectedEntry = entry;
      selectedChangelog = changelogsById.get(entry.changelogId) ?? null;
      break;
    }
  }

  if (!selectedEntry || !selectedChangelog) {
    return { status: "not-found" };
  }

  const selectedCategory =
    normalizeChangelogCategory(category) ?? selectedEntry.category;
  const categoryDefinition = getChangelogCategoryDefinition(
    selectedCategory,
    selectedChangelog.settings.categoryDefinitions,
  );

  const sourcePullRequestNumbers = new Set(
    selectedEntry.sourcePullRequests.map((pullRequest) => pullRequest.number),
  );

  let pullRequests = (
    await store.listPullRequestsForRange(selectedChangelog, {
      startedAt: "1970-01-01T00:00:00.000Z",
      endedAt: oneSecondAfter(selectedEntry.windowEndedAt),
    })
  ).filter((pullRequest) => sourcePullRequestNumbers.has(pullRequest.number));

  if (pullRequests.length === 0) {
    pullRequests = buildRegenerationFallbackPullRequests({
      category: selectedCategory,
      changelog: selectedChangelog,
      entry: selectedEntry,
    });
  }

  const categoryDefinitions = [categoryDefinition];
  const [learnings, writerOptions] = await Promise.all([
    store.listAiFeedback(workspaceId, selectedChangelog.id),
    resolveAiWritingOptions({ changelog: selectedChangelog, store }),
  ]);
  const summaryResult = await summarizer.summarize(pullRequests, {
    ...writerOptions,
    categoryDefinitions,
    learnings,
    rewriteInstructions,
  });
  const { candidate, usage } = unwrapAiSummaryResult(summaryResult);
  if (usage) {
    await recordAiUsage({
      workspaceId,
      sourceId: `marketing-regeneration:${entryId}:${crypto.randomUUID()}`,
      usage,
    });
  }
  const validation = validateGeneratedEntry(candidate, {
    categoryDefinitions,
  });

  if (!validation.ok) {
    return { status: "invalid-output" };
  }

  const generatedItems =
    validation.entry.items && validation.entry.items.length > 0
      ? validation.entry.items
      : [
          {
            title: validation.entry.title,
            summary: validation.entry.summary,
            category: validation.entry.category,
          },
        ];
  const selectedItem =
    generatedItems.find((item) =>
      item.sourcePullRequestNumbers?.some((number) =>
        sourcePullRequestNumbers.has(number),
      ),
    ) ??
    generatedItems.find((item) => item.category === selectedCategory) ??
    generatedItems[0];

  if (!selectedItem) {
    return { status: "invalid-output" };
  }

  return {
    status: "ok",
    entry: {
      title: selectedItem.title,
      summary: selectedItem.summary,
      category: selectedItem.category,
    },
  };
}

async function regenerateHeldChangelogEntry({
  entryId,
  store,
  summarizer,
  recordAiUsage,
  workspaceId,
}: {
  entryId: string;
  store: Store;
  summarizer: AiSummarizer;
  recordAiUsage: (input: {
    workspaceId: string;
    sourceId: string;
    usage: AiTokenUsage;
  }) => Promise<void>;
  workspaceId: string;
}): Promise<
  | {
      status: "ok";
      entry: StoredEntry;
    }
  | {
      status: "not-found" | "not-held" | "missing-source" | "invalid-output";
    }
> {
  const changelogs = await store.listChangelogs(workspaceId);
  let selectedEntry: StoredEntry | null = null;
  let selectedChangelog: StoredChangelog | null = null;

  for (const changelog of changelogs) {
    const entry = (await store.listEntries(changelog.id)).find(
      (item) => item.id === entryId,
    );
    if (entry) {
      selectedEntry = entry;
      selectedChangelog = changelog;
      break;
    }
  }

  if (!selectedEntry || !selectedChangelog) {
    return { status: "not-found" };
  }

  if (selectedEntry.status !== "held") {
    return { status: "not-held" };
  }

  const sourcePullRequestNumbers = new Set(
    selectedEntry.sourcePullRequests.map((pullRequest) => pullRequest.number),
  );
  if (sourcePullRequestNumbers.size === 0) {
    return { status: "missing-source" };
  }

  const pullRequests = (
    await store.listPullRequestsForRange(selectedChangelog, {
      startedAt: "1970-01-01T00:00:00.000Z",
      endedAt: oneSecondAfter(selectedEntry.windowEndedAt),
    })
  ).filter((pullRequest) => sourcePullRequestNumbers.has(pullRequest.number));

  if (pullRequests.length === 0) {
    return { status: "missing-source" };
  }

  const categoryDefinitions = selectedChangelog.settings.categoryDefinitions;
  const [learnings, writerOptions] = await Promise.all([
    store.listAiFeedback(workspaceId, selectedChangelog.id),
    resolveAiWritingOptions({ changelog: selectedChangelog, store }),
  ]);
  const summaryResult = await summarizer.summarize(pullRequests, {
    ...writerOptions,
    categoryDefinitions,
    learnings,
  });
  const { candidate, usage } = unwrapAiSummaryResult(summaryResult);
  if (usage) {
    await recordAiUsage({
      workspaceId,
      sourceId: `held-regeneration:${entryId}:${crypto.randomUUID()}`,
      usage,
    });
  }
  const validation = validateGeneratedEntry(candidate, {
    categoryDefinitions,
  });

  if (!validation.ok) {
    return { status: "invalid-output" };
  }

  const generatedItems =
    validation.entry.items && validation.entry.items.length > 0
      ? validation.entry.items
      : [
          {
            title: validation.entry.title,
            summary: validation.entry.summary,
            category: validation.entry.category,
          },
        ];
  const selectedItem =
    generatedItems.find((item) =>
      item.sourcePullRequestNumbers?.some((number) =>
        sourcePullRequestNumbers.has(number),
      ),
    ) ?? generatedItems[0];

  if (!selectedItem) {
    return { status: "invalid-output" };
  }

  const entry = await store.updateEntry({
    workspaceId,
    entryId,
    title: selectedItem.title,
    summary: selectedItem.summary,
    category: selectedItem.category,
  });

  return entry ? { status: "ok", entry } : { status: "not-found" };
}

function buildRegenerationFallbackPullRequests({
  category,
  changelog,
  entry,
}: {
  category: ChangelogCategory;
  changelog: StoredChangelog;
  entry: StoredEntry;
}): PullRequestMetadata[] {
  const mergedAt = entry.publishedAt ?? entry.windowEndedAt;

  if (entry.sourcePullRequests.length > 0) {
    return entry.sourcePullRequests.map((pullRequest, index) => ({
      id: `entry_${entry.id}_source_${pullRequest.number || index}`,
      number: pullRequest.number || index + 1,
      title: pullRequest.title || entry.title,
      body: entry.summary,
      labels: [category],
      mergedAt: pullRequest.mergedAt ?? mergedAt,
      url: pullRequest.url,
      repository: changelog.repository,
      author: pullRequest.author,
    }));
  }

  return [
    {
      id: `entry_${entry.id}`,
      number: 1,
      title: entry.title,
      body: entry.summary,
      labels: [category],
      mergedAt,
      url: "",
      repository: changelog.repository,
    },
  ];
}

async function generateChangelogEntryPostImage({
  assetStorage,
  category,
  entryId,
  imageGenerator,
  store,
  summary,
  title,
  workspaceId,
}: {
  assetStorage: AssetStorage | null;
  category: unknown;
  entryId: string;
  imageGenerator: AiImageGenerator;
  store: Store;
  summary: unknown;
  title: unknown;
  workspaceId: string;
}): Promise<
  | { status: "ok"; entry: StoredEntry }
  | {
      status:
        | "not-found"
        | "not-post-category"
        | "invalid-output"
        | "provider-error";
    }
> {
  const changelogs = await store.listChangelogs(workspaceId);
  const changelogsById = new Map(
    changelogs.map((changelog) => [changelog.id, changelog]),
  );
  let selectedEntry: StoredEntry | null = null;
  let selectedChangelog: StoredChangelog | null = null;

  for (const changelog of changelogs) {
    const entry = (await store.listEntries(changelog.id)).find(
      (item) => item.id === entryId,
    );
    if (entry) {
      selectedEntry = entry;
      selectedChangelog = changelogsById.get(entry.changelogId) ?? null;
      break;
    }
  }

  if (!selectedEntry || !selectedChangelog) {
    return { status: "not-found" };
  }

  if (!assetStorage) {
    return { status: "provider-error" };
  }

  const selectedCategory =
    normalizeChangelogCategory(category) ?? selectedEntry.category;
  const categoryDefinition = getChangelogCategoryDefinition(
    selectedCategory,
    selectedChangelog.settings.categoryDefinitions,
  );

  if (categoryDefinition.displayType !== "post") {
    return { status: "not-post-category" };
  }

  const imageTitle = normalizePostImageText(title) ?? selectedEntry.title;
  const imageSummary = normalizePostImageText(summary) ?? selectedEntry.summary;

  try {
    const generated = await imageGenerator.generatePostImage({
      category: selectedCategory,
      summary: imageSummary,
      title: imageTitle,
    });

    const image = await readGeneratedPostImage(generated.imageUrl);
    if (!image) {
      return { status: "invalid-output" };
    }

    const imageUrl = publicPostImageUrl(workspaceId, entryId);
    await assetStorage.putObject({
      ...image,
      key: postImageAssetKey(workspaceId, entryId),
    });

    const entry = await store.updateEntryImage({
      entryId,
      imageUrl,
      workspaceId,
    });

    return entry ? { status: "ok", entry } : { status: "not-found" };
  } catch {
    return { status: "provider-error" };
  }
}

async function readGeneratedPostImage(
  imageUrl: string,
  allowRemote = true,
): Promise<{ body: Uint8Array; contentType: string } | null> {
  const dataUrlMatch =
    /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([a-z0-9+/=]+)$/i.exec(
      imageUrl,
    );
  if (dataUrlMatch) {
    const binary = atob(dataUrlMatch[2]);
    const body = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    if (body.byteLength > maxPostImageSizeBytes) {
      return null;
    }
    return {
      body,
      contentType:
        dataUrlMatch[1].toLowerCase() === "image/jpg"
          ? "image/jpeg"
          : dataUrlMatch[1].toLowerCase(),
    };
  }

  if (!allowRemote || !isSafeGeneratedImageUrl(imageUrl)) {
    return null;
  }

  const response = await fetch(imageUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    return null;
  }

  const contentType = response.headers
    .get("content-type")
    ?.toLowerCase()
    .split(";")[0]
    .trim();
  if (!contentType || !postImageContentTypes.has(contentType)) {
    return null;
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxPostImageSizeBytes) {
    return null;
  }

  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > maxPostImageSizeBytes) {
    return null;
  }

  return { body, contentType };
}

function normalizePostImageText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isSafeGeneratedImageUrl(value: string): boolean {
  if (
    /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)
  ) {
    return true;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function oneSecondAfter(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return new Date(date.getTime() + 1000).toISOString();
}

async function mergeChangelogEntries({
  entryIds,
  store,
  summarizer,
  recordAiUsage,
  workspaceId,
}: {
  entryIds: string[];
  store: Store;
  summarizer: AiSummarizer;
  recordAiUsage: (input: {
    workspaceId: string;
    sourceId: string;
    usage: AiTokenUsage;
  }) => Promise<void>;
  workspaceId: string;
}): Promise<
  | { status: "published"; entry: StoredEntry }
  | { status: "not-found" | "invalid-output" }
> {
  const changelogs = await store.listChangelogs(workspaceId);
  const entriesById = new Map<string, StoredEntry>();

  for (const changelog of changelogs) {
    const entries = await store.listEntries(changelog.id);
    for (const entry of entries) {
      entriesById.set(entry.id, entry);
    }
  }

  const selectedEntries = entryIds
    .map((entryId) => entriesById.get(entryId) ?? null)
    .filter((entry): entry is StoredEntry => Boolean(entry));

  if (
    selectedEntries.length !== entryIds.length ||
    new Set(selectedEntries.map((entry) => entry.changelogId)).size !== 1
  ) {
    return { status: "not-found" };
  }

  const changelog = await store.getChangelogById(
    selectedEntries[0].changelogId,
  );
  if (!changelog || changelog.workspaceId !== workspaceId) {
    return { status: "not-found" };
  }

  const [learnings, writerOptions] = await Promise.all([
    store.listAiFeedback(workspaceId, changelog.id),
    resolveAiWritingOptions({ changelog, store }),
  ]);
  const summaryResult = summarizer.mergeEntries
    ? await summarizer.mergeEntries(selectedEntries, {
        ...writerOptions,
        categoryDefinitions: changelog.settings.categoryDefinitions,
        learnings,
      })
    : {
        title: selectedEntries.map((entry) => entry.title).join(" + "),
        summary: selectedEntries.map((entry) => entry.summary).join("\n\n"),
        category: selectedEntries[0].category,
        items: [],
        confidence: 0.95,
        sensitive: false,
      };
  const { candidate, usage } = unwrapAiSummaryResult(summaryResult);
  if (usage) {
    await recordAiUsage({
      workspaceId,
      sourceId: `merge:${[...entryIds].sort().join(":")}:${crypto.randomUUID()}`,
      usage,
    });
  }
  const validation = validateGeneratedEntry(candidate, {
    categoryDefinitions: changelog.settings.categoryDefinitions,
  });

  if (!validation.ok) {
    return { status: "invalid-output" };
  }

  const mergedEntry = await store.createEntry({
    changelogId: selectedEntries[0].changelogId,
    title: validation.entry.title,
    summary: validation.entry.summary,
    category: validation.entry.category,
    status: "published",
    publishedAt: latestIso(
      selectedEntries
        .map((entry) => entry.publishedAt)
        .filter((value): value is string => Boolean(value)),
    ),
    windowEndedAt: latestIso(
      selectedEntries.map((entry) => entry.windowEndedAt),
    ),
    items: [],
    sourcePullRequests: mergeSourcePullRequests(selectedEntries),
  });

  await Promise.all(
    selectedEntries.map((entry) =>
      store.markEntryNotRelevant({
        workspaceId,
        entryId: entry.id,
        note: `Merged with related posts into "${mergedEntry.title}". Treat these updates as one post in future AI syncs.`,
      }),
    ),
  );

  return { status: "published", entry: mergedEntry };
}

function latestIso(values: string[]): string {
  return (
    values
      .map((value) => new Date(value).getTime())
      .filter(Number.isFinite)
      .sort((left, right) => right - left)
      .map((value) => new Date(value).toISOString())[0] ??
    new Date().toISOString()
  );
}

function mergeSourcePullRequests(entries: StoredEntry[]) {
  return Array.from(
    new Map(
      entries
        .flatMap((entry) => entry.sourcePullRequests)
        .map((pullRequest) => [
          `${pullRequest.number}:${pullRequest.url}`,
          pullRequest,
        ]),
    ).values(),
  );
}

function normalizeChangelogCategory(value: unknown): ChangelogCategory | null {
  if (typeof value !== "string") {
    return null;
  }

  return normalizeChangelogCategoryId(value) || null;
}

function getDefaultAppName(repositories: GitHubRepository[]): string {
  const repository = repositories.find((item) => item.name) ?? repositories[0];
  if (!repository) {
    return "Cooee";
  }

  return humanizeRepositoryName(
    repository.name || repository.fullName.split("/").at(-1) || "Cooee",
  );
}

function humanizeRepositoryName(name: string): string {
  const words = name.replace(/[_-]+/g, " ").trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return "Cooee";
  }

  return words
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLabelList(value: unknown, fallback: string): string[] {
  const labels = readString(value, fallback)
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);

  return Array.from(new Set(labels));
}

function labelListToString(labels: string[]): string {
  return Array.from(new Set(labels)).join(", ");
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function readNumber(value: unknown, fallback: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  const fallbackParsed =
    typeof fallback === "number" ? fallback : Number(fallback);

  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return Number.isFinite(fallbackParsed) ? fallbackParsed : 0;
}

function stripUrlQuery(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split("?")[0];
  }
}

function readEnum<const TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  fallback: TValue,
): TValue {
  return typeof value === "string" && allowed.includes(value as TValue)
    ? (value as TValue)
    : fallback;
}
