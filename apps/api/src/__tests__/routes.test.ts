import { describe, expect, test } from "bun:test";
import {
  defaultChangelogCategoryDefinitions,
  type PullRequestMetadata,
} from "@cooee/shared";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Stripe from "stripe";
import { createApp } from "../server";
import { InMemoryStore } from "../store/memory";
import type { StoredChangelog, StoredEntry } from "../store/types";
import {
  createDefaultImageGenerator,
  type AiSummarizer,
} from "../services/openai";
import { signPayload, type GitHubAppClient } from "../services/github";

class TestAssetStorage {
  objects = new Map<string, { body: Uint8Array; contentType: string }>();

  async putObject(input: {
    body: Uint8Array;
    contentType: string;
    key: string;
  }) {
    this.objects.set(input.key, {
      body: input.body,
      contentType: input.contentType,
    });
  }

  async getObject(key: string) {
    return this.objects.get(key) ?? null;
  }
}

function publishedEntry(input: {
  id: string;
  changelogId?: string;
  publishedAt: string;
  title?: string;
}): StoredEntry {
  return {
    id: input.id,
    changelogId: input.changelogId ?? "cl_acme",
    title: input.title ?? input.id,
    summary: `Summary for ${input.id}.`,
    category: "feature",
    status: "published",
    publishedAt: input.publishedAt,
    imageUrl: null,
    windowEndedAt: input.publishedAt,
    sourcePullRequests: [],
  };
}

function billingRecoveryStore(): InMemoryStore {
  return new InMemoryStore({
    workspaces: [
      {
        id: "ws_acme",
        name: "Acme",
        billingMode: "hosted",
        repositoryLimit: 15,
        stripeCustomerId: "cus_saved",
      },
    ],
    billingSubscriptions: [
      {
        id: "billing_saved",
        workspaceId: "ws_acme",
        stripeSubscriptionId: "sub_saved",
        stripeCustomerId: "cus_saved",
        status: "active",
        planId: "watermelon",
        billingCadence: "monthly",
        priceId: "price_saved",
        repositoryLimit: 15,
        currentPeriodStart: "2026-07-01T00:00:00.000Z",
        currentPeriodEnd: "2026-08-01T00:00:00.000Z",
        billingEmail: "owner@example.com",
        cancelAtPeriodEnd: false,
        cancelAt: null,
        endedAt: null,
        lastPaymentFailedAt: null,
      },
    ],
  });
}

function missingBillingCustomerError() {
  return { code: "resource_missing" };
}

function billingRecoveryStripe(): {
  checkoutInput: () => Stripe.Checkout.SessionCreateParams | null;
  stripe: Stripe;
} {
  const stripe = new Stripe("sk_test_123", {
    apiVersion: "2026-02-25.clover",
  });
  let checkoutInput: Stripe.Checkout.SessionCreateParams | null = null;

  stripe.billingPortal.sessions.create = async () => {
    throw missingBillingCustomerError();
  };
  stripe.customers.retrieve = async () => {
    throw missingBillingCustomerError();
  };
  stripe.prices.list = (async () =>
    ({
      data: [
        {
          id: "price_lobster_monthly",
          lookup_key: "cooee_lobster_monthly",
        },
        {
          id: "price_lobster_usage",
          lookup_key: "cooee_lobster_ai_credits_monthly",
        },
      ],
    }) as Stripe.Response<
      Stripe.ApiList<Stripe.Price>
    >) as typeof stripe.prices.list;
  stripe.checkout.sessions.create = (async (
    input: Stripe.Checkout.SessionCreateParams,
  ) => {
    checkoutInput = input;
    return {
      id: "cs_recovery",
      object: "checkout.session",
      url: "https://billing.example.test/recovery",
    } as Stripe.Response<Stripe.Checkout.Session>;
  }) as typeof stripe.checkout.sessions.create;

  return { checkoutInput: () => checkoutInput, stripe };
}

