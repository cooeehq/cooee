import * as React from "react";
import { Popover } from "@base-ui/react/popover";
import {
  CooeeChangelogCategoryBadge,
  CooeeChangelogEntry,
  CooeeChangelogEntryMeta,
  cooeeChangelogStyles,
} from "./ChangelogUi.js";
import type {
  ChangelogCategoryDefinition,
  ChangelogDisplayType,
  PublicFeedEntry,
} from "./feed-types.js";
import { renderMarkdown } from "./markdown.js";
import cooeeLogoSource from "./cooee-logo.svg?raw";

const defaultTriggerSelector = "[data-cooee-updates-trigger]";
const defaultCooeePoweredByUrl =
  "https://cooee.sh/?utm_source=widget&utm_medium=referral&utm_campaign=powered_by";
const cooeeLogoAnimationDurationMs = 1650;
const cooeeLogoAnimationStyles =
  cooeeLogoSource
    .match(/<style><!\[CDATA\[([\s\S]*?)\]\]><\/style>/i)?.[1]
    ?.replaceAll(
      'svg[data-play-on-mount="true"]',
      '.cooee-updates__powered-by-logo-art svg[data-play-on-mount="true"]',
    )
    .replaceAll(".home-logo-link", ".cooee-updates__powered-by")
    .replace(/^(\s*)(\.logo-)/gm, "$1.cooee-updates__powered-by-logo-art $2")
    .replace(/^svg\s*\{/m, ".cooee-updates__powered-by-logo-art svg {") ?? "";
const cooeeLogoMarkup = cooeeLogoSource
  .replace(/^<\?xml[^>]*>\s*<!DOCTYPE[^>]*>\s*/i, "")
  .replace(/<style>[\s\S]*?<\/style>/i, "")
  .replace(/\sstyle="[^"]*"/g, "")
  .replace(/>\s+</g, "><")
  .trim();
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
  articleLoadError?: string;
  articleLoading?: string;
  backToChangelog?: string;
  changelog?: string;
  close: string;
  empty: string;
  loadError: string;
  loading: string;
  retry: string;
  readMore?: string;
  /** @deprecated The public changelog is now linked from the popup heading. */
  viewAll: string;
  loaded: (count: number) => string;
  unread: (count: number) => string;
};

type ResolvedLabels = CooeeUpdatesLabels &
  Required<
    Pick<
      CooeeUpdatesLabels,
      | "articleLoadError"
      | "articleLoading"
      | "backToChangelog"
      | "changelog"
      | "readMore"
    >
  >;

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
      categoryDefinitions: ChangelogCategoryDefinition[];
      publicUrl: string | null;
      resolvedFeedUrl: string;
      latestPublishedAt?: string;
    }
  | { status: "error"; entries: PublicFeedEntry[] };

type UpdatesPanelProps = {
  articleState: ArticleState;
  cooeePoweredByUrl: string;
  labels: ResolvedLabels;
  onArticleOpen: (entry: PublicFeedEntry) => void;
  onArticleRetry: () => void;
  onRetry: () => void;
  state: LoadState;
};

type ArticleState =
  | { status: "closed" }
  | { status: "loading"; entry: PublicFeedEntry }
  | { status: "error"; entry: PublicFeedEntry }
  | { status: "success"; entry: PublicFeedEntry; markdown: string };

const defaultLabels: ResolvedLabels = {
  articleLoadError: "We couldn’t load this article.",
  articleLoading: "Loading article…",
  backToChangelog: "Back to changelog",
  changelog: "Changelog",
  close: "Close updates",
  empty: "No updates yet.",
  loadError: "We couldn’t load the latest updates.",
  loading: "Loading updates…",
  retry: "Try again",
  readMore: "Read more",
  viewAll: "View all updates",
  loaded: (count) => `${count} ${count === 1 ? "update" : "updates"} loaded.`,
  unread: (count) => `${count} unread ${count === 1 ? "update" : "updates"}`,
};

