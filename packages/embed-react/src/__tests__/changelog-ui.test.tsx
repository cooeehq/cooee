import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CooeeChangelogCard,
  CooeeChangelogCategoryBadge,
  CooeeChangelogEntryMeta,
  CooeeChangelogEntry,
  CooeeChangelogStyles,
  cooeeChangelogStyles,
} from "../index";

describe("shared changelog presentation", () => {
  test("renders one reusable card structure for hosted and embedded changelogs", () => {
    const html = renderToStaticMarkup(
      <>
        <CooeeChangelogStyles nonce="test-nonce" />
        <CooeeChangelogCard
          action={<a href="/articles/launch">Read more</a>}
          imageUrl="/launch.webp"
          summaryHtml="<p>A readable launch summary.</p>"
          title="A major launch"
        >
          <CooeeChangelogEntryMeta
            dateTime="2026-08-10T05:00:00.000Z"
            dateLabel="10 Aug 2026"
          >
            <CooeeChangelogCategoryBadge category="feature">
              Feature
            </CooeeChangelogCategoryBadge>
          </CooeeChangelogEntryMeta>
        </CooeeChangelogCard>
      </>,
    );

    expect(html).toContain('data-cooee-changelog-styles=""');
    expect(html).toContain('nonce="test-nonce"');
    expect(html).toContain('class="cooee-changelog-card-frame"');
    expect(html).toContain('class="cooee-changelog-card"');
    expect(html).toContain('class="cooee-changelog-card__image"');
    expect(html).toContain('class="cooee-changelog-card__title"');
    expect(html).toContain('class="cooee-changelog-card__summary"');
    expect(html).toContain('class="cooee-changelog-card__action"');
    expect(html).toContain("A readable launch summary.");
    expect(html).toContain('dateTime="2026-08-10T05:00:00.000Z"');
  });

  test("uses the public changelog badge tones and container-based mobile rhythm", () => {
    const badge = renderToStaticMarkup(
      <CooeeChangelogCategoryBadge category="improvement">
        Improvement
      </CooeeChangelogCategoryBadge>,
    );

    expect(badge).toContain("cooee-changelog-badge--improvement");
    expect(cooeeChangelogStyles).toContain("container-type: inline-size");
    expect(cooeeChangelogStyles).toContain(
      "@container cooee-changelog-card (max-width: 480px)",
    );
    expect(cooeeChangelogStyles).toContain("@media (max-width: 640px)");
    expect(cooeeChangelogStyles).toContain("padding: 20px");
  });

  test("renders every public changelog display type through one component set", () => {
    const post = renderToStaticMarkup(
      <CooeeChangelogEntry
        categoryLabel="Feature"
        displayType="post"
        entry={{
          category: "feature",
          imageUrl: "/feature.webp",
          summary: "A full-sized feature.",
          title: "Feature launch",
        }}
      />,
    );
    const article = renderToStaticMarkup(
      <CooeeChangelogEntry
        action={<a href="/article">Read more</a>}
        categoryLabel="Article"
        displayType="article"
        entry={{
          category: "article",
          summary: "A long-form story.",
          title: "Article launch",
        }}
      />,
    );
    const callout = renderToStaticMarkup(
      <CooeeChangelogEntry
        categoryLabel="Improvement"
        displayType="callout"
        entry={{
          category: "improvement",
          summary: "A compact refinement.",
          title: "Faster filters",
        }}
      />,
    );
    const text = renderToStaticMarkup(
      <CooeeChangelogEntry
        categoryLabel="Fix"
        displayType="text"
        entry={{
          category: "fix",
          summary: "The underlying fix detail.",
          title: "Fixed session recovery",
        }}
      />,
    );

    expect(post).toContain('data-display-type="post"');
    expect(post).toContain("cooee-changelog-card");
    expect(article).toContain('data-display-type="article"');
    expect(article).toContain("Read more");
    expect(callout).toContain('data-display-type="callout"');
    expect(callout).toContain("cooee-changelog-callout");
    expect(callout).toContain('aria-label="Expand callout text"');
    expect(text).toContain('data-display-type="text"');
    expect(text).toContain("<details");
    expect(text).toContain("cooee-changelog-text");
    expect(cooeeChangelogStyles).toContain(".cooee-changelog-callout");
    expect(cooeeChangelogStyles).toContain(".cooee-changelog-text");
  });
});
