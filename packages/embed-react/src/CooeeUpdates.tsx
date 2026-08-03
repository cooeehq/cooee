import * as React from "react";
import { Popover } from "@base-ui/react/popover";
import type { PublicFeedEntry } from "./feed-types.js";
import { renderMarkdown } from "./markdown.js";

const defaultTriggerSelector = "[data-cooee-updates-trigger]";
const useIsomorphicLayoutEffect =
  typeof document === "undefined" ? React.useEffect : React.useLayoutEffect;

export type CooeeUpdatesTheme = "light" | "dark" | "system" | "shadcn";

export type CooeeUpdatesAppearance = {
  /** @deprecated Use the top-level `theme` prop. */
  colorScheme?: Exclude<CooeeUpdatesTheme, "shadcn">;
  /** Background for the trigger. Choose a colour with enough contrast against accentTextColor. */
  accentColor?: string;
  /** Text colour for the trigger. */
  accentTextColor?: string;
  /** Corner radius in CSS pixels, clamped between 0 and 24. */
  cornerRadius?: number;
};

export type CooeeUpdatesLabels = {
  close: string;
  empty: string;
  loadError: string;
  loading: string;
  retry: string;
  viewAll: string;
  loaded: (count: number) => string;
  unread: (count: number) => string;
};

export type CooeeUpdatesProps = {
  feedUrl: string;
  /** Visual theme. `shadcn` consumes the host project's semantic CSS variables. */
  theme?: CooeeUpdatesTheme;
  maxItems?: number;
  buttonLabel?: string;
  className?: string;
  /**
   * CSS selector for an existing element that should open the popup. Defaults
   * to `[data-cooee-updates-trigger]`. Pass `null` to always render Cooee's
   * built-in button.
   */
  triggerSelector?: string | null;
  appearance?: CooeeUpdatesAppearance;
  labels?: Partial<CooeeUpdatesLabels>;
  /** CSP nonce applied to the component's style block. */
  styleNonce?: string;
};

type LoadState =
  | { status: "loading"; entries: PublicFeedEntry[] }
  | {
      status: "success";
      entries: PublicFeedEntry[];
      changelogName: string;
      publicUrl: string | null;
      latestPublishedAt?: string;
    }
  | { status: "error"; entries: PublicFeedEntry[] };

type UpdatesPanelProps = {
  labels: CooeeUpdatesLabels;
  onRetry: () => void;
  state: LoadState;
};

const defaultLabels: CooeeUpdatesLabels = {
  close: "Close updates",
  empty: "No updates yet.",
  loadError: "We couldn’t load the latest updates.",
  loading: "Loading updates…",
  retry: "Try again",
  viewAll: "View all updates",
  loaded: (count) => `${count} ${count === 1 ? "update" : "updates"} loaded.`,
  unread: (count) => `${count} unread ${count === 1 ? "update" : "updates"}`,
};