const defaultCategoryDefinitions: ChangelogCategoryDefinition[] = [
  { id: "feature", label: "Feature", displayType: "post" },
  { id: "improvement", label: "Improvement", displayType: "callout" },
  { id: "fix", label: "Fix", displayType: "text" },
  { id: "maintenance", label: "Maintenance", displayType: "text" },
];

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
  const [articleState, setArticleState] = React.useState<ArticleState>({
    status: "closed",
  });
  const [cooeePoweredByUrl, setCooeePoweredByUrl] = React.useState(
    defaultCooeePoweredByUrl,
  );
  const [externalTrigger, setExternalTrigger] =
    React.useState<HTMLElement | null>(null);
  const [shadcnStyles, setShadcnStyles] = React.useState("");
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const articleRequestRef = React.useRef<AbortController | null>(null);
  const feedScrollPositionRef = React.useRef(0);
  const returnToEntryIdRef = React.useRef<string | null>(null);
  const shouldRestoreFeedPositionRef = React.useRef(false);
  const reactId = React.useId();
  const instanceId = `cooee-${reactId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const panelId = `${instanceId}-panel`;
  const positionerId = `${instanceId}-positioner`;
  const headingId = `${instanceId}-heading`;
  const labels = React.useMemo(
    () => ({
      ...defaultLabels,
      ...labelOverrides,
      articleLoadError:
        labelOverrides?.articleLoadError ?? defaultLabels.articleLoadError,
      articleLoading:
        labelOverrides?.articleLoading ?? defaultLabels.articleLoading,
      backToChangelog:
        labelOverrides?.backToChangelog ?? defaultLabels.backToChangelog,
      changelog: labelOverrides?.changelog ?? defaultLabels.changelog,
      readMore: labelOverrides?.readMore ?? defaultLabels.readMore,
    }),
    [labelOverrides],
  );
  const itemLimit = normalizeMaxItems(maxItems);

  React.useEffect(() => {
    setCooeePoweredByUrl(buildCooeePoweredByUrl(window.location.hostname));
  }, []);

  const closeArticle = React.useCallback((restoreFeedPosition = true) => {
    articleRequestRef.current?.abort();
    articleRequestRef.current = null;
    shouldRestoreFeedPositionRef.current = restoreFeedPosition;
    setArticleState({ status: "closed" });
  }, []);

  const openArticle = React.useCallback(
    async (entry: PublicFeedEntry) => {
      if (!entry.articleSlug) {
        return;
      }

      if (panelRef.current) {
        feedScrollPositionRef.current = panelRef.current.scrollTop;
      }
      returnToEntryIdRef.current = entry.id;
      shouldRestoreFeedPositionRef.current = false;

      articleRequestRef.current?.abort();
      const controller = new AbortController();
      articleRequestRef.current = controller;
      setArticleState({ status: "loading", entry });

      try {
        const response = await fetch(
          getPublicArticleApiUrl(
            state.status === "success" ? state.resolvedFeedUrl : feedUrl,
            entry.articleSlug,
          ),
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error("The article request failed");
        }

        const markdown = parsePublicArticleMarkdown(await response.json());
        if (!controller.signal.aborted) {
          setArticleState({ status: "success", entry, markdown });
        }
      } catch (error) {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setArticleState({ status: "error", entry });
        }
      } finally {
        if (articleRequestRef.current === controller) {
          articleRequestRef.current = null;
        }
      }
    },
    [feedUrl, state],
  );

  useIsomorphicLayoutEffect(() => {
    if (
      articleState.status !== "closed" ||
      !shouldRestoreFeedPositionRef.current
    ) {
      return;
    }

    shouldRestoreFeedPositionRef.current = false;
    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    const scrollTop = feedScrollPositionRef.current;
    const entryId = returnToEntryIdRef.current;
    const restore = () => {
      panel.scrollTop = scrollTop;
      const readMoreButtons = panel.querySelectorAll<HTMLButtonElement>(
        "[data-cooee-read-more-entry]",
      );
      const readMoreButton = Array.from(readMoreButtons).find(
        (button) =>
          button.getAttribute("data-cooee-read-more-entry") === entryId,
      );
      readMoreButton?.focus({ preventScroll: true });
      panel.scrollTop = scrollTop;
    };

    restore();
    const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [articleState.status]);

  React.useEffect(
    () => () => {
      articleRequestRef.current?.abort();
    },
    [],
  );

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
          categoryDefinitions: feed.categoryDefinitions,
          publicUrl: feed.publicUrl,
          resolvedFeedUrl: response.url || feedUrl,
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

  useIsomorphicLayoutEffect(() => {
    if (theme !== "shadcn" || typeof document === "undefined") {
      setShadcnStyles("");
      return;
    }

    const source = externalTrigger ?? rootRef.current;
    if (!source) {
      return;
    }
    const themeSource: HTMLElement = source;

    function syncThemeTokens() {
      const styles =
        themeSource.ownerDocument.defaultView?.getComputedStyle(themeSource);
      if (!styles) {
        return;
      }

      const nextStyles = buildShadcnStyles(instanceId, positionerId, styles);
      setShadcnStyles((current) =>
        current === nextStyles ? current : nextStyles,
      );
    }

    syncThemeTokens();

    const observer =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(syncThemeTokens);
    let themeAncestor: Element | null = themeSource;
    while (observer && themeAncestor) {
      observer.observe(themeAncestor, {
        attributeFilter: ["class", "data-theme", "style"],
        attributes: true,
      });
      themeAncestor = themeAncestor.parentElement;
    }

    const colorScheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    colorScheme?.addEventListener?.("change", syncThemeTokens);

    return () => {
      observer?.disconnect();
      colorScheme?.removeEventListener?.("change", syncThemeTokens);
    };
  }, [externalTrigger, instanceId, positionerId, theme]);

  return (
    <Popover.Root
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          closeArticle(false);
        }
      }}
      open={open}
    >
      <div
        className={["cooee-updates", className].filter(Boolean).join(" ")}
        data-color-scheme={scheme}
        data-cooee-theme={theme}
        data-external-trigger={externalTrigger ? "" : undefined}
        id={instanceId}
        ref={rootRef}
      >
        <style
          data-cooee-styles
          nonce={styleNonce}
        >{`${cooeeLogoAnimationStyles}\n${cooeeChangelogStyles}\n${embedStyles}\n${instanceStyles}\n${shadcnStyles}`}</style>
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
          align="start"
          anchor={externalTrigger ?? triggerRef}
          className="cooee-updates cooee-updates__positioner"
          collisionAvoidance={{
            side: "flip",
            align: "none",
            fallbackAxisSide: "none",
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
            data-article-view={
              articleState.status === "closed" ? undefined : ""
            }
            finalFocus={() => triggerRef.current}
            id={panelId}
            initialFocus={closeRef}
            ref={panelRef}
          >
            <div
              className="cooee-updates__panel-content"
              data-article-view={
                articleState.status === "closed" ? undefined : ""
              }
            >
              <header className="cooee-updates__header">
                <div className="cooee-updates__header-leading">
                  {articleState.status !== "closed" ? (
                    <button
                      aria-label={labels.backToChangelog}
                      className="cooee-updates__back"
                      onClick={() => closeArticle()}
                      type="button"
                    >
                      <span aria-hidden="true">←</span>
                    </button>
                  ) : null}
                  <Popover.Title dir="auto" id={headingId}>
                    {state.status === "success" && state.publicUrl ? (
                      <a
                        aria-label={`View ${labels.changelog}`}
                        className="cooee-updates__header-title-link"
                        href={state.publicUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <span className="cooee-updates__header-title-content">
                          <span
                            aria-hidden="true"
                            className="cooee-updates__header-title-view"
                          >
                            View
                          </span>
                          <span className="cooee-updates__header-title-label">
                            {labels.changelog}
                          </span>
                          <span
                            aria-hidden="true"
                            className="cooee-updates__header-title-icon"
                          >
                            ↗
                          </span>
                        </span>
                      </a>
                    ) : (
                      labels.changelog
                    )}
                  </Popover.Title>
                </div>
                <Popover.Close
                  aria-label={labels.close}
                  className="cooee-updates__close"
                  ref={closeRef}
                >
                  <span aria-hidden="true">×</span>
                </Popover.Close>
              </header>

              <UpdatesPanel
                articleState={articleState}
                cooeePoweredByUrl={cooeePoweredByUrl}
                labels={labels}
                onArticleOpen={(entry) => void openArticle(entry)}
                onArticleRetry={() => {
                  if (articleState.status !== "closed") {
                    void openArticle(articleState.entry);
                  }
                }}
                onRetry={() => {
                  closeRef.current?.focus();
                  setRetryCount((count) => count + 1);
                }}
                state={state}
              />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function UpdatesPanel({
  articleState,
  cooeePoweredByUrl,
  labels,
  onArticleOpen,
  onArticleRetry,
  onRetry,
  state,
}: UpdatesPanelProps) {
  if (articleState.status !== "closed") {
    return (
      <div className="cooee-updates__view" data-view="article">
        <ArticlePanel
          articleState={articleState}
          labels={labels}
          onRetry={onArticleRetry}
        />
        <footer className="cooee-updates__footer">
          <PoweredByCooee href={cooeePoweredByUrl} />
        </footer>
      </div>
    );
  }

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
    <div className="cooee-updates__view" data-view="feed">
      <p aria-live="polite" className="cooee-updates__sr-only" role="status">
        {labels.loaded(state.entries.length)}
      </p>
      <div className="cooee-updates__entries">
        {state.entries.map((entry) => {
          const publishedDate = formatPublishedDate(entry.publishedAt);
          const categoryDefinition = getCategoryDefinition(
            entry.category,
            state.categoryDefinitions,
            entry,
          );

          return (
            <CooeeChangelogEntry
              action={
                entry.articleSlug ? (
                  <button
                    className="cooee-updates__read-more"
                    data-cooee-read-more-entry={entry.id}
                    onClick={() => onArticleOpen(entry)}
                    type="button"
                  >
                    <span className="cooee-updates__read-more-label">
                      {labels.readMore}
                    </span>
                    <span
                      aria-hidden="true"
                      className="cooee-updates__read-more-icon"
                    >
                      →
                    </span>
                  </button>
                ) : null
              }
              categoryLabel={categoryDefinition.label}
              dateLabel={publishedDate}
              dateTime={entry.publishedAt}
              displayType={categoryDefinition.displayType}
              entry={entry}
              getCategoryLabel={(category) =>
                getCategoryDefinition(category, state.categoryDefinitions).label
              }
              key={entry.id}
              showMeta
            />
          );
        })}
      </div>
      <footer className="cooee-updates__footer">
        <PoweredByCooee href={cooeePoweredByUrl} />
      </footer>
    </div>
  );
}

function PoweredByCooee({ href }: { href: string }) {
  const logoArtRef = React.useRef<HTMLSpanElement>(null);
  const animationTimeoutRef = React.useRef<number | null>(null);

  const playAnimation = React.useCallback(() => {
    if (animationTimeoutRef.current !== null) {
      return;
    }

    const svg = logoArtRef.current?.querySelector("svg");
    if (!svg) {
      return;
    }

    svg.setAttribute("data-play-on-mount", "true");
    animationTimeoutRef.current = window.setTimeout(() => {
      svg.removeAttribute("data-play-on-mount");
      animationTimeoutRef.current = null;
    }, cooeeLogoAnimationDurationMs);
  }, []);

  React.useEffect(
    () => () => {
      if (animationTimeoutRef.current !== null) {
        window.clearTimeout(animationTimeoutRef.current);
      }
    },
    [],
  );

  return (
    <a
      className="cooee-updates__powered-by"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <span>Powered by</span>
      <span
        aria-label="cooee"
        className="cooee-updates__powered-by-logo"
        role="img"
      >
        <span
          aria-hidden="true"
          className="cooee-updates__powered-by-logo-trigger"
          onPointerEnter={playAnimation}
        />
        <span
          aria-hidden="true"
          className="cooee-updates__powered-by-logo-art"
          dangerouslySetInnerHTML={{ __html: cooeeLogoMarkup }}
          ref={logoArtRef}
        />
      </span>
    </a>
  );
}

function ArticlePanel({
  articleState,
  labels,
  onRetry,
}: {
  articleState: Exclude<ArticleState, { status: "closed" }>;
  labels: ResolvedLabels;
  onRetry: () => void;
}) {
  if (articleState.status === "loading") {
    return (
      <div className="cooee-updates__article-status">
        <p aria-live="polite" role="status">
          {labels.articleLoading}
        </p>
      </div>
    );
  }

  if (articleState.status === "error") {
    return (
      <div
        aria-live="assertive"
        className="cooee-updates__article-status"
        role="alert"
      >
        <p>{labels.articleLoadError}</p>
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

  const publishedDate = formatPublishedDate(articleState.entry.publishedAt);

  return (
    <article className="cooee-updates__article">
      <CooeeChangelogEntryMeta
        dateLabel={publishedDate}
        dateTime={articleState.entry.publishedAt}
      >
        <CooeeChangelogCategoryBadge category={articleState.entry.category}>
          {formatCategory(articleState.entry.category)}
        </CooeeChangelogCategoryBadge>
      </CooeeChangelogEntryMeta>
      <h3 className="cooee-updates__article-title" dir="auto">
        {articleState.entry.title}
      </h3>
      {articleState.entry.imageUrl ? (
        <img
          alt=""
          className="cooee-updates__article-image"
          src={articleState.entry.imageUrl}
        />
      ) : null}
      <div
        className="cooee-updates__article-body"
        dangerouslySetInnerHTML={{
          __html: renderMarkdown(articleState.markdown),
        }}
        dir="auto"
      />
    </article>
  );
}

function parsePublicFeed(
  value: unknown,
  feedUrl: string,
): {
  categoryDefinitions: ChangelogCategoryDefinition[];
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
    categoryDefinitions: normalizeCategoryDefinitions(
      value.changelog.categoryDefinitions,
    ),
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

function normalizeCategoryDefinitions(
  value: unknown,
): ChangelogCategoryDefinition[] {
  if (!Array.isArray(value)) {
    return defaultCategoryDefinitions;
  }

  const definitions = value.flatMap((definition) => {
    if (
      !isRecord(definition) ||
      typeof definition.id !== "string" ||
      definition.id.trim() === "" ||
      typeof definition.label !== "string" ||
      definition.label.trim() === "" ||
      !isChangelogDisplayType(definition.displayType)
    ) {
      return [];
    }

    return [
      {
        id: normalizeCategoryId(definition.id),
        label: definition.label.trim(),
        displayType: definition.displayType,
        ...(typeof definition.marketingCopy === "boolean"
          ? { marketingCopy: definition.marketingCopy }
          : {}),
      },
    ];
  });

  return definitions.length > 0 ? definitions : defaultCategoryDefinitions;
}

function getCategoryDefinition(
  category: string,
  definitions: ChangelogCategoryDefinition[],
  entry?: PublicFeedEntry,
): ChangelogCategoryDefinition {
  const normalizedCategory = normalizeCategoryId(category);
  return (
    definitions.find(
      ({ id }) => normalizeCategoryId(id) === normalizedCategory,
    ) ?? {
      id: normalizedCategory,
      label: formatCategory(normalizedCategory),
      displayType: entry?.articleSlug ? "article" : "post",
    }
  );
}

function normalizeCategoryId(category: string): string {
  return category
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function isChangelogDisplayType(value: unknown): value is ChangelogDisplayType {
  return (
    value === "article" ||
    value === "post" ||
    value === "callout" ||
    value === "text"
  );
}

function getPublicArticleApiUrl(feedUrl: string, articleSlug: string): string {
  const url = new URL(
    feedUrl,
    typeof window === "undefined" ? "http://localhost" : window.location.href,
  );
  const articlePath = `/articles/${encodeURIComponent(articleSlug)}`;

  if (/\/feed\.json\/?$/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/feed\.json\/?$/, articlePath);
  } else {
    url.pathname = `${url.pathname.replace(/\/$/, "")}${articlePath}`;
  }

  url.hash = "";
  url.search = "";
  return url.toString();
}

function parsePublicArticleMarkdown(value: unknown): string {
  if (
    !isRecord(value) ||
    !isRecord(value.entry) ||
    typeof value.entry.articleMarkdown !== "string" ||
    value.entry.articleMarkdown.trim().length === 0
  ) {
    throw new Error("Invalid public article");
  }

  return value.entry.articleMarkdown;
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

export function buildCooeePoweredByUrl(hostname?: string): string {
  const url = new URL(defaultCooeePoweredByUrl);
  const attributedHost = hostname?.trim();

  if (attributedHost) {
    url.searchParams.set("utm_content", attributedHost);
  }

  return url.toString();
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

const shadcnColorTokens = [
  ["--cooee-accent", "--primary", "--color-primary"],
  ["--cooee-accent-text", "--primary-foreground", "--color-primary-foreground"],
  ["--cooee-surface", "--popover", "--color-popover"],
  ["--cooee-surface-subtle", "--muted", "--color-muted"],
  ["--cooee-text", "--popover-foreground", "--color-popover-foreground"],
  ["--cooee-muted", "--muted-foreground", "--color-muted-foreground"],
  ["--cooee-border", "--border", "--color-border"],
  ["--cooee-ring", "--ring", "--color-ring"],
] as const;

function buildShadcnStyles(
  instanceId: string,
  positionerId: string,
  styles: CSSStyleDeclaration,
): string {
  const declarations = shadcnColorTokens.flatMap(
    ([target, semanticToken, tailwindAlias]) => {
      const value = normalizeShadcnColor(
        styles.getPropertyValue(semanticToken),
      );
      const alias = normalizeShadcnColor(
        styles.getPropertyValue(tailwindAlias),
      );
      const resolved = value ?? alias;

      return resolved ? [`${target}: ${resolved};`] : [];
    },
  );

  return declarations.length > 0
    ? `#${instanceId}, #${positionerId} {\n    ${declarations.join("\n    ")}\n  }`
    : "";
}

