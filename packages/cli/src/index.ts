#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
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
const cooeeAgentsInstructionsStart = "<!-- cooee-pr-labels:start -->";
const cooeeAgentsInstructionsEnd = "<!-- cooee-pr-labels:end -->";

export const cooeeAgentsInstructions = `${cooeeAgentsInstructionsStart}
## Cooee pull-request labels

When creating, updating, reviewing, or preparing a pull request, use
\`$cooee-pr-labels\` after the PR exists. Apply the appropriate Cooee category
before handing the PR back to the user.
${cooeeAgentsInstructionsEnd}`;

export type CliArguments = {
  help: boolean;
  json: boolean;
  noOpen: boolean;
  repository: string | null;
  skipSkill: boolean;
};

export type SetupSession = {
  expiresAt: string;
  pollToken: string;
  sessionId: string;
  setupUrl: string;
};

export type SetupConfiguration = {
  aiPersonality: "product-user" | "concise" | "technical";
  createImagesPerUpdate: boolean;
  historicalBackfillDays: number;
  privacyLabels: string;
  publishTime: string;
  scheduleFrequency: "daily" | "weekly" | "monthly" | "on-merge";
  scheduleMonthDay: number;
  scheduleWeekday: number;
};

export type SetupStatus = {
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

export async function discoverLocalRepositoryRoot(
  repository: string,
  run = execFileAsync,
): Promise<string | null> {
  try {
    const { stdout: rootOutput } = await run("git", [
      "rev-parse",
      "--show-toplevel",
    ]);
    const root = rootOutput.trim();
    if (!root) return null;
    const { stdout: remote } = await run("git", [
      "-C",
      root,
      "remote",
      "get-url",
      "origin",
    ]);
    const localRepository = parseGitHubRemote(remote);
    return localRepository?.toLowerCase() === repository.toLowerCase()
      ? root
      : null;
  } catch {
    return null;
  }
}

export function upsertCooeeAgentsInstructions(content: string): string {
  const start = content.indexOf(cooeeAgentsInstructionsStart);
  const end = content.indexOf(cooeeAgentsInstructionsEnd);
  const hasStart = start >= 0;
  const hasEnd = end >= 0;
  const duplicateStart =
    hasStart && content.indexOf(cooeeAgentsInstructionsStart, start + 1) >= 0;
  const duplicateEnd =
    hasEnd && content.indexOf(cooeeAgentsInstructionsEnd, end + 1) >= 0;

  if (
    hasStart !== hasEnd ||
    (hasStart && end < start) ||
    duplicateStart ||
    duplicateEnd
  ) {
    throw new Error(
      "AGENTS.md contains an incomplete or duplicate Cooee managed block.",
    );
  }

  if (hasStart) {
    const blockEnd = end + cooeeAgentsInstructionsEnd.length;
    return `${content.slice(0, start)}${cooeeAgentsInstructions}${content.slice(blockEnd)}`;
  }

  const separator =
    content.length === 0
      ? ""
      : content.endsWith("\n\n")
        ? ""
        : content.endsWith("\n")
          ? "\n"
          : "\n\n";
  return `${content}${separator}${cooeeAgentsInstructions}\n`;
}

export type AgentsInstructionsUpdate = "created" | "updated" | "unchanged";

export async function writeCooeeAgentsInstructions(
  repositoryRoot: string,
): Promise<AgentsInstructionsUpdate> {
  const agentsPath = join(repositoryRoot, "AGENTS.md");
  let content = "";
  let exists = false;

  try {
    const stats = await lstat(agentsPath);
    if (stats.isSymbolicLink()) {
      throw new Error("Refusing to update a symlinked AGENTS.md file.");
    }
    if (!stats.isFile()) {
      throw new Error("AGENTS.md exists but is not a regular file.");
    }
    content = await readFile(agentsPath, "utf8");
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const updated = upsertCooeeAgentsInstructions(content);
  if (updated === content) return "unchanged";
  await writeFile(agentsPath, updated, "utf8");
  return exists ? "updated" : "created";
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
    if (body.status === "completed" || body.status === "ready-to-complete") {
      return body;
    }
    await wait(2_000);
  }
  throw new Error("Cooee setup expired. Run the command again to start over.");
}

export async function getSetupConfiguration(
  session: SetupSession,
  request: typeof fetch = fetch,
): Promise<SetupConfiguration> {
  const response = await request(
    `${appUrl}/api/cli/setup-sessions/${encodeURIComponent(session.sessionId)}/configuration`,
    { headers: { authorization: `Bearer ${session.pollToken}` } },
  );
  const body = (await response.json().catch(() => ({}))) as {
    configuration?: Partial<SetupConfiguration>;
    error?: string;
  };
  if (!response.ok || !body.configuration) {
    throw new Error(body.error ?? "Cooee could not load setup choices.");
  }
  return normalizeSetupConfiguration(body.configuration);
}

export async function saveSetupConfiguration(
  session: SetupSession,
  configuration: SetupConfiguration,
  request: typeof fetch = fetch,
): Promise<SetupStatus> {
  const response = await request(
    `${appUrl}/api/cli/setup-sessions/${encodeURIComponent(session.sessionId)}/configuration`,
    {
      body: JSON.stringify({ configuration }),
      headers: {
        authorization: `Bearer ${session.pollToken}`,
        "content-type": "application/json",
      },
      method: "PUT",
    },
  );
  const body = (await response.json().catch(() => ({}))) as SetupStatus & {
    error?: string;
  };
  if (!response.ok || body.status !== "completed") {
    throw new Error(body.error ?? "Cooee could not save setup choices.");
  }
  return body;
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

export async function collectSetupConfiguration(
  initial: SetupConfiguration,
  ask: (question: string) => Promise<string>,
): Promise<SetupConfiguration> {
  const scheduleFrequency = readScheduleFrequency(
    await ask(
      `Publish cadence [daily/weekly/monthly/on-merge] (${initial.scheduleFrequency}): `,
    ),
    initial.scheduleFrequency,
  );
  const scheduleWeekday =
    scheduleFrequency === "weekly"
      ? readBoundedNumber(
          await ask(
            `Weekday [Sunday=0, Monday=1] (${initial.scheduleWeekday}): `,
          ),
          initial.scheduleWeekday,
          0,
          6,
          "Choose a weekday from 0 to 6.",
        )
      : initial.scheduleWeekday;
  const scheduleMonthDay =
    scheduleFrequency === "monthly"
      ? readBoundedNumber(
          await ask(`Day of the month (${initial.scheduleMonthDay}): `),
          initial.scheduleMonthDay,
          1,
          31,
          "Choose a day from 1 to 31.",
        )
      : initial.scheduleMonthDay;
  const publishTime =
    scheduleFrequency === "on-merge"
      ? initial.publishTime
      : readPublishTime(
          await ask(
            `Publishing time, 24-hour local time (${initial.publishTime}): `,
          ),
          initial.publishTime,
        );
  const aiPersonality = readAiPersonality(
    await ask(
      `Writing style [product-user/concise/technical] (${initial.aiPersonality}): `,
    ),
    initial.aiPersonality,
  );
  const historicalBackfillDays = readBoundedNumber(
    await ask(
      `Backfill merged PRs from the last how many days (${initial.historicalBackfillDays}): `,
    ),
    initial.historicalBackfillDays,
    1,
    365,
    "Choose a backfill length from 1 to 365 days.",
  );
  const privacyLabels = readLabelList(
    await ask(`Privacy labels, comma-separated (${initial.privacyLabels}): `),
    initial.privacyLabels,
  );
  const createImagesPerUpdate = readYesNo(
    await ask(
      `Create an image for each published update? [y/N] (${initial.createImagesPerUpdate ? "Y/n" : "y/N"}): `,
    ),
    initial.createImagesPerUpdate,
  );

  return {
    aiPersonality,
    createImagesPerUpdate,
    historicalBackfillDays,
    privacyLabels,
    publishTime,
    scheduleFrequency,
    scheduleMonthDay,
    scheduleWeekday,
  };
}

export async function promptForSetupConfiguration(
  initial: SetupConfiguration,
): Promise<SetupConfiguration> {
  const readline = createInterface({ input: stdin, output: stdout });
  return completePromptBeforeClosing(
    collectSetupConfiguration(initial, (question) =>
      readline.question(question),
    ),
    () => readline.close(),
  );
}

export async function completePromptBeforeClosing<T>(
  pending: Promise<T>,
  close: () => void,
): Promise<T> {
  try {
    return await pending;
  } finally {
    close();
  }
}

export async function collectInitialSetupConfiguration(
  json: boolean,
  prompt: (
    initial: SetupConfiguration,
  ) => Promise<SetupConfiguration> = promptForSetupConfiguration,
): Promise<SetupConfiguration | null> {
  if (json) return null;
  return prompt(normalizeSetupConfiguration({}));
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

async function promptForAgentsInstructions(
  agentsPath: string,
): Promise<boolean> {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await readline.question(
      `Add Cooee PR-label instructions to ${agentsPath}? Compatible coding agents will classify and label PRs after creating them. [y/N] `,
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

export function normalizeSetupConfiguration(
  input: Partial<SetupConfiguration>,
): SetupConfiguration {
  return {
    aiPersonality: isAiPersonality(input.aiPersonality)
      ? input.aiPersonality
      : "product-user",
    createImagesPerUpdate: input.createImagesPerUpdate === true,
    historicalBackfillDays: normalizeBoundedNumber(
      input.historicalBackfillDays,
      14,
      1,
      365,
    ),
    privacyLabels:
      typeof input.privacyLabels === "string" && input.privacyLabels.trim()
        ? input.privacyLabels.trim()
        : "cooee:skip, cooee:internal, security",
    publishTime:
      typeof input.publishTime === "string" && isPublishTime(input.publishTime)
        ? input.publishTime
        : "09:00",
    scheduleFrequency: isScheduleFrequency(input.scheduleFrequency)
      ? input.scheduleFrequency
      : "daily",
    scheduleMonthDay: normalizeBoundedNumber(input.scheduleMonthDay, 1, 1, 31),
    scheduleWeekday: normalizeBoundedNumber(input.scheduleWeekday, 1, 0, 6),
  };
}

function readScheduleFrequency(
  value: string,
  fallback: SetupConfiguration["scheduleFrequency"],
): SetupConfiguration["scheduleFrequency"] {
  const candidate = value.trim().toLowerCase();
  if (!candidate) return fallback;
  if (isScheduleFrequency(candidate)) return candidate;
  throw new Error("Choose daily, weekly, monthly, or on-merge.");
}

function readAiPersonality(
  value: string,
  fallback: SetupConfiguration["aiPersonality"],
): SetupConfiguration["aiPersonality"] {
  const candidate = value.trim().toLowerCase();
  if (!candidate) return fallback;
  if (isAiPersonality(candidate)) return candidate;
  throw new Error("Choose product-user, concise, or technical.");
}

function readBoundedNumber(
  value: string,
  fallback: number,
  minimum: number,
  maximum: number,
  error: string,
): number {
  if (!value.trim()) return fallback;
  const candidate = Number(value);
  if (
    !Number.isInteger(candidate) ||
    candidate < minimum ||
    candidate > maximum
  ) {
    throw new Error(error);
  }
  return candidate;
}

function readPublishTime(value: string, fallback: string): string {
  if (!value.trim()) return fallback;
  if (!isPublishTime(value.trim())) {
    throw new Error("Use a 24-hour time such as 09:00.");
  }
  return value.trim();
}

function readLabelList(value: string, fallback: string): string {
  if (!value.trim()) return fallback;
  const labels = value
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  if (labels.length === 0) {
    throw new Error("Enter at least one privacy label.");
  }
  return Array.from(new Set(labels)).join(", ");
}

function readYesNo(value: string, fallback: boolean): boolean {
  const candidate = value.trim().toLowerCase();
  if (!candidate) return fallback;
  if (["y", "yes"].includes(candidate)) return true;
  if (["n", "no"].includes(candidate)) return false;
  throw new Error("Answer yes or no.");
}

function normalizeBoundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : fallback;
}

function isScheduleFrequency(
  value: unknown,
): value is SetupConfiguration["scheduleFrequency"] {
  return ["daily", "weekly", "monthly", "on-merge"].includes(value as string);
}

function isAiPersonality(
  value: unknown,
): value is SetupConfiguration["aiPersonality"] {
  return ["product-user", "concise", "technical"].includes(value as string);
}

function isPublishTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
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
  --skip-skill             Do not offer optional coding-agent PR labeling
  -h, --help               Show this help`);
}

export function isMainModule(
  moduleUrl: string,
  entryPath: string | undefined,
  resolveEntryPath: (path: string) => string = realpathSync,
): boolean {
  if (!entryPath) return false;
  try {
    return fileURLToPath(moduleUrl) === resolveEntryPath(entryPath);
  } catch {
    return false;
  }
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
      "Choose your changelog defaults before connecting GitHub. Cooee will apply them automatically after approval.",
    );
  }
  const terminalConfiguration = await collectInitialSetupConfiguration(
    args.json,
  );
  if (!args.json) {
    console.log(
      `Open this URL if your browser does not launch:\n${session.setupUrl}`,
    );
  }
  if (!args.noOpen) await openBrowser(session.setupUrl);

  let result = await pollSetupSession({
    session,
    onStatus: args.json
      ? undefined
      : (status) => {
          if (status.status === "awaiting-installation") {
            console.log(
              "Waiting for GitHub App access. Complete the browser step, then return here.",
            );
          }
          if (status.status === "repository-not-granted") {
            console.log(
              status.error ??
                "Grant Cooee access to the requested repository, then continue in the browser.",
            );
          }
        },
  });
  if (result.status === "ready-to-complete") {
    if (!args.json) {
      console.log("GitHub access confirmed. Applying your setup choices…");
    }
    const configuration =
      terminalConfiguration ?? (await getSetupConfiguration(session));
    result = await saveSetupConfiguration(session, configuration);
  }
  if (args.json) {
    const localRepositoryRoot = !args.skipSkill
      ? await discoverLocalRepositoryRoot(repository)
      : null;
    console.log(
      JSON.stringify({
        ...result,
        ...(!args.skipSkill
          ? {
              optionalAgentsInstructions: {
                content: cooeeAgentsInstructions,
                path: localRepositoryRoot
                  ? join(localRepositoryRoot, "AGENTS.md")
                  : null,
              },
              optionalSkillInstallCommand: skillInstallCommand.join(" "),
            }
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
    const localRepositoryRoot = await discoverLocalRepositoryRoot(repository);
    if (localRepositoryRoot) {
      const agentsPath = join(localRepositoryRoot, "AGENTS.md");
      if (await promptForAgentsInstructions(agentsPath)) {
        try {
          const update =
            await writeCooeeAgentsInstructions(localRepositoryRoot);
          console.log(
            update === "unchanged"
              ? `${agentsPath} already contains the current Cooee instructions.`
              : `${update === "created" ? "Created" : "Updated"} ${agentsPath}. Review and commit it when ready.`,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "The file could not be updated.";
          console.log(`Could not update ${agentsPath}: ${message}`);
        }
      }
    } else {
      console.log(
        `The connected repository is not the current local checkout. Add this block to its AGENTS.md:\n\n${cooeeAgentsInstructions}`,
      );
    }
  } else if (!args.skipSkill && !args.json) {
    console.log(`Optional PR-labeling skill: ${skillInstallCommand.join(" ")}`);
    console.log(
      `Optional AGENTS.md instructions:\n\n${cooeeAgentsInstructions}`,
    );
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  void main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Cooee setup failed.";
    console.error(message);
    process.exitCode = 1;
  });
}
