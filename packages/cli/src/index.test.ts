import { expect, test } from "bun:test";
import {
  createSetupSession,
  discoverRepository,
  parseArguments,
  parseGitHubRemote,
  pollSetupSession,
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
