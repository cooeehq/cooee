import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "cooee-pr-label.sh");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function runHelper(...args: string[]) {
  const directory = await mkdtemp(join(tmpdir(), "cooee-pr-label-test-"));
  temporaryDirectories.push(directory);
  const log = join(directory, "gh.log");
  const gh = join(directory, "gh");
  await writeFile(
    gh,
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$GH_LOG"
if [[ "$1 $2" == "label list" ]]; then
  printf '%s\\n' 'cooee:fix'
elif [[ "$1 $2" == "pr view" ]]; then
  printf '%s\\n' '{"number":42,"title":"Fix output","url":"https://github.com/cooeehq/cooee/pull/42","labels":[]}'
fi
`,
  );
  await chmod(gh, 0o755);

  const process = Bun.spawn(["bash", script, ...args], {
    env: {
      ...Bun.env,
      GH_LOG: log,
      PATH: `${directory}:${Bun.env.PATH}`,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return {
    exitCode,
    ghCalls: await readFile(log, "utf8"),
    stderr,
    stdout,
  };
}

test("refuses to apply a label without recorded user confirmation", async () => {
  const result = await runHelper(
    "apply",
    "cooee:fix",
    "https://github.com/cooeehq/cooee/pull/42",
  );

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("Ask the user to confirm");
  expect(result.ghCalls).not.toContain("pr edit");
});

test("inspects the exact connected PR with classification context", async () => {
  const result = await runHelper(
    "status",
    "https://github.com/cooeehq/cooee/pull/42",
  );

  expect(result.exitCode).toBe(0);
  expect(result.ghCalls).toContain(
    "pr view https://github.com/cooeehq/cooee/pull/42 --json number,title,body,url,baseRefName,headRefName,labels",
  );
});

test("applies the confirmed label to the exact connected PR", async () => {
  const result = await runHelper(
    "apply",
    "--confirmed",
    "cooee:fix",
    "https://github.com/cooeehq/cooee/pull/42",
  );

  expect(result.exitCode).toBe(0);
  expect(result.ghCalls).toContain(
    "label list --repo cooeehq/cooee --limit 1000 --json name --jq .[].name",
  );
  expect(result.ghCalls).toContain(
    "pr edit https://github.com/cooeehq/cooee/pull/42 --add-label cooee:fix",
  );
});

test("preserves a GitHub Enterprise host when checking its labels", async () => {
  const result = await runHelper(
    "apply",
    "--confirmed",
    "cooee:fix",
    "https://github.example.com/cooeehq/cooee/pull/42",
  );

  expect(result.exitCode).toBe(0);
  expect(result.ghCalls).toContain(
    "label list --repo github.example.com/cooeehq/cooee --limit 1000 --json name --jq .[].name",
  );
});

test("replaces only the confirmed Cooee label on the connected PR", async () => {
  const result = await runHelper(
    "replace",
    "--confirmed",
    "cooee:improvement",
    "cooee:fix",
    "https://github.com/cooeehq/cooee/pull/42",
  );

  expect(result.exitCode).toBe(0);
  expect(result.ghCalls).toContain(
    "pr edit https://github.com/cooeehq/cooee/pull/42 --remove-label cooee:improvement --add-label cooee:fix",
  );
});