export function CooeeUpdates({
  feedUrl,
  theme: themeProp,
  maxItems = 5,
  buttonLabel = "Latest updates",
  className,
  triggerSelector = defaultTriggerSelector,
  appearance,
  labels: labelOverrides,
  styleNonce,
}: CooeeUpdatesProps) {
  const [open, setOpen] = React.useState(false);
  const [retryCount, setRetryCount] = React.useState(0);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [state, setState] = React.useState<LoadState>({
    status: "loading",
    entries: [],
  });
  const [externalTrigger, setExternalTrigger] =
    React.useState<HTMLElement | null>(null);
  const triggerRef = React.useRef<HTMLElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const reactId = React.useId();
  const instanceId = `cooee-${reactId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const panelId = `${instanceId}-panel`;
  const positionerId = `${instanceId}-positioner`;
  const headingId = `${instanceId}-heading`;
  const labels = React.useMemo(
    () => ({ ...defaultLabels, ...labelOverrides }),
    [labelOverrides],
  );
  const itemLimit = normalizeMaxItems(maxItems);

  useIsomorphicLayoutEffect(() => {
    if (typeof document === "undefined" || triggerSelector === null) {
      setExternalTrigger(null);
      return;
    }

    const resolvedTriggerSelector = triggerSelector;
    let observer: MutationObserver | undefined;

    function findTrigger() {
      try {
        const nextTrigger = document.querySelector<HTMLElement>(
          resolvedTriggerSelector,
        );
        setExternalTrigger((current) =>
          current === nextTrigger ? current : nextTrigger,
        );
      } catch {
        setExternalTrigger(null);
      }
    }

    findTrigger();

    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(findTrigger);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    return () => observer?.disconnect();
  }, [triggerSelector]);

  React.useEffect(() => {
    if (!externalTrigger) {
      return;
    }

    const trigger = externalTrigger;
    triggerRef.current = trigger;
    const originalAttributes = captureTriggerAttributes(trigger);
    const needsButtonSemantics = !isInteractiveElement(trigger);

    if (needsButtonSemantics) {
      trigger.setAttribute("role", "button");
      trigger.tabIndex = 0;
    }

    function toggle(event: Event) {
      if (trigger.matches("a[href]")) {
        event.preventDefault();
      }
      setOpen((current) => !current);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (
        !needsButtonSemantics ||
        (event.key !== "Enter" && event.key !== " ")
      ) {
        return;
      }

      event.preventDefault();
      setOpen((current) => !current);
    }

    trigger.addEventListener("click", toggle);
    trigger.addEventListener("keydown", handleKeyDown);

    return () => {
      trigger.removeEventListener("click", toggle);
      trigger.removeEventListener("keydown", handleKeyDown);
      restoreTriggerAttributes(trigger, originalAttributes);
      if (triggerRef.current === trigger) {
        triggerRef.current = null;
      }
    };
  }, [externalTrigger]);

  React.useEffect(() => {
    if (!externalTrigger) {
      return;
    }

    externalTrigger.setAttribute("aria-controls", panelId);
    externalTrigger.setAttribute("aria-expanded", String(open));
    externalTrigger.setAttribute("aria-haspopup", "dialog");
    externalTrigger.setAttribute(
      "data-cooee-unread-count",
      String(unreadCount),
    );
    externalTrigger.toggleAttribute("data-cooee-has-unread", unreadCount > 0);
  }, [externalTrigger, open, panelId, unreadCount]);

  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setState({ status: "loading", entries: [] });
    setUnreadCount(0);

    async function load() {
      try {
        const response = await fetch(feedUrl, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("The updates feed request failed");
        }

        const feed = parsePublicFeed(
          await response.json(),
          response.url || feedUrl,
        );
        const entries = feed.entries.slice(0, itemLimit);

        if (!active) {
          return;
        }

        setState({
          status: "success",
          entries,
          changelogName: feed.changelogName,
          publicUrl: feed.publicUrl,
          latestPublishedAt: feed.entries[0]?.publishedAt,
        });
        setUnreadCount(countUnread(feedUrl, feed.entries));
      } catch (error) {
        if (active && !isAbortError(error)) {
          setState({ status: "error", entries: [] });
        }
      }
    }

    void load();

    return () => {
      active = false;
      controller.abort();
    };
  }, [feedUrl, itemLimit, retryCount]);

  React.useEffect(() => {
    if (open && state.status === "success") {
      markSeen(feedUrl, state.latestPublishedAt);
      setUnreadCount(0);
    }
  }, [feedUrl, open, state]);

  const theme = themeProp ?? appearance?.colorScheme ?? "system";
  const scheme = theme === "shadcn" ? "inherit" : theme;
  const instanceStyles = buildInstanceStyles(
    instanceId,
    positionerId,
    appearance,
  );

  return (
    <Popover.Root onOpenChange={setOpen} open={open}>
      <div
        className={["cooee-updates", className].filter(Boolean).join(" ")}
        data-color-scheme={scheme}
        data-cooee-theme={theme}
        data-external-trigger={externalTrigger ? "" : undefined}
        id={instanceId}
      >
        <style
          data-cooee-styles
          nonce={styleNonce}
        >{`${embedStyles}\n${instanceStyles}`}</style>
        {!externalTrigger ? (
          <button
            aria-controls={panelId}
            aria-expanded={open}
            aria-haspopup="dialog"
            className="cooee-updates__trigger"
            onClick={() => setOpen((current) => !current)}
            ref={(element: HTMLButtonElement | null) => {
              triggerRef.current = element;
            }}
            type="button"
          >
            <span>{buttonLabel}</span>
            {unreadCount > 0 ? (
              <>
                <span aria-hidden="true" className="cooee-updates__count">
                  {unreadCount}
                </span>
                <span className="cooee-updates__sr-only">
                  {labels.unread(unreadCount)}
                </span>
              </>
            ) : null}
          </button>
        ) : null}
      </div>

      <Popover.Portal keepMounted>
        <Popover.Positioner
          align="end"
          anchor={externalTrigger ?? triggerRef}
          className="cooee-updates cooee-updates__positioner"
          collisionAvoidance={{
            side: "flip",
            align: "shift",
            fallbackAxisSide: "start",
          }}
          collisionPadding={12}
          data-color-scheme={scheme}
          data-cooee-theme={theme}
          id={positionerId}
          positionMethod="fixed"
          side="bottom"
          sideOffset={8}
        >
          <Popover.Popup
            aria-labelledby={headingId}
            className="cooee-updates__panel"
            finalFocus={() => triggerRef.current}
            id={panelId}
            initialFocus={closeRef}
          >
            <header className="cooee-updates__header">
              <Popover.Title dir="auto" id={headingId}>
                {state.status === "success" ? state.changelogName : buttonLabel}
              </Popover.Title>
              <Popover.Close
                aria-label={labels.close}
                className="cooee-updates__close"
                ref={closeRef}
              >
                <span aria-hidden="true">×</span>
              </Popover.Close>
            </header>

            <UpdatesPanel
              labels={labels}
              onRetry={() => {
                closeRef.current?.focus();
                setRetryCount((count) => count + 1);
              }}
              state={state}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function UpdatesPanel({ labels, onRetry, state }: UpdatesPanelProps) {
  if (state.status === "loading") {
    return (
      <p aria-live="polite" className="cooee-updates__status" role="status">
        {labels.loading}
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <div aria-live="assertive" className="cooee-updates__status" role="alert">
        <p>{labels.loadError}</p>
        <button
          className="cooee-updates__retry"
          onClick={onRetry}
          type="button"
        >
          {labels.retry}
        </button>
      </div>
    );
  }

  if (state.entries.length === 0) {
    return (
      <p aria-live="polite" className="cooee-updates__status" role="status">
        {labels.empty}
      </p>
    );
  }

  return (
    <>
      <p aria-live="polite" className="cooee-updates__sr-only" role="status">
        {labels.loaded(state.entries.length)}
      </p>
      <div className="cooee-updates__entries">
        {state.entries.map((entry) => (
          <article className="cooee-updates__entry" key={entry.id}>
            <div className="cooee-updates__entry-meta" dir="auto">
              {formatCategory(entry.category)}
            </div>
            {entry.imageUrl ? (
              <img
                alt=""
                className="cooee-updates__entry-image"
                loading="lazy"
                src={entry.imageUrl}
              />
            ) : null}
            <h3 className="cooee-updates__entry-title" dir="auto">
              {entry.title}
            </h3>
            <div
              className="cooee-updates__entry-summary"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(entry.summary),
              }}
              dir="auto"
            />
            {entry.items && entry.items.length > 0 ? (
              <div className="cooee-updates__item-list">
                {entry.items.map((item, index) => (
                  <section
                    className="cooee-updates__item"
                    key={`${entry.id}:${item.category}:${item.title}:${index}`}
                  >
                    <div className="cooee-updates__item-header">
                      <h4 className="cooee-updates__item-title" dir="auto">
                        {item.title}
                      </h4>
                      <span className="cooee-updates__item-badge" dir="auto">
                        {formatCategory(item.category)}
                      </span>
                    </div>
                    <div
                      className="cooee-updates__item-summary"
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(item.summary),
                      }}
                      dir="auto"
                    />
                  </section>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {state.publicUrl ? (
        <footer className="cooee-updates__footer">
          <a href={state.publicUrl} rel="noreferrer" target="_blank">
            {labels.viewAll}
            <span aria-hidden="true"> ↗</span>
          </a>
        </footer>
      ) : null}
    </>
  );
}

function parsePublicFeed(
  value: unknown,
  feedUrl: string,
): {
  changelogName: string;
  publicUrl: string | null;
  entries: PublicFeedEntry[];
} {
  if (
    !isRecord(value) ||
    !isRecord(value.changelog) ||
    typeof value.changelog.name !== "string"
  ) {
    throw new Error("Invalid updates feed");
  }

  if (
    !Array.isArray(value.entries) ||
    !value.entries.every(isPublicFeedEntry)
  ) {
    throw new Error("Invalid updates feed");
  }

  return {
    changelogName: value.changelog.name,
    publicUrl:
      typeof value.changelog.publicUrl === "string"
        ? resolveSafeHttpUrl(value.changelog.publicUrl, feedUrl)
        : null,
    entries: value.entries.map((entry) => ({
      ...entry,
      imageUrl:
        typeof entry.imageUrl === "string"
          ? resolveSafeHttpUrl(entry.imageUrl, feedUrl)
          : entry.imageUrl,
    })),
  };
}

function resolveSafeHttpUrl(value: string, baseUrl: string): string | null {
  try {
    const feedOrigin = new URL(baseUrl).origin;
    const url = new URL(value, `${feedOrigin}/`);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function isPublicFeedEntry(value: unknown): value is PublicFeedEntry {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.category !== "string" ||
    typeof value.publishedAt !== "string"
  ) {
    return false;
  }

  return (
    value.items === undefined ||
    (Array.isArray(value.items) && value.items.every(isChangeItem))
  );
}

function isChangeItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    typeof value.category === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return typeof DOMException !== "undefined" && error instanceof DOMException
    ? error.name === "AbortError"
    : isRecord(error) && error.name === "AbortError";
}

function normalizeMaxItems(value: number): number {
  if (!Number.isFinite(value)) {
    return 5;
  }

  return Math.min(100, Math.max(0, Math.floor(value)));
}

function buildInstanceStyles(
  instanceId: string,
  positionerId: string,
  appearance: CooeeUpdatesAppearance | undefined,
): string {
  const declarations: string[] = [];
  const accentColor = normalizeCssColor(appearance?.accentColor);
  const accentTextColor = normalizeCssColor(appearance?.accentTextColor);
  const cornerRadius = normalizeCornerRadius(appearance?.cornerRadius);

  if (accentColor) {
    declarations.push(`--cooee-accent: ${accentColor};`);
  }
  if (accentTextColor) {
    declarations.push(`--cooee-accent-text: ${accentTextColor};`);
  }
  if (cornerRadius !== null) {
    declarations.push(`--cooee-radius: ${cornerRadius}px;`);
  }

  return declarations.length > 0
    ? `#${instanceId}, #${positionerId} {\n    ${declarations.join("\n    ")}\n  }`
    : "";
}

