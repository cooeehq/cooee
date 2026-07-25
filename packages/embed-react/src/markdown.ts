import { marked, Renderer } from "marked";

const renderer = new Renderer();

renderer.html = ({ text }) => escapeHtml(text);
renderer.code = ({ text, lang }) => {
  const language = normalizeCodeLanguage(lang);
  const languageAttribute = language
    ? ` data-language="${escapeAttribute(language)}"`
    : "";
  const classAttribute = language
    ? ` class="language-${escapeAttribute(language)}"`
    : "";

  return `<pre data-code-block${languageAttribute}><code data-code="block"${classAttribute}>${escapeHtml(text)}</code></pre>`;
};
renderer.codespan = ({ text }) =>
  `<code data-code="inline">${escapeHtml(text)}</code>`;
renderer.image = ({ text }) => escapeHtml(text);
renderer.link = ({ href, title, tokens }) => {
  const label = renderer.parser.parseInline(tokens);
  const safeHref = normalizeSafeHref(href);

  if (!safeHref) {
    return label;
  }

  const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
  return `<a href="${escapeAttribute(safeHref)}"${titleAttribute} rel="nofollow noreferrer" target="_blank">${label}</a>`;
};

export function renderMarkdown(markdown: string): string {
  return marked(markdown, {
    async: false,
    breaks: true,
    gfm: true,
    renderer,
  });
}

function normalizeSafeHref(href: string): string | null {
  try {
    const url = new URL(href, "https://cooee.local");

    if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
      return null;
    }

    return href;
  } catch {
    return null;
  }
}

function normalizeCodeLanguage(lang: string | undefined): string | null {
  const value = lang?.trim().split(/\s+/)[0] ?? "";

  if (!value || !/^[A-Za-z0-9_+-]+$/.test(value)) {
    return null;
  }

  return value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