export function normalizeShadcnColor(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) {
    return null;
  }

  return normalizeCssColor(candidate) ?? normalizeCssColor(`hsl(${candidate})`);
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

function formatPublishedDate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
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
  --cooee-radius: 24px;
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
  --cooee-radius: var(--radius-lg, var(--radius, 10px));
  --cooee-border-subtle: color-mix(in oklab, var(--cooee-border) 70%, transparent);
  --cooee-shadow: color-mix(in oklab, var(--cooee-text) 16%, transparent);
  color-scheme: inherit;
  font-family: var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
}
.cooee-updates,
.cooee-updates *,
.cooee-updates *::before,
.cooee-updates *::after { box-sizing: border-box; }
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
.cooee-updates__back,
.cooee-updates__close,
.cooee-updates__read-more,
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
.cooee-updates__back:focus-visible,
.cooee-updates__close:focus-visible,
.cooee-updates__read-more:focus-visible,
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
  --cooee-popup-inline-size: 360px;
  background: var(--cooee-surface);
  block-size: var(--popup-height, auto);
  border: 1px solid var(--cooee-border);
  border-radius: var(--cooee-radius);
  box-shadow: 0 18px 48px var(--cooee-shadow);
  color: var(--cooee-text);
  inline-size: var(--popup-width, var(--cooee-popup-inline-size));
  max-block-size: min(70dvh, 640px, var(--available-height));
  max-inline-size: min(360px, var(--available-width));
  overflow: auto;
  overscroll-behavior: contain;
  padding: 14px;
  scrollbar-width: none;
  text-align: start;
  transform-origin: top left;
  transition:
    inline-size 280ms cubic-bezier(0.22, 1, 0.36, 1),
    block-size 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