function normalizeCornerRadius(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return Math.min(24, Math.max(0, value));
}

function normalizeCssColor(value: string | undefined): string | null {
  if (!value) return null;
  if (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("color", value)
  ) {
    return value;
  }
  return /^#[0-9a-f]{3,8}$/i.test(value.trim()) ? value.trim() : null;
}

function countUnread(feedUrl: string, entries: PublicFeedEntry[]): number {
  if (typeof window === "undefined") {
    return 0;
  }

  try {
    const lastSeen = window.localStorage.getItem(storageKey(feedUrl));
    if (!lastSeen) {
      return entries.length;
    }

    return entries.filter((entry) => entry.publishedAt > lastSeen).length;
  } catch {
    return 0;
  }
}

function markSeen(feedUrl: string, latestPublishedAt: string | undefined) {
  if (typeof window === "undefined" || !latestPublishedAt) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey(feedUrl), latestPublishedAt);
  } catch {
    // Storage can be unavailable in private modes and embedded third-party contexts.
  }
}

function storageKey(feedUrl: string): string {
  return `cooee:last-seen:${feedUrl}`;
}

function formatCategory(category: string): string {
  return category.length > 0
    ? category.slice(0, 1).toLocaleUpperCase() + category.slice(1)
    : "Update";
}

