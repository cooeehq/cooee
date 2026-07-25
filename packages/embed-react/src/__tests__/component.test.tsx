import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import domino from "@mixmark-io/domino";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { CooeeUpdates, type CooeeUpdatesLabels } from "../CooeeUpdates";

const testWindow = domino.createWindow("<!doctype html><html><body></body></html>");
let focusedElement: Element | null = null;
let roots: Root[] = [];
let originalFetch = globalThis.fetch;

Object.defineProperties(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true, writable: true },
  Node: { configurable: true, value: testWindow.Node, writable: true },
  document: { configurable: true, value: testWindow.document, writable: true },
  navigator: { configurable: true, value: testWindow.navigator, writable: true },
  window: { configurable: true, value: testWindow, writable: true },
});
Object.defineProperty(testWindow.document, "activeElement", {
  configurable: true,
  get: () => focusedElement,
});

beforeEach(() => {
  focusedElement = null;
  roots = [];
  originalFetch = globalThis.fetch;
  testWindow.document.body.innerHTML = "";
});

afterEach(async () => {
  await act(async () => {
    roots.forEach((root) => root.unmount());
  });
  globalThis.fetch = originalFetch;
});

describe("CooeeUpdates embed", () => {
  test("gives multiple instances unique disclosure IDs", () => {
    const html = renderToStaticMarkup(
      <>
        <CooeeUpdates feedUrl="https://cooee.test/one.json" />
        <CooeeUpdates feedUrl="https://cooee.test/two.json" />
      </>,
    );
    const document = domino.createWindow(html).document;
    const triggers = [...document.querySelectorAll("button[aria-controls]")];

    expect(triggers).toHaveLength(2);
    expect(triggers[0]?.getAttribute("aria-controls")).not.toBe(
      triggers[1]?.getAttribute("aria-controls"),
    );

    for (const trigger of triggers) {
      const panelId = trigger.getAttribute("aria-controls");
      const panel = panelId ? document.getElementById(panelId) : null;

      expect(panel).not.toBeNull();
      expect(panel?.getAttribute("role")).toBe("region");
      expect(document.getElementById(panel?.getAttribute("aria-labelledby") ?? "")).not.toBeNull();
    }
  });

  test("applies a CSP nonce without inline style attributes", () => {
    const html = renderToStaticMarkup(
      <CooeeUpdates
        appearance={{ accentColor: "#155e75", cornerRadius: 12 }}
        feedUrl="https://cooee.test/feed.json"
        styleNonce="nonce-123"
      />,
    );
    const document = domino.createWindow(html).document;
    const root = requiredElement<HTMLElement>(document, ".cooee-updates");
    const style = requiredElement<HTMLElement>(root, "style[data-cooee-styles]");
    expect(root.hasAttribute("style")).toBe(false);
    expect(style.getAttribute("nonce")).toBe("nonce-123");
    expect(style.textContent).toContain("--cooee-accent: #155e75");
  });

  test("opens from the keyboard-friendly trigger, focuses close, and restores focus on Escape", async () => {
    mockFetch(() => new Promise<Response>(() => undefined));
    const container = testWindow.document.createElement("div");
    testWindow.document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(<CooeeUpdates feedUrl="https://cooee.test/feed.json" />);
    });

    const trigger = requiredElement<HTMLButtonElement>(container, ".cooee-updates__trigger");
    const close = requiredElement<HTMLButtonElement>(container, ".cooee-updates__close");
    trackFocus(trigger);
    trackFocus(close);
    await act(async () => trigger.click());

    const panel = requiredElement<HTMLElement>(container, ".cooee-updates__panel");
    expect(panel.hidden).toBe(false);
    expect(focusedElement).toBe(close);

    const escape = new testWindow.Event("keydown", { bubbles: true, cancelable: true });
    Object.defineProperty(escape, "key", { value: "Escape" });
    await act(async () => close.dispatchEvent(escape));

    expect(panel.hidden).toBe(true);
    expect(focusedElement).toBe(trigger);
    expect(escape.defaultPrevented).toBe(true);
  });

  test("restores focus when an outside non-focusable target dismisses the panel", async () => {
    mockFetch(() => new Promise<Response>(() => undefined));
    const { container } = await renderEmbed();
    const outside = testWindow.document.createElement("div");
    testWindow.document.body.appendChild(outside);
    const trigger = requiredElement<HTMLButtonElement>(container, ".cooee-updates__trigger");
    const close = requiredElement<HTMLButtonElement>(container, ".cooee-updates__close");
    trackFocus(trigger);
    trackFocus(close);
    await act(async () => trigger.click());

    const pointerDown = new testWindow.Event("pointerdown", { bubbles: true });
    await act(async () => {
      outside.dispatchEvent(pointerDown);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(focusedElement).toBe(trigger);
  });

  test("counts unread entries before applying the render limit", async () => {
    Object.defineProperty(testWindow, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => undefined,
      },
    });
    mockFetch(async () =>
      jsonResponse({
        changelog: { name: "Cooee" },
        entries: Array.from({ length: 10 }, (_, index) => ({
          id: `entry-${index}`,
          title: `Update ${index}`,
          summary: "Summary",
          category: "improvement",
          publishedAt: `2026-07-${String(14 - index).padStart(2, "0")}T00:00:00.000Z`,
        })),
      }),
    );
    const { container } = await renderEmbed({ maxItems: 5 });
    await flushAsyncWork();
    expect(
      requiredElement<HTMLElement>(container, ".cooee-updates__count").textContent,
    ).toBe("10");
  });

  test("shows an accessible retry state for network and malformed-feed errors", async () => {
    let requests = 0;
    mockFetch(async () => {
      requests += 1;
      return new Response(JSON.stringify({ changelog: { name: "Cooee" }, entries: "invalid" }));
    });
    const { container } = await renderEmbed();

    await flushAsyncWork();
    const alert = requiredElement<HTMLElement>(container, "[role='alert']");
    expect(alert.textContent).toContain("We couldn’t load the latest updates.");

    const retry = requiredElement<HTMLButtonElement>(alert, "button");
    await act(async () => retry.click());
    await flushAsyncWork();
    expect(requests).toBe(2);
  });

  test("announces a valid empty feed without crashing", async () => {
    mockFetch(async () => jsonResponse({
      changelog: { name: "Cooee" },
      entries: [],
    }));
    const { container } = await renderEmbed();

    await flushAsyncWork();
    const status = requiredElement<HTMLElement>(container, "[role='status']");
    expect(status.textContent).toBe("No updates yet.");
  });

  test("renders feed images and a localized full changelog link", async () => {
    mockFetch(async () =>
      jsonResponse({
        changelog: {
          name: "Cooee",
          publicUrl: "/changelog/cooee",
        },
        entries: [
          {
            id: "entry-image",
            title: "A visual update",
            summary: "Now with a preview.",
            category: "feature",
            publishedAt: "2026-07-21T00:00:00.000Z",
            imageUrl: "api/public/updates/entry-image/image",
          },
        ],
      }),
    );
    const { container } = await renderEmbed({
      labels: { viewAll: "See every update" },
    });

    await flushAsyncWork();
    const image = requiredElement<HTMLImageElement>(
      container,
      ".cooee-updates__entry-image",
    );
    const link = requiredElement<HTMLAnchorElement>(
      container,
      ".cooee-updates__footer a",
    );
    expect(image.src).toBe(
      "https://cooee.test/api/public/updates/entry-image/image",
    );
    expect(image.alt).toBe("");
    expect(link.href).toBe("https://cooee.test/changelog/cooee");
    expect(link.textContent).toContain("See every update");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });

  test("drops unsafe public links and images", async () => {
    mockFetch(async () =>
      jsonResponse({
        changelog: { name: "Cooee", publicUrl: "javascript:alert(1)" },
        entries: [
          {
            id: "entry-unsafe",
            title: "Unsafe asset",
            summary: "No unsafe URLs should render.",
            category: "fix",
            publishedAt: "2026-07-21T00:00:00.000Z",
            imageUrl: "data:text/html,unsafe",
          },
        ],
      }),
    );
    const { container } = await renderEmbed();

    await flushAsyncWork();
    expect(container.querySelector(".cooee-updates__entry-image")).toBeFalsy();
    expect(container.querySelector(".cooee-updates__footer")).toBeFalsy();
  });

  test("aborts the stale request when the feed URL changes", async () => {
    const signals: AbortSignal[] = [];
    mockFetch((_input, init) => {
      if (init?.signal) {
        signals.push(init.signal);
      }
      return new Promise<Response>(() => undefined);
    });
    const container = testWindow.document.createElement("div");
    testWindow.document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(<CooeeUpdates feedUrl="https://cooee.test/old.json" />);
    });
    await act(async () => {
      root.render(<CooeeUpdates feedUrl="https://cooee.test/new.json" />);
    });

    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });
});

async function renderEmbed(
  props: {
    labels?: Partial<CooeeUpdatesLabels>;
    maxItems?: number;
  } = {},
) {
  const container = testWindow.document.createElement("div");
  testWindow.document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(
      <CooeeUpdates
        feedUrl="https://cooee.test/feed.json"
        labels={props.labels}
        maxItems={props.maxItems}
      />,
    );
  });

  return { container, root };
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function mockFetch(
  implementation: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
) {
  globalThis.fetch = implementation as typeof fetch;
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector(selector);
  if (!element) {
    throw new Error(`Expected element matching ${selector}`);
  }

  return element as T;
}

function trackFocus(element: HTMLElement) {
  Object.defineProperty(element, "focus", {
    configurable: true,
    value() {
      focusedElement = element;
    },
  });
}
