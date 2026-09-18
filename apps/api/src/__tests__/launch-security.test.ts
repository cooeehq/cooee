import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthRuntime } from "../auth";
import { validateProductionConfig } from "../config";
import { createApp, getTrustedClientIp } from "../server";
import { generateChangelogForWindow } from "../services/generation";
import type { AiSummarizer } from "../services/openai";
import { createStore } from "../store";
import { InMemoryStore } from "../store/memory";

function authenticatedAs(userId = "user_owner"): AuthRuntime {
  return {
    handler: async () => new Response(null, { status: 204 }),
    canAccessGitHubInstallation: async () => true,
    getSession: async () => ({
      user: { id: userId, name: "Owner", email: "owner@example.com" },
    }),
  };
}

const summarizer: AiSummarizer = {
  summarize: async () => ({
    title: "Safer launch",
    summary: "Launch controls are now enforced.",
    category: "improvement",
    confidence: 0.99,
    sensitive: false,
  }),
};

describe("launch security boundaries", () => {
  test("uses only a validated IP from a trusted edge header", () => {
    expect(
      getTrustedClientIp(
        new Request("https://cooee.test", {
          headers: { "x-real-ip": "203.0.113.42" },
        }),
        "x-real-ip",
      ),
    ).toBe("203.0.113.42");
    expect(
      getTrustedClientIp(
        new Request("https://cooee.test", {
          headers: { "x-real-ip": "spoofed, 203.0.113.42" },
        }),
        "x-real-ip",
      ),
    ).toBe("unknown");
    expect(
      getTrustedClientIp(new Request("https://cooee.test"), undefined),
    ).toBe("shared");
  });

  test("production cannot silently use memory storage or unauthenticated admin routes", async () => {
    expect(() => createStore({ NODE_ENV: "production" })).toThrow(
      "DATABASE_URL is required in production.",
    );
    expect(() => createStore({ RAILWAY_PROJECT_ID: "project_test" })).toThrow(
      "DATABASE_URL is required in production.",
    );

    const app = createApp({
      env: { NODE_ENV: "production" },
      store: InMemoryStore.seeded(),
      auth: null,
    });
    const response = await app.fetch(
      new Request("https://cooee.test/api/admin/settings"),
    );
    expect(response.status).toBe(503);
  });

  test("derives the workspace from memberships and rejects cross-workspace access", async () => {
    const store = InMemoryStore.seeded();
    store.workspaces.push({
      id: "ws_other",
      name: "Other",
    });
    store.memberships.push({
      id: "membership_owner",
      workspaceId: "ws_acme",
      userId: "user_owner",
      role: "owner",
    });
    const app = createApp({
      auth: authenticatedAs(),
      env: { NODE_ENV: "production" },
      store,
    });

    const allowed = await app.fetch(
      new Request("https://cooee.test/api/admin/settings"),
    );
    expect(allowed.status).toBe(200);

    const denied = await app.fetch(
      new Request("https://cooee.test/api/admin/settings?workspaceId=ws_other"),
    );
    expect(denied.status).toBe(403);
  });

  test("provisions an owner workspace for a newly authenticated user", async () => {
    const store = new InMemoryStore();
    const app = createApp({
      auth: authenticatedAs("user_new"),
      env: { NODE_ENV: "production", BILLING_ENABLED: "true" },
      store,
    });

    const response = await app.fetch(
      new Request("https://cooee.test/api/admin/settings"),
    );
    expect(response.status).toBe(200);
    expect(store.memberships).toHaveLength(1);
    expect(store.memberships[0]).toMatchObject({
      userId: "user_new",
      role: "owner",
    });
    expect(store.workspaces[0]).toMatchObject({});
  });

  test("joins a new GitHub user to an existing accessible installation workspace", async () => {
    const store = InMemoryStore.seeded();
    const initialWorkspaceCount = store.workspaces.length;
    const app = createApp({
      auth: {
        ...authenticatedAs("user_teammate"),
        listAccessibleGitHubResources: async () => ({
          installationIds: [12345],
          repositoryFullNames: ["acme/app"],
        }),
      },
      env: { NODE_ENV: "production" },
      store,
    });

    const response = await app.fetch(
      new Request("https://cooee.test/api/admin/settings"),
    );

    expect(response.status).toBe(200);
    expect(store.workspaces).toHaveLength(initialWorkspaceCount);
    expect(await store.listWorkspaceMemberships("user_teammate")).toEqual([
      expect.objectContaining({
        workspaceId: "ws_acme",
        role: "member",
      }),
    ]);

    const repeated = await app.fetch(
      new Request("https://cooee.test/api/admin/settings"),
    );
    expect(repeated.status).toBe(200);
    expect(await store.listWorkspaceMemberships("user_teammate")).toHaveLength(
      1,
    );
  });

  test("does not grant a multi-installation workspace from partial GitHub access", async () => {
    const store = InMemoryStore.seeded();
    store.githubInstallations.push({
      id: "ghi_private",
      workspaceId: "ws_acme",
      installationId: 67890,
      accountLogin: "private-org",
      accountType: "Organization",
      suspendedAt: null,
    });
    const app = createApp({
      auth: {
        ...authenticatedAs("user_partial"),
        listAccessibleGitHubResources: async () => ({
          installationIds: [12345],
          repositoryFullNames: ["acme/app"],
        }),
      },
      env: { NODE_ENV: "production" },
      store,
    });

    const response = await app.fetch(
      new Request(
        "https://cooee.test/api/admin/github/app?workspaceId=ws_acme",
      ),
    );

    expect(response.status).toBe(403);
    expect(await store.listWorkspaceMemberships("user_partial")).toEqual([]);
  });

  test("does not grant a workspace when one repository is outside GitHub access", async () => {
    const store = InMemoryStore.seeded();
    store.repositories.push({
      id: "repo_private",
      workspaceId: "ws_acme",
      githubInstallationId: "ghi_acme",
      owner: "acme",
      name: "private-app",
      fullName: "acme/private-app",
      private: true,
    });
    const app = createApp({
      auth: {
        ...authenticatedAs("user_partial_repo"),
        listAccessibleGitHubResources: async () => ({
          installationIds: [12345],
          repositoryFullNames: ["acme/app"],
        }),
      },
      env: { NODE_ENV: "production" },
      store,
    });

    const response = await app.fetch(
      new Request(
        "https://cooee.test/api/admin/github/app?workspaceId=ws_acme",
      ),
    );

    expect(response.status).toBe(403);
    expect(await store.listWorkspaceMemberships("user_partial_repo")).toEqual(
      [],
    );
  });

  test("revokes GitHub-derived access when the upstream grant disappears", async () => {
    const store = InMemoryStore.seeded();
    let githubAccess = {
      installationIds: [12345],
      repositoryFullNames: ["acme/app"],
    };
    const app = createApp({
      auth: {
        ...authenticatedAs("user_revoked"),
        listAccessibleGitHubResources: async () => githubAccess,
      },
      env: { NODE_ENV: "production" },
      store,
    });

    const initial = await app.fetch(
      new Request("https://cooee.test/api/admin/github/app"),
    );
    expect(initial.status).toBe(200);

    githubAccess = { installationIds: [], repositoryFullNames: [] };
    const revoked = await app.fetch(
      new Request(
        "https://cooee.test/api/admin/github/app?workspaceId=ws_acme",
      ),
    );

    expect(revoked.status).toBe(403);
  });

  test("does not revalidate owner memberships against GitHub installations", async () => {
    const store = InMemoryStore.seeded();
    store.memberships.push({
      id: "membership_owner",
      workspaceId: "ws_acme",
      userId: "user_owner",
      role: "owner",
    });
    const app = createApp({
      auth: {
        ...authenticatedAs(),
        listAccessibleGitHubResources: async () => ({
          installationIds: [],
          repositoryFullNames: [],
        }),
      },
      env: { NODE_ENV: "production" },
      store,
    });

    const response = await app.fetch(
      new Request("https://cooee.test/api/admin/settings"),
    );

    expect(response.status).toBe(200);
  });

  test("prefers the connected workspace when the GitHub user already has an empty workspace", async () => {
    const store = InMemoryStore.seeded();
    store.workspaces.push({
      id: "ws_personal",
      name: "Personal",
    });
    store.memberships.push({
      id: "membership_personal",
      workspaceId: "ws_personal",
      userId: "user_teammate",
      role: "owner",
    });
    const app = createApp({
      auth: {
        ...authenticatedAs("user_teammate"),
        listAccessibleGitHubResources: async () => ({
          installationIds: [12345],
          repositoryFullNames: ["acme/app"],
        }),
      },
      env: { NODE_ENV: "production" },
      store,
    });

    const response = await app.fetch(
      new Request("https://cooee.test/api/admin/github/app"),
    );
    const body = (await response.json()) as {
      repositories?: Array<{ fullName?: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.repositories).toContainEqual(
      expect.objectContaining({ fullName: "acme/app" }),
    );
    expect(await store.listWorkspaceMemberships("user_teammate")).toHaveLength(
      2,
    );
  });

  test("does not provision a duplicate workspace when GitHub access verification fails", async () => {
    const store = InMemoryStore.seeded();
    const initialWorkspaceCount = store.workspaces.length;
    const app = createApp({
      auth: {
        ...authenticatedAs("user_teammate"),
        listAccessibleGitHubResources: async () => null,
      },
      env: { NODE_ENV: "production" },
      store,
    });

    const response = await app.fetch(
      new Request("https://cooee.test/api/admin/settings"),
    );

    expect(response.status).toBe(503);
    expect(store.workspaces).toHaveLength(initialWorkspaceCount);
    expect(await store.listWorkspaceMemberships("user_teammate")).toEqual([]);
  });

  test("preserves explicit local memberships when GitHub verification is unavailable", async () => {
    const store = InMemoryStore.seeded();
    store.memberships.push({
      id: "membership_local_member",
      workspaceId: "ws_acme",
      userId: "user_local_member",
      role: "member",
      source: "local",
    });
    const app = createApp({
      auth: {
        ...authenticatedAs("user_local_member"),
        listAccessibleGitHubResources: async () => null,
      },
      env: { NODE_ENV: "production" },
      store,
    });

    const response = await app.fetch(
      new Request("https://cooee.test/api/admin/settings"),
    );

    expect(response.status).toBe(200);
  });

  test("allows a local OAuth App login to bootstrap a development workspace", async () => {
    const store = new InMemoryStore();
    const app = createApp({
      auth: {
        ...authenticatedAs("user_local"),
        listAccessibleGitHubResources: async () => null,
      },
      env: { NODE_ENV: "development", COOEE_RUNTIME_MODE: "hosted" },
      store,
    });

    const response = await app.fetch(
      new Request("http://localhost:3000/api/admin/settings"),
    );

    expect(response.status).toBe(200);
    expect(await store.listWorkspaceMemberships("user_local")).toEqual([
      expect.objectContaining({ role: "owner" }),
    ]);
  });

  test("public feeds support cross-origin embeds and static HTML has security headers", async () => {
    const staticRoot = mkdtempSync(join(tmpdir(), "cooee-security-"));
    writeFileSync(
      join(staticRoot, "index.html"),
      "<!doctype html><html></html>",
    );
    const app = createApp({ store: InMemoryStore.seeded(), staticRoot });
    const feed = await app.fetch(
      new Request(
        "https://cooee.test/api/public/changelogs/acme-app/feed.json",
        { headers: { origin: "https://customer.example" } },
      ),
    );
    expect(feed.headers.get("access-control-allow-origin")).toBe("*");
    expect(feed.headers.get("x-content-type-options")).toBe("nosniff");

    const preflight = await app.fetch(
      new Request(
        "https://cooee.test/api/public/changelogs/acme-app/feed.json",
        { method: "OPTIONS" },
      ),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain(
      "GET",
    );

    const html = await app.fetch(
      new Request("https://cooee.test/changelog/acme-app"),
    );
    expect(html.headers.get("x-frame-options")).toBe("DENY");
    expect(html.headers.get("permissions-policy")).toContain("camera=()");
  });

  test("GitHub webhooks fail closed without a verification secret", async () => {
    const app = createApp({ env: {}, store: InMemoryStore.seeded() });
    const response = await app.fetch(
      new Request("https://cooee.test/api/webhooks/github", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(response.status).toBe(503);
  });

  test("validates mandatory hosted production configuration", () => {
    expect(() => validateProductionConfig({ NODE_ENV: "production" })).toThrow(
      "Missing required production configuration",
    );
  });

  test("keeps disabled public changelogs out of public feeds", async () => {
    const store = InMemoryStore.seeded();
    store.workspaceSettings.set("ws_acme", { publicChangelog: false });
    const app = createApp({ store });
    const response = await app.fetch(
      new Request(
        "https://cooee.test/api/public/changelogs/acme-app/feed.json",
      ),
    );
    expect(response.status).toBe(404);
    const page = await app.fetch(
      new Request("https://cooee.test/changelog/acme-app"),
    );
    expect(page.status).toBe(404);
  });

  test("requires owner role for workspace mutations", async () => {
    const store = InMemoryStore.seeded();
    store.memberships.push({
      id: "membership_member",
      workspaceId: "ws_acme",
      userId: "user_member",
      role: "member",
    });
    const app = createApp({
      auth: authenticatedAs("user_member"),
      env: { NODE_ENV: "production" },
      store,
    });
    expect(
      (await app.fetch(new Request("https://cooee.test/api/admin/settings")))
        .status,
    ).toBe(200);
    expect(
      (
        await app.fetch(
          new Request("https://cooee.test/api/admin/settings", {
            method: "PUT",
            body: JSON.stringify({ settings: {} }),
          }),
        )
      ).status,
    ).toBe(403);
    const entry = store.entries[0];
    expect(entry).toBeDefined();
    expect(
      (
        await app.fetch(
          new Request(
            `https://cooee.test/api/admin/changelog-entries/${entry?.id}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                title: "Member edit",
                summary: "Members can maintain changelog content.",
                category: "improvement",
              }),
            },
          ),
        )
      ).status,
    ).toBe(200);
  });

  test("binds a first GitHub installation claim to signed user state", async () => {
    const store = InMemoryStore.seeded();
    store.memberships.push({
      id: "membership_owner",
      workspaceId: "ws_acme",
      userId: "user_owner",
      role: "owner",
    });
    const githubClient = {
      listInstallations: async () => [],
      listMergedPullRequests: async () => [],
      syncInstallation: async (installationId: number) => ({
        installation: {
          installationId,
          accountLogin: "owner",
          accountType: "User",
          suspendedAt: null,
        },
        repositories: [],
      }),
    };
    const app = createApp({
      auth: authenticatedAs(),
      env: {
        NODE_ENV: "production",
        APP_URL: "https://cooee.test",
        BETTER_AUTH_SECRET: "a".repeat(32),
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "private",
        GITHUB_APP_SLUG: "cooee-test",
      },
      githubClient,
      store,
    });
    const install = await app.fetch(
      new Request("https://cooee.test/api/admin/github/install"),
    );
    const state = new URL(
      install.headers.get("location") ?? "",
    ).searchParams.get("state");
    expect(state).toBeTruthy();

    const missingState = await app.fetch(
      new Request(
        "https://cooee.test/api/github/callback?installation_id=67890",
      ),
    );
    expect(missingState.headers.get("location")).toContain(
      "github=invalid-installation",
    );

    const callback = await app.fetch(
      new Request(
        `https://cooee.test/api/github/callback?installation_id=67890&state=${encodeURIComponent(state ?? "")}`,
      ),
    );
    expect(callback.headers.get("location")).toContain("github=connected");
    expect(await store.listGitHubInstallations("ws_acme")).toContainEqual(
      expect.objectContaining({ installationId: 67890 }),
    );
  });

  test("allows a signed local GitHub App callback with an OAuth App session", async () => {
    const store = InMemoryStore.seeded();
    store.memberships.push({
      id: "membership_owner",
      workspaceId: "ws_acme",
      userId: "user_owner",
      role: "owner",
    });
    const auth = authenticatedAs();
    auth.canAccessGitHubInstallation = async () => false;
    const app = createApp({
      auth,
      env: {
        NODE_ENV: "development",
        APP_URL: "https://cooee.test",
        VITE_PUBLIC_SITE_URL: "http://localhost:5173",
        BETTER_AUTH_SECRET: "a".repeat(32),
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "private",
        GITHUB_APP_SLUG: "cooee-test",
      },
      githubClient: {
        listMergedPullRequests: async () => [],
        syncInstallation: async (installationId: number) => ({
          installation: {
            installationId,
            accountLogin: "owner",
            accountType: "User",
            suspendedAt: null,
          },
          repositories: [],
        }),
      },
      store,
    });
    const install = await app.fetch(
      new Request("https://cooee.test/api/admin/github/install"),
    );
    const state = new URL(
      install.headers.get("location") ?? "",
    ).searchParams.get("state");
    const callback = await app.fetch(
      new Request(
        `https://cooee.test/api/github/callback?installation_id=67890&state=${encodeURIComponent(state ?? "")}`,
      ),
    );

    expect(callback.headers.get("location")).toBe(
      "http://localhost:5173/changelog?github=connected",
    );
  });

  test("does not allow a GitHub installation to move between workspaces", async () => {
    const store = InMemoryStore.seeded();
    await expect(
      store.upsertGitHubInstallation({
        workspaceId: "ws_other",
        installationId: 12345,
        accountLogin: "acme",
        accountType: "Organization",
      }),
    ).rejects.toThrow("already assigned");
    expect(store.githubInstallations[0].workspaceId).toBe("ws_acme");
  });

  test("locks a generated changelog window against duplicate runs", async () => {
    const store = InMemoryStore.seeded();
    store.pullRequests.push({
      id: "pr_launch_lock",
      number: 900,
      title: "Launch lock",
      body: "Prevent duplicate generation.",
      labels: [],
      mergedAt: "2026-06-05T12:00:00.000Z",
      url: "https://github.com/acme/app/pull/900",
      repository: "acme/app",
    });
    const input = {
      store,
      summarizer,
      changelogId: "cl_acme",
      windowStart: "2026-06-05T00:00:00.000Z",
      windowEnd: "2026-06-06T00:00:00.000Z",
    };
    expect((await generateChangelogForWindow(input)).status).toBe("published");
    await expect(generateChangelogForWindow(input)).rejects.toMatchObject({
      status: 409,
    });
  });
});