type TriggerAttributeSnapshot = Record<
  | "aria-controls"
  | "aria-expanded"
  | "aria-haspopup"
  | "data-cooee-has-unread"
  | "data-cooee-unread-count"
  | "role"
  | "tabindex",
  string | null
>;

function captureTriggerAttributes(
  element: HTMLElement,
): TriggerAttributeSnapshot {
  return {
    "aria-controls": element.getAttribute("aria-controls"),
    "aria-expanded": element.getAttribute("aria-expanded"),
    "aria-haspopup": element.getAttribute("aria-haspopup"),
    "data-cooee-has-unread": element.getAttribute("data-cooee-has-unread"),
    "data-cooee-unread-count": element.getAttribute("data-cooee-unread-count"),
    role: element.getAttribute("role"),
    tabindex: element.getAttribute("tabindex"),
  };
}

function restoreTriggerAttributes(
  element: HTMLElement,
  attributes: TriggerAttributeSnapshot,
) {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null) {
      element.removeAttribute(name);
    } else {
      element.setAttribute(name, value);
    }
  }
}

function isInteractiveElement(element: HTMLElement): boolean {
  return element.matches(
    "button, input, select, textarea, summary, a[href], [contenteditable]:not([contenteditable='false']), [role='button']",
  );
}

const embedStyles = `
.cooee-updates {
  --cooee-accent: #292524;
  --cooee-accent-text: #fafaf9;
  --cooee-radius: 10px;
  --cooee-surface: #fafaf9;
  --cooee-surface-subtle: #f5f5f4;
  --cooee-text: #1c1917;
  --cooee-muted: #57534e;
  --cooee-border: #d6d3d1;
  --cooee-border-subtle: #e7e5e4;
  --cooee-ring: #2563eb;
  --cooee-shadow: rgba(28, 25, 23, 0.16);
  color-scheme: light;
  display: inline-block;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  max-inline-size: 100%;
  position: relative;
}
.cooee-updates[data-cooee-theme="shadcn"] {
  --cooee-accent: var(--color-primary, hsl(var(--primary)));
  --cooee-accent-text: var(--color-primary-foreground, hsl(var(--primary-foreground)));
  --cooee-radius: var(--radius-lg, var(--radius, 10px));
  --cooee-surface: var(--color-popover, hsl(var(--popover)));
  --cooee-surface-subtle: var(--color-muted, hsl(var(--muted)));
  --cooee-text: var(--color-popover-foreground, hsl(var(--popover-foreground)));
  --cooee-muted: var(--color-muted-foreground, hsl(var(--muted-foreground)));
  --cooee-border: var(--color-border, hsl(var(--border)));
  --cooee-border-subtle: color-mix(in oklab, var(--cooee-border) 70%, transparent);
  --cooee-ring: var(--color-ring, hsl(var(--ring)));
  --cooee-shadow: color-mix(in oklab, var(--cooee-text) 16%, transparent);
  color-scheme: inherit;
  font-family: var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
}
.cooee-updates[data-color-scheme="dark"] {
  --cooee-surface: #1c1917;
  --cooee-surface-subtle: #292524;
  --cooee-text: #fafaf9;
  --cooee-muted: #d6d3d1;
  --cooee-border: #57534e;
  --cooee-border-subtle: #44403c;
  --cooee-shadow: rgba(0, 0, 0, 0.42);
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  .cooee-updates[data-color-scheme="system"] {
    --cooee-surface: #1c1917;
    --cooee-surface-subtle: #292524;
    --cooee-text: #fafaf9;
    --cooee-muted: #d6d3d1;
    --cooee-border: #57534e;
    --cooee-border-subtle: #44403c;
    --cooee-shadow: rgba(0, 0, 0, 0.42);
    color-scheme: dark;
  }
}
.cooee-updates__trigger,
.cooee-updates__close,
.cooee-updates__retry {
  font: inherit;
}
.cooee-updates__trigger {
  align-items: center;
  background: var(--cooee-accent);
  border: 0;
  border-radius: var(--cooee-radius);
  color: var(--cooee-accent-text);
  cursor: pointer;
  display: inline-flex;
  font-size: 13px;
  font-weight: 650;
  gap: 8px;
  justify-content: center;
  min-block-size: 44px;
  padding: 0 14px;
}
.cooee-updates__trigger:focus-visible,
.cooee-updates__close:focus-visible,
.cooee-updates__retry:focus-visible,
.cooee-updates a:focus-visible {
  outline: 3px solid var(--cooee-ring);
  outline-offset: 2px;
}
.cooee-updates__count {
  align-items: center;
  background: var(--cooee-border);
  border-radius: 999px;
  color: var(--cooee-text);
  display: inline-flex;
  font-size: 11px;
  min-block-size: 22px;
  justify-content: center;
  min-inline-size: 22px;
  padding: 0 6px;
}
.cooee-updates__panel {
  background: var(--cooee-surface);
  border: 1px solid var(--cooee-border);
  border-radius: var(--cooee-radius);
  box-shadow: 0 18px 48px var(--cooee-shadow);
  color: var(--cooee-text);
  inline-size: 360px;
  max-block-size: min(70dvh, 640px, var(--available-height));
  max-inline-size: min(360px, var(--available-width));
  overflow: auto;
  overscroll-behavior: contain;
  padding: 14px;
  text-align: start;
}
.cooee-updates__positioner {
  inline-size: auto;
  max-inline-size: calc(100vw - 24px);
  z-index: 2147483000;
}
.cooee-updates__header {
  align-items: center;
  border-block-end: 1px solid var(--cooee-border-subtle);
  display: flex;
  gap: 10px;
  justify-content: space-between;
  margin-block-end: 10px;
  padding-block-end: 10px;
}
.cooee-updates__header h2 {
  font-size: 15px;
  line-height: 1.35;
  margin: 0;
  overflow-wrap: anywhere;
}
.cooee-updates__close {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 8px;
  color: var(--cooee-muted);
  cursor: pointer;
  display: inline-flex;
  flex: none;
  font-size: 24px;
  inline-size: 44px;
  justify-content: center;
  line-height: 1;
  min-block-size: 44px;
}
.cooee-updates__close:hover { background: var(--cooee-surface-subtle); }
.cooee-updates__status {
  color: var(--cooee-muted);
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
}
.cooee-updates__status p { margin: 0 0 10px; }
.cooee-updates__retry {
  background: var(--cooee-accent);
  border: 0;
  border-radius: 8px;
  color: var(--cooee-accent-text);
  cursor: pointer;
  font-size: 13px;
  font-weight: 650;
  min-block-size: 44px;
  padding: 0 14px;
}
.cooee-updates__entries { min-inline-size: 0; }
.cooee-updates__entry {
  border-block-end: 1px solid var(--cooee-border-subtle);
  min-inline-size: 0;
  padding: 10px 0;
}
.cooee-updates__entry:last-child { border-block-end: 0; }
.cooee-updates__entry-meta {
  color: var(--cooee-muted);
  font-size: 11px;
  font-weight: 650;
  overflow-wrap: anywhere;
  text-transform: uppercase;
}
.cooee-updates__entry-title {
  font-size: 14px;
  line-height: 1.4;
  margin: 4px 0;
  overflow-wrap: anywhere;
}
.cooee-updates__entry-image {
  aspect-ratio: 16 / 9;
  border: 1px solid var(--cooee-border-subtle);
  border-radius: var(--cooee-radius);
  display: block;
  inline-size: 100%;
  margin-block: 8px;
  object-fit: cover;
}
.cooee-updates__entry-summary,
.cooee-updates__item-summary {
  color: var(--cooee-muted);
  font-size: 13px;
  line-height: 1.5;
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
.cooee-updates__entry-summary > :first-child,
.cooee-updates__item-summary > :first-child { margin-block-start: 0; }
.cooee-updates__entry-summary > :last-child,
.cooee-updates__item-summary > :last-child { margin-block-end: 0; }
.cooee-updates__item-list {
  display: grid;
  gap: 8px;
  margin-block-start: 10px;
}
.cooee-updates__item {
  border: 1px solid var(--cooee-border-subtle);
  border-radius: var(--cooee-radius);
  min-inline-size: 0;
  padding: 10px;
}
.cooee-updates__item-header {
  align-items: flex-start;
  display: flex;
  gap: 8px;
  justify-content: space-between;
  min-inline-size: 0;
}
.cooee-updates__item-title {
  font-size: 13px;
  line-height: 1.4;
  margin: 0;
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
.cooee-updates__item-badge {
  border: 1px solid var(--cooee-border);
  border-radius: 999px;
  color: var(--cooee-muted);
  flex: none;
  font-size: 10px;
  font-weight: 650;
  max-inline-size: 45%;
  overflow-wrap: anywhere;
  padding: 2px 6px;
  text-transform: uppercase;
}
.cooee-updates__item-summary {
  font-size: 12px;
  margin-block-start: 6px;
}
.cooee-updates__sr-only {
  block-size: 1px;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  inline-size: 1px;
  margin: -1px;
  overflow: hidden;
  padding: 0;
  position: absolute;
  white-space: nowrap;
}
.cooee-updates__footer {
  border-block-start: 1px solid var(--cooee-border-subtle);
  margin-block-start: 10px;
  padding-block-start: 10px;
}
.cooee-updates__footer a {
  color: var(--cooee-text);
  display: inline-flex;
  font-size: 13px;
  font-weight: 650;
  min-block-size: 44px;
  align-items: center;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.cooee-updates [data-code="inline"] {
  background: var(--cooee-surface-subtle);
  border: 1px solid var(--cooee-border-subtle);
  border-radius: 6px;
  color: var(--cooee-text);
  font: 0.92em ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  padding: 1px 5px;
}
.cooee-updates [data-code-block] {
  background: #292524;
  border: 1px solid #44403c;
  border-radius: 8px;
  color: #fafaf9;
  margin: 10px 0 0;
  max-inline-size: 100%;
  overflow-x: auto;
  padding: 12px;
  text-wrap: initial;
}
.cooee-updates [data-code="block"] {
  background: transparent;
  border: 0;
  color: inherit;
  display: block;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  min-inline-size: max-content;
  padding: 0;
  white-space: pre;
}
@media (max-width: 480px) {
  .cooee-updates__panel {
    inline-size: min(360px, calc(100vw - 24px));
    max-block-size: min(calc(100dvh - 24px), var(--available-height));
  }
}
@media (prefers-reduced-motion: reduce) {
  .cooee-updates *,
  .cooee-updates *::before,
  .cooee-updates *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
@media (forced-colors: active) {
  .cooee-updates__trigger,
  .cooee-updates__retry { border: 1px solid ButtonText; }
}
`;
