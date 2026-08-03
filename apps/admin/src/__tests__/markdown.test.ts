import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../markdown";

describe("web markdown rendering", () => {
  test("renders inline code and fenced code blocks with stable hooks", () => {
    const html = renderMarkdown(
      "Use `repository.fullName`.\n\n```ts\nconst visible = count < 10;\n```",
    );

    expect(html).toContain(
      '<code data-code="inline">repository.fullName</code>',
    );
    expect(html).toContain(
      '<pre data-code-block data-language="ts"><code data-code="block" class="language-ts">const visible = count &lt; 10;</code></pre>',
    );
  });

  test("renders safe images and GFM tables for articles", () => {
    const html = renderMarkdown(
      "![Release notes](https://images.example.test/release.png)\n\n| Plan | Includes |\n| --- | --- |\n| Pro | Articles |",
    );

    expect(html).toContain(
      '<img src="https://images.example.test/release.png" alt="Release notes" loading="lazy" />',
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Plan</th>");
    expect(html).toContain("<td>Articles</td>");
  });
});
