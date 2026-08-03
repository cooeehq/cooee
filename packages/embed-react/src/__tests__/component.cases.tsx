import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import domino from "@mixmark-io/domino";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { CooeeUpdatesLabels } from "../CooeeUpdates";

const testWindow = domino.createWindow(
  "<!doctype html><html><body></body></html>",
);
Object.defineProperties(testWindow, {
  KeyboardEvent: { configurable: true, value: testWindow.Event },
  MouseEvent: { configurable: true, value: testWindow.Event },
  PointerEvent: { configurable: true, value: testWindow.Event },
});
let focusedElement: Element | null = null;
let roots: Root[] = [];
let originalFetch = globalThis.fetch;

Object.defineProperties(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true, writable: true },
  Element: { configurable: true, value: testWindow.Element, writable: true },
  HTMLElement: {
    configurable: true,
    value: testWindow.HTMLElement,
    writable: true,
  },
  KeyboardEvent: {
    configurable: true,
    value: testWindow.KeyboardEvent,
    writable: true,
  },
  MouseEvent: {
    configurable: true,
    value: testWindow.MouseEvent,
    writable: true,
  },
  Node: { configurable: true, value: testWindow.Node, writable: true },
  PointerEvent: {
    configurable: true,
    value: testWindow.PointerEvent,
    writable: true,
  },
  document: { configurable: true, value: testWindow.document, writable: true },
  navigator: {
    configurable: true,
    value: testWindow.navigator,
    writable: true,
  },
  requestAnimationFrame: {
    configurable: true,
    value: (callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 0),
    writable: true,
  },
  cancelAnimationFrame: {
    configurable: true,
    value: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
    writable: true,
  },
  window: { configurable: true, value: testWindow, writable: true },
});
Object.defineProperty(testWindow.document, "activeElement", {
  configurable: true,
  get: () => focusedElement,
});
const testRect = {
  bottom: 44,
  height: 44,
  left: 0,
  right: 120,
  top: 0,
  width: 120,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};
Object.defineProperties(testWindow.Element.prototype, {
  getBoundingClientRect: { configurable: true, value: () => testRect },
  getClientRects: {
    configurable: true,
    value: () =>
      Object.assign([testRect], {
        item: (index: number) => (index === 0 ? testRect : null),
      }),
  },
  getRootNode: {
    configurable: true,
    value(this: Element) {
      return this.ownerDocument;
    },
  },
});

