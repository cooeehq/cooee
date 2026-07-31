import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicChangelogPage } from "../App";
import { AnimatedCooeeLogo } from "../components/animated-cooee-logo";

describe("AnimatedCooeeLogo", () => {
  test("only uses the resting logo area for pointer-triggered animation", () => {
    const html = renderToStaticMarkup(<AnimatedCooeeLogo />);
    const source = readFileSync(
      new URL("../components/animated-cooee-logo.tsx", import.meta.url),
      "utf8",
    );

    expect(html).not.toContain(".home-logo-link:hover");
    expect(html).not.toContain(".animated-cooee-logo:hover");
    expect(html).toContain(
      ".home-logo-link:focus-visible .animated-cooee-logo .logo-tail",
    );
    expect(html).toContain("pointer-events: none");
    expect(html).toContain("pointer-events:all");
    expect(source).toContain("onPointerEnter={() => setIsAnimating(true)}");
    expect(html).not.toContain("prefers-reduced-motion: no-preference");
  });

  test("limits the public footer hover target to the resting logo", () => {
    const html = renderToStaticMarkup(
      <PublicChangelogPage
        appName="Acme"
        embedded
        entries={[]}
        logoDataUrl={null}
        publicAppUrl=""
        visibleRepositories={[]}
      />,
    );
    const footer = html.match(/<footer[\s\S]*?<\/footer>/)?.[0];
    const footerLink = footer?.match(
      /<a[^>]*href="https:\/\/cooee\.sh"[^>]*>/,
    )?.[0];

    expect(footerLink).toBeDefined();
    expect(footerLink).not.toContain("home-logo-link");
    expect(footer).toContain('width="1070" height="240"');
  });

  test("uses the same resting-state hit target in the static logo asset", () => {
    const svg = readFileSync(
      new URL("../../public/cooee-logo.svg", import.meta.url),
      "utf8",
    );

    expect(svg).toContain("pointer-events: none");
    expect(svg).not.toContain(".home-logo-link:hover");
    expect(svg).toContain('svg[data-play-on-mount="true"] .logo-tail');
    expect(svg).toContain(
      '<rect class="logo-hit-area" x="0" y="0" width="1070" height="240" fill="none" style="pointer-events:all;"/>',
    );
  });
});
