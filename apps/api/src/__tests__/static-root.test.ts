import { describe, expect, test } from "bun:test";
import { resolveStaticRoot } from "../static-root";

describe("frontend static root", () => {
  test("resolves a configured bundle from the workspace root", () => {
    expect(
      resolveStaticRoot("apps/admin/dist", "/workspace/apps/api/src"),
    ).toBe("/workspace/apps/admin/dist");
  });

  test("preserves an absolute bundle path and the default fallback", () => {
    expect(
      resolveStaticRoot("/srv/cooee/admin", "/workspace/apps/api/src"),
    ).toBe("/srv/cooee/admin");
    expect(resolveStaticRoot("  ", "/workspace/apps/api/src")).toBeUndefined();
    expect(
      resolveStaticRoot(undefined, "/workspace/apps/api/src"),
    ).toBeUndefined();
  });
});