const { CooeeUpdates } = await import("../CooeeUpdates");

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

    expect(triggers[0]?.getAttribute("aria-controls")).toBeTruthy();
    expect(triggers[1]?.getAttribute("aria-controls")).toBeTruthy();
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
    const style = requiredElement<HTMLElement>(
      root,
      "style[data-cooee-styles]",
    );
    expect(root.hasAttribute("style")).toBe(false);
    expect(style.getAttribute("nonce")).toBe("nonce-123");
    expect(style.textContent).toContain("--cooee-accent: #155e75");
  });

  test("supports explicit light and dark themes through the theme prop", () => {
    const html = renderToStaticMarkup(
      <CooeeUpdates
        appearance={{ colorScheme: "light" }}
        feedUrl="https://cooee.test/feed.json"
        theme="dark"
      />,
    );
    const document = domino.createWindow(html).document;
    const root = requiredElement<HTMLElement>(document, ".cooee-updates");

    expect(root.getAttribute("data-color-scheme")).toBe("dark");
    expect(root.getAttribute("data-cooee-theme")).toBe("dark");
  });

  test("maps shadcn semantic tokens without requiring Tailwind compilation", () => {
    const html = renderToStaticMarkup(
      <CooeeUpdates feedUrl="https://cooee.test/feed.json" theme="shadcn" />,
    );
    const document = domino.createWindow(html).document;
    const root = requiredElement<HTMLElement>(document, ".cooee-updates");
    const style = requiredElement<HTMLElement>(
      root,
      "style[data-cooee-styles]",
    );

    expect(root.getAttribute("data-color-scheme")).toBe("inherit");
    expect(root.getAttribute("data-cooee-theme")).toBe("shadcn");
    expect(style.textContent).toContain(
      "--cooee-surface: var(--color-popover, hsl(var(--popover)))",
    );
    expect(style.textContent).toContain(
      "--cooee-accent: var(--color-primary, hsl(var(--primary)))",
    );
    expect(style.textContent).toContain(
      "--cooee-ring: var(--color-ring, hsl(var(--ring)))",
    );
  });

  test("uses a data attribute on any element as the accessible popup anchor", async () => {
    mockFetch(() => new Promise<Response>(() => undefined));
    const externalTrigger = testWindow.document.createElement("div");
    externalTrigger.setAttribute("data-cooee-updates-trigger", "");
    externalTrigger.textContent = "What’s new";
    testWindow.document.body.appendChild(externalTrigger);

    const { container } = await renderEmbed();

    expect(container.querySelector(".cooee-updates__trigger")).toBeFalsy();
    expect(externalTrigger.getAttribute("role")).toBe("button");
    expect(externalTrigger.getAttribute("tabindex")).toBe("0");
    expect(externalTrigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(externalTrigger.getAttribute("aria-expanded")).toBe("false");

    const space = new testWindow.Event("keydown", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(space, "key", { value: " " });
    await act(async () => externalTrigger.dispatchEvent(space));
    await flushAsyncWork();

    const panel = requiredElement<HTMLElement>(
      testWindow.document,
      ".cooee-updates__panel",
    );
    expect(panel.getAttribute("data-open")).not.toBeNull();
    expect(externalTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(space.defaultPrevented).toBe(true);
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

    const trigger = requiredElement<HTMLButtonElement>(
      container,
      ".cooee-updates__trigger",
    );
    trackFocus(trigger);
    await act(async () => trigger.click());
    await flushAsyncWork();

    const close = requiredElement<HTMLButtonElement>(
      testWindow.document,
      ".cooee-updates__close",
    );
    const panel = requiredElement<HTMLElement>(
      testWindow.document,
      ".cooee-updates__panel",
    );
    expect(panel.getAttribute("data-open")).not.toBeNull();
    expect(close.getAttribute("aria-label")).toBe("Close updates");

    const escape = new testWindow.Event("keydown", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(escape, "key", { value: "Escape" });
    await act(async () => close.dispatchEvent(escape));

    expect(panel.getAttribute("data-closed")).not.toBeNull();
    expect(focusedElement).toBe(trigger);
    expect(escape.defaultPrevented).toBe(true);
  });

  test("dismisses the panel from its close control", async () => {
    mockFetch(() => new Promise<Response>(() => undefined));
    const { container } = await renderEmbed();
    const trigger = requiredElement<HTMLButtonElement>(
      container,
      ".cooee-updates__trigger",
    );
    trackFocus(trigger);
    await act(async () => trigger.click());
    await flushAsyncWork();
    const panel = requiredElement<HTMLElement>(
      testWindow.document,
      ".cooee-updates__panel",
    );
    const close = requiredElement<HTMLButtonElement>(
      testWindow.document,
      ".cooee-updates__close",
    );

    await act(async () => close.click());
    expect(panel.getAttribute("data-closed")).not.toBeNull();
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
      requiredElement<HTMLElement>(container, ".cooee-updates__count")
        .textContent,
    ).toBe("10");
  });

  test("shows an accessible retry state for network and malformed-feed errors", async () => {
    let requests = 0;
    mockFetch(async () => {
      requests += 1;
      return new Response(
        JSON.stringify({ changelog: { name: "Cooee" }, entries: "invalid" }),
      );
    });
    const { container } = await renderEmbed();

    await flushAsyncWork();
    await openEmbed(container);
    const alert = requiredElement<HTMLElement>(
      testWindow.document,
      "[role='alert']",
    );
    expect(alert.textContent).toContain("We couldn’t load the latest updates.");

    const retry = requiredElement<HTMLButtonElement>(alert, "button");
    await act(async () => retry.click());
    await flushAsyncWork();
    expect(requests).toBe(2);
  });

  test("announces a valid empty feed without crashing", async () => {
    mockFetch(async () =>
      jsonResponse({
        changelog: { name: "Cooee" },
        entries: [],
      }),
    );
    const { container } = await renderEmbed();

    await flushAsyncWork();
    await openEmbed(container);
    const status = requiredElement<HTMLElement>(
      testWindow.document,
      "[role='status']",
    );
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
    await openEmbed(container);
    const image = requiredElement<HTMLImageElement>(
      testWindow.document,
      ".cooee-updates__entry-image",
    );
    const link = requiredElement<HTMLAnchorElement>(
      testWindow.document,
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
    await openEmbed(container);
    expect(
      testWindow.document.querySelector(".cooee-updates__entry-image"),
    ).toBeFalsy();
    expect(
      testWindow.document.querySelector(".cooee-updates__footer"),
    ).toBeFalsy();
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
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openEmbed(container: ParentNode) {
  const trigger = requiredElement<HTMLButtonElement>(
    container,
    ".cooee-updates__trigger",
  );
  await act(async () => trigger.click());
  await flushAsyncWork();
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function mockFetch(
  implementation: (
    ...args: Parameters<typeof fetch>
  ) => ReturnType<typeof fetch>,
) {
  globalThis.fetch = implementation as typeof fetch;
}

function requiredElement<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
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