.cooee-updates__panel::-webkit-scrollbar {
  display: none;
  height: 0;
  width: 0;
}
.cooee-updates__panel[data-article-view] {
  --cooee-popup-inline-size: 680px;
  max-block-size: min(85dvh, 800px, var(--available-height));
  max-inline-size: min(680px, var(--available-width));
}
.cooee-updates__panel-content {
  inline-size: min(330px, calc(var(--available-width) - 30px));
}
.cooee-updates__panel-content[data-article-view] {
  inline-size: min(650px, calc(var(--available-width) - 30px));
}
.cooee-updates__positioner {
  block-size: var(--positioner-height, auto);
  inline-size: var(--positioner-width, auto);
  max-inline-size: calc(100vw - 24px);
  z-index: 2147483000;
}
.cooee-updates__header {
  align-items: center;
  background: var(--cooee-surface);
  border-block-end: 1px solid var(--cooee-border-subtle);
  display: flex;
  gap: 10px;
  justify-content: space-between;
  margin: -14px -14px 8px;
  padding: 8px 14px;
  position: sticky;
  top: -14px;
  z-index: 2;
}
.cooee-updates__header h2 {
  font-size: 13px;
  line-height: 1.35;
  margin: 0;
  overflow-wrap: anywhere;
}
.cooee-updates__header-title-link {
  align-items: center;
  border: 1px solid transparent;
  border-radius: 999px;
  color: inherit;
  display: inline-grid;
  grid-template-areas: "label";
  min-block-size: 32px;
  padding-inline: 10px;
  position: relative;
  text-decoration: none;
}
.cooee-updates__header-title-link::before {
  background: var(--cooee-surface-subtle);
  border: 1px solid var(--cooee-border-subtle);
  border-radius: inherit;
  content: "";
  inset: -1px;
  opacity: 0;
  position: absolute;
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.cooee-updates__header-title-content {
  align-items: center;
  display: inline-flex;
  gap: 2px;
  grid-area: label;
  position: relative;
}
.cooee-updates__header-title-view,
.cooee-updates__header-title-icon {
  opacity: 0;
  transition: opacity 130ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.cooee-updates__header-title-view {
  transform: translateX(-6px);
}
.cooee-updates__header-title-label {
  transform: translateX(-28px);
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.cooee-updates__header-title-icon {
  margin-inline-start: 4px;
  transform: translateX(-6px);
}
.cooee-updates__header-title-link:hover::before,
.cooee-updates__header-title-link:focus-visible::before {
  opacity: 1;
}
.cooee-updates__header-title-link:hover .cooee-updates__header-title-view,
.cooee-updates__header-title-link:focus-visible .cooee-updates__header-title-view,
.cooee-updates__header-title-link:hover .cooee-updates__header-title-icon,
.cooee-updates__header-title-link:focus-visible .cooee-updates__header-title-icon {
  opacity: 1;
  transform: translateX(0);
}
.cooee-updates__header-title-link:hover .cooee-updates__header-title-label,
.cooee-updates__header-title-link:focus-visible .cooee-updates__header-title-label {
  transform: translateX(0);
}
.cooee-updates__header-leading {
  align-items: center;
  display: flex;
  gap: 4px;
  min-inline-size: 0;
}
.cooee-updates__back,
.cooee-updates__close {
  align-items: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--cooee-muted);
  cursor: pointer;
  display: inline-flex;
  flex: none;
  font-size: 18px;
  inline-size: 36px;
  justify-content: center;
  line-height: 1;
  min-block-size: 36px;
  position: relative;
}
.cooee-updates__back::after,
.cooee-updates__close::after {
  content: "";
  inset: -4px;
  position: absolute;
}
.cooee-updates__back:hover,
.cooee-updates__close:hover {
  border-color: var(--cooee-border-subtle);
  color: var(--cooee-text);
}
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
.cooee-updates__view {
  animation: cooee-updates-view-enter 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
  min-inline-size: 0;
}
.cooee-updates__view[data-view="article"] {
  --cooee-view-enter-offset: 12px;
}
.cooee-updates__view[data-view="feed"] {
  --cooee-view-enter-offset: -12px;
}
@keyframes cooee-updates-view-enter {
  from {
    opacity: 0;
    transform: translateX(var(--cooee-view-enter-offset));
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
.cooee-updates .cooee-changelog-meta__date,
.cooee-updates .cooee-changelog-badge {
  font-size: 11px;
}
.cooee-updates .cooee-changelog-card__title,
.cooee-updates .cooee-changelog-callout__title,
.cooee-updates .cooee-changelog-text__title {
  font-size: 17px;
  line-height: 1.3;
}
.cooee-updates .cooee-changelog-card__title {
  margin-block-end: 10px;
}
.cooee-updates .cooee-changelog-card__summary {
  font-size: 13px;
  line-height: 1.55;
}
.cooee-updates .cooee-changelog-card__summary a,
.cooee-updates .cooee-changelog-card__action a,
.cooee-updates .cooee-changelog-card__action button {
  font-size: 12px;
}
.cooee-updates .cooee-updates__read-more {
  text-decoration: none;
}
.cooee-updates__read-more-label {
  text-decoration: underline;
  text-decoration-color: var(--cooee-border);
  text-underline-offset: 4px;
}
.cooee-updates__read-more-icon {
  display: inline-flex;
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.cooee-updates__read-more:hover .cooee-updates__read-more-label {
  text-decoration-color: currentColor;
}
.cooee-updates__read-more:hover .cooee-updates__read-more-icon {
  transform: translateX(2px);
}
.cooee-updates .cooee-changelog-callout__summary,
.cooee-updates .cooee-changelog-text__summary,
.cooee-updates .cooee-changelog-item__summary {
  font-size: 12px;
  line-height: 1.6;
}
.cooee-updates .cooee-changelog-item__title {
  font-size: 13px;
}
.cooee-updates__article {
  margin-inline: auto;
  max-inline-size: 620px;
  padding: 12px 4px 24px;
}
.cooee-updates__article-title {
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 16px 0 20px;
  overflow-wrap: anywhere;
}
.cooee-updates__article-image {
  aspect-ratio: 16 / 9;
  border: 1px solid var(--cooee-border-subtle);
  border-radius: var(--cooee-radius);
  display: block;
  inline-size: 100%;
  margin-block-end: 20px;
  object-fit: cover;
}
.cooee-updates__article-body {
  color: var(--cooee-text);
  font-size: 14px;
  line-height: 1.65;
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
.cooee-updates__article-body > :first-child { margin-block-start: 0; }
.cooee-updates__article-body > :last-child { margin-block-end: 0; }
.cooee-updates__article-body h1,
.cooee-updates__article-body h2,
.cooee-updates__article-body h3,
.cooee-updates__article-body h4 {
  color: var(--cooee-text);
  line-height: 1.25;
  margin-block: 28px 10px;
}
.cooee-updates__article-body p,
.cooee-updates__article-body ol,
.cooee-updates__article-body ul { margin-block: 0 16px; }
.cooee-updates__article-body a {
  color: var(--cooee-text);
  font-weight: 650;
  text-underline-offset: 3px;
}
.cooee-updates__article-status {
  align-items: flex-start;
  color: var(--cooee-muted);
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-block-size: 240px;
  padding: 24px;
}
.cooee-updates__article-status p { margin: 0 0 12px; }
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
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  justify-content: center;
  margin-block-start: 10px;
  padding: 12px 20px 0;
}
.cooee-updates__view[data-view="article"] > .cooee-updates__footer {
  border-block-start: 1px solid var(--cooee-border-subtle);
}
.cooee-updates__footer a {
  align-items: center;
  color: var(--cooee-text);
  display: inline-flex;
  font-size: 12px;
  font-weight: 650;
  min-block-size: 44px;
  text-decoration: none;
}
.cooee-updates__footer .cooee-updates__powered-by {
  color: var(--cooee-muted);
  font-size: 11px;
  font-weight: 450;
  gap: 7px;
  margin-inline: auto;
}
.cooee-updates__powered-by-logo {
  block-size: 12px;
  display: block;
  inline-size: 90px;
  overflow: visible;
  position: relative;
}
.cooee-updates__powered-by-logo-trigger {
  block-size: 100%;
  cursor: pointer;
  inline-size: 59.45%;
  inset-block-start: 0;
  inset-inline-start: 0;
  position: absolute;
  z-index: 1;
}
.cooee-updates__powered-by-logo-art {
  block-size: 100%;
  display: block;
  inline-size: 100%;
  pointer-events: none;
}
.cooee-updates__powered-by-logo-art svg {
  clip-rule: evenodd;
  display: block;
  fill: currentColor;
  fill-rule: evenodd;
  inline-size: 100%;
  overflow: visible;
  pointer-events: none;
  stroke-linejoin: round;
  stroke-miterlimit: 2;
}
.cooee-updates__powered-by-logo path {
  fill-rule: nonzero;
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
@media (max-width: 640px) {
  .cooee-updates__positioner {
    block-size: auto !important;
    inline-size: auto !important;
    inset-block-end: max(8px, env(safe-area-inset-bottom)) !important;
    inset-block-start: max(8px, env(safe-area-inset-top)) !important;
    inset-inline-end: max(8px, env(safe-area-inset-right)) !important;
    inset-inline-start: max(8px, env(safe-area-inset-left)) !important;
    max-inline-size: none;
    position: fixed !important;
    transform: none !important;
  }
  .cooee-updates__panel {
    block-size: 100% !important;
    inline-size: 100% !important;
    max-block-size: none;
    max-inline-size: none;
    transition: none;
  }
  .cooee-updates__panel[data-article-view] {
    max-block-size: none;
    max-inline-size: none;
  }
  .cooee-updates__panel-content,
  .cooee-updates__panel-content[data-article-view] {
    inline-size: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cooee-updates *,
  .cooee-updates *::before,
  .cooee-updates *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
@media (forced-colors: active) {
  .cooee-updates__trigger,
  .cooee-updates__retry { border: 1px solid ButtonText; }
}
`;
