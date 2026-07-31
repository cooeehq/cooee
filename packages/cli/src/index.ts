#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const execFileAsync = promisify(execFile);
const appUrl = "https://app.cooee.sh";
const skillInstallCommand = [
  "npx",
  "skills",
  "add",
  "cooeehq/cooee",
  "--skill",
  "cooee-pr-labels",
  "-g",
];

export type CliArguments = {
  help: boolean;
  json: boolean;
  noOpen: boolean;
  repository: string | null;
  skipSkill: boolean;
};

type SetupSession = {
  expiresAt: string;
  pollToken: string;
  sessionId: string;
  setupUrl: string;
};

type SetupStatus = {
  changelogUrl?: string | null;
  dashboardUrl?: string | null;
  error?: string | null;
  expiresAt?: string;
  repository?: string;
  status: string;
};

export function parseArguments(argv: string[]): CliArguments {
  const result: CliArguments = {
    help: false,
    json: false,
    noOpen: false,
    repository: null,
    skipSkill: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") result.help = true;
    else if (argument === "--json") result.json = true;
    else if (argument === "--no-open") result.noOpen = true;
    else if (argument === "--skip-skill") result.skipSkill = true;
    else if (argument === "--repo") {
      const repository = argv[index + 1];
      if (!repository || repository.startsWith("--")) {
        throw new Error("--repo requires an owner/repository value.");
      }
      result.repository = repository;
      index += 1;
    } else if (argument.startsWith("--repo=")) {
      const repository = argument.slice("--repo=".length);
      if (!repository) {
        throw new Error("--repo requires an owner/repository value.");
      }
      result.repository = repository;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (result.repository && !isGitHubRepository(result.repository)) {
    throw new Error("--repo must use the owner/repository GitHub format.");
  }
  return result;
}

export function parseGitHubRemote(remote: string): string | null {
  const value = remote.trim().replace(/\.git$/, "");
  const match =
    /^(?:git@github\.com:|https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+)$/.exec(
      value,
    );
  return match?.[1] && isGitHubRepository(match[1]) ? match[1] : null;
}

export async function discoverRepository(
  run = execFileAsync,
): Promise<string | null> {
  try {
    const { stdout: remote } = await run("git", [
      "remote",
      "get-url",
      "origin",
    ]);
    return parseGitHubRemote(remote);
  } catch {
    return null;
  }
}

export async function createSetupSession(
  repository: string,
  request: typeof fetch = fetch,
): Promise<SetupSession> {
  const response = await request(`${appUrl}/api/cli/setup-sessions`, {
    body: JSON.stringify({ repository }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = (await response
    .json()
    .catch(() => ({}))) as Partial<SetupSession> & {
    error?: string;
  };
  if (
    !response.ok ||
    !body.sessionId ||
    !body.pollToken ||
    !body.setupUrl ||
    !body.expiresAt
  ) {
    throw new Error(
      body.error ?? "Cooee could not start setup. Try again shortly.",
    );
  }
  return body as SetupSession;
}

export async function pollSetupSession({
  onStatus,
  request = fetch,
  session,
  wait = sleep,
}: {
  onStatus?: (status: SetupStatus) => void;
  request?: typeof fetch;
  session: SetupSession;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<SetupStatus> {
  const expiry = new Date(session.expiresAt).getTime();
  let previousStatus = "";
  while (Date.now() < expiry) {
    const response = await request(
      `${appUrl}/api/cli/setup-sessions/${encodeURIComponent(session.sessionId)}`,
      { headers: { authorization: `Bearer ${session.pollToken}` } },
    );
    const body = (await response.json().catch(() => ({}))) as SetupStatus & {
      error?: string;
    };
    if (response.status === 410 || body.status === "expired") {
      throw new Error(
        "Cooee setup expired. Run the command again to start over.",
      );
    }
    if (!response.ok) {
      throw new Error(body.error ?? "Cooee could not check setup status.");
    }
    if (body.status !== previousStatus) {
      previousStatus = body.status;
      onStatus?.(body);
    }
    if (body.status === "completed") return body;
    await wait(2_000);
  }
  throw new Error("Cooee setup expired. Run the command again to start over.");
}

export async function openBrowser(url: string): Promise<boolean> {
  let command: string;
  let args: string[];
  if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  return new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

export async function offerSkillInstall(
  prompt = promptForSkillInstall,
  install = runSkillInstaller,
): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) return false;
  if (!(await prompt())) return false;
  return install();
}

async function promptForSkillInstall(): Promise<boolean> {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await readline.question(
      "Install the optional Cooee PR Labels skill for Codex/Claude? [y/N] ",
    );
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

async function runSkillInstaller(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(skillInstallCommand[0], skillInstallCommand.slice(1), {
      stdio: "inherit",
    });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isGitHubRepository(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(
    value.trim(),
  );
}

function printHelp(): void {
  console.log(`Usage: cooee-changelog [options]

Connect the current GitHub repository to hosted Cooee.

Options:
  --repo owner/repository  Use a repository instead of the Git origin remote
  --no-open                Print the browser URL without opening it
  --json                   Print the final result as JSON
  --skip-skill             Do not offer the optional PR-labeling skill
  -h, --help               Show this help`);
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const repository = args.repository ?? (await discoverRepository());
  if (!repository) {
    throw new Error(
      "No GitHub origin remote found. Re-run with --repo owner/repository.",
    );
  }

  const session = await createSetupSession(repository);
  if (!args.json) {
    console.log(`Starting Cooee setup for ${repository}.`);
    console.log(
      `Open this URL if your browser does not launch:\n${session.setupUrl}`,
    );
  }
  if (!args.noOpen) await openBrowser(session.setupUrl);

  const result = await pollSetupSession({
    session,
    onStatus: args.json
      ? undefined
      : (status) => {
          if (status.status === "repository-not-granted") {
            console.log(
              status.error ??
                "Grant Cooee access to the requested repository, then continue in the browser.",
            );
          }
        },
  });
  if (args.json) {
    console.log(
      JSON.stringify({
        ...result,
        ...(!args.skipSkill
          ? { optionalSkillInstallCommand: skillInstallCommand.join(" ") }
          : {}),
      }),
    );
  } else {
    console.log(`Cooee is connected to ${result.repository}.`);
    console.log(`Dashboard: ${result.dashboardUrl}`);
    console.log(`Changelog: ${result.changelogUrl}`);
  }

  if (!args.skipSkill && !args.json && stdin.isTTY && stdout.isTTY) {
    const installed = await offerSkillInstall();
    if (!installed) {
      console.log(
        `Optional PR-labeling skill: ${skillInstallCommand.join(" ")}`,
      );
    }
  } else if (!args.skipSkill && !args.json) {
    console.log(`Optional PR-labeling skill: ${skillInstallCommand.join(" ")}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Cooee setup failed.";
    console.error(message);
    process.exitCode = 1;
  });
}
