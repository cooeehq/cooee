import { expect, test } from "bun:test";

test("CooeeUpdates component behavior", async () => {
  const child = Bun.spawn(["bun", "test", "./component.cases.tsx"], {
    cwd: import.meta.dir,
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
});
