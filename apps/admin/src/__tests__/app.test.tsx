import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  App,
  PublicChangelogPage,
  getAdminDocumentTitle,
  isCliSetupPath,
  getNextScheduledRunLabel,
  getLocalPublicChangelogUrl,
  getHostedPublicChangelogUrl,
  getApiUnavailableMessage,
  getPublicChangelogResourceUrls,
  getSurfaceFromPathname,
  hasMeaningfulCalloutOverflow,
  shouldShowAdminSessionLoadingPage,
} from "../App";

describe("Cooee admin app", () => {
  test("routes only admin and public changelog surfaces", () => {
    expect(getSurfaceFromPathname("/login")).toBe("login");
    expect(getSurfaceFromPathname("/changelog")).toBe("app");
    expect(getSurfaceFromPathname("/changelog/settings")).toBe("app");
    expect(getSurfaceFromPathname("/app/settings")).toBe("app");
    expect(getSurfaceFromPathname("/app/setup")).toBe("app");
    expect(isCliSetupPath("/app/setup/")).toBe(true);
    expect(getSurfaceFromPathname("/changelog/acme")).toBe("publicChangelog");
    expect(getSurfaceFromPathname("/changelog/acme/articles/launch-notes")).toBe(
      "publicChangelog",
    );
    expect(getSurfaceFromPathname("/application")).toBe("notFound");
    expect(getSurfaceFromPathname("/docs")).toBe("notFound");
    expect(getSurfaceFromPathname("/privacy")).toBe("notFound");
  });

  test("renders the self-hosted sign-in surface without marketing navigation", () => {
    const html = renderToStaticMarkup(
      <App deploymentMode="admin" initialSurface="login" />,
    );

    expect(html).toContain("Sign in");
    expect(html).toContain("Continue with GitHub");
    expect(html).toContain("/cooee-login-galah.webp");
    expect(html).toContain("Don&#x27;t let your changelog go walkabout.");
    expect(html).toContain("h-[100svh]");
    expect(html).toContain("min-h-0 flex-1");
    expect(html.indexOf('aria-label="Cooee illustration"')).toBeLessThan(
      html.indexOf('aria-label="Sign-in support"'),
    );
    expect(html).not.toContain("Pricing");
    expect(html).not.toContain("How it works");
  });

  test("renders the authenticated operator dashboard", () => {
    const html = renderToStaticMarkup(
      <App
        deploymentMode="admin"
        initialAuthUser={{ name: "Rod ONeill", email: "rod@example.com" }}
        initialIsSignedIn
        initialSurface="app"
        showOnboarding={false}
      />,
    );

    expect(html).toContain("Changelog");
    expect(html).toContain("Repositories");
    expect(html).toContain("Held for review");
    expect(html).toContain("Rod ONeill");
    expect(html).toContain("Posts per page");
    expect(html).toContain('aria-label="Posts per page"');
    expect(html).toContain('aria-label="Loading held-review count"');
  });

  test("renders per-changelog branded image settings with responsive pattern choices", () => {
    const html = renderToStaticMarkup(
      <App
        deploymentMode="admin"
        initialAuthUser={{ name: "Rod ONeill", email: "rod@example.com" }}
        initialIsSignedIn
        initialSurface="app"
        initialView="settings"
        showOnboarding={false}
      />,
    );

    expect(html).toContain('href="#settings-images"');
    expect(html).toContain("Brand card");
    expect(html).toContain("Reference style");
    expect(html).toContain("Illustration");
    expect(html).toContain("Space");
    expect(html).toContain("Sky");
    expect(html).toContain("Cyberpunk");
    expect(html).toContain("Server room");
    expect(html).toContain("Road");
    expect(html).toContain("Soft gradient");
    expect(html).toContain("Mesh gradient");
    expect(html).toContain("Soft blobs");
    expect(html).toContain("Solid brand colour");
    expect(html).toContain("sm:grid-cols-2");
    expect(html).toContain("Accent colour");
    expect(html).toContain("Title overlay");
    expect(html).toContain("Show the post title on generated images");
  });

  test("uses a loading state instead of the sign-in page while checking an admin session", () => {
    expect(
      shouldShowAdminSessionLoadingPage({
        authSessionStatus: "loading",
        deploymentMode: "admin",
        surface: "app",
      }),
    ).toBe(true);
    expect(
      shouldShowAdminSessionLoadingPage({
        authSessionStatus: "loading",
        deploymentMode: "admin",
        surface: "login",
      }),
    ).toBe(false);
    expect(
      shouldShowAdminSessionLoadingPage({
        authSessionStatus: "ready",
        deploymentMode: "admin",
        surface: "app",
      }),
    ).toBe(false);
  });

  test("titles each admin section", () => {
    expect(
      getAdminDocumentTitle({ appName: "Partbot", view: "dashboard" }),
    ).toBe("Changelog · Partbot | Cooee");
    expect(
      getAdminDocumentTitle({ appName: "Partbot", view: "repositories" }),
    ).toBe("Repositories | Cooee");
    expect(getAdminDocumentTitle({ appName: "Cooee", view: "dashboard" })).toBe(
      "Changelog | Cooee",
    );
  });

  test("labels timed and merge-triggered automatic runs", () => {
    expect(
      getNextScheduledRunLabel({
        now: new Date("2026-06-03T00:30:00.000Z"),
        settings: {
          publishTime: "09:00",
          scheduleFrequency: "weekly",
          scheduleWeekday: 3,
          timeZone: "Australia/Brisbane",
        },
      }),
    ).toBe("Wed, 10 Jun at 9:00 am");

    expect(
      getNextScheduledRunLabel({
        now: new Date("2026-06-03T00:30:00.000Z"),
        settings: {
          publishTime: "09:00",
          scheduleFrequency: "on-merge",
          timeZone: "Australia/Brisbane",
        },
      }),
    ).toBe("On the next PR merge");
  });

  test("uses the theme-specific logo with a fallback to the default", () => {
    const commonProps = {
      appName: "Acme",
      embedded: true,
      entries: [],
      lightLogoDataUrl: "https://assets.test/acme-light.svg",
      logoDataUrl: "https://assets.test/acme-default.svg",
      publicAppUrl: "",
      publicResourceUrls: getPublicChangelogResourceUrls("acme"),
      visibleRepositories: [],
    };
    const lightHtml = renderToStaticMarkup(
      <PublicChangelogPage {...commonProps} publicTheme="light" />,
    );
    const darkHtml = renderToStaticMarkup(
      <PublicChangelogPage {...commonProps} publicTheme="dark" />,
    );

    expect(lightHtml).toContain('src="https://assets.test/acme-light.svg"');
    expect(lightHtml).not.toContain(
      'src="https://assets.test/acme-default.svg"',
    );
    expect(darkHtml).toContain('src="https://assets.test/acme-default.svg"');
    expect(darkHtml).not.toContain('src="https://assets.test/acme-light.svg"');
    expect(lightHtml).toContain('aria-label="Changelog feeds"');
  });

  test("shows an explicit load-more control before the public branding", () => {
    const html = renderToStaticMarkup(
      <PublicChangelogPage
        appName="Acme"
        embedded
        entries={[]}
        hasMoreEntries
        logoDataUrl={null}
        onLoadMoreEntries={() => {}}
        publicAppUrl=""
        visibleRepositories={[]}
      />,
    );

    expect(html).toContain("Load more...");
    expect(html).toContain("data-public-load-more-control");
    expect(html).not.toContain("data-public-load-more-sentinel");
    expect(html).toContain("border-border pt-6 mt-5");
    expect(html.indexOf("Load more...")).toBeLessThan(
      html.indexOf("Powered by"),
    );
  });

  test("only expands callouts for meaningful visible overflow", () => {
    expect(hasMeaningfulCalloutOverflow(124, 120, 24)).toBe(false);
    expect(hasMeaningfulCalloutOverflow(132.1, 120, 24)).toBe(true);
    expect(hasMeaningfulCalloutOverflow(129, 120, Number.NaN)).toBe(true);
  });

  test("links article-style updates to their public article URL", () => {
    const html = renderToStaticMarkup(
      <PublicChangelogPage
        appName="Acme"
        embedded
        entries={[
          {
            id: "article_1",
            title: "Launch notes",
            summary: "A closer look at the launch.",
            articleSlug: "launch-notes",
            articleMarkdown: "# The full story",
            category: "feature",
            publishedAt: "2026-08-01T00:00:00.000Z",
            time: "Today",
          },
        ]}
        logoDataUrl={null}
        publicAppUrl=""
        publicChangelogSlug="acme"
        visibleRepositories={[]}
      />,
    );

    expect(html).toContain("Read more");
    expect(html).toContain("/changelog/acme/articles/launch-notes");
    expect(html).toContain('data-display-type="article"');
    expect(html).not.toContain("view-transition-name");
  });

  test("builds changelog resource URLs for hosted and custom domains", () => {
    expect(getPublicChangelogResourceUrls("acme app")).toEqual({
      api: "/api/public/openapi.json",
      json: "/api/public/changelogs/acme%20app/feed.json",
      rss: "/api/public/changelogs/acme%20app/feed.xml",
    });
    expect(getPublicChangelogResourceUrls(null)).toEqual({
      api: "/api/public/openapi.json",
      json: "/api/public/changelog/feed.json",
      rss: "/api/public/changelog/feed.xml",
    });
  });

  test("uses the app host for hosted public changelogs", () => {
    expect(getHostedPublicChangelogUrl()).toBe("https://app.cooee.sh");
  });

  test("explains when the Cooee API cannot be reached", () => {
    expect(getApiUnavailableMessage(true)).toBe(
      "Cooee’s local API isn’t running. Start it with bun run dev, then refresh this page.",
    );
    expect(getApiUnavailableMessage(false)).toBe(
      "Cooee couldn’t reach its API. Refresh the page and try again.",
    );
  });

  test("keeps the View changelog destination on the local app in development", () => {
    expect(
      getLocalPublicChangelogUrl(
        "/changelog/cooee",
        { hostname: "localhost", origin: "http://localhost:5173" },
        true,
      ),
    ).toBe("http://localhost:5173/changelog/cooee");
    expect(
      getLocalPublicChangelogUrl(
        "/changelog/cooee",
        { hostname: "app.cooee.sh", origin: "https://app.cooee.sh" },
        false,
      ),
    ).toBeNull();
  });
});
