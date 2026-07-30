import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  App,
  PublicChangelogPage,
  getAdminDocumentTitle,
  getNextScheduledRunLabel,
  getPublicChangelogResourceUrls,
  getSurfaceFromPathname,
  shouldShowAdminSessionLoadingPage,
} from "../App";

describe("Cooee admin app", () => {
  test("routes only admin and public changelog surfaces", () => {
    expect(getSurfaceFromPathname("/login")).toBe("login");
    expect(getSurfaceFromPathname("/changelog")).toBe("app");
    expect(getSurfaceFromPathname("/changelog/settings")).toBe("app");
    expect(getSurfaceFromPathname("/app/settings")).toBe("app");
    expect(getSurfaceFromPathname("/changelog/acme")).toBe("publicChangelog");
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
    expect(html.indexOf("Load more...")).toBeLessThan(
      html.indexOf("Powered by"),
    );
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
});
