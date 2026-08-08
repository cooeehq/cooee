import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cooeeAgentsInstructions,
  completePromptBeforeClosing,
  collectInitialSetupConfiguration,
  collectSetupConfiguration,
  createSetupSession,
  discoverLocalRepositoryRoot,
  discoverRepository,
  getSetupConfiguration,
  isMainModule,
  normalizeSetupConfiguration,
  parseArguments,
  parseGitHubRemote,
  pollSetupSession,
  saveSetupConfiguration,
  upsertCooeeAgentsInstructions,
  writeCooeeAgentsInstructions,
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

test("keeps the prompt open until all answers finish", async () => {
  let closeCount = 0;
  let finishPrompt: ((value: string) => void) | undefined;
  const pending = new Promise<string>((resolve) => {
    finishPrompt = resolve;
  });
  const result = completePromptBeforeClosing(pending, () => {
    closeCount += 1;
  });

  await Promise.resolve();
  expect(closeCount).toBe(0);
  finishPrompt?.("weekly");
  expect(await result).toBe("weekly");
  expect(closeCount).toBe(1);
});

test("discovers the repository without requiring GitHub CLI credentials", async () => {
  const repository = await discoverRepository(async () => ({
    stderr: "",
    stdout: "ssh://git@github.com/cooeehq/cooee.git\n",
  }));
  expect(repository).toBe("cooeehq/cooee");
});

test("matches the current checkout before offering an AGENTS.md update", async () => {
  const run = async (_command: string, args: string[]) => ({
    stderr: "",
    stdout: args.includes("--show-toplevel")
      ? "/tmp/cooee\n"
      : "git@github.com:cooeehq/cooee.git\n",
  });

  expect(await discoverLocalRepositoryRoot("CooeeHQ/Cooee", run)).toBe(
    "/tmp/cooee",
  );
  expect(
    await discoverLocalRepositoryRoot("acme/another-repository", run),
  ).toBeNull();
});

test("adds and refreshes one managed Cooee block without replacing instructions", () => {
  const original = "# Repository instructions\n\nKeep this guidance.\n";
  const inserted = upsertCooeeAgentsInstructions(original);

  expect(inserted).toStartWith(original);
  expect(inserted).toContain(cooeeAgentsInstructions);
  expect(upsertCooeeAgentsInstructions(inserted)).toBe(inserted);
  expect(() =>
    upsertCooeeAgentsInstructions(
      `${original}<!-- cooee-pr-labels:start -->\nIncomplete\n`,
    ),
  ).toThrow("incomplete or duplicate");
});

test("creates and updates AGENTS.md without committing it", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "cooee-cli-agents-"));
  const agentsPath = join(repositoryRoot, "AGENTS.md");
  try {
    expect(await writeCooeeAgentsInstructions(repositoryRoot)).toBe("created");
    expect(await readFile(agentsPath, "utf8")).toBe(
      `${cooeeAgentsInstructions}\n`,
    );
    expect(await writeCooeeAgentsInstructions(repositoryRoot)).toBe(
      "unchanged",
    );

    await writeFile(
      agentsPath,
      (await readFile(agentsPath, "utf8")).replace(
        "before handing the PR back to the user.",
        "Outdated wording.",
      ),
      "utf8",
    );
    expect(await writeCooeeAgentsInstructions(repositoryRoot)).toBe("updated");
    expect(await readFile(agentsPath, "utf8")).toContain(
      "before handing the PR back to the user.",
    );
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
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
    "pull-requests",
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
    generationSource: "pull-requests",
    historicalBackfillDays: 30,
    privacyLabels: "cooee:skip, cooee:private",
    publishTime: "16:30",
    scheduleFrequency: "weekly",
    scheduleMonthDay: 1,
    scheduleWeekday: 5,
  });
});

test("collects terminal choices before opening the browser and skips them for JSON", async () => {
  const terminalConfiguration = await collectInitialSetupConfiguration(
    false,
    async (initial) => ({ ...initial, scheduleFrequency: "weekly" }),
  );
  expect(terminalConfiguration).toMatchObject({
    scheduleFrequency: "weekly",
  });

  let prompted = false;
  const jsonConfiguration = await collectInitialSetupConfiguration(
    true,
    async () => {
      prompted = true;
      return normalizeSetupConfiguration({});
    },
  );
  expect(jsonConfiguration).toBeNull();
  expect(prompted).toBe(false);
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
