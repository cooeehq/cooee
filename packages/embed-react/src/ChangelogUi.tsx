import * as React from "react";
import type {
  ChangelogChangeItem,
  ChangelogDisplayType,
} from "./feed-types.js";
import { renderMarkdown } from "./markdown.js";

export type CooeeChangelogCategoryBadgeProps = {
  category: string;
  children: React.ReactNode;
  className?: string;
};

export type CooeeChangelogEntryMetaProps = {
  children: React.ReactNode;
  className?: string;
  dateLabel?: string | null;
  dateTime?: string;
};

export type CooeeChangelogCardProps = Omit<
  React.HTMLAttributes<HTMLElement>,
  "children" | "title"
> & {
  action?: React.ReactNode;
  children?: React.ReactNode;
  details?: React.ReactNode;
  imageAlt?: string;
  imageUrl?: string | null;
  summaryHtml: string;
  title: string;
};

export type CooeeChangelogEntryData = {
  category: string;
  imageUrl?: string | null;
  items?: ChangelogChangeItem[];
  summary: string;
  title: string;
};

export type CooeeChangelogEntryProps = Omit<
  React.HTMLAttributes<HTMLElement>,
  "children" | "title"
> & {
  action?: React.ReactNode;
  categoryLabel: string;
  dateLabel?: string | null;
  dateTime?: string;
  displayType: ChangelogDisplayType;
  entry: CooeeChangelogEntryData;
  getCategoryLabel?: (category: string) => string;
  showMeta?: boolean;
};

export function CooeeChangelogStyles({ nonce }: { nonce?: string }) {
  return (
    <style data-cooee-changelog-styles="" nonce={nonce}>
      {cooeeChangelogStyles}
    </style>
  );
}

export function CooeeChangelogCategoryBadge({
  category,
  children,
  className,
}: CooeeChangelogCategoryBadgeProps) {
  const tone = getCategoryTone(category);

  return (
    <span
      className={joinClassNames(
        "cooee-changelog-badge",
        `cooee-changelog-badge--${tone}`,
        className,
      )}
      dir="auto"
    >
      {children}
    </span>
  );
}

export function CooeeChangelogEntryMeta({
  children,
  className,
  dateLabel,
  dateTime,
}: CooeeChangelogEntryMetaProps) {
  return (
    <div className={joinClassNames("cooee-changelog-meta", className)}>
      {children}
      {dateLabel ? (
        <time className="cooee-changelog-meta__date" dateTime={dateTime}>
          {dateLabel}
        </time>
      ) : null}
    </div>
  );
}

export function CooeeChangelogCard({
  action,
  children,
  className,
  details,
  imageAlt = "",
  imageUrl,
  summaryHtml,
  title,
  ...articleProps
}: CooeeChangelogCardProps) {
  return (
    <div className="cooee-changelog-card-frame">
      <article
        {...articleProps}
        className={joinClassNames("cooee-changelog-card", className)}
      >
        {children}
        {imageUrl ? (
          <img
            alt={imageAlt}
            className="cooee-changelog-card__image"
            loading="lazy"
            src={imageUrl}
          />
        ) : null}
        <h3 className="cooee-changelog-card__title" dir="auto">
          {title}
        </h3>
        <div
          className="cooee-changelog-card__summary"
          dangerouslySetInnerHTML={{ __html: summaryHtml }}
          dir="auto"
        />
        {details}
        {action ? (
          <div className="cooee-changelog-card__action">{action}</div>
        ) : null}
      </article>
    </div>
  );
}

