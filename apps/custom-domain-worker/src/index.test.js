import { afterEach, describe, expect, test } from "bun:test";
import { proxyToCooeeOrigin, resolveOriginHost } from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("custom domain proxy Worker", () => {
  test.each([
    ["cooee.sh", "website.internal"],
    ["www.cooee.sh", "website.internal"],
    ["app.cooee.sh", "admin.internal"],
    ["api.cooee.sh", "api.internal"],
    ["cloud.cooee.sh", "api.internal"],
    ["changelog.partbot.io", "api.internal"],
  ])("routes %s to %s", (hostname, expectedOrigin) => {
    expect(
      resolveOriginHost(hostname, {
        COOEE_ADMIN_ORIGIN_HOST: "admin.internal",
        COOEE_ORIGIN_HOST: "api.internal",
        COOEE_WEBSITE_ORIGIN_HOST: "website.internal",
      }),
    ).toBe(expectedOrigin);
  });

  test("proxies the marketing site to its Railway origin", async () => {
    let proxiedRequest;
    globalThis.fetch = async (request) => {
      proxiedRequest = request;
      return new Response("ok");
    };

    await proxyToCooeeOrigin(new Request("https://cooee.sh/pricing"), {
      COOEE_WEBSITE_ORIGIN_HOST: "cooee.up.railway.app",
    });

    expect(proxiedRequest.url).toBe(
      "https://cooee.up.railway.app/pricing",
    );
    expect(proxiedRequest.headers.get("x-forwarded-host")).toBe("cooee.sh");
  });

  test("proxies the app to its Railway origin", async () => {
    let proxiedRequest;
    globalThis.fetch = async (request) => {
      proxiedRequest = request;
      return new Response("ok");
    };

    await proxyToCooeeOrigin(new Request("https://app.cooee.sh/login"), {
      COOEE_ADMIN_ORIGIN_HOST: "cooee-admin-production.up.railway.app",
    });

    expect(proxiedRequest.url).toBe(
      "https://cooee-admin-production.up.railway.app/login",
    );
    expect(proxiedRequest.headers.get("x-forwarded-host")).toBe(
      "app.cooee.sh",
    );
  });

  test("proxies custom hostname traffic to the Railway origin", async () => {
    let proxiedRequest;
    globalThis.fetch = async (request) => {
      proxiedRequest = request;
      return new Response("ok");
    };

    const response = await proxyToCooeeOrigin(
      new Request("https://changelog.partbot.io/api/public/changelog/feed.json"),
      {
        COOEE_ORIGIN_HOST: "cooee-api-production.up.railway.app",
      },
    );

    expect(await response.text()).toBe("ok");
    expect(proxiedRequest.url).toBe(
      "https://cooee-api-production.up.railway.app/api/public/changelog/feed.json",
    );
    expect(proxiedRequest.headers.get("x-forwarded-host")).toBe(
      "changelog.partbot.io",
    );
    expect(proxiedRequest.headers.get("x-cooee-custom-host")).toBe(
      "changelog.partbot.io",
    );
  });

  test("does not attach a request body to GET or HEAD requests", async () => {
    let proxiedRequest;
    globalThis.fetch = async (request) => {
      proxiedRequest = request;
      return new Response("ok");
    };

    await proxyToCooeeOrigin(
      new Request("https://changelog.partbot.io/", {
        method: "HEAD",
      }),
    );

    expect(proxiedRequest.body).toBeNull();
  });
});
