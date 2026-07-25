import { afterEach, describe, expect, test } from "bun:test";
import { proxyToCooeeOrigin } from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("custom domain proxy Worker", () => {
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