export function CooeeChangelogEntry({
  action,
  categoryLabel,
  className,
  dateLabel,
  dateTime,
  displayType,
  entry,
  getCategoryLabel = formatCategoryLabel,
  showMeta = false,
  ...articleProps
}: CooeeChangelogEntryProps) {
  const [isCalloutExpanded, setIsCalloutExpanded] = React.useState(false);
  const [isCalloutExpandable, setIsCalloutExpandable] = React.useState(false);
  const calloutSummaryRef = React.useRef<HTMLDivElement | null>(null);
  const summaryHtml = renderMarkdown(entry.summary);

  React.useEffect(() => {
    if (displayType !== "callout") {
      setIsCalloutExpandable(false);
      return;
    }

    const summary = calloutSummaryRef.current;
    if (!summary) {
      return;
    }

    const updateExpandableState = () => {
      const canExpand = summary.scrollHeight > 121;
      setIsCalloutExpandable(canExpand);
      if (!canExpand) {
        setIsCalloutExpanded(false);
      }
    };

    updateExpandableState();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateExpandableState);
    observer.observe(summary);
    return () => observer.disconnect();
  }, [displayType, summaryHtml]);

  const meta = showMeta ? (
    <CooeeChangelogEntryMeta dateLabel={dateLabel} dateTime={dateTime}>
      <CooeeChangelogCategoryBadge category={entry.category}>
        {categoryLabel}
      </CooeeChangelogCategoryBadge>
    </CooeeChangelogEntryMeta>
  ) : null;
  const items = renderEntryItems(entry.items, getCategoryLabel);

  if (displayType === "text") {
    return (
      <div className="cooee-changelog-card-frame">
        <article
          {...articleProps}
          className={joinClassNames("cooee-changelog-text", className)}
          data-display-type="text"
        >
          {meta}
          <details>
            <summary className="cooee-changelog-text__title">
              <span dir="auto">{entry.title}</span>
              <span
                aria-hidden="true"
                className="cooee-changelog-text__chevron"
              >
                ↓
              </span>
            </summary>
            <div
              className="cooee-changelog-text__summary"
              dangerouslySetInnerHTML={{ __html: summaryHtml }}
              dir="auto"
            />
            {items ? (
              <div className="cooee-changelog-items--plain">{items}</div>
            ) : null}
          </details>
        </article>
      </div>
    );
  }

  if (displayType === "callout") {
    return (
      <div className="cooee-changelog-card-frame">
        <article
          {...articleProps}
          className={joinClassNames("cooee-changelog-callout", className)}
          data-display-type="callout"
        >
          {meta}
          <h3 className="cooee-changelog-callout__title" dir="auto">
            {entry.title}
          </h3>
          <div
            className="cooee-changelog-callout__summary"
            data-collapsed={isCalloutExpanded ? undefined : ""}
            dangerouslySetInnerHTML={{ __html: summaryHtml }}
            dir="auto"
            ref={calloutSummaryRef}
          />
          <button
            aria-expanded={isCalloutExpanded}
            aria-label={
              isCalloutExpanded
                ? "Collapse callout text"
                : "Expand callout text"
            }
            className="cooee-changelog-callout__toggle"
            hidden={!isCalloutExpandable}
            onClick={() => setIsCalloutExpanded((current) => !current)}
            type="button"
          >
            <span aria-hidden="true">{isCalloutExpanded ? "↑" : "↓"}</span>
          </button>
          {items ? <div className="cooee-changelog-items">{items}</div> : null}
        </article>
      </div>
    );
  }

  return (
    <CooeeChangelogCard
      {...articleProps}
      action={action}
      className={className}
      data-display-type={displayType}
      details={
        items ? <div className="cooee-changelog-items">{items}</div> : null
      }
      imageUrl={entry.imageUrl}
      summaryHtml={summaryHtml}
      title={entry.title}
    >
      {meta}
    </CooeeChangelogCard>
  );
}

function renderEntryItems(
  items: ChangelogChangeItem[] | undefined,
  getCategoryLabel: (category: string) => string,
) {
  if (!items || items.length === 0) {
    return null;
  }

  return items.map((item, index) => (
    <section
      className="cooee-changelog-item"
      key={`${item.category}:${item.title}:${index}`}
    >
      <div className="cooee-changelog-item__header">
        <h4 className="cooee-changelog-item__title" dir="auto">
          {item.title}
        </h4>
        <CooeeChangelogCategoryBadge category={item.category}>
          {getCategoryLabel(item.category)}
        </CooeeChangelogCategoryBadge>
      </div>
      <div
        className="cooee-changelog-item__summary"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(item.summary) }}
        dir="auto"
      />
    </section>
  ));
}