describe("api routes", () => {
  test("returns complimentary billing state without exposing saved billing", async () => {
    const store = billingRecoveryStore();
    store.complimentaryAccessGrants.push({
      id: "grant_friend",
      workspaceId: "ws_acme",
      planId: "watermelon",
      reason: "Launch partner",
      grantedBy: "operator@example.com",
      expiresAt: null,
      createdAt: "2026-07-22T00:00:00.000Z",
    });
    const app = createApp({
      store,
      env: { BILLING_ENABLED: "true" },
    });

    const response = await app.fetch(
      new Request("http://cooee.test/api/admin/billing/subscription"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      accessSource: "complimentary",
      planId: "watermelon",
      repositoryLimit: 15,
      complimentaryAccess: { planId: "watermelon", expiresAt: null },
      managementState: "unavailable",
      portalUrl: null,
      subscription: null,
    });

    const checkout = await app.fetch(
      new Request("http://cooee.test/api/admin/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: "lobster" }),
      }),
    );
    expect(checkout.status).toBe(409);
    expect(await checkout.json()).toEqual({
      error: "Complimentary access is managed by the workspace operator.",
    });
  });

  test("serves health, public feed, and latest updates", async () => {
    const store = InMemoryStore.seeded();
    const app = createApp({ store });

    const health = await app.fetch(new Request("http://cooee.test/api/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, service: "cooee-api" });

    const feed = await app.fetch(
      new Request("http://cooee.test/api/public/changelogs/acme-app/feed.json"),
    );
    expect(feed.status).toBe(200);
    const feedJson = await feed.json();
    expect(feedJson.entries).toHaveLength(2);
    expect(feedJson.entries[0].sourcePullRequests).toBeUndefined();
    expect(feed.headers.get("access-control-allow-origin")).toBe("*");
    expect(feed.headers.get("cache-control")).toContain("max-age=60");

    const latest = await app.fetch(
      new Request(
        "http://cooee.test/api/public/changelogs/acme-app/latest?limit=1",
      ),
    );
    expect(latest.status).toBe(200);
    const latestJson = await latest.json();
    expect(latestJson.entries).toHaveLength(1);
    expect(
      Object.values(latestJson.groups).flatMap((entries) => entries),
    ).toHaveLength(1);

    const head = await app.fetch(
      new Request(
        "http://cooee.test/api/public/changelogs/acme-app/feed.json",
        { method: "HEAD" },
      ),
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("access-control-allow-methods")).toContain("HEAD");
  });

  test("validates public feed queries and preserves not-found responses", async () => {
    const app = createApp({ store: InMemoryStore.seeded() });

    for (const path of [
      "/api/public/changelogs/acme-app/latest?limit=0",
      "/api/public/changelogs/acme-app/latest?limit=2.5",
      "/api/public/changelogs/acme-app/latest?limit=words",
      "/api/public/changelogs/acme-app/feed.json?before=yesterday",
    ]) {
      const response = await app.fetch(new Request(`http://cooee.test${path}`));
      expect(response.status).toBe(400);
      expect(await response.json()).toHaveProperty("error");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }

    const missing = await app.fetch(
      new Request(
        "http://cooee.test/api/public/changelogs/missing/latest?limit=5",
      ),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Changelog not found" });
  });

  test("serves the public OpenAPI contract", async () => {
    const app = createApp({ store: InMemoryStore.seeded() });
    const response = await app.fetch(
      new Request("http://cooee.test/api/public/openapi.json"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    expect(await response.json()).toMatchObject({
      openapi: "3.1.0",
      info: { title: "Cooee Public API" },
      paths: {
        "/api/public/changelogs/{slug}/feed.json": {},
        "/api/public/changelogs/{slug}/latest": {},
      },
    });
  });

  test("selects fixed billing currencies by customer region", async () => {
    const app = createApp({ store: InMemoryStore.seeded() });
    const cases = [
      ["AU", "aud"],
      ["NZ", "aud"],
      ["GB", "gbp"],
      ["BG", "usd"],
      ["DE", "usd"],
      ["CA", "usd"],
    ] as const;

    for (const [countryCode, currency] of cases) {
      const response = await app.fetch(
        new Request("http://cooee.test/api/public/billing/currency", {
          headers: { "cf-ipcountry": countryCode },
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ countryCode, currency });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }

    const localeOnly = await app.fetch(
      new Request("http://cooee.test/api/public/billing/currency", {
        headers: { "accept-language": "en-GB" },
      }),
    );
    expect(await localeOnly.json()).toEqual({
      countryCode: null,
      currency: "usd",
    });

    const browserCountryHint = await app.fetch(
      new Request(
        "http://cooee.test/api/public/billing/currency?countryCode=AU",
        { headers: { "accept-language": "en-GB" } },
      ),
    );
    expect(await browserCountryHint.json()).toEqual({
      countryCode: "AU",
      currency: "aud",
    });
  });

  test("serves a public changelog feed from its custom domain host", async () => {
    const store = InMemoryStore.seeded();
    store.changelogs[0].customDomain = "changelog.partbot.io";
    store.changelogs[0].publicUrl = "https://changelog.partbot.io";
    const staticRoot = mkdtempSync(join(tmpdir(), "cooee-static-"));
    writeFileSync(
      join(staticRoot, "index.html"),
      '<!doctype html><div id="root"></div>',
    );
    const app = createApp({ store, staticRoot });

    const feed = await app.fetch(
      new Request(
        "https://changelog.partbot.io/api/public/changelog/feed.json",
      ),
    );

    expect(feed.status).toBe(200);
    const feedJson = await feed.json();
    expect(feedJson.changelog.publicUrl).toBe("https://changelog.partbot.io");
    expect(feedJson.entries).toHaveLength(2);

    const forwardedFeed = await app.fetch(
      new Request(
        "https://origin-changelog.cooee.sh/api/public/changelog/feed.json",
        {
          headers: {
            "x-forwarded-host": "changelog.partbot.io",
          },
        },
      ),
    );

    expect(forwardedFeed.status).toBe(200);

    const workerFeed = await app.fetch(
      new Request(
        "https://cooee.up.railway.app/api/public/changelog/feed.json",
        {
          headers: {
            "x-cooee-custom-host": "changelog.partbot.io",
            "x-forwarded-host": "cooee.up.railway.app",
          },
        },
      ),
    );

    expect(workerFeed.status).toBe(200);

    const root = await app.fetch(
      new Request("https://cooee.up.railway.app/", {
        headers: {
          "x-cooee-custom-host": "changelog.partbot.io",
        },
        redirect: "manual",
      }),
    );

    expect(root.status).toBe(200);
    expect(root.headers.get("location")).toBeNull();
    expect(await root.text()).toContain('<div id="root"></div>');

    const legacyPathHead = await app.fetch(
      new Request("https://cooee.up.railway.app/changelog/acme-app", {
        headers: {
          "x-cooee-custom-host": "changelog.partbot.io",
        },
        method: "HEAD",
      }),
    );

    expect(legacyPathHead.status).toBe(200);
  });

  test("public feed only loads the latest daily window and exposes an older cursor", async () => {
    const store = InMemoryStore.seeded();
    store.entries = [
      publishedEntry({
        id: "entry_latest",
        publishedAt: "2026-06-13T12:00:00.000Z",
      }),
      publishedEntry({
        id: "entry_within_daily_window",
        publishedAt: "2026-06-07T12:00:00.000Z",
      }),
      publishedEntry({
        id: "entry_older_than_daily_window",
        publishedAt: "2026-06-05T12:00:00.000Z",
      }),
    ];
    const app = createApp({ store });

    const feed = await app.fetch(
      new Request("http://cooee.test/api/public/changelogs/acme-app/feed.json"),
    );

    expect(feed.status).toBe(200);
    const feedJson = await feed.json();
    expect(feedJson.entries.map((entry: { id: string }) => entry.id)).toEqual([
      "entry_latest",
      "entry_within_daily_window",
    ]);
    expect(feedJson.pagination).toEqual({
      hasMore: true,
      nextBefore: "2026-06-06T12:00:00.000Z",
      windowEndedAt: "2026-06-13T12:00:00.000Z",
      windowStartedAt: "2026-06-06T12:00:00.000Z",
    });

    const olderFeed = await app.fetch(
      new Request(
        `http://cooee.test/api/public/changelogs/acme-app/feed.json?before=${encodeURIComponent(
          feedJson.pagination.nextBefore,
        )}`,
      ),
    );

    expect(olderFeed.status).toBe(200);
    const olderFeedJson = await olderFeed.json();
    expect(
      olderFeedJson.entries.map((entry: { id: string }) => entry.id),
    ).toEqual(["entry_older_than_daily_window"]);
    expect(olderFeedJson.pagination.hasMore).toBe(false);
    expect(olderFeedJson.pagination.nextBefore).toBeNull();
  });

  test("public feed omits scheduled future posts", async () => {
    const store = InMemoryStore.seeded();
    store.entries = [
      publishedEntry({
        id: "entry_scheduled",
        publishedAt: "2999-06-13T12:00:00.000Z",
      }),
      publishedEntry({
        id: "entry_visible",
        publishedAt: "2026-06-13T12:00:00.000Z",
      }),
    ];
    const app = createApp({ store });

    const feed = await app.fetch(
      new Request("http://cooee.test/api/public/changelogs/acme-app/feed.json"),
    );

    expect(feed.status).toBe(200);
    const feedJson = await feed.json();
    expect(feedJson.entries.map((entry: { id: string }) => entry.id)).toEqual([
      "entry_visible",
    ]);
    expect(JSON.stringify(feedJson)).not.toContain("entry_scheduled");
  });

  test("public feed expands the initial window for weekly and monthly changelog schedules", async () => {
    const store = InMemoryStore.seeded();
    const app = createApp({ store });

    store.changelogs[0].settings.scheduleFrequency = "weekly";
    store.entries = [
      publishedEntry({
        id: "weekly_latest",
        publishedAt: "2026-06-13T00:00:00.000Z",
      }),
      publishedEntry({
        id: "weekly_boundary",
        publishedAt: "2026-05-16T00:00:00.000Z",
      }),
      publishedEntry({
        id: "weekly_old",
        publishedAt: "2026-05-15T23:59:59.999Z",
      }),
    ];

    const weeklyFeed = await app.fetch(
      new Request("http://cooee.test/api/public/changelogs/acme-app/feed.json"),
    );

    expect(weeklyFeed.status).toBe(200);
    const weeklyFeedJson = await weeklyFeed.json();
    expect(
      weeklyFeedJson.entries.map((entry: { id: string }) => entry.id),
    ).toEqual(["weekly_latest", "weekly_boundary"]);
    expect(weeklyFeedJson.pagination.nextBefore).toBe(
      "2026-05-16T00:00:00.000Z",
    );

    store.changelogs[0].settings.scheduleFrequency = "monthly";
    store.entries = [
      publishedEntry({
        id: "monthly_latest",
        publishedAt: "2026-06-13T00:00:00.000Z",
      }),
      publishedEntry({
        id: "monthly_boundary",
        publishedAt: "2026-03-13T00:00:00.000Z",
      }),
      publishedEntry({
        id: "monthly_old",
        publishedAt: "2026-03-12T23:59:59.999Z",
      }),
    ];

    const monthlyFeed = await app.fetch(
      new Request("http://cooee.test/api/public/changelogs/acme-app/feed.json"),
    );

    expect(monthlyFeed.status).toBe(200);
    const monthlyFeedJson = await monthlyFeed.json();
    expect(
      monthlyFeedJson.entries.map((entry: { id: string }) => entry.id),
    ).toEqual(["monthly_latest", "monthly_boundary"]);
    expect(monthlyFeedJson.pagination.nextBefore).toBe(
      "2026-03-13T00:00:00.000Z",
    );
  });

  test("serves branded metadata for public changelog page shells", async () => {
    const store = InMemoryStore.seeded();
    store.changelogs[0].settings.publicTheme = "dark";
    store.workspaceSettings.set("ws_acme", {
      faviconAssetKey: "workspaces/ws_acme/favicon/icon.png",
    });
    const staticRoot = mkdtempSync(join(tmpdir(), "cooee-static-"));
    writeFileSync(
      join(staticRoot, "index.html"),
      '<!doctype html><html><head><title>Cooee</title><meta name="description" content="Generic app shell" /></head><body><div id="root"></div></body></html>',
    );
    const app = createApp({ store, staticRoot });

    const page = await app.fetch(
      new Request("https://cooee.test/changelog/acme-app"),
    );

    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("content-security-policy")).toContain(
      "https://static.cloudflareinsights.com",
    );
    expect(page.headers.get("content-security-policy")).toContain(
      "https://*.posthog.com",
    );
    expect(page.headers.get("content-security-policy")).toMatch(
      /script-src 'self' 'nonce-[^']+'/,
    );
    const html = await page.text();
    expect(html).toContain('<html data-theme="dark">');
    expect(html).toContain("<title>Acme App Changelog</title>");
    expect(html).toContain(
      '<link rel="icon" href="https://cooee.test/api/public/changelogs/acme-app/favicon?v=',
    );
    expect(html).toContain(
      '<meta name="description" content="Latest product updates" />',
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://cooee.test/changelog/acme-app" />',
    );
    expect(html).toContain(
      '<meta property="og:title" content="Acme App Changelog" />',
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://cooee.test/changelog/acme-app" />',
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://cooee.test/cooee-icon.png" />',
    );
    expect(html).toContain(
      '<meta name="twitter:image" content="https://cooee.test/cooee-icon.png" />',
    );
    expect(html).toContain(
      '<meta name="twitter:title" content="Acme App Changelog" />',
    );
    expect(html).toContain(
      '<meta name="twitter:card" content="summary_large_image" />',
    );
    expect(html).toContain('<div id="root"></div>');
    expect(html).not.toContain("<title>Cooee</title>");
    expect(html).not.toContain("Generic app shell");
  });

  test("serves indexable metadata for the developer docs shell", async () => {
    const staticRoot = mkdtempSync(join(tmpdir(), "cooee-static-"));
    writeFileSync(
      join(staticRoot, "index.html"),
      '<!doctype html><html><head><title>Cooee</title><meta name="description" content="Generic app shell" /></head><body><div id="root"></div></body></html>',
    );
    const app = createApp({ store: InMemoryStore.seeded(), staticRoot });

    const page = await app.fetch(new Request("https://cooee.test/docs"));
    const head = await app.fetch(
      new Request("https://cooee.test/docs", { method: "HEAD" }),
    );

    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain("<title>Cooee Developer Docs</title>");
    expect(html).toContain(
      '<meta name="description" content="Integrate Cooee changelogs with React, the public API, and MCP." />',
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://cooee.test/docs" />',
    );
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain(
      '<meta property="og:image" content="https://cooee.test/cooee-icon.png" />',
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("uses HTTPS canonical URLs when a production proxy reaches the app over HTTP", async () => {
    const staticRoot = mkdtempSync(join(tmpdir(), "cooee-static-"));
    writeFileSync(
      join(staticRoot, "index.html"),
      '<!doctype html><html><head><title>Cooee</title></head><body><div id="root"></div></body></html>',
    );
    const app = createApp({ store: InMemoryStore.seeded(), staticRoot });

    const page = await app.fetch(new Request("http://cooee.test/docs"));

    expect(await page.text()).toContain(
      '<link rel="canonical" href="https://cooee.test/docs" />',
    );
  });

  test("serves route-specific metadata for trust and legal pages", async () => {
    const staticRoot = mkdtempSync(join(tmpdir(), "cooee-static-"));
    writeFileSync(
      join(staticRoot, "index.html"),
      '<!doctype html><html><head><title>Cooee</title><meta name="description" content="Generic app shell" /></head><body><div id="root"></div></body></html>',
    );
    const app = createApp({ store: InMemoryStore.seeded(), staticRoot });

    for (const [pathname, title, description] of [
      [
        "/privacy",
        "Privacy Policy | Cooee",
        "What information Cooee handles, why it is needed, and what can become public.",
      ],
      [
        "/terms",
        "Terms of Use | Cooee",
        "The practical terms that apply when you use Cooee's hosted service.",
      ],
      [
        "/cookies",
        "Cookies | Cooee",
        "How Cooee uses essential storage and optional analytics cookies.",
      ],
      [
        "/security",
        "Security | Cooee",
        "How Cooee limits sensitive data, where the boundaries are, and how to report a vulnerability.",
      ],
    ]) {
      const page = await app.fetch(
        new Request(`https://cooee.test${pathname}`),
      );
      const html = await page.text();

      expect(page.status).toBe(200);
      expect(html).toContain(`<title>${title}</title>`);
      expect(html).toContain(
        `<meta name="description" content="${description.replaceAll("'", "&#39;")}" />`,
      );
      expect(html).toContain(
        `<link rel="canonical" href="https://cooee.test${pathname}" />`,
      );
    }
  });

  test("redirects the www hostname to the canonical Cooee domain", async () => {
    const app = createApp({ store: InMemoryStore.seeded() });

    const response = await app.fetch(
      new Request("https://www.cooee.sh/docs?section=react", {
        redirect: "manual",
      }),
    );

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      "https://cooee.sh/docs?section=react",
    );
  });

  test("redirects legacy admin paths to the changelog workspace", async () => {
    const staticRoot = mkdtempSync(join(tmpdir(), "cooee-static-"));
    writeFileSync(
      join(staticRoot, "index.html"),
      "<!doctype html><title>Cooee</title>",
    );
    const app = createApp({ store: InMemoryStore.seeded(), staticRoot });

    const legacy = await app.fetch(
      new Request("https://cooee.test/app/settings?tab=publishing", {
        redirect: "manual",
      }),
    );
    const workspace = await app.fetch(
      new Request("https://cooee.test/changelog/settings"),
    );

    expect(legacy.status).toBe(308);
    expect(legacy.headers.get("location")).toBe(
      "/changelog/settings?tab=publishing",
    );
    expect(workspace.status).toBe(200);
    expect(await workspace.text()).toContain("<title>Cooee</title>");
  });

  test("sets cache headers for static assets without caching the app shell", async () => {
    const staticRoot = mkdtempSync(join(tmpdir(), "cooee-static-"));
    writeFileSync(
      join(staticRoot, "index.html"),
      "<!doctype html><title>Cooee</title>",
    );
    writeFileSync(join(staticRoot, "cooee-icon.png"), new Uint8Array([1, 2]));
    const app = createApp({ store: InMemoryStore.seeded(), staticRoot });

    const icon = await app.fetch(
      new Request("https://cooee.test/cooee-icon.png"),
    );
    const appShell = await app.fetch(new Request("https://cooee.test/login"));

    expect(icon.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(appShell.headers.get("cache-control")).toBe("no-cache");
  });

  test("serves the remembered public theme from the request cookie", async () => {
    const store = InMemoryStore.seeded();
    store.changelogs[0].settings.publicTheme = "light";
    const staticRoot = mkdtempSync(join(tmpdir(), "cooee-static-"));
    writeFileSync(
      join(staticRoot, "index.html"),
      '<!doctype html><html lang="en" data-theme="light"><head><title>Cooee</title></head><body><div id="root"></div></body></html>',
    );
    const app = createApp({ store, staticRoot });

    const page = await app.fetch(
      new Request("https://cooee.test/changelog/acme-app", {
        headers: {
          cookie: "cooee_public_changelog_theme=dark",
        },
      }),
    );

    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<html lang="en" data-theme="dark">');
    expect(html).not.toContain('<html lang="en" data-theme="light">');
  });

  test("serves admin changelog entries with pagination and filters", async () => {
    const store = InMemoryStore.seeded();
    const app = createApp({ store });

    const page = await app.fetch(
      new Request(
        "http://cooee.test/api/admin/changelogs/cl_acme/entries?limit=1&page=2",
      ),
    );
    expect(page.status).toBe(200);
    const pageJson = await page.json();
    expect(pageJson.entries).toHaveLength(1);
    expect(pageJson.entries[0].id).toBe("entry_login_fix");
    expect(pageJson.pagination).toEqual({
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
    });

    const search = await app.fetch(
      new Request(
        "http://cooee.test/api/admin/changelogs/cl_acme/entries?query=filters",
      ),
    );
    expect(search.status).toBe(200);
    const searchJson = await search.json();
    expect(searchJson.entries.map((entry: { id: string }) => entry.id)).toEqual(
      ["entry_saved_filters"],
    );
    expect(searchJson.entries[0].sourcePullRequests).toEqual([
      {
        number: 42,
        url: "https://github.com/acme/app/pull/42",
        author: "octocat",
        mergedAt: "2026-06-05T03:15:00.000Z",
      },
    ]);

    const date = await app.fetch(
      new Request(
        "http://cooee.test/api/admin/changelogs/cl_acme/entries?from=2026-06-05&to=2026-06-05",
      ),
    );
    expect(date.status).toBe(200);
    const dateJson = await date.json();
    expect(dateJson.entries.map((entry: { id: string }) => entry.id)).toEqual([
      "entry_login_fix",
    ]);
  });

  test("orders same-date admin posts by category priority", async () => {
    const store = InMemoryStore.seeded();
    store.entries = [];
    for (const entry of [
      ["Maintenance update", "maintenance"],
      ["Fix update", "fix"],
      ["Feature update", "feature"],
      ["Improvement update", "improvement"],
    ] as const) {
      await store.createEntry({
        changelogId: "cl_acme",
        title: entry[0],
        summary: `${entry[0]} summary.`,
        category: entry[1],
        status: "published",
        publishedAt: "2026-06-05T23:00:00.000Z",
        windowEndedAt: "2026-06-05T23:00:00.000Z",
        sourcePullRequests: [],
      });
    }
    const app = createApp({ store });

    const response = await app.fetch(
      new Request(
        "http://cooee.test/api/admin/changelogs/cl_acme/entries?limit=10",
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.entries.map((entry: { category: string }) => entry.category),
    ).toEqual(["feature", "improvement", "fix", "maintenance"]);
  });

  test("returns the workspace count of reviewable held entries", async () => {
    const store = InMemoryStore.seeded();
    store.entries = [];
    await store.createEntry({
      changelogId: "cl_acme",
      title: "Review this update",
      summary: "This needs review.",
      category: "maintenance",
      status: "held",
      publishedAt: null,
      holdReason: "sensitive-content",
      windowEndedAt: "2026-06-05T23:00:00.000Z",
      sourcePullRequests: [],
    });
    await store.createEntry({
      changelogId: "cl_acme",
      title: "Skipped update",
      summary: "This should not appear in review.",
      category: "maintenance",
      status: "held",
      publishedAt: null,
      holdReason: "skip-label:cooee:skip",
      windowEndedAt: "2026-06-05T23:00:00.000Z",
      sourcePullRequests: [],
    });

    const app = createApp({ store });
    const response = await app.fetch(
      new Request("http://cooee.test/api/admin/held-entry-count"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 1 });
  });

  test("manual generation fails closed into a held draft on low confidence", async () => {
    const store = InMemoryStore.seeded();
    store.pullRequests.push({
      id: "pr_44",
      number: 44,
      title: "Add usage dashboard",
      body: "Customers can now track usage trends.",
      labels: ["feature"],
      mergedAt: "2026-06-05T04:15:00.000Z",
      url: "https://github.com/acme/app/pull/44",
      repository: "acme/app",
      author: "octocat",
    });
    const summarizer: AiSummarizer = {
      summarize: async () => ({
        title: "Internal migration",
        summary: "Infrastructure changed.",
        category: "maintenance",
        confidence: 0.42,
        sensitive: false,
      }),
    };
    const app = createApp({ store, summarizer });

    const response = await app.fetch(
      new Request("http://cooee.test/api/admin/changelogs/cl_acme/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ windowEnd: "2026-06-05T23:00:00.000Z" }),
      }),
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.status).toBe("held");
    expect(body.holdReason).toBe("low-confidence");
    expect(store.entries.some((entry) => entry.status === "held")).toBe(true);
  });

  test("manual generation reports missing OpenAI config separately from low confidence", async () => {
    const store = InMemoryStore.seeded();
    store.pullRequests.push({
      id: "pr_45",
      number: 45,
      title: "Add usage dashboard",
      body: "Customers can now track usage trends.",
      labels: ["feature"],
      mergedAt: "2026-06-05T04:15:00.000Z",
      url: "https://github.com/acme/app/pull/45",
      repository: "acme/app",
      author: "octocat",
    });
    const app = createApp({ store, env: {} });

    const response = await app.fetch(
      new Request("http://cooee.test/api/admin/changelogs/cl_acme/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ windowEnd: "2026-06-05T23:00:00.000Z" }),
      }),
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.status).toBe("held");
    expect(body.holdReason).toBe("openai-not-configured");
  });

  test("regenerates marketing copy for an existing post without overwriting it", async () => {
    const store = InMemoryStore.seeded();
    const originalSummary = store.entries[0].summary;
    store.aiFeedback.push(
      {
        id: "feedback_current_changelog",
        workspaceId: "ws_acme",
        changelogId: "cl_acme",
        entryId: "entry_dismissed",
        title: "Internal dependency update",
        summary: "A dependency was upgraded.",
        category: "maintenance",
        note: "Do not publish dependency-only updates.",
        createdAt: "2026-06-08T00:00:00.000Z",
      },
      {
        id: "feedback_other_changelog",
        workspaceId: "ws_acme",
        changelogId: "cl_other",
        entryId: "entry_other",
        title: "Other repository update",
        summary: "This learning belongs to another repository.",
        category: "maintenance",
        note: "Do not use this learning here.",
        createdAt: "2026-06-08T00:00:00.000Z",
      },
    );
    const seenPullRequestNumbers: number[][] = [];
    const seenCategoryIds: string[][] = [];
    const seenLearningIds: string[][] = [];
    const seenRewriteInstructions: Array<string | undefined> = [];
    const summarizer: AiSummarizer = {
      summarize: async (pullRequests, options) => {
        seenPullRequestNumbers.push(
          pullRequests.map((pullRequest) => pullRequest.number),
        );
        seenCategoryIds.push(
          (options?.categoryDefinitions ?? []).map((category) => category.id),
        );
        seenLearningIds.push(
          (options?.learnings ?? []).map((learning) => learning.id),
        );
        seenRewriteInstructions.push(options?.rewriteInstructions);

        return {
          title: "Saved filter views",
          summary:
            "Saved filters now give teams a faster way to return to their most important views.",
          category: "feature",
          confidence: 0.95,
          sensitive: false,
          items: [
            {
              title: "Saved filter views",
              summary:
                "Saved filters now give teams a faster way to return to their most important views.",
              category: "feature",
              sourcePullRequestNumbers: [42],
            },
          ],
        };
      },
    };
    const app = createApp({ store, summarizer });

    const response = await app.fetch(
      new Request(
        "http://cooee.test/api/admin/changelog-entries/entry_saved_filters/regenerate-marketing-copy",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            category: "feature",
            rewriteInstructions:
              "  Lead with the time saved and keep the implementation detail brief.  ",
          }),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      title: "Saved filter views",
      summary:
        "Saved filters now give teams a faster way to return to their most important views.",
      category: "feature",
    });
    expect(seenPullRequestNumbers).toEqual([[42]]);
    expect(seenCategoryIds).toEqual([["feature"]]);
    expect(seenLearningIds).toEqual([["feedback_current_changelog"]]);
    expect(seenRewriteInstructions).toEqual([
      "Lead with the time saved and keep the implementation detail brief.",
    ]);
    expect(store.entries[0].summary).toBe(originalSummary);
  });

  test("regenerates copy for any category and falls back when source metadata is missing", async () => {
    const store = InMemoryStore.seeded();
    const entry = await store.createEntry({
      changelogId: "cl_acme",
      title: "Webhook retry logs",
      summary: "Webhook retries are easier to inspect.",
      category: "improvement",
      status: "published",
      publishedAt: "2026-06-08T04:15:00.000Z",
      windowEndedAt: "2026-06-08T23:00:00.000Z",
      sourcePullRequests: [],
    });
    const seenPullRequests: PullRequestMetadata[][] = [];
    const summarizer: AiSummarizer = {
      summarize: async (pullRequests) => {
        seenPullRequests.push(pullRequests);

        return {
          title: "Clearer webhook retry status",
          summary: "Webhook retries now show clearer status for follow-up.",
          category: "improvement",
          confidence: 0.95,
          sensitive: false,
          items: [
            {
              title: "Clearer webhook retry status",
              summary: "Webhook retries now show clearer status for follow-up.",
              category: "improvement",
              sourcePullRequestNumbers: [1],
            },
          ],
        };
      },
    };
    const app = createApp({ store, summarizer });

    const response = await app.fetch(
      new Request(
        `http://cooee.test/api/admin/changelog-entries/${entry.id}/regenerate-marketing-copy`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ category: "improvement" }),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      title: "Clearer webhook retry status",
      summary: "Webhook retries now show clearer status for follow-up.",
      category: "improvement",
    });
    expect(seenPullRequests[0]).toEqual([
      expect.objectContaining({
        title: "Webhook retry logs",
        body: "Webhook retries are easier to inspect.",
        labels: ["improvement"],
      }),
    ]);
  });

  test("generates a post image for an existing changelog post", async () => {
    const store = InMemoryStore.seeded();
    const originalSummary = store.entries[0].summary;
    const seenPrompts: Array<{
      category: string;
      summary: string;
      title: string;
    }> = [];
    const imageGenerator = {
      generatePostImage: async (input: {
        category: string;
        summary: string;
        title: string;
      }) => {
        seenPrompts.push(input);
        return {
          imageUrl: "data:image/webp;base64,cG9zdC1pbWFnZQ==",
        };
      },
    };
    const app = createApp({ store, imageGenerator } as any);

    const response = await app.fetch(
      new Request(
        "http://cooee.test/api/admin/changelog-entries/entry_saved_filters/generate-image",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            category: "feature",
            summary: "Saved filters now get a more visual launch post.",
            title: "Saved filter views",
          }),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "entry_saved_filters",
      imageUrl: "data:image/webp;base64,cG9zdC1pbWFnZQ==",
      summary: originalSummary,
      title: "Saved filters",
    });
    expect(seenPrompts).toEqual([
      {
        category: "feature",
        summary: "Saved filters now get a more visual launch post.",
        title: "Saved filter views",
      },
    ]);
    expect(store.entries[0].summary).toBe(originalSummary);
    expect(store.entries[0].imageUrl).toBe(
      "data:image/webp;base64,cG9zdC1pbWFnZQ==",
    );
  });

  test("requires explicit OpenAI image model configuration", () => {
    expect(
      createDefaultImageGenerator({
        OPENAI_API_KEY: "sk-test",
      }).disabledReason,
    ).toBe("openai-image-model-not-configured");
    expect(
      createDefaultImageGenerator({
        OPENAI_API_KEY: "sk-test",
        OPENAI_IMAGE_MODEL: "gpt-image-2",
      }).disabledReason,
    ).toBeUndefined();

    const source = readFileSync(
      new URL("../services/openai.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("!env.OPENAI_IMAGE_MODEL");
    expect(source).not.toContain('env.OPENAI_IMAGE_MODEL ?? "gpt-image-2"');
  });

  test("OpenAI prompts speak directly to the changelog reader", () => {
    const source = readFileSync(
      new URL("../services/openai.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("Speak directly to the reader as you/your");
    expect(source).toContain(
      "do not refer to the reader as users, merchants, customers, store owners, teams",
    );
    expect(source).toContain("not as users, merchants, customers");
  });

  test("reports post image generation availability without config details", async () => {
    const store = InMemoryStore.seeded();
    const app = createApp({
      store,
      imageGenerator: {
        disabledReason: "openai-image-model-not-configured",
        generatePostImage: async () => {
          throw new Error("not configured");
        },
      },
    } as any);

    const response = await app.fetch(
      new Request(
        "http://cooee.test/api/admin/post-image-generation/availability",
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      available: false,
      reason: "Post image generation is not configured.",
    });
    expect(JSON.stringify(body)).not.toContain("OPENAI");
    expect(JSON.stringify(body)).not.toContain("gpt-image-2");
  });

  test("returns generic provider image errors without leaking provider details", async () => {
    const store = InMemoryStore.seeded();
    const imageGenerator = {
      generatePostImage: async () => {
        throw new Error(
          'OpenAI image model "gpt-image-2" is not available for this project.',
        );
      },
    };
    const app = createApp({ store, imageGenerator } as any);

    const response = await app.fetch(
      new Request(
        "http://cooee.test/api/admin/changelog-entries/entry_saved_filters/generate-image",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            category: "feature",
            summary: "Saved filters now get a more visual launch post.",
            title: "Saved filter views",
          }),
        },
      ),
    );

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({
      error: "Post image generation is temporarily unavailable.",
      unavailable: true,
    });
    expect(JSON.stringify(body)).not.toContain("proj_");
    expect(JSON.stringify(body)).not.toContain("gpt-image-2");
    expect(store.entries[0].imageUrl).toBeNull();
  });

  test("uploads a manual post image to asset storage", async () => {
    const store = InMemoryStore.seeded();
    const assetStorage = new TestAssetStorage();
    const app = createApp({ assetStorage, store });
    const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const form = new FormData();
    form.set(
      "image",
      new Blob([imageBytes], { type: "image/png" }),
      "post.png",
    );
    form.set("category", "feature");

    const response = await app.fetch(
      new Request(
        "http://cooee.test/api/admin/changelog-entries/entry_saved_filters/image",
        {
          method: "POST",
          body: form,
        },
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      id: "entry_saved_filters",
      imageUrl:
        "/api/public/workspaces/ws_acme/changelog-entries/entry_saved_filters/image",
    });
    expect(store.entries[0].imageUrl).toBe(body.imageUrl);
    expect([...assetStorage.objects.keys()]).toEqual([
      "workspaces/ws_acme/changelog-entries/entry_saved_filters/image",
    ]);

    const publicImage = await app.fetch(
      new Request(
        "http://cooee.test/api/public/workspaces/ws_acme/changelog-entries/entry_saved_filters/image",
      ),
    );

    expect(publicImage.status).toBe(200);
    expect(publicImage.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await publicImage.arrayBuffer())).toEqual(imageBytes);

    const canonicalPublicImage = await app.fetch(
      new Request(
        "http://cooee.test/api/public/changelogs/acme-app/entries/entry_saved_filters/image",
      ),
    );

    expect(canonicalPublicImage.status).toBe(200);
    expect(canonicalPublicImage.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await canonicalPublicImage.arrayBuffer())).toEqual(
      imageBytes,
    );
  });

  test("historical generation runs across the requested lookback window", async () => {
    const store = InMemoryStore.seeded();
    store.pullRequests.push(
      {
        id: "pr_40",
        number: 40,
        title: "Improve onboarding checklist",
        body: "Users can complete setup faster.",
        labels: ["improvement"],
        mergedAt: "2026-06-04T04:15:00.000Z",
        url: "https://github.com/acme/app/pull/40",
        repository: "acme/app",
        author: "octocat",
      },
      {
        id: "pr_45",
        number: 45,
        title: "Improve saved filter sharing",
        body: "Users can share saved filters with teammates.",
        labels: ["improvement"],
        mergedAt: "2026-06-05T04:15:00.000Z",
        url: "https://github.com/acme/app/pull/45",
        repository: "acme/app",
        author: "octocat",
      },
      {
        id: "pr_43",
        number: 43,
        title: "Add export controls",
        body: "Users can export filtered reports.",
        labels: ["feature"],
        mergedAt: "2026-06-06T04:15:00.000Z",
        url: "https://github.com/acme/app/pull/43",
        repository: "acme/app",
        author: "octocat",
      },
      {
        id: "pr_49",
        number: 49,
        title: "Show recent merged changes",
        body: "Backfill includes pull requests merged just before the run.",
        labels: ["feature"],
        mergedAt: "2026-06-07T00:05:00.000Z",
        url: "https://github.com/acme/app/pull/49",
        repository: "acme/app",
        author: "octocat",
      },
    );
    const summarizer: AiSummarizer = {
      summarize: async (pullRequests) => ({
        title: pullRequests.map((pr) => `PR ${pr.number}`).join(", "),
        summary: "Historical updates were generated from merged pull requests.",
        category: "improvement",
        confidence: 0.95,
        sensitive: false,
      }),
    };
    const app = createApp({ env: {}, store, summarizer });

    const response = await app.fetch(
      new Request(
        "http://cooee.test/api/admin/changelogs/cl_acme/generate-historical",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ days: 3, now: "2026-06-07T00:30:00.000Z" }),
        },
      ),
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.windows).toMatchObject([
      {
        startedAt: "2026-06-04T00:30:00.000Z",
        endedAt: "2026-06-07T00:30:00.000Z",
        status: "published",
      },
    ]);
    expect(
      body.windows.map((window: { status: string }) => window.status),
    ).toEqual(["published"]);
    expect(
      store.entries
        .filter((entry) => entry.title.startsWith("PR "))
        .map((entry) => entry.title),
    ).toEqual(["PR 49", "PR 43", "PR 45", "PR 40"]);
  });

  test("historical generation accepts an inclusive local date range", async () => {
    const store = InMemoryStore.seeded();
    store.pullRequests = [
      {
        id: "pr_range",
        number: 91,
        title: "Add date range backfills",
        body: "Backfills can cover selected dates.",
        labels: ["feature"],
        mergedAt: "2026-06-05T04:15:00.000Z",
        url: "https://github.com/acme/app/pull/91",
        repository: "acme/app",
        author: "octocat",
      },
    ];
    const summarizer: AiSummarizer = {
      summarize: async () => ({
        title: "Add date range backfills",
        summary: "Backfills can cover selected dates.",
        category: "feature",
        confidence: 0.95,
        sensitive: false,
      }),
    };
    const app = createApp({ env: {}, store, summarizer });

    const response = await app.fetch(
      new Request(
        "http://cooee.test/api/admin/changelogs/cl_acme/generate-historical",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            startDate: "2026-06-05",
            endDate: "2026-06-05",
          }),
        },
      ),
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.windows).toMatchObject([
      {
        startedAt: "2026-06-04T14:00:00.000Z",
        endedAt: "2026-06-05T14:00:00.000Z",
        status: "published",
      },
    ]);
  });

  test("GitHub merged pull request webhooks store PR metadata", async () => {
    const store = InMemoryStore.seeded();
    store.pullRequests = [];
    const webhookSecret = "webhook-secret";
    const app = createApp({
      store,
      env: {
        GITHUB_WEBHOOK_SECRET: webhookSecret,
      },
    });
    const payload = JSON.stringify({
      action: "closed",
      repository: {
        full_name: "acme/app",
      },
      pull_request: {
        id: 3796624863,
        number: 44,
        title: "Add usage dashboard",
        body: "Customers can now track usage trends.",
        merged: true,
        merged_at: "2026-06-06T04:15:00.000Z",
        html_url: "https://github.com/acme/app/pull/44?utm=private",
        user: {
          login: "octocat",
        },
        labels: [
          {
            name: "feature",
          },
        ],
      },
    });

    const response = await app.fetch(
      new Request("http://cooee.test/api/webhooks/github", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": await signPayload(payload, webhookSecret),
        },
        body: payload,
      }),
    );

    expect(response.status).toBe(202);
    expect(store.pullRequests).toEqual([
      {
        id: "github_3796624863",
        number: 44,
        title: "Add usage dashboard",
        body: "Customers can now track usage trends.",
        labels: ["feature"],
        mergedAt: "2026-06-06T04:15:00.000Z",
        url: "https://github.com/acme/app/pull/44",
        repository: "acme/app",
        author: "octocat",
      },
    ]);
  });

  test("acknowledges every-merge webhooks after durably queueing one job", async () => {
    const store = InMemoryStore.seeded();
    store.pullRequests = [];
    store.changelogs[0].settings.scheduleFrequency = "on-merge";
    const webhookSecret = "webhook-secret";
    let summarizeCalls = 0;
    const summarizer: AiSummarizer = {
      summarize: async () => {
        summarizeCalls += 1;
        return {
          title: "Queued PR",
          summary: "Customers can now track usage trends more easily.",
          category: "feature",
          confidence: 0.95,
          sensitive: false,
        };
      },
    };
    const app = createApp({
      store,
      summarizer,
      env: { GITHUB_WEBHOOK_SECRET: webhookSecret },
    });
    const payload = JSON.stringify({
      action: "closed",
      repository: { full_name: "acme/app" },
      pull_request: {
        id: 3796624863,
        number: 44,
        title: "Add usage dashboard",
        body: "Customers can now track usage trends.",
        merged: true,
        merged_at: "2026-06-06T04:15:00.000Z",
        html_url: "https://github.com/acme/app/pull/44",
        user: { login: "octocat" },
        labels: [{ name: "feature" }],
      },
    });
    const request = async () =>
      app.fetch(
        new Request("http://cooee.test/api/webhooks/github", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": await signPayload(payload, webhookSecret),
          },
          body: payload,
        }),
      );

    expect((await request()).status).toBe(202);
    expect((await request()).status).toBe(202);

    expect(summarizeCalls).toBe(0);
    expect(store.mergeGenerationJobs).toHaveLength(1);
    expect(store.mergeGenerationJobs[0]).toMatchObject({
      changelogId: "cl_acme",
      pullRequestNumber: 44,
      status: "pending",
      windowStartedAt: "2026-06-06T04:15:00.000Z",
    });
  });

  test("persists manual posts without requiring AI", async () => {
    const store = InMemoryStore.seeded();
    store.workspaces[0].billingMode = "hosted";
    store.workspaces[0].repositoryLimit = 1;
    const app = createApp({ store });

    const response = await app.fetch(
      new Request("http://cooee.test/api/admin/changelogs/cl_acme/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Manual release note",
          summary: "This post was written without AI.",
          category: "improvement",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      title: "Manual release note",
      status: "published",
      sourcePullRequests: [],
    });
    expect(await store.listEntries("cl_acme")).toContainEqual(
      expect.objectContaining({ title: "Manual release note" }),
    );
  });

  test("updates and deletes changelog entries", async () => {
    const store = InMemoryStore.seeded();
    const app = createApp({ store });
    const entry = store.entries[0];
    expect(entry).toBeDefined();

    const updated = await app.fetch(
      new Request(`http://cooee.test/api/admin/changelog-entries/${entry.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Edited update",
          summary: "The public changelog copy was corrected.",
          category: "improvement",
          publishedAt: "2999-06-08T04:15:00.000Z",
        }),
      }),
    );

    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      id: entry.id,
      title: "Edited update",
      summary: "The public changelog copy was corrected.",
      category: "improvement",
      publishedAt: "2999-06-08T04:15:00.000Z",
    });
    expect(store.entries[0]).toMatchObject({
      id: entry.id,
      title: "Edited update",
      summary: "The public changelog copy was corrected.",
      category: "improvement",
      publishedAt: "2999-06-08T04:15:00.000Z",
    });

    const deleted = await app.fetch(
      new Request(`http://cooee.test/api/admin/changelog-entries/${entry.id}`, {
        method: "DELETE",
      }),
    );

    expect(deleted.status).toBe(204);
    expect(store.entries.some((item) => item.id === entry.id)).toBe(false);
  });

  test("marks changelog entries as not relevant and stores AI feedback", async () => {
    const store = InMemoryStore.seeded();
    const app = createApp({ store });
    const entry = store.entries[0];
    expect(entry).toBeDefined();

    const response = await app.fetch(
      new Request(
        `http://cooee.test/api/admin/changelog-entries/${entry.id}/not-relevant`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            note: "Dependency-only updates are not relevant.",
          }),
        },
      ),
    );

    expect(response.status).toBe(204);
    expect(store.entries.some((item) => item.id === entry.id)).toBe(false);
    expect(store.aiFeedback).toEqual([
      {
        id: expect.any(String),
        workspaceId: "ws_acme",
        changelogId: "cl_acme",
        entryId: entry.id,
        title: entry.title,
        summary: entry.summary,
        category: entry.category,
        note: "Dependency-only updates are not relevant.",
        createdAt: expect.any(String),
      },
    ]);
  });

  test("hides label-skipped holds but keeps reviewable holds actionable", async () => {
    const store = InMemoryStore.seeded();
    store.pullRequests.push({
      id: "pr_46",
      number: 46,
      title: "Customer address normalization",
      body: "Normalize customer addresses before export.",
      labels: ["improvement"],
      mergedAt: "2026-06-07T04:15:00.000Z",
      url: "https://github.com/acme/app/pull/46",
      repository: "acme/app",
      author: "octocat",
    });
    await store.createEntry({
      changelogId: "cl_acme",
      title: "Update held for review",
      summary:
        "One or more pull requests matched privacy controls and need review before publishing.",
      category: "maintenance",
      status: "held",
      publishedAt: null,
      holdReason: "skip-label:cooee:skip",
      windowEndedAt: "2026-06-06T23:00:00.000Z",
      sourcePullRequests: [
        {
          number: 44,
          title: "Customer-facing skipped update",
          url: "https://github.com/acme/app/pull/44",
          author: "octocat",
        },
      ],
    });
    const heldEntry = await store.createEntry({
      changelogId: "cl_acme",
      title: "Update held for review",
      summary:
        "One or more pull requests matched privacy controls and need review before publishing.",
      category: "maintenance",
      status: "held",
      publishedAt: null,
      holdReason: "sensitive-content",
      windowEndedAt: "2026-06-07T23:00:00.000Z",
      sourcePullRequests: [
        {
          number: 46,
          title: "Customer address normalization",
          url: "https://github.com/acme/app/pull/46",
          author: "octocat",
        },
      ],
    });
    const app = createApp({ store });

    const list = await app.fetch(
      new Request("http://cooee.test/api/admin/changelogs/cl_acme/entries"),
    );
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody).toMatchObject({
      heldEntries: [
        {
          id: heldEntry.id,
          title: "Update held for review",
          status: "held",
          holdReason: "sensitive-content",
          processedAt: expect.any(String),
          windowEndedAt: "2026-06-07T23:00:00.000Z",
          sourcePullRequests: [
            {
              number: 46,
              title: "Customer address normalization",
              url: "https://github.com/acme/app/pull/46",
              author: "octocat",
              mergedAt: "2026-06-07T04:15:00.000Z",
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(listBody)).not.toContain(
      "Customer-facing skipped update",
    );

    const published = await app.fetch(
      new Request(
        `http://cooee.test/api/admin/changelog-entries/${heldEntry.id}/publish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "Customer address normalization",
            summary: "Address normalization is ready to describe publicly.",
            category: "improvement",
          }),
        },
      ),
    );
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({
      id: heldEntry.id,
      title: "Customer address normalization",
      summary: "Address normalization is ready to describe publicly.",
      category: "improvement",
      status: "published",
      publishedAt: "2026-06-07T04:15:00.000Z",
    });

    const relevantEntry = await store.createEntry({
      changelogId: "cl_acme",
      title: "Billing import improvements",
      summary: "Billing imports are now safer to retry.",
      category: "improvement",
      status: "held",
      publishedAt: null,
      holdReason: "sensitive-label:security",
      windowEndedAt: "2026-06-06T23:00:00.000Z",
      sourcePullRequests: [
        {
          number: 45,
          title: "Billing import cleanup",
          url: "https://github.com/acme/app/pull/45",
          author: "mona",
        },
      ],
    });

    const relevant = await app.fetch(
      new Request(
        `http://cooee.test/api/admin/changelog-entries/${relevantEntry.id}/relevant`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            note: "This held PR should be considered customer-relevant.",
          }),
        },
      ),
    );

    expect(relevant.status).toBe(204);
    expect(store.entries.some((entry) => entry.id === relevantEntry.id)).toBe(
      false,
    );
    expect(store.aiFeedback[0]).toMatchObject({
      entryId: relevantEntry.id,
      title: "Billing import improvements",
      note: "Marked relevant. This held PR should be considered customer-relevant.",
    });
  });

  test("regenerates a held draft from its source pull request with current writing settings", async () => {
    const store = InMemoryStore.seeded();
    store.workspaceSettings.set("ws_acme", {
      aiAudience: "technical-users",
      aiPersonality: "concise",
    });
    store.pullRequests.push({
      id: "pr_49",
      number: 49,
      title: "Improve activity exports",
      body: "Customers can export filtered activity with clearer file names.",
      labels: ["feature"],
      mergedAt: "2026-06-07T04:15:00.000Z",
      url: "https://github.com/acme/app/pull/49",
      repository: "acme/app",
      author: "octocat",
    });
    const heldEntry = await store.createEntry({
      changelogId: "cl_acme",
      title: "Update held for review",
      summary: "Cooee generated a draft that needs review.",
      category: "maintenance",
      status: "held",
      publishedAt: null,
      holdReason: "low-confidence",
      windowEndedAt: "2026-06-07T23:00:00.000Z",
      sourcePullRequests: [
        {
          number: 49,
          title: "Improve activity exports",
          url: "https://github.com/acme/app/pull/49",
          author: "octocat",
          mergedAt: "2026-06-07T04:15:00.000Z",
        },
      ],
    });
    const seenOptions: Array<{
      aiAudience?: string;
      aiPersonality?: string;
    }> = [];
    const summarizer: AiSummarizer = {
      summarize: async (_pullRequests, options) => {
        seenOptions.push({
          aiAudience: options?.aiAudience,
          aiPersonality: options?.aiPersonality,
        });

        return {
          title: "Cleaner activity exports",
          summary:
            "Filtered activity exports now use clearer file names for faster sharing.",
          category: "feature",
          confidence: 0.95,
          sensitive: false,
          items: [
            {
              title: "Cleaner activity exports",
              summary:
                "Filtered activity exports now use clearer file names for faster sharing.",
              category: "feature",
              sourcePullRequestNumbers: [49],
            },
          ],
        };
      },
    };
    const app = createApp({ store, summarizer });

    const response = await app.fetch(
      new Request(
        `http://cooee.test/api/admin/changelog-entries/${heldEntry.id}/regenerate`,
        { method: "POST" },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: heldEntry.id,
      title: "Cleaner activity exports",
      summary:
        "Filtered activity exports now use clearer file names for faster sharing.",
      category: "feature",
      status: "held",
      windowEndedAt: "2026-06-07T23:00:00.000Z",
    });
    expect(seenOptions).toEqual([
      {
        aiAudience: "technical-users",
        aiPersonality: "concise",
      },
    ]);
    expect(
      store.entries.find((entry) => entry.id === heldEntry.id),
    ).toMatchObject({
      title: "Cleaner activity exports",
      status: "held",
    });
  });

  test("merges selected changelog entries with AI and stores merge learnings", async () => {
    const store = InMemoryStore.seeded();
    const [firstEntry, secondEntry] = store.entries;
    expect(firstEntry).toBeDefined();
    expect(secondEntry).toBeDefined();
    const summarizer: AiSummarizer = {
      summarize: async () => ({
        title: "Unused",
        summary: "Unused.",
        category: "maintenance",
        confidence: 0.95,
        sensitive: false,
      }),
      mergeEntries: async (entries) => ({
        title: "Account access improvements",
        summary: entries.map((entry) => entry.title).join(" and "),
        category: "improvement",
        confidence: 0.95,
        sensitive: false,
      }),
    };
    const app = createApp({ store, summarizer });

    const response = await app.fetch(
      new Request("http://cooee.test/api/admin/changelog-entries/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entryIds: [firstEntry.id, secondEntry.id],
        }),
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.title).toBe("Account access improvements");
    expect(body.summary).toBe("Saved filters and More reliable login");
    expect(body.category).toBe("improvement");
    expect(store.entries.some((entry) => entry.id === firstEntry.id)).toBe(
      false,
    );
    expect(store.entries.some((entry) => entry.id === secondEntry.id)).toBe(
      false,
    );
    expect(store.entries[0]).toMatchObject({
      title: "Account access improvements",
      summary: "Saved filters and More reliable login",
      category: "improvement",
      status: "published",
    });
    expect(store.aiFeedback).toHaveLength(2);
    expect(store.aiFeedback.map((feedback) => feedback.entryId).sort()).toEqual(
      [firstEntry.id, secondEntry.id].sort(),
    );
    expect(
      store.aiFeedback.every((feedback) =>
        feedback.note?.includes("Merged with related posts"),
      ),
    ).toBe(true);
  });

  test("serves GitHub App connection status and install redirect", async () => {
    const store = InMemoryStore.seeded();
    const app = createApp({
      store,
      env: {
        GITHUB_APP_ID: "12345",
        GITHUB_APP_SLUG: "cooee-test",
        GITHUB_APP_PRIVATE_KEY: "test-private-key",
      },
    });

    const status = await app.fetch(
      new Request("http://cooee.test/api/admin/github/app"),
    );
    expect(status.status).toBe(200);
    const body = await status.json();
    expect(body.configured).toBe(true);
    expect(body.billingEnabled).toBe(false);
    expect(body.billingMode).toBe("self-hosted");
    expect(body.installUrl).toBe(
      "https://github.com/apps/cooee-test/installations/new",
    );
    expect(body.repositoryLimit).toBeNull();
    expect(body.repositories).toEqual([
      {
        id: "repo_acme",
        fullName: "acme/app",
        owner: "acme",
        name: "app",
        private: false,
        installationId: 12345,
        accountLogin: "acme",
        selected: true,
        changelogId: "cl_acme",
        changelogSlug: "acme-app",
      },
    ]);

    const redirect = await app.fetch(
      new Request("http://cooee.test/api/admin/github/install"),
    );
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(
      "https://github.com/apps/cooee-test/installations/new",
    );
  });

  test("returns hosted workspace repository allowance in GitHub App status", async () => {
    const store = new InMemoryStore({
      workspaces: [
        {
          id: "ws_acme",
          name: "Acme",
          billingMode: "hosted",
          repositoryLimit: 1,
        },
      ],
      githubInstallations: [
        {
          id: "ghi_acme",
          workspaceId: "ws_acme",
          installationId: 12345,
          accountLogin: "acme",
          accountType: "Organization",
          suspendedAt: null,
        },
      ],
      repositories: [
        {
          id: "repo_app",
          workspaceId: "ws_acme",
          githubInstallationId: "ghi_acme",
          owner: "acme",
          name: "app",
          fullName: "acme/app",
          private: true,
        },
        {
          id: "repo_api",
          workspaceId: "ws_acme",
          githubInstallationId: "ghi_acme",
          owner: "acme",
          name: "api",
          fullName: "acme/api",
          private: true,
        },
      ],
    });
    const app = createApp({
      store,
      env: {
        GITHUB_APP_ID: "12345",
        GITHUB_APP_SLUG: "cooee-test",
        GITHUB_APP_PRIVATE_KEY: "test-private-key",
      },
    });

    const status = await app.fetch(
      new Request("http://cooee.test/api/admin/github/app"),
    );

    expect(status.status).toBe(200);
    const body = await status.json();
    expect(body.billingEnabled).toBe(false);
    expect(body.billingMode).toBe("hosted");
    expect(body.repositoryLimit).toBe(1);
    expect(
      body.repositories
        .map((repository: { fullName: string }) => repository.fullName)
        .sort(),
    ).toEqual(["acme/api", "acme/app"]);
  });

  test("serves hosted billing subscription details without exposing internal billing ids", async () => {
    const changelogSettings: StoredChangelog["settings"] = {
      skipLabels: ["cooee:skip", "cooee:internal"],
      sensitiveLabels: ["security", "vulnerability"],
      categoryDefinitions: defaultChangelogCategoryDefinitions,
      groupEntriesByCategory: true,
      scheduleFrequency: "daily",
      publishTime: "09:00",
      timeZone: "UTC",
      includePullRequestLinks: false,
      publicTheme: "light",
    };
    const store = new InMemoryStore({
      workspaces: [
        {
          id: "ws_acme",
          name: "Acme",
          billingMode: "hosted",
          repositoryLimit: 3,
          stripeCustomerId: "cus_workspace",
        },
      ],
      repositories: [
        {
          id: "repo_api",
          workspaceId: "ws_acme",
          githubInstallationId: null,
          owner: "acme",
          name: "api",
          fullName: "acme/api",
          private: false,
        },
        {
          id: "repo_app",
          workspaceId: "ws_acme",
          githubInstallationId: null,
          owner: "acme",
          name: "app",
          fullName: "acme/app",
          private: false,
        },
        {
          id: "repo_marketing",
          workspaceId: "ws_acme",
          githubInstallationId: null,
          owner: "acme",
          name: "marketing",
          fullName: "acme/marketing",
          private: false,
        },
      ],
      changelogs: [
        {
          id: "cl_api",
          workspaceId: "ws_acme",
          repositoryId: "repo_api",
          slug: "acme-api",
          name: "Acme API",
          description: "Latest API updates",
          publicUrl: "https://cooee.test/changelog/acme-api",
          customDomain: null,
          customHostnameId: null,
          customHostnameStatus: null,
          customHostnameSslStatus: null,
          repository: "acme/api",
          settings: changelogSettings,
          lastGeneratedWindowEnd: null,
        },
        {
          id: "cl_app",
          workspaceId: "ws_acme",
          repositoryId: "repo_app",
          slug: "acme-app",
          name: "Acme App",
          description: "Latest app updates",
          publicUrl: "https://cooee.test/changelog/acme-app",
          customDomain: null,
          customHostnameId: null,
          customHostnameStatus: null,
          customHostnameSslStatus: null,
          repository: "acme/app",
          settings: changelogSettings,
          lastGeneratedWindowEnd: null,
        },
      ],
      pullRequests: [
        {
          id: "pr_1",
          number: 1,
          title: "Add billing usage",
          body: "",
          labels: [],
          mergedAt: "2026-05-20T00:00:00.000Z",
          url: "https://github.com/acme/api/pull/1",
          repository: "acme/api",
          author: "octocat",
        },
        {
          id: "pr_2",
          number: 2,
          title: "Improve billing usage",
          body: "",
          labels: [],
          mergedAt: "2026-06-01T00:00:00.000Z",
          url: "https://github.com/acme/app/pull/2",
          repository: "acme/app",
          author: "mona",
        },
        {
          id: "pr_unselected",
          number: 4,
          title: "Unselected repository work",
          body: "",
          labels: [],
          mergedAt: "2026-06-02T00:00:00.000Z",
          url: "https://github.com/acme/marketing/pull/4",
          repository: "acme/marketing",
          author: "mona",
        },
        {
          id: "pr_old",
          number: 3,
          title: "Old usage",
          body: "",
          labels: [],
          mergedAt: "2026-04-20T00:00:00.000Z",
          url: "https://github.com/acme/app/pull/3",
          repository: "acme/app",
          author: "mona",
        },
      ],
      billingSubscriptions: [
        {
          id: "sub_acme",
          workspaceId: "ws_acme",
          stripeSubscriptionId: "sub_123",
          stripeCustomerId: "cus_123",
          status: "active",
          planId: "pineapple",
          billingCadence: "monthly",
          priceId: "price_starter",
          repositoryLimit: 3,
          currentPeriodStart: "2026-05-13T00:00:00.000Z",
          currentPeriodEnd: "2026-06-13T00:00:00.000Z",
          billingEmail: null,
          cancelAtPeriodEnd: false,
          cancelAt: null,
          endedAt: null,
          lastPaymentFailedAt: null,
        },
      ],
    });
    store.processedPullRequestUsage.push(
      {
        workspaceId: "ws_acme",
        repositoryId: "repo_api",
        pullRequestNumber: 1,
        periodStartedAt: "2026-05-13T00:00:00.000Z",
        processedAt: "2026-05-20T00:00:00.000Z",
      },
      {
        workspaceId: "ws_acme",
        repositoryId: "repo_app",
        pullRequestNumber: 2,
        periodStartedAt: "2026-05-13T00:00:00.000Z",
        processedAt: "2026-06-01T00:00:00.000Z",
      },
    );
    store.aiUsageEvents.push({
      id: "usage_header",
      workspaceId: "ws_acme",
      stripeCustomerId: "cus_123",
      sourceId: "generation:cl_app:header",
      inputTokens: 10_000,
      cachedInputTokens: 0,
      outputTokens: 2_500,
      totalTokens: 12_500,
      rechargePacksReported: 0,
      createdAt: "2026-06-01T01:00:00.000Z",
      reportedAt: "2026-06-01T01:00:01.000Z",
    });
    const app = createApp({
      store,
      env: {
        BILLING_ENABLED: "true",
      },
    });

    const response = await app.fetch(
      new Request("http://cooee.test/api/admin/billing/subscription", {
        headers: { "cf-ipcountry": "GB" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      enabled: true,
      billingMode: "hosted",
      currency: "gbp",
      repositoryLimit: 3,
      usage: {
        connectedRepositories: 2,
        pullRequestsThisPeriod: 2,
        periodStartedAt: "2026-05-13T00:00:00.000Z",
        periodEndedAt: "2026-06-13T00:00:00.000Z",
      },
      plans: [
        {
          id: "lobster",
          monthlyAmount: 20,
          annualAmount: 200,
          priceLabel: "£20",
          annualPriceLabel: "£200",
          repositoryLimit: 1,
          monthlyPullRequestLimit: 25,
        },
        {
          id: "pineapple",
          repositoryLimit: 3,
          monthlyPullRequestLimit: 100,
        },
        {
          id: "watermelon",
          repositoryLimit: 15,
          monthlyPullRequestLimit: 250,
        },
      ],
      portalUrl: null,
      managementState: "unavailable",
      subscription: {
        status: "active",
        repositoryLimit: 3,
        currentPeriodEnd: "2026-06-13T00:00:00.000Z",
      },
    });
    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain("cus_123");
    expect(serializedBody).not.toContain("sub_123");
    expect(serializedBody).not.toContain("price_starter");
    expect(serializedBody).not.toContain("lookupKey");

    const usageResponse = await app.fetch(
      new Request("http://cooee.test/api/admin/billing/usage"),
    );
    expect(usageResponse.status).toBe(200);
    const usageBody = await usageResponse.json();
    expect(usageBody).toMatchObject({
      billingMode: "hosted",
      entitlements: {
        scheduledPublishing: true,
      },
      usage: {
        aiCreditsThisPeriod: 12.5,
        includedCredits: 120,
        pullRequestsThisPeriod: 2,
      },
    });
    expect(usageBody).not.toHaveProperty("plans");
    expect(usageBody).not.toHaveProperty("portalUrl");
    expect(JSON.stringify(usageBody)).not.toContain("cus_123");
  });

  test("offers guarded billing recovery when the saved customer is unavailable", async () => {
    const store = billingRecoveryStore();
    const { checkoutInput, stripe } = billingRecoveryStripe();
    const app = createApp({
      store,
      stripeClient: stripe,
      env: {
        APP_URL: "https://cooee.test",
        BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_123",
      },
    });

    const detailsResponse = await app.fetch(
      new Request("http://cooee.test/api/admin/billing/subscription"),
    );
    expect(detailsResponse.status).toBe(200);
    expect(await detailsResponse.json()).toMatchObject({
      managementState: "recovery_required",
      portalUrl: null,
      subscription: { planId: "watermelon", status: "active" },
    });

    const checkoutResponse = await app.fetch(
      new Request("http://cooee.test/api/admin/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: "lobster",
          billingCadence: "monthly",
          customerEmail: "owner@example.com",
        }),
      }),
    );
    expect(checkoutResponse.status).toBe(200);
    expect(await checkoutResponse.json()).toEqual({
      enabled: true,
      url: "https://billing.example.test/recovery",
    });
    expect(checkoutInput()).not.toHaveProperty("customer");
    expect(checkoutInput()).toMatchObject({
      customer_email: "owner@example.com",
      metadata: { workspaceId: "ws_acme", planId: "lobster" },
    });
  });

  test("can archive an unavailable saved subscription and continue on Free", async () => {
    const store = billingRecoveryStore();
    const { checkoutInput, stripe } = billingRecoveryStripe();
    const app = createApp({
      store,
      stripeClient: stripe,
      env: {
        APP_URL: "https://cooee.test",
        BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_123",
      },
    });

    const response = await app.fetch(
      new Request("http://cooee.test/api/admin/billing/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "downgrade_to_free" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      managementState: "unavailable",
      planId: "free",
      repositoryLimit: 1,
      subscription: { status: "canceled" },
    });
    expect(await store.getWorkspace("ws_acme")).toMatchObject({
      repositoryLimit: 1,
      stripeCustomerId: null,
    });
    expect(await store.getBillingSubscription("ws_acme")).toMatchObject({
      status: "canceled",
      endedAt: expect.any(String),
    });

    const checkoutResponse = await app.fetch(
      new Request("http://cooee.test/api/admin/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: "lobster",
          billingCadence: "monthly",
          customerEmail: "owner@example.com",
        }),
      }),
    );
    expect(checkoutResponse.status).toBe(200);
    expect(checkoutInput()).not.toHaveProperty("customer");
    expect(checkoutInput()).toMatchObject({
      customer_email: "owner@example.com",
      metadata: { workspaceId: "ws_acme", planId: "lobster" },
    });
  });

  test("archives a saved subscription when portal recovery and customer lookup disagree", async () => {
    const store = billingRecoveryStore();
    const { stripe } = billingRecoveryStripe();
    stripe.customers.retrieve = (async () =>
      ({
        id: "cus_saved",
        object: "customer",
        deleted: false,
      }) as unknown as Stripe.Response<Stripe.Customer>) as typeof stripe.customers.retrieve;
    const app = createApp({
      store,
      stripeClient: stripe,
      env: {
        APP_URL: "https://cooee.test",
        BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_123",
      },
    });

    const detailsResponse = await app.fetch(
      new Request("http://cooee.test/api/admin/billing/subscription"),
    );
    expect(await detailsResponse.json()).toMatchObject({
      managementState: "recovery_required",
    });

    const response = await app.fetch(
      new Request("http://cooee.test/api/admin/billing/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "downgrade_to_free" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      planId: "free",
      repositoryLimit: 1,
      subscription: { status: "canceled" },
    });
  });

  test("sends a stale recovery request to the manageable subscription portal", async () => {
    const store = billingRecoveryStore();
    const stripe = new Stripe("sk_test_123", {
      apiVersion: "2026-02-25.clover",
    });
    stripe.customers.retrieve = (async () =>
      ({
        id: "cus_saved",
        object: "customer",
        deleted: false,
      }) as unknown as Stripe.Response<Stripe.Customer>) as typeof stripe.customers.retrieve;
    stripe.billingPortal.sessions.create = (async () =>
      ({
        url: "https://billing.example.test/manage",
      }) as Stripe.Response<Stripe.BillingPortal.Session>) as typeof stripe.billingPortal.sessions.create;
    const app = createApp({
      store,
      stripeClient: stripe,
      env: {
        APP_URL: "https://cooee.test",
        BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_123",
      },
    });

    const checkoutResponse = await app.fetch(
      new Request("http://cooee.test/api/admin/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: "lobster",
          billingCadence: "monthly",
          recoverSubscription: true,
        }),
      }),
    );
    expect(checkoutResponse.status).toBe(200);
    expect(await checkoutResponse.json()).toEqual({
      enabled: true,
      url: "https://billing.example.test/manage",
    });

    const freeResponse = await app.fetch(
      new Request("http://cooee.test/api/admin/billing/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "downgrade_to_free" }),
      }),
    );
    expect(freeResponse.status).toBe(409);
    expect(await store.getBillingSubscription("ws_acme")).toMatchObject({
      status: "active",
      endedAt: null,
    });
  });

  test("returns a safe billing error when a portal session cannot be created", async () => {
    const store = billingRecoveryStore();
    const stripe = new Stripe("sk_test_123", {
      apiVersion: "2026-02-25.clover",
    });
    stripe.customers.retrieve = (async () =>
      ({
        id: "cus_saved",
        object: "customer",
        deleted: false,
      }) as unknown as Stripe.Response<Stripe.Customer>) as typeof stripe.customers.retrieve;
    stripe.billingPortal.sessions.create = (async () => {
      throw new Error("Billing portal is unavailable");
    }) as typeof stripe.billingPortal.sessions.create;
    const app = createApp({
      store,
      stripeClient: stripe,
      env: {
        APP_URL: "https://cooee.test",
        BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_123",
      },
    });

    const response = await app.fetch(
      new Request("http://cooee.test/api/admin/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: "lobster",
          billingCadence: "monthly",
          recoverSubscription: true,
        }),
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Billing management is temporarily unavailable.",
    });
  });

  test("falls back to recovery checkout when the portal reports a missing customer", async () => {
    const store = billingRecoveryStore();
    const { checkoutInput, stripe } = billingRecoveryStripe();
    stripe.customers.retrieve = (async () =>
      ({
        id: "cus_saved",
        object: "customer",
        deleted: false,
      }) as unknown as Stripe.Response<Stripe.Customer>) as typeof stripe.customers.retrieve;
    const app = createApp({
      store,
      stripeClient: stripe,
      env: {
        APP_URL: "https://cooee.test",
        BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_123",
      },
    });

    const response = await app.fetch(
      new Request("http://cooee.test/api/admin/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: "lobster",
          billingCadence: "monthly",
          customerEmail: "owner@example.com",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      url: "https://billing.example.test/recovery",
    });
    expect(checkoutInput()).not.toHaveProperty("customer");
  });

  test("rejects Stripe webhooks with an invalid signature", async () => {
    const app = createApp({
      env: {
        BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_123",
        STRIPE_WEBHOOK_SECRET: "whsec_test",
      },
    });

    const response = await app.fetch(
      new Request("http://cooee.test/api/webhooks/stripe", {
        method: "POST",
        headers: {
          "stripe-signature": "invalid",
        },
        body: JSON.stringify({ id: "evt_invalid", type: "ping" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid Stripe signature",
    });
  });

  test("syncs Stripe subscription webhook state into workspace billing", async () => {
    const webhookSecret = "whsec_test";
    const stripe = new Stripe("sk_test_123", {
      apiVersion: "2026-02-25.clover",
    });
    const store = InMemoryStore.seeded();
    const app = createApp({
      store,
      env: {
        BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_123",
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      },
    });
    const payload = JSON.stringify({
      id: "evt_subscription_updated",
      created: 1781308800,
      object: "event",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_123",
          object: "subscription",
          customer: "cus_123",
          status: "active",
          metadata: {
            workspaceId: "ws_acme",
            planId: "pineapple",
            billingCadence: "monthly",
          },
          items: {
            data: [
              {
                price: {
                  id: "price_starter",
                  metadata: {
                    component: "base",
                    plan_id: "pineapple",
                    billing_cadence: "monthly",
                    repository_limit: "3",
                  },
                  recurring: { interval: "month", usage_type: "licensed" },
                },
                current_period_start: 1781308800,
                current_period_end: 1783900800,
              },
              {
                id: "si_usage",
                price: {
                  id: "price_pineapple_usage",
                  metadata: {
                    component: "usage",
                    plan_id: "pineapple",
                    recharge_credits: "15",
                  },
                  recurring: { interval: "month", usage_type: "metered" },
                },
                current_period_start: 1781308800,
                current_period_end: 1783900800,
              },
            ],
          },
        },
      },
    });
    const signature = await stripe.webhooks.generateTestHeaderStringAsync({
      payload,
      secret: webhookSecret,
    });

    const response = await app.fetch(
      new Request("http://cooee.test/api/webhooks/stripe", {
        method: "POST",
        headers: {
          "stripe-signature": signature,
        },
        body: payload,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    await expect(store.getWorkspace("ws_acme")).resolves.toMatchObject({
      billingMode: "hosted",
      repositoryLimit: 3,
      stripeCustomerId: "cus_123",
    });
    await expect(
      store.getBillingSubscription("ws_acme"),
    ).resolves.toMatchObject({
      stripeSubscriptionId: "sub_123",
      stripeCustomerId: "cus_123",
      status: "active",
      planId: "pineapple",
      billingCadence: "monthly",
      priceId: "price_starter",
      repositoryLimit: 3,
      currentPeriodStart: "2026-06-13T00:00:00.000Z",
      currentPeriodEnd: "2026-07-13T00:00:00.000Z",
    });
  });

  test("keeps cloud billing disabled until it is explicitly enabled", async () => {
    const store = InMemoryStore.seeded();
    const app = createApp({
      store,
      env: {
        GITHUB_APP_ID: "12345",
        GITHUB_APP_SLUG: "cooee-test",
        GITHUB_APP_PRIVATE_KEY: "test-private-key",
        STRIPE_SECRET_KEY: "sk_test_123",
        STRIPE_PRICE_ID: "price_starter",
      },
    });

    const status = await app.fetch(
      new Request("http://cooee.test/api/admin/github/app"),
    );

    expect(status.status).toBe(200);
    const body = await status.json();
    expect(body.billingEnabled).toBe(false);
    expect(body.billingMode).toBe("self-hosted");
  });

  test("persists workspace settings", async () => {
    const store = new InMemoryStore({
      workspaces: [
        {
          id: "ws_acme",
          name: "Acme",
          billingMode: "self-hosted",
          repositoryLimit: 0,
        },
      ],
    });
    const app = createApp({ store });

    const initial = await app.fetch(
      new Request("http://cooee.test/api/admin/settings"),
    );
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      settings: {
        appName: "Cooee",
        publicSlug: "changelog",
        publicAppLabel: "Open app",
        publicLogoAlignment: "left",
        scheduleFrequency: "daily",
        includePullRequestLinks: false,
      },
    });

    const saved = await app.fetch(
      new Request("http://cooee.test/api/admin/settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          settings: {
            appName: "Cooee React",
            publicSlug: "cooee-react",
            publicAppUrl: "https://app.cooee.test",
            publicAppLabel: "Launch workspace",
            publicLogoAlignment: "center",
            scheduleFrequency: "weekly",
            includePullRequestLinks: true,
            aiProvider: "unknown-provider",
            aiModel: "gpt-from-browser",
            logoAssetKey: "workspaces/ws_acme/logo/evil.png",
            logoDataUrl: "data:image/png;base64,ZmFrZQ==",
            logoUrl: "https://evil.test/logo.png",
            lightLogoAssetKey: "workspaces/ws_acme/light-logo/evil.png",
            lightLogoUrl: "https://evil.test/light-logo.png",
            faviconAssetKey: "workspaces/ws_acme/favicon/evil.png",
            faviconUrl: "https://evil.test/favicon.png",
          },
        }),
      }),
    );

    expect(saved.status).toBe(200);
    const savedBody = await saved.json();
    expect(savedBody).toMatchObject({
      settings: {
        appName: "Cooee React",
        publicSlug: "cooee-react",
        publicAppUrl: "https://app.cooee.test",
        publicAppLabel: "Launch workspace",
        publicLogoAlignment: "center",
        scheduleFrequency: "weekly",
        includePullRequestLinks: true,
        logoAssetKey: null,
        logoDataUrl: null,
        logoUrl: null,
        lightLogoAssetKey: null,
        lightLogoUrl: null,
        faviconAssetKey: null,
        faviconUrl: null,
      },
    });
    expect(JSON.stringify(savedBody)).not.toContain("aiProvider");
    expect(JSON.stringify(savedBody)).not.toContain("aiModel");

    const reloaded = await app.fetch(
      new Request("http://cooee.test/api/admin/settings"),
    );
    const reloadedBody = await reloaded.json();
    expect(reloadedBody).toMatchObject({
      settings: {
        appName: "Cooee React",
        publicSlug: "cooee-react",
        publicAppUrl: "https://app.cooee.test",
        publicAppLabel: "Launch workspace",
        publicLogoAlignment: "center",
        scheduleFrequency: "weekly",
        includePullRequestLinks: true,
        logoAssetKey: null,
        logoDataUrl: null,
        logoUrl: null,
        lightLogoAssetKey: null,
        lightLogoUrl: null,
        faviconAssetKey: null,
        faviconUrl: null,
      },
    });
    expect(JSON.stringify(reloadedBody)).not.toContain("aiProvider");
    expect(JSON.stringify(reloadedBody)).not.toContain("aiModel");
  });

  test("persists changelog settings per selected repository", async () => {
    const store = InMemoryStore.seeded();
    const provisionedHostnames: string[] = [];
    const app = createApp({
      store,
      customHostnameProvisioner: {
        createCustomHostname: async ({ hostname }) => {
          provisionedHostnames.push(hostname);
          return {
            id: "cfh_partbot",
            hostname,
            status: "pending",
            sslStatus: "pending_validation",
          };
        },
      },
      env: {
        APP_URL: "http://cooee.test",
        CLOUDFLARE_CUSTOM_HOSTNAME_CNAME_TARGET: "cloud.cooee.sh",
      },
    });

    const initial = await app.fetch(
      new Request("http://cooee.test/api/admin/changelogs/cl_acme/settings"),
    );
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      settings: {
        appName: "Acme App",
        publicSlug: "acme-app",
        scheduleFrequency: "daily",
        publishTime: "09:00",
        timeZone: "Australia/Brisbane",
        includePullRequestLinks: false,
        publicTheme: "light",
        privacyLabels: "cooee:skip, cooee:internal, security, vulnerability",
      },
    });

    const saved = await app.fetch(
      new Request("http://cooee.test/api/admin/changelogs/cl_acme/settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          settings: {
            appName: "Acme API",
            publicSlug: "acme-api",
            customDomain: "changelog.partbot.io",
            scheduleFrequency: "weekly",
            scheduleWeekday: 4,
            scheduleMonthDay: 20,
            publishTime: "15:30",
            timeZone: "UTC",
            includePullRequestLinks: true,
            publicTheme: "dark",
            privacyLabels: "cooee:skip, internal",
          },
        }),
      }),
    );

    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      changelog: {
        id: "cl_acme",
        name: "Acme API",
        slug: "acme-api",
        customDomain: "changelog.partbot.io",
        customHostnameStatus: "pending",
        customHostnameSslStatus: "pending_validation",
        publicUrl: "https://changelog.partbot.io",
      },
      settings: {
        appName: "Acme API",
        publicSlug: "acme-api",
        customDomain: "changelog.partbot.io",
        customHostnameStatus: "pending",
        customHostnameSslStatus: "pending_validation",
        customHostnameCnameTarget: "cloud.cooee.sh",
        scheduleFrequency: "weekly",
        scheduleWeekday: 4,
        scheduleMonthDay: 20,
        publishTime: "15:30",
        timeZone: "UTC",
        includePullRequestLinks: true,
        publicTheme: "dark",
        privacyLabels: "cooee:skip, internal",
      },
    });
    expect(await store.getChangelogById("cl_acme")).toMatchObject({
      name: "Acme API",
      slug: "acme-api",
      customHostnameId: "cfh_partbot",
      customHostnameStatus: "pending",
      customHostnameSslStatus: "pending_validation",
      settings: {
        skipLabels: ["cooee:skip", "internal"],
        sensitiveLabels: [],
        scheduleFrequency: "weekly",
        scheduleWeekday: 4,
        scheduleMonthDay: 20,
        publishTime: "15:30",
        timeZone: "UTC",
        includePullRequestLinks: true,
        publicTheme: "dark",
      },
    });
    expect(provisionedHostnames).toEqual(["changelog.partbot.io"]);

    const workspaceSettings = await app.fetch(
      new Request("http://cooee.test/api/admin/settings"),
    );
    expect(await workspaceSettings.json()).toMatchObject({
      settings: {
        publicSlug: "acme-api",
        scheduleFrequency: "weekly",
        includePullRequestLinks: true,
      },
    });
  });

  test("persists custom changelog categories and display mappings", async () => {
    const store = InMemoryStore.seeded();
    const app = createApp({ store });

    const saved = await app.fetch(
      new Request("http://cooee.test/api/admin/changelogs/cl_acme/settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          settings: {
            categoryDefinitions: [
              { label: "Feature", displayType: "post" },
              { label: "Fix", displayType: "text", marketingCopy: true },
              {
                label: "Announcement",
                displayType: "post",
                marketingCopy: true,
              },
            ],
            groupEntriesByCategory: true,
          },
        }),
      }),
    );

    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      settings: {
        categoryDefinitions: [
          {
            id: "feature",
            label: "Feature",
            displayType: "post",
            marketingCopy: true,
          },
          {
            id: "fix",
            label: "Fix",
            displayType: "text",
            marketingCopy: false,
          },
          {
            id: "announcement",
            label: "Announcement",
            displayType: "post",
            marketingCopy: true,
          },
        ],
        groupEntriesByCategory: true,
      },
    });
    expect((await store.getChangelogById("cl_acme"))?.settings).toMatchObject({
      categoryDefinitions: [
        {
          id: "feature",
          label: "Feature",
          displayType: "post",
          marketingCopy: true,
        },
        {
          id: "fix",
          label: "Fix",
          displayType: "text",
          marketingCopy: false,
        },
        {
          id: "announcement",
          label: "Announcement",
          displayType: "post",
          marketingCopy: true,
        },
      ],
      groupEntriesByCategory: true,
    });
  });

  test("does not provision an unchanged custom hostname twice", async () => {
    const store = InMemoryStore.seeded();
    store.changelogs[0].customDomain = "changelog.partbot.io";
    store.changelogs[0].customHostnameId = "cfh_partbot";
    store.changelogs[0].customHostnameStatus = "active";
    store.changelogs[0].customHostnameSslStatus = "active";
    const provisionedHostnames: string[] = [];
    const app = createApp({
      store,
      customHostnameProvisioner: {
        createCustomHostname: async ({ hostname }) => {
          provisionedHostnames.push(hostname);
          return {
            id: "cfh_duplicate",
            hostname,
            status: "pending",
            sslStatus: "pending_validation",
          };
        },
      },
      env: {
        APP_URL: "http://cooee.test",
      },
    });

    const saved = await app.fetch(
      new Request("http://cooee.test/api/admin/changelogs/cl_acme/settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          settings: {
            customDomain: "changelog.partbot.io",
          },
        }),
      }),
    );

    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      settings: {
        customDomain: "changelog.partbot.io",
        customHostnameStatus: "active",
        customHostnameSslStatus: "active",
      },
    });
    expect(provisionedHostnames).toEqual([]);
  });

  test("rejects apex custom domains", async () => {
    const store = InMemoryStore.seeded();
    const provisionedHostnames: string[] = [];
    const app = createApp({
      store,
      customHostnameProvisioner: {
        createCustomHostname: async ({ hostname }) => {
          provisionedHostnames.push(hostname);
          return {
            id: "cfh_apex",
            hostname,
            status: "pending",
            sslStatus: "pending_validation",
          };
        },
      },
    });

    const saved = await app.fetch(
      new Request("http://cooee.test/api/admin/changelogs/cl_acme/settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          settings: {
            customDomain: "partbot.io",
          },
        }),
      }),
    );

    expect(saved.status).toBe(400);
    expect(await saved.json()).toEqual({
      error:
        "Custom domains must be subdomains, such as changelog.example.com. Apex domains are not supported.",
    });
    expect(provisionedHostnames).toEqual([]);
    expect(await store.getChangelogById("cl_acme")).toMatchObject({
      customDomain: null,
      customHostnameId: null,
    });
  });

  test("provisions an unchanged custom domain when Cloudflare metadata is missing", async () => {
    const store = InMemoryStore.seeded();
    store.changelogs[0].customDomain = "changelog.partbot.io";
    store.changelogs[0].customHostnameId = null;
    store.changelogs[0].customHostnameStatus = "cname cloud.cooee.sh";
    store.changelogs[0].customHostnameSslStatus = null;
    const provisionedHostnames: string[] = [];
    const app = createApp({
      store,
      customHostnameProvisioner: {
        createCustomHostname: async ({ hostname }) => {
          provisionedHostnames.push(hostname);
          return {
            id: "cfh_partbot",
            hostname,
            status: "pending",
            sslStatus: "pending_validation",
          };
        },
      },
      env: {
        APP_URL: "http://cooee.test",
      },
    });

    const saved = await app.fetch(
      new Request("http://cooee.test/api/admin/changelogs/cl_acme/settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          settings: {
            customDomain: "changelog.partbot.io",
          },
        }),
      }),
    );

    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      settings: {
        customDomain: "changelog.partbot.io",
        customHostnameStatus: "pending",
        customHostnameSslStatus: "pending_validation",
      },
    });
    expect(await store.getChangelogById("cl_acme")).toMatchObject({
      customHostnameId: "cfh_partbot",
      customHostnameStatus: "pending",
      customHostnameSslStatus: "pending_validation",
    });
    expect(provisionedHostnames).toEqual(["changelog.partbot.io"]);
  });

  test("removes a provisioned custom hostname when the setting is cleared", async () => {
    const store = InMemoryStore.seeded();
    store.changelogs[0].customDomain = "changelog.partbot.io";
    store.changelogs[0].customHostnameId = "cfh_partbot";
    store.changelogs[0].customHostnameStatus = "active";
    store.changelogs[0].customHostnameSslStatus = "active";
    const deletedHostnames: string[] = [];
    const app = createApp({
      store,
      customHostnameProvisioner: {
        createCustomHostname: async ({ hostname }) => ({
          id: "cfh_new",
          hostname,
          status: "pending",
          sslStatus: "pending_validation",
        }),
        deleteCustomHostname: async (id) => {
          deletedHostnames.push(id);
        },
      },
      env: {
        APP_URL: "http://cooee.test",
      },
    });

    const saved = await app.fetch(
      new Request("http://cooee.test/api/admin/changelogs/cl_acme/settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          settings: {
            customDomain: "",
          },
        }),
      }),
    );

    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      changelog: {
        customDomain: null,
        customHostnameStatus: null,
        customHostnameSslStatus: null,
      },
      settings: {
        customDomain: "",
        customHostnameStatus: "",
        customHostnameSslStatus: "",
      },
    });
    expect(deletedHostnames).toEqual(["cfh_partbot"]);
  });

  test("refreshes a provisioned custom hostname status", async () => {
    const store = InMemoryStore.seeded();
    store.changelogs[0].customDomain = "changelog.partbot.io";
    store.changelogs[0].customHostnameId = "cfh_partbot";
    store.changelogs[0].customHostnameStatus = "pending";
    store.changelogs[0].customHostnameSslStatus = "pending_validation";
    const refreshedHostnames: string[] = [];
    const app = createApp({
      store,
      customHostnameProvisioner: {
        createCustomHostname: async ({ hostname }) => ({
          id: "cfh_new",
          hostname,
          status: "pending",
          sslStatus: "pending_validation",
        }),
        getCustomHostname: async (id) => {
          refreshedHostnames.push(id);
          return {
            id,
            hostname: "changelog.partbot.io",
            status: "active",
            sslStatus: "active",
          };
        },
      },
      env: {
        APP_URL: "http://cooee.test",
      },
    });

    const refreshed = await app.fetch(
      new Request(
        "http://cooee.test/api/admin/changelogs/cl_acme/custom-domain/refresh",
        {
          method: "POST",
        },
      ),
    );

    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toMatchObject({
      changelog: {
        customDomain: "changelog.partbot.io",
        customHostnameStatus: "active",
        customHostnameSslStatus: "active",
      },
      settings: {
        customDomain: "changelog.partbot.io",
        customHostnameStatus: "active",
        customHostnameSslStatus: "active",
      },
    });
    expect(refreshedHostnames).toEqual(["cfh_partbot"]);
  });

  test("workspace settings save updates the existing changelog slug when one exists", async () => {
    const store = InMemoryStore.seeded();
    const app = createApp({
      store,
      env: {
        APP_URL: "http://cooee.test",
      },
    });

    const saved = await app.fetch(
      new Request("http://cooee.test/api/admin/settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          settings: {
            appName: "Acme App",
            publicSlug: "cooee",
            scheduleFrequency: "daily",
            publishTime: "09:00",
            timeZone: "Australia/Brisbane",
            includePullRequestLinks: false,
            privacyLabels: "cooee:skip, cooee:internal, security",
          },
        }),
      }),
    );

    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      changelog: {
        id: "cl_acme",
        slug: "cooee",
        publicUrl: "http://cooee.test/changelog/cooee",
      },
      settings: {
        publicSlug: "cooee",
      },
    });
    expect(await store.getChangelogById("cl_acme")).toMatchObject({
      slug: "cooee",
    });

    const feed = await app.fetch(
      new Request("http://cooee.test/api/public/changelogs/cooee/feed.json"),
    );
    expect(feed.status).toBe(200);
  });

  test("persists onboarding completion in workspace settings", async () => {
    const store = InMemoryStore.seeded();
    const app = createApp({ store });

    const completed = await app.fetch(
      new Request("http://cooee.test/api/admin/onboarding/complete", {
        method: "POST",
      }),
    );

    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      settings: {
        onboardingCompleted: true,
      },
    });

    const settings = await app.fetch(
      new Request("http://cooee.test/api/admin/settings"),
    );
    expect(settings.status).toBe(200);
    expect(await settings.json()).toMatchObject({
      settings: {
        onboardingCompleted: true,
      },
    });
  });

  test("changelog slugs are unique globally", async () => {
    const store = InMemoryStore.seeded();
    store.workspaces.push({
      id: "ws_other",
      name: "Other",
      billingMode: "self-hosted",
      repositoryLimit: 0,
    });
    store.githubInstallations.push({
      id: "ghi_other",
      workspaceId: "ws_other",
      installationId: 67890,
      accountLogin: "other",
      accountType: "Organization",
      suspendedAt: null,
    });
    store.repositories.push({
      id: "repo_other",
      workspaceId: "ws_other",
      githubInstallationId: "ghi_other",
      owner: "other",
      name: "cooee",
      fullName: "other/cooee",
      private: false,
    });
    store.changelogs.push({
      id: "cl_other",
      workspaceId: "ws_other",
      repositoryId: "repo_other",
      repository: "other/cooee",
      slug: "cooee",
      name: "Other Cooee",
      description: "Other updates",
      publicUrl: "http://cooee.test/changelog/cooee",
      customDomain: null,
      customHostnameId: null,
      customHostnameStatus: null,
      customHostnameSslStatus: null,
      lastGeneratedWindowEnd: null,
      settings: {
        skipLabels: ["cooee:skip"],
        sensitiveLabels: [],
        categoryDefinitions: defaultChangelogCategoryDefinitions,
        groupEntriesByCategory: true,
        publicTheme: "light",
        scheduleFrequency: "daily",
        publishTime: "09:00",
        timeZone: "Australia/Brisbane",
        includePullRequestLinks: false,
      },
    });
    const app = createApp({
      store,
      env: {
        APP_URL: "http://cooee.test",
      },
    });

    const saved = await app.fetch(
      new Request("http://cooee.test/api/admin/changelogs/cl_acme/settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          settings: {
            appName: "Acme App",
            publicSlug: "cooee",
            scheduleFrequency: "daily",
            publishTime: "09:00",
            timeZone: "Australia/Brisbane",
            includePullRequestLinks: false,
            privacyLabels: "cooee:skip",
          },
        }),
      }),
    );

    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      changelog: {
        id: "cl_acme",
        slug: "cooee-2",
        publicUrl: "http://cooee.test/changelog/cooee-2",
      },
      settings: {
        publicSlug: "cooee-2",
      },
    });
    expect(await store.getChangelogById("cl_other")).toMatchObject({
      slug: "cooee",
    });
  });

  test("uploads workspace logos to asset storage and serves them by public URL", async () => {
    const store = new InMemoryStore({
      workspaces: [
        {
          id: "ws_acme",
          name: "Acme",
          billingMode: "self-hosted",
          repositoryLimit: 0,
        },
      ],
    });
    const assetStorage = new TestAssetStorage();
    const app = createApp({ assetStorage, store });
    const form = new FormData();
    const logoBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    form.set("logo", new Blob([logoBytes], { type: "image/png" }), "logo.png");

    const uploaded = await app.fetch(
      new Request("http://cooee.test/api/admin/settings/logo", {
        method: "POST",
        body: form,
      }),
    );

    expect(uploaded.status).toBe(200);
    const uploadBody = await uploaded.json();
    expect(uploadBody.settings.logoDataUrl).toBeNull();
    expect(uploadBody.settings.logoAssetKey).toStartWith(
      "workspaces/ws_acme/logo/",
    );
    expect(uploadBody.settings.logoUrl).toBe(
      "/api/public/workspaces/ws_acme/logo",
    );

    const persisted = await store.getWorkspaceSettings("ws_acme");
    expect(persisted?.logoDataUrl).toBeNull();
    expect(persisted?.logoAssetKey).toBe(uploadBody.settings.logoAssetKey);

    const publicLogo = await app.fetch(
      new Request("http://cooee.test/api/public/workspaces/ws_acme/logo"),
    );

    expect(publicLogo.status).toBe(200);
    expect(publicLogo.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await publicLogo.arrayBuffer())).toEqual(logoBytes);
  });

  test("lets paid workspaces upload and serve light mode logos and favicons", async () => {
    const store = billingRecoveryStore();
    const assetStorage = new TestAssetStorage();
    const app = createApp({ assetStorage, store });
    const logoBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const logoForm = new FormData();
    logoForm.set(
      "logo",
      new Blob([logoBytes], { type: "image/png" }),
      "light-logo.png",
    );
    const logoUpload = await app.fetch(
      new Request("http://cooee.test/api/admin/settings/light-logo", {
        method: "POST",
        body: logoForm,
      }),
    );

    expect(logoUpload.status).toBe(200);
    const logoUploadBody = await logoUpload.json();
    expect(logoUploadBody.settings.lightLogoUrl).toStartWith(
      "/api/public/workspaces/ws_acme/light-logo?v=",
    );

    const faviconBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);
    const faviconForm = new FormData();
    faviconForm.set(
      "favicon",
      new Blob([faviconBytes], { type: "image/png" }),
      "favicon.png",
    );
    const faviconUpload = await app.fetch(
      new Request("http://cooee.test/api/admin/settings/favicon", {
        method: "POST",
        body: faviconForm,
      }),
    );

    expect(faviconUpload.status).toBe(200);
    const faviconUploadBody = await faviconUpload.json();
    expect(faviconUploadBody.settings.faviconUrl).toStartWith(
      "/api/public/workspaces/ws_acme/favicon?v=",
    );

    const publicLightLogo = await app.fetch(
      new Request("http://cooee.test/api/public/workspaces/ws_acme/light-logo"),
    );
    expect(publicLightLogo.status).toBe(200);
    expect(publicLightLogo.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await publicLightLogo.arrayBuffer())).toEqual(
      logoBytes,
    );

    const publicFavicon = await app.fetch(
      new Request("http://cooee.test/api/public/workspaces/ws_acme/favicon"),
    );
    expect(publicFavicon.status).toBe(200);
    expect(publicFavicon.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await publicFavicon.arrayBuffer())).toEqual(
      faviconBytes,
    );

    const faviconDelete = await app.fetch(
      new Request("http://cooee.test/api/admin/settings/favicon", {
        method: "DELETE",
      }),
    );
    expect(faviconDelete.status).toBe(200);
    expect(await faviconDelete.json()).toMatchObject({
      settings: { faviconAssetKey: null, faviconUrl: null },
    });
    expect(
      await app.fetch(
        new Request("http://cooee.test/api/public/workspaces/ws_acme/favicon"),
      ),
    ).toMatchObject({ status: 404 });
  });

  test("keeps theme logos and favicons behind a paid plan", async () => {
    const store = InMemoryStore.seeded();
    store.workspaces[0].billingMode = "hosted";
    const assetStorage = new TestAssetStorage();
    const app = createApp({ assetStorage, store });
    const form = new FormData();
    form.set(
      "logo",
      new Blob([new Uint8Array([0x89, 0x50])], { type: "image/png" }),
      "light-logo.png",
    );

    const response = await app.fetch(
      new Request("http://cooee.test/api/admin/settings/light-logo", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({
      error: "A paid plan is required to use theme logos and a custom favicon.",
    });
    expect(assetStorage.objects.size).toBe(0);
  });

  test("public feed exposes a changelog-scoped logo URL", async () => {
    const store = InMemoryStore.seeded();
    store.workspaceSettings.set("ws_acme", {
      logoAssetKey: "workspaces/ws_acme/logo/logo.png",
      logoDataUrl: null,
      logoUrl: "/api/public/workspaces/ws_acme/logo",
      lightLogoAssetKey: "workspaces/ws_acme/light-logo/light.png",
      lightLogoUrl: "/api/public/workspaces/ws_acme/light-logo",
      faviconAssetKey: "workspaces/ws_acme/favicon/icon.png",
      faviconUrl: "/api/public/workspaces/ws_acme/favicon",
      publicLogoAlignment: "right",
    });
    const assetStorage = new TestAssetStorage();
    const logoBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    assetStorage.objects.set("workspaces/ws_acme/logo/logo.png", {
      body: logoBytes,
      contentType: "image/png",
    });
    const app = createApp({ assetStorage, store });

    const feed = await app.fetch(
      new Request("http://cooee.test/api/public/changelogs/acme-app/feed.json"),
    );

    expect(feed.status).toBe(200);
    const feedBody = await feed.json();
    expect(feedBody).toMatchObject({
      changelog: {
        logoUrl: "https://cooee.test/api/public/changelogs/acme-app/logo",
        publicLogoAlignment: "right",
      },
    });
    expect(feedBody.changelog.lightLogoUrl).toStartWith(
      "https://cooee.test/api/public/changelogs/acme-app/light-logo?v=",
    );
    expect(feedBody.changelog.faviconUrl).toStartWith(
      "https://cooee.test/api/public/changelogs/acme-app/favicon?v=",
    );

    const canonicalPublicLogo = await app.fetch(
      new Request("http://cooee.test/api/public/changelogs/acme-app/logo"),
    );

    expect(canonicalPublicLogo.status).toBe(200);
    expect(canonicalPublicLogo.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await canonicalPublicLogo.arrayBuffer())).toEqual(
      logoBytes,
    );
  });

  test("public feed returns changelog-scoped absolute post image URLs", async () => {
    const store = InMemoryStore.seeded();
    store.entries[0].imageUrl =
      "api/public/workspaces/ws_acme/changelog-entries/entry_feature/image";
    const app = createApp({ store });

    const feed = await app.fetch(
      new Request(
        "https://cooee.test/api/public/changelogs/acme-app/feed.json",
      ),
    );
    const body = await feed.json();

    expect(body.entries[0].imageUrl).toBe(
      "https://cooee.test/api/public/changelogs/acme-app/entries/entry_saved_filters/image",
    );
  });

  test("public feed includes the configured changelog theme", async () => {
    const store = InMemoryStore.seeded();
    store.changelogs[0].settings.publicTheme = "dark";
    const app = createApp({ store });

    const feed = await app.fetch(
      new Request("http://cooee.test/api/public/changelogs/acme-app/feed.json"),
    );

    expect(feed.status).toBe(200);
    expect(await feed.json()).toMatchObject({
      changelog: {
        publicTheme: "dark",
      },
    });
  });

  test("public feed includes the configured app link", async () => {
    const store = InMemoryStore.seeded();
    store.workspaceSettings.set("ws_acme", {
      publicAppUrl: "https://app.acme.test",
      publicAppLabel: "Launch workspace",
    });
    const app = createApp({ store });

    const feed = await app.fetch(
      new Request("http://cooee.test/api/public/changelogs/acme-app/feed.json"),
    );

    expect(feed.status).toBe(200);
    expect(await feed.json()).toMatchObject({
      changelog: {
        publicAppUrl: "https://app.acme.test",
        publicAppLabel: "Launch workspace",
      },
    });
  });

  test("uploads static SVG workspace logos", async () => {
    const store = new InMemoryStore({
      workspaces: [
        {
          id: "ws_acme",
          name: "Acme",
          billingMode: "self-hosted",
          repositoryLimit: 0,
        },
      ],
    });
    const assetStorage = new TestAssetStorage();
    const app = createApp({ assetStorage, store });
    const svgLogo =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 32"><title>Acme</title><path fill="currentColor" d="M0 0h120v32H0z"/></svg>';
    const form = new FormData();
    form.set(
      "logo",
      new Blob([svgLogo], { type: "image/svg+xml" }),
      "logo.svg",
    );

    const uploaded = await app.fetch(
      new Request("http://cooee.test/api/admin/settings/logo", {
        method: "POST",
        body: form,
      }),
    );

    expect(uploaded.status).toBe(200);
    const uploadBody = await uploaded.json();
    expect(uploadBody.settings.logoAssetKey).toEndWith(".svg");

    const publicLogo = await app.fetch(
      new Request("http://cooee.test/api/public/workspaces/ws_acme/logo"),
    );

    expect(publicLogo.status).toBe(200);
    expect(publicLogo.headers.get("content-type")).toBe("image/svg+xml");
    expect(publicLogo.headers.get("content-security-policy")).toContain(
      "script-src 'none'",
    );
    expect(await publicLogo.text()).toBe(svgLogo);
  });

  test("rejects unsafe logo uploads before persistence", async () => {
    const store = new InMemoryStore({
      workspaces: [
        {
          id: "ws_acme",
          name: "Acme",
          billingMode: "self-hosted",
          repositoryLimit: 0,
        },
      ],
    });
    const app = createApp({ assetStorage: new TestAssetStorage(), store });
    const unsupported = new FormData();
    unsupported.set(
      "logo",
      new Blob(["not an image"], { type: "text/plain" }),
      "logo.txt",
    );

    const unsupportedResponse = await app.fetch(
      new Request("http://cooee.test/api/admin/settings/logo", {
        method: "POST",
        body: unsupported,
      }),
    );

    expect(unsupportedResponse.status).toBe(415);

    const unsafeSvg = new FormData();
    unsafeSvg.set(
      "logo",
      new Blob(
        ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" />'],
        {
          type: "image/svg+xml",
        },
      ),
      "logo.svg",
    );

    const unsafeSvgResponse = await app.fetch(
      new Request("http://cooee.test/api/admin/settings/logo", {
        method: "POST",
        body: unsafeSvg,
      }),
    );

    expect(unsafeSvgResponse.status).toBe(400);
    expect(await unsafeSvgResponse.json()).toEqual({
      error: "SVG logos cannot contain event handlers.",
    });

    const oversized = new FormData();
    oversized.set(
      "logo",
      new Blob([new Uint8Array(600 * 1024)], { type: "image/png" }),
      "logo.png",
    );

    const oversizedResponse = await app.fetch(
      new Request("http://cooee.test/api/admin/settings/logo", {
        method: "POST",
        body: oversized,
      }),
    );

    expect(oversizedResponse.status).toBe(413);
    expect(await store.getWorkspaceSettings("ws_acme")).toBeNull();
  });

  test("defaults workspace settings app name from connected repositories", async () => {
    const store = new InMemoryStore({
      workspaces: [
        {
          id: "ws_acme",
          name: "Acme",
          billingMode: "self-hosted",
          repositoryLimit: 0,
        },
      ],
      githubInstallations: [
        {
          id: "ghi_acme",
          workspaceId: "ws_acme",
          installationId: 12345,
          accountLogin: "acme",
          accountType: "Organization",
          suspendedAt: null,
        },
      ],
      repositories: [
        {
          id: "repo_cooee_react",
          workspaceId: "ws_acme",
          githubInstallationId: "ghi_acme",
          owner: "cooeehq",
          name: "cooee-react",
          fullName: "cooeehq/cooee-react",
          private: false,
        },
      ],
    });
    const app = createApp({ store });

    const response = await app.fetch(
      new Request("http://cooee.test/api/admin/settings"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      settings: {
        appName: "Cooee React",
      },
    });
  });

  test("syncs GitHub App callback installations into stored repositories", async () => {
    const store = new InMemoryStore({
      workspaces: [
        {
          id: "ws_acme",
          name: "Acme",
          billingMode: "self-hosted",
          repositoryLimit: 0,
        },
      ],
    });
    const githubClient: GitHubAppClient = {
      listMergedPullRequests: async () => [],
      syncInstallation: async (installationId) => ({
        installation: {
          installationId,
          accountLogin: "acme",
          accountType: "Organization",
          suspendedAt: null,
        },
        repositories: [
          {
            owner: "acme",
            name: "app",
            fullName: "acme/app",
            private: false,
          },
        ],
      }),
    };
    const app = createApp({
      store,
      githubClient,
      env: {
        APP_URL: "http://cooee.test",
        GITHUB_APP_ID: "12345",
        GITHUB_APP_SLUG: "cooee-test",
        GITHUB_APP_PRIVATE_KEY: "test-private-key",
      },
    });

    const response = await app.fetch(
      new Request(
        "http://cooee.test/api/onboarding/github?installation_id=67890&setup_action=install",
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://cooee.test/changelog?github=connected",
    );
    expect(await store.listRepositories("ws_acme")).toEqual([
      {
        id: "repo_acme_app",
        workspaceId: "ws_acme",
        githubInstallationId: "ghi_67890",
        owner: "acme",
        name: "app",
        fullName: "acme/app",
        private: false,
      },
    ]);
  });

  test("does not import unclaimed GitHub App installations during sync", async () => {
    const store = new InMemoryStore({
      workspaces: [
        {
          id: "ws_acme",
          name: "Acme",
          billingMode: "self-hosted",
          repositoryLimit: 0,
        },
      ],
    });
    const githubClient = {
      listInstallations: async () => {
        throw new Error("App-wide installation enumeration must not be used");
      },
      listMergedPullRequests: async () => [],
      syncInstallation: async (installationId: number) => ({
        installation: {
          installationId,
          accountLogin: installationId === 101 ? "partbot" : "cooeehq",
          accountType: "Organization",
          suspendedAt: null,
        },
        repositories: [
          {
            owner: installationId === 101 ? "partbot" : "cooeehq",
            name: installationId === 101 ? "fulfillment" : "cooee-react",
            fullName:
              installationId === 101
                ? "partbot/fulfillment"
                : "cooeehq/cooee-react",
            private: true,
          },
        ],
      }),
    };
    const app = createApp({
      store,
      githubClient,
      env: {
        GITHUB_APP_ID: "12345",
        GITHUB_APP_SLUG: "cooee-test",
        GITHUB_APP_PRIVATE_KEY: "test-private-key",
      },
    });

    const response = await app.fetch(
      new Request("http://cooee.test/api/admin/github/sync", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(await store.listGitHubInstallations("ws_acme")).toEqual([]);
    expect(await store.listRepositories("ws_acme")).toEqual([]);
  });

  test("selects a synced GitHub repository for changelog generation", async () => {
    const store = InMemoryStore.seeded();
    const app = createApp({ store });

    const selected = await app.fetch(
      new Request(
        "http://cooee.test/api/admin/github/repositories/repo_acme/select",
        {
          method: "POST",
        },
      ),
    );

    expect(selected.status).toBe(200);
    const selectedBody = await selected.json();
    expect(selectedBody.repository).toMatchObject({
      id: "repo_acme",
      fullName: "acme/app",
      selected: true,
      changelogSlug: "acme-app",
    });
    expect(selectedBody.changelog).toMatchObject({
      repositoryId: "repo_acme",
      repository: "acme/app",
      slug: "acme-app",
    });

    const status = await app.fetch(
      new Request("http://cooee.test/api/admin/github/app"),
    );
    const statusBody = await status.json();
    expect(statusBody.repositories[0]).toMatchObject({
      id: "repo_acme",
      selected: true,
      changelogSlug: "acme-app",
    });
  });

  test("returns a clear setup error when GitHub OAuth auth routes are unavailable", async () => {
    const app = createApp({ env: {} });

    const response = await app.fetch(
      new Request("http://cooee.test/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "github", callbackURL: "/" }),
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "GitHub OAuth requires DATABASE_URL, GITHUB_CLIENT_ID, and GITHUB_CLIENT_SECRET.",
    });
  });

  test("trusts the local Vite origin for GitHub OAuth callbacks", () => {
    const source = readFileSync(new URL("../auth.ts", import.meta.url), "utf8");

    expect(source).toContain("http://localhost:5173");
    expect(source).toContain("trustedOrigins");
  });
});
