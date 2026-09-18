import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../markdown";

describe("embed markdown rendering", () => {
  test("renders markdown formatting and safe external links", () => {
    const html = renderMarkdown(
      "Customers can **save filters** and open [reports](https://example.com/reports).",
    );

    expect(html).toContain("<strong>save filters</strong>");
    expect(html).toContain(
      '<a href="https://example.com/reports" rel="nofollow noreferrer" target="_blank">reports</a>',
    );
  });

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
});