function formatCategoryLabel(category: string) {
  const normalized = category.trim();
  return normalized
    ? `${normalized.slice(0, 1).toLocaleUpperCase()}${normalized.slice(1)}`
    : "Update";
}

function getCategoryTone(category: string): string {
  switch (category.trim().toLowerCase()) {
    case "feature":
    case "improvement":
    case "fix":
    case "maintenance":
      return category.trim().toLowerCase();
    default:
      return "default";
  }
}

function joinClassNames(...values: Array<string | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export const cooeeChangelogStyles = `
.cooee-changelog-card-frame {
  container-name: cooee-changelog-card;
  container-type: inline-size;
  min-inline-size: 0;
}
.cooee-changelog-card-frame + .cooee-changelog-card-frame {
  margin-block-start: 12px;
}
.cooee-changelog-card {
  background: var(--cooee-surface, var(--card, #fafaf9));
  border: 1px solid var(--cooee-border-subtle, var(--border, #e7e5e4));
  border-radius: 24px;
  color: var(--cooee-text, var(--foreground, #1c1917));
  min-inline-size: 0;
  padding: 36px;
}
.cooee-changelog-meta {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  justify-content: space-between;
  margin-block-end: 16px;
}
.cooee-changelog-meta__date {
  color: var(--cooee-muted, var(--muted-foreground, #57534e));
  font-size: 12px;
  line-height: 1.3;
}
.cooee-changelog-badge {
  align-items: center;
  border: 1px solid var(--cooee-border, var(--border, #d6d3d1));
  border-radius: 999px;
  display: inline-flex;
  flex: none;
  font-size: 12px;
  font-weight: 650;
  line-height: 1;
  max-inline-size: 65%;
  overflow-wrap: anywhere;
  padding: 4px 10px;
}
.cooee-changelog-badge--feature {
  background: #ecfdf5;
  border-color: #a7f3d0;
  color: #065f46;
}
.cooee-changelog-badge--improvement {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1d4ed8;
}
.cooee-changelog-badge--fix {
  background: #fffbeb;
  border-color: #fde68a;
  color: #92400e;
}
.cooee-changelog-badge--maintenance,
.cooee-changelog-badge--default {
  background: #f5f5f4;
  border-color: #d6d3d1;
  color: #44403c;
}
.cooee-changelog-card__image {
  aspect-ratio: 16 / 9;
  border: 1px solid var(--cooee-border-subtle, var(--border, #e7e5e4));
  border-radius: 16px;
  display: block;
  inline-size: 100%;
  margin-block-end: 20px;
  object-fit: cover;
}
.cooee-changelog-card__title {
  color: var(--cooee-text, var(--foreground, #1c1917));
  font-size: 24px;
  font-weight: 650;
  letter-spacing: normal;
  line-height: 1.2;
  margin: 0 0 16px;
  overflow-wrap: anywhere;
}
.cooee-changelog-card__summary {
  color: var(--cooee-muted, var(--muted-foreground, #57534e));
  font-size: 16px;
  line-height: 1.625;
  max-inline-size: 68ch;
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
.cooee-changelog-card__summary > :first-child { margin-block-start: 0; }
.cooee-changelog-card__summary > :last-child { margin-block-end: 0; }
.cooee-changelog-card__summary p { margin-block: 0; }
.cooee-changelog-card__summary p + p,
.cooee-changelog-card__summary ol,
.cooee-changelog-card__summary ul { margin-block-start: 16px; }
.cooee-changelog-card__summary ol,
.cooee-changelog-card__summary ul { padding-inline-start: 20px; }
.cooee-changelog-card__summary a,
.cooee-changelog-card__action a,
.cooee-changelog-card__action button {
  color: var(--cooee-text, var(--foreground, #1c1917));
  font: inherit;
  font-size: 14px;
  font-weight: 650;
  text-decoration: underline;
  text-decoration-color: var(--cooee-border, var(--border, #d6d3d1));
  text-underline-offset: 4px;
}
.cooee-changelog-card__action {
  margin-block-start: 20px;
}
.cooee-changelog-card__action button {
  align-items: center;
  background: transparent;
  border: 0;
  cursor: pointer;
  display: inline-flex;
  gap: 6px;
  min-block-size: 44px;
  padding: 0;
}
.cooee-changelog-card__action a {
  align-items: center;
  display: inline-flex;
  gap: 6px;
  min-block-size: 44px;
}
.cooee-changelog-card__action a:hover,
.cooee-changelog-card__action button:hover {
  text-decoration-color: currentColor;
}
.cooee-changelog-callout {
  background: var(--cooee-surface-subtle, var(--muted, #f5f5f4));
  border: 1px solid var(--cooee-border-subtle, var(--border, #e7e5e4));
  border-radius: 16px;
  color: var(--cooee-text, var(--foreground, #1c1917));
  min-inline-size: 0;
  padding: 20px;
}
.cooee-changelog-callout__title {
  font-size: 16px;
  font-weight: 650;
  line-height: 1.375;
  margin: 0 0 8px;
  overflow-wrap: anywhere;
}
.cooee-changelog-callout__summary,
.cooee-changelog-text__summary,
.cooee-changelog-item__summary {
  color: var(--cooee-muted, var(--muted-foreground, #57534e));
  font-size: 14px;
  line-height: 1.625;
  overflow-wrap: anywhere;
}
.cooee-changelog-callout__summary[data-collapsed] {
  max-block-size: 120px;
  overflow: hidden;
}
.cooee-changelog-callout__summary > :first-child,
.cooee-changelog-text__summary > :first-child,
.cooee-changelog-item__summary > :first-child { margin-block-start: 0; }
.cooee-changelog-callout__summary > :last-child,
.cooee-changelog-text__summary > :last-child,
.cooee-changelog-item__summary > :last-child { margin-block-end: 0; }
.cooee-changelog-callout__toggle {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 8px;
  color: var(--cooee-muted, var(--muted-foreground, #57534e));
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  inline-size: 44px;
  justify-content: center;
  margin-block-start: 8px;
  margin-inline-start: -10px;
  min-block-size: 44px;
}
.cooee-changelog-text {
  color: var(--cooee-text, var(--foreground, #1c1917));
  min-inline-size: 0;
  padding: 6px 16px;
}
.cooee-changelog-text__title {
  align-items: center;
  cursor: pointer;
  display: inline-flex;
  font-size: 14px;
  gap: 8px;
  line-height: 1.625;
  list-style: none;
}
.cooee-changelog-text__title::-webkit-details-marker { display: none; }
.cooee-changelog-text__chevron {
  color: var(--cooee-muted, var(--muted-foreground, #57534e));
  display: inline-flex;
  transition: transform 150ms ease;
}
.cooee-changelog-text details[open] .cooee-changelog-text__chevron {
  transform: rotate(180deg);
}
.cooee-changelog-text__summary { margin-block-start: 8px; }
.cooee-changelog-items {
  display: grid;
  gap: 12px;
  margin-block-start: 16px;
}
.cooee-changelog-items--plain {
  display: grid;
  gap: 10px;
  margin-block-start: 12px;
}
.cooee-changelog-item {
  background: color-mix(in oklab, var(--cooee-surface, var(--card, #fafaf9)) 70%, transparent);
  border: 1px solid var(--cooee-border-subtle, var(--border, #e7e5e4));
  border-radius: 16px;
  min-inline-size: 0;
  padding: 16px;
}
.cooee-changelog-items--plain .cooee-changelog-item {
  background: transparent;
  border: 0;
  border-radius: 0;
  padding: 0;
}
.cooee-changelog-item__header {
  align-items: flex-start;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}
.cooee-changelog-item__title {
  font-size: 15px;
  line-height: 1.4;
  margin: 0;
}
.cooee-changelog-item__summary { margin-block-start: 8px; }
.cooee-updates[data-color-scheme="dark"] .cooee-changelog-badge--feature,
[data-theme="dark"] .cooee-changelog-badge--feature {
  background: #022c22;
  border-color: rgba(16, 185, 129, 0.4);
  color: #a7f3d0;
}
.cooee-updates[data-color-scheme="dark"] .cooee-changelog-badge--improvement,
[data-theme="dark"] .cooee-changelog-badge--improvement {
  background: #172554;
  border-color: rgba(59, 130, 246, 0.4);
  color: #bfdbfe;
}
.cooee-updates[data-color-scheme="dark"] .cooee-changelog-badge--fix,
[data-theme="dark"] .cooee-changelog-badge--fix {
  background: #451a03;
  border-color: rgba(245, 158, 11, 0.4);
  color: #fde68a;
}
.cooee-updates[data-color-scheme="dark"] .cooee-changelog-badge--maintenance,
.cooee-updates[data-color-scheme="dark"] .cooee-changelog-badge--default,
[data-theme="dark"] .cooee-changelog-badge--maintenance,
[data-theme="dark"] .cooee-changelog-badge--default {
  background: #292524;
  border-color: #44403c;
  color: #e7e5e4;
}
@media (prefers-color-scheme: dark) {
  .cooee-updates[data-color-scheme="system"] .cooee-changelog-badge--feature {
    background: #022c22;
    border-color: rgba(16, 185, 129, 0.4);
    color: #a7f3d0;
  }
  .cooee-updates[data-color-scheme="system"] .cooee-changelog-badge--improvement {
    background: #172554;
    border-color: rgba(59, 130, 246, 0.4);
    color: #bfdbfe;
  }
  .cooee-updates[data-color-scheme="system"] .cooee-changelog-badge--fix {
    background: #451a03;
    border-color: rgba(245, 158, 11, 0.4);
    color: #fde68a;
  }
  .cooee-updates[data-color-scheme="system"] .cooee-changelog-badge--maintenance,
  .cooee-updates[data-color-scheme="system"] .cooee-changelog-badge--default {
    background: #292524;
    border-color: #44403c;
    color: #e7e5e4;
  }
}
@container cooee-changelog-card (max-width: 480px) {
  .cooee-changelog-card {
    border-radius: 20px;
    padding: 20px;
  }
  .cooee-changelog-meta {
    margin-block-end: 14px;
  }
  .cooee-changelog-card__image {
    border-radius: 12px;
    margin-block-end: 16px;
  }
  .cooee-changelog-card__title {
    font-size: 20px;
    margin-block-end: 12px;
  }
  .cooee-changelog-card__summary {
    font-size: 15px;
    line-height: 1.6;
  }
  .cooee-changelog-card__action {
    margin-block-start: 16px;
  }
  .cooee-changelog-callout {
    padding: 20px;
  }
}
@media (max-width: 640px) {
  .cooee-changelog-card {
    border-radius: 20px;
    padding: 20px;
  }
  .cooee-changelog-meta {
    margin-block-end: 14px;
  }
  .cooee-changelog-card__image {
    border-radius: 12px;
    margin-block-end: 16px;
  }
  .cooee-changelog-card__title {
    font-size: 20px;
    margin-block-end: 12px;
  }
  .cooee-changelog-card__summary {
    font-size: 15px;
    line-height: 1.6;
  }
  .cooee-changelog-card__action {
    margin-block-start: 16px;
  }
  .cooee-changelog-callout {
    padding: 20px;
  }
}
`;
