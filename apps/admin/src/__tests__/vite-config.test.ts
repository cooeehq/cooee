import { describe, expect, test } from "bun:test";
import config from "../../vite.config";

describe("admin dev server config", () => {
  test("builds the admin app and proxies API requests in development", () => {
    if (typeof config === "function") {
      throw new Error("Expected a static Vite config");
    }

    const apiProxy = config.server?.proxy?.["/api"];
    expect(config.build?.outDir).toBe("dist");
    expect(config.define?.["import.meta.env.VITE_COOEE_APP_MODE"]).toBe(
      '"admin"',
    );
    expect(config.server?.port).toBe(5173);
    expect(apiProxy).toEqual({ target: "http://localhost:3000" });
  });

  test("uses neutral admin metadata before the client determines the route", () => {
    if (typeof config === "function") {
      throw new Error("Expected a static Vite config");
    }

    const plugin = config.plugins?.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        "name" in candidate &&
        candidate.name === "cooee-admin-metadata",
    );
    const metadataPlugin = plugin as
      | { transformIndexHtml?: (html: string) => string }
      | undefined;
    const transformIndexHtml = metadataPlugin?.transformIndexHtml as
      | ((html: string) => string)
      | undefined;

    if (!transformIndexHtml) {
      throw new Error("Expected the admin metadata plugin");
    }

    const html = transformIndexHtml(
      '<title>__COOEE_TITLE__</title><link rel="canonical" href="https://cooee.invalid/__COOEE_CANONICAL_URL__" />',
    );
    expect(html).toContain("<title>Cooee</title>");
    expect(html).toContain('href="https://app.cooee.sh/changelog"');
  });
});
