import { expect, test } from "bun:test";
import {
  collectSetupConfiguration,
  createSetupSession,
  discoverRepository,
  getSetupConfiguration,
  isMainModule,
  normalizeSetupConfiguration,
  parseArguments,
  parseGitHubRemote,
  pollSetupSession,
  saveSetupConfiguration,
} from "./index";

test("parses supported CLI arguments", () => {
  expect(
    parseArguments(["--repo", "cooeehq/cooee", "--no-open", "--skip-skill"]),
  ).toEqual({
    help: false,
    json: false,
    noOpen: true,
    repository: "cooeehq/cooee",
    skipSkill: true,
  });
  expect(() => parseArguments(["--repo", "not a repo"])).toThrow("--repo");
  expect(() => parseArguments(["--repo"])).toThrow("requires");
  expect(() => parseArguments(["--repo="])).toThrow("requires");
});

test("recognizes common GitHub origin remotes", () => {
  expect(parseGitHubRemote("git@github.com:cooeehq/cooee.git")).toBe(
    "cooeehq/cooee",
  );
  expect(parseGitHubRemote("https://github.com/cooeehq/cooee.git")).toBe(
    "cooeehq/cooee",
  );
  expect(parseGitHubRemote("https://gitlab.com/cooeehq/cooee.git")).toBeNull();
});

test("runs when npm invokes the bin through a symlink", () => {
  expect(
    isMainModule(
      "file:///tmp/cooee-changelog/dist/index.js",
      "/tmp/cooee-changelog/node_modules/.bin/cooee-changelog",
      () => "/tmp/cooee-changelog/dist/index.js",
    ),
  ).toBe(true);
});

test("discovers the repository without requiring GitHub CLI credentials", async () => {
  const repository = await discoverRepository(async () => ({
    stderr: "",
    stdout: "ssh://git@github.com/cooeehq/cooee.git\n",
  }));
  expect(repository).toBe("cooeehq/cooee");
});

test("polls until setup completes", async () => {
  let calls = 0;
  const result = await pollSetupSession({
    session: {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      pollToken: "token",
      sessionId: "session",
      setupUrl: "https://app.cooee.sh/app/setup?code=code",
    },
    request: async () => {
      calls += 1;
      return new Response(
        JSON.stringify(
          calls === 1
            ? { status: "awaiting-installation" }
            : {
                changelogUrl: "https://cooee.sh/changelog/cooee",
                dashboardUrl: "https://app.cooee.sh/app",
                repository: "cooeehq/cooee",
                status: "completed",
              },
        ),
        { headers: { "content-type": "application/json" } },
      );
    },
    wait: async () => {},
  });
  expect(result.status).toBe("completed");
  expect(calls).toBe(2);
});

test("surfaces hosted API errors and expired setup sessions", async () => {
  await expect(
    createSetupSession(
      "cooeehq/cooee",
      async () =>
        new Response(
          JSON.stringify({ error: "Hosted setup is unavailable." }),
          {
            status: 404,
          },
        ),
    ),
  ).rejects.toThrow("Hosted setup is unavailable.");

  await expect(
    pollSetupSession({
      session: {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        pollToken: "token",
        sessionId: "session",
        setupUrl: "https://app.cooee.sh/app/setup?code=code",
      },
      request: async () =>
        new Response(JSON.stringify({ status: "expired" }), { status: 410 }),
    }),
  ).rejects.toThrow("expired");
});

test("collects the Cooee choices in the terminal", async () => {
  const answers = [
    "weekly",
    "5",
    "16:30",
    "concise",
    "30",
    "cooee:skip, cooee:private",
    "yes",
  ];
  const configuration = await collectSetupConfiguration(
    normalizeSetupConfiguration({}),
    async () => answers.shift() ?? "",
  );

  expect(configuration).toEqual({
    aiPersonality: "concise",
    createImagesPerUpdate: true,
    historicalBackfillDays: 30,
    privacyLabels: "cooee:skip, cooee:private",
    publishTime: "16:30",
    scheduleFrequency: "weekly",
    scheduleMonthDay: 1,
    scheduleWeekday: 5,
  });
});

test("reads and saves only session-scoped configuration with the polling token", async () => {
  const session = {
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    pollToken: "token",
    sessionId: "session",
    setupUrl: "https://app.cooee.sh/app/setup?code=code",
  };
  const initial = await getSetupConfiguration(session, async (url, init) => {
    expect(url).toContain("/session/configuration");
    expect(init?.headers).toEqual({ authorization: "Bearer token" });
    return new Response(
      JSON.stringify({
        configuration: {
          aiPersonality: "technical",
          createImagesPerUpdate: true,
          historicalBackfillDays: 21,
          privacyLabels: "cooee:skip",
          publishTime: "11:00",
          scheduleFrequency: "on-merge",
          scheduleMonthDay: 1,
          scheduleWeekday: 1,
        },
      }),
    );
  });
  expect(initial.aiPersonality).toBe("technical");

  const result = await saveSetupConfiguration(
    session,
    initial,
    async (_url, init) => {
      expect(init?.method).toBe("PUT");
      expect(init?.headers).toEqual({
        authorization: "Bearer token",
        "content-type": "application/json",
      });
      return new Response(
        JSON.stringify({
          changelogUrl: "https://cooee.sh/changelog/cooee",
          dashboardUrl: "https://app.cooee.sh/app",
          repository: "cooeehq/cooee",
          status: "completed",
        }),
      );
    },
  );
  expect(result.status).toBe("completed");
});
