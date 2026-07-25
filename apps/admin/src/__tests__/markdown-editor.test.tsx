import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MarkdownEditor,
  shouldReplaceEditorContent,
} from "../components/markdown-editor";

describe("MarkdownEditor", () => {
  test("renders TipTap formatting controls for markdown-backed summaries", () => {
    const html = renderToStaticMarkup(
      <MarkdownEditor
        ariaLabel="Public summary"
        markdown="Customers can **save filters**."
        onChange={() => undefined}
      />,
    );

    expect(html).toContain("data-markdown-editor");
    expect(html).toContain("Bold");
    expect(html).toContain("Italic");
    expect(html).toContain("Bullet list");
    expect(html).toContain("Inline code");
    expect(html).toContain("Code block");
    expect(html).toContain("Link");
    expect(html).not.toContain("<textarea");
  });

  test("does not replace editor content when markdown round-trips to the same document", () => {
    expect(
      shouldReplaceEditorContent(
        "<p>Customers can save filters.</p>",
        "Customers can save filters.",
      ),
    ).toBe(false);
  });
});
