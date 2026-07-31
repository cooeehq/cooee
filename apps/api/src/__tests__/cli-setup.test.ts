import { expect, test } from "bun:test";
import { createApp } from "../server";
import { InMemoryStore } from "../store/memory";
import type { AuthRuntime } from "../auth";
import type { GitHubAppClient } from "../services/github";

test("creates a paired CLI setup session without exposing the repository to polling", async () => {
  const store = InMemoryStore.seeded();
  const app = createApp({
    env: {
      APP_URL: "https://app.cooee.sh",
      COOEE_CLI_SETUP_ENABLED: "true",
    },
    store,
  });

  const created = await app.fetch(
    new Request("https://app.cooee.sh/api/cli/setup-sessions", {
      body: JSON.stringify({ repository: "cooeehq/cooee" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  expect(created.status).toBe(200);
  const body = (await created.json()) as {
    pollToken: string;
    sessionId: string;
    setupUrl: string;
  };
  expect(body.setupUrl).toStartWith("https://app.cooee.sh/app/setup?code=");

  const pending = await app.fetch(
    new Request(
      `https://app.cooee.sh/api/cli/setup-sessions/${body.sessionId}`,
      { headers: { authorization: `Bearer ${body.pollToken}` } },
    ),
  );
  expect(await pending.json()).toEqual({
    error: null,
    expiresAt: expect.any(String),
    status: "pending",
  });

  const browserCode = new URL(body.setupUrl).searchParams.get("code") ?? "";
  const claimed = await app.fetch(
    new Request("https://app.cooee.sh/api/cli/setup-sessions/claim", {
      body: JSON.stringify({ code: browserCode }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  const cookie = claimed.headers.get("set-cookie");
  expect(cookie).toContain("__Host-cooee-cli-setup=");
  expect(await claimed.json()).toEqual({
    error: null,
    expiresAt: expect.any(String),
    status: "pending",
    targetRepository: "cooeehq/cooee",
  });

  const browser = await app.fetch(
    new Request("https://app.cooee.sh/api/cli/setup-sessions/browser", {
      headers: { cookie: cookie?.split(";")[0] ?? "" },
    }),
  );
  expect((await browser.json()).targetRepository).toBe("cooeehq/cooee");

  const unauthorized = await app.fetch(
    new Request(
      `https://app.cooee.sh/api/cli/setup-sessions/${body.sessionId}`,
      { headers: { authorization: "Bearer wrong-token" } },
    ),
  );
  expect(unauthorized.status).toBe(404);
});

test("expires setup sessions and keeps the feature disabled outside hosted setup", async () => {
  const store = InMemoryStore.seeded();
  const enabled = createApp({
    env: { COOEE_CLI_SETUP_ENABLED: "true" },
    store,
  });
  const created = await enabled.fetch(
    new Request("http://cooee.test/api/cli/setup-sessions", {
      body: JSON.stringify({ repository: "cooeehq/cooee" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  const body = (await created.json()) as {
    pollToken: string;
    sessionId: string;
  };
  store.cliSetupSessions[0]!.expiresAt = new Date(Date.now() - 1).toISOString();

  const expired = await enabled.fetch(
    new Request(`http://cooee.test/api/cli/setup-sessions/${body.sessionId}`, {
      headers: { authorization: `Bearer ${body.pollToken}` },
    }),
  );
  expect(expired.status).toBe(410);

  const disabled = createApp({ store: InMemoryStore.seeded() });
  const unavailable = await disabled.fetch(
    new Request("http://cooee.test/api/cli/setup-sessions", {
      body: JSON.stringify({ repository: "cooeehq/cooee" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  expect(unavailable.status).toBe(404);
});

test("does not rate limit authenticated CLI polling while setup is in progress", async () => {
  const store = InMemoryStore.seeded();
  const app = createApp({
    env: {
      COOEE_CLI_SETUP_ENABLED: "true",
      NODE_ENV: "production",
    },
    store,
  });
  const created = await app.fetch(
    new Request("https://app.cooee.sh/api/cli/setup-sessions", {
      body: JSON.stringify({ repository: "cooeehq/cooee" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  const body = (await created.json()) as {
    pollToken: string;
    sessionId: string;
  };

  for (let attempt = 0; attempt < 35; attempt += 1) {
    const response = await app.fetch(
      new Request(
        `https://app.cooee.sh/api/cli/setup-sessions/${body.sessionId}`,
        { headers: { authorization: `Bearer ${body.pollToken}` } },
      ),
    );
    expect(response.status).toBe(200);
  }
});

test("binds the GitHub App callback to the paired setup session", async () => {
  const store = new InMemoryStore();
  const auth: AuthRuntime = {
    handler: async () => new Response(null, { status: 404 }),
    getSession: async () => ({
      user: { id: "user_1", name: "Mona", email: "mona@example.com" },
    }),
    listAccessibleGitHubInstallationIds: async () => [],
    canAccessGitHubInstallation: async () => true,
  };
  const githubClient: GitHubAppClient = {
    listMergedPullRequests: async () => [],
    syncInstallation: async (installationId) => ({
      installation: {
        installationId,
        accountLogin: "cooeehq",
        accountType: "Organization",
        suspendedAt: null,
      },
      repositories: [
        {
          owner: "cooeehq",
          name: "cooee",
          fullName: "cooeehq/cooee",
          private: true,
        },
      ],
    }),
  };
  const app = createApp({
    auth,
    env: {
      APP_URL: "https://app.cooee.sh",
      BETTER_AUTH_SECRET: "a-secure-test-secret-that-is-long-enough",
      COOEE_CLI_SETUP_ENABLED: "true",
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: "private-key",
      GITHUB_APP_SLUG: "cooee-test",
      NODE_ENV: "production",
    },
    githubClient,
    store,
  });
  const created = await app.fetch(
    new Request("https://app.cooee.sh/api/cli/setup-sessions", {
      body: JSON.stringify({ repository: "cooeehq/cooee" }),
      headers: {
        "content-type": "application/json",
        "x-real-ip": "203.0.113.1",
      },
      method: "POST",
    }),
  );
  const setup = (await created.json()) as {
    pollToken: string;
    sessionId: string;
    setupUrl: string;
  };
  const code = new URL(setup.setupUrl).searchParams.get("code") ?? "";
  const claim = await app.fetch(
    new Request("https://app.cooee.sh/api/cli/setup-sessions/claim", {
      body: JSON.stringify({ code }),
      headers: {
        "content-type": "application/json",
        "x-real-ip": "203.0.113.1",
      },
      method: "POST",
    }),
  );
  const cookie = claim.headers.get("set-cookie")?.split(";")[0] ?? "";
  const install = await app.fetch(
    new Request("https://app.cooee.sh/api/cli/setup-sessions/install", {
      headers: { cookie, "x-real-ip": "203.0.113.1" },
    }),
  );
  expect(install.status).toBe(302);
  const githubInstall = new URL(install.headers.get("location") ?? "");
  const callback = await app.fetch(
    new Request(
      `https://app.cooee.sh/api/github/callback?installation_id=9&state=${encodeURIComponent(githubInstall.searchParams.get("state") ?? "")}`,
      { headers: { "x-real-ip": "203.0.113.1" } },
    ),
  );
  expect(callback.headers.get("location")).toBe(
    "https://app.cooee.sh/app/setup",
  );

  const browser = await app.fetch(
    new Request("https://app.cooee.sh/api/cli/setup-sessions/browser", {
      headers: { cookie, "x-real-ip": "203.0.113.1" },
    }),
  );
  expect(await browser.json()).toMatchObject({
    status: "ready-to-complete",
    targetRepository: "cooeehq/cooee",
  });

  const paired = store.cliSetupSessions[0]!;
  store.workspaceSettings.set(paired.workspaceId!, {
    onboardingCompleted: true,
  });
  const complete = await app.fetch(
    new Request("https://app.cooee.sh/api/cli/setup-sessions/complete", {
      headers: { cookie, "x-real-ip": "203.0.113.1" },
      method: "POST",
    }),
  );
  expect(complete.status).toBe(200);

  const poll = await app.fetch(
    new Request(
      `https://app.cooee.sh/api/cli/setup-sessions/${setup.sessionId}`,
      {
        headers: {
          authorization: `Bearer ${setup.pollToken}`,
          "x-real-ip": "203.0.113.1",
        },
      },
    ),
  );
  expect(await poll.json()).toMatchObject({
    changelogUrl: expect.stringContaining("/changelog/"),
    repository: "cooeehq/cooee",
    status: "completed",
  });
});
