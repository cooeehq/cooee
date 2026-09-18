# @cooeehq/react

Drop-in React component for [Cooee](https://cooee.sh) changelogs. Renders a
"Latest updates" button with an unread count and a popup listing the most
recent entries from your public feed.

## Install

```bash
npm install @cooeehq/react
```

The package is ESM-only. React 18 or 19 is required as a peer dependency.

## Usage

```tsx
import { CooeeUpdates } from "@cooeehq/react";

export function Updates() {
  return (
    <CooeeUpdates
      feedUrl="https://api.cooee.sh/api/public/changelogs/acme/feed.json"
      maxItems={5}
      theme="system"
    />
  );
}
```

### Use your own trigger

Add `data-cooee-updates-trigger` to any element and render `CooeeUpdates`
anywhere on the same page. The popup is portalled to the document body and
anchored to that element, automatically flipping and shifting to stay inside
the viewport. Its starting edge stays aligned with the trigger whenever space
allows.

```tsx
export function AppHeader() {
  return (
    <>
      <button data-cooee-updates-trigger>What’s new</button>

      <CooeeUpdates feedUrl="https://api.cooee.sh/api/public/changelogs/acme/feed.json" />
    </>
  );
}
```

Non-interactive elements receive button semantics and keyboard handling while
the component is mounted. The trigger also receives
`data-cooee-unread-count="…"` and `data-cooee-has-unread` so you can render an
indicator with your own CSS. Use `triggerSelector` when you need a different
selector, or pass `null` to always use Cooee’s built-in button.

The feed must be publicly reachable from the browser and allow requests from
the site where the component is rendered.

## Props

| Prop              | Type                                | Default                        | Description                                           |
| ----------------- | ----------------------------------- | ------------------------------ | ----------------------------------------------------- |
| `feedUrl`         | `string`                            | required                       | URL of the public Cooee JSON feed                     |
| `theme`           | `light \| dark \| system \| shadcn` | `system`                       | Standalone colour mode or host shadcn semantic tokens |
| `maxItems`        | `number`                            | `5`                            | Entries to show, clamped between 0 and 100            |
| `buttonLabel`     | `string`                            | `"Latest updates"`             | Visible label for the trigger                         |
| `className`       | `string`                            | —                              | Extra class on the component root                     |
| `triggerSelector` | `string \| null`                    | `[data-cooee-updates-trigger]` | Selector for an existing popup trigger                |
| `appearance`      | `CooeeUpdatesAppearance`            | defaults                       | Optional accent colours and corner radius             |
| `labels`          | `Partial<CooeeUpdatesLabels>`       | English defaults               | Localized status and control labels                   |
| `styleNonce`      | `string`                            | —                              | CSP nonce for the component style block               |

Unread state is tracked per feed URL in `localStorage`; opening the popup
marks everything as seen. When the feed includes post images, the component
loads them lazily and resolves legacy relative URLs against the feed origin. A
footer link opens the complete public changelog in a new tab, alongside the
permanent Cooee attribution. Entries include their publication date and use the
same category badge palette as the public changelog.

Article entries include a **Read more** action. It loads the published article
from the public API and expands the popup into a viewport-bounded, scrollable
reader. The sticky header keeps both the back and close controls available.

### Shared changelog presentation

`CooeeChangelogCard`, `CooeeChangelogCategoryBadge`, and
`CooeeChangelogEntryMeta` are the presentation primitives used by the popup.
Hosted changelog views can reuse them to keep card spacing, image treatment,
typography, dates, and badge tones in sync. Render `CooeeChangelogStyles` once
near the shared view; its container query automatically switches cards from
the roomy desktop spacing to the mobile spacing based on the card width.

```tsx
import {
  CooeeChangelogCard,
  CooeeChangelogCategoryBadge,
  CooeeChangelogEntryMeta,
  CooeeChangelogStyles,
} from "@cooeehq/react";

export function ChangelogCard() {
  return (
    <>
      <CooeeChangelogStyles />
      <CooeeChangelogCard
        imageUrl="/launch.webp"
        summaryHtml="<p>The release is ready.</p>"
        title="A major launch"
      >
        <CooeeChangelogEntryMeta dateLabel="10 Aug 2026">
          <CooeeChangelogCategoryBadge category="feature">
            Feature
          </CooeeChangelogCategoryBadge>
        </CooeeChangelogEntryMeta>
      </CooeeChangelogCard>
    </>
  );
}
```

### Appearance

Use the top-level `theme` prop to force light or dark mode, follow the operating
system, or inherit a shadcn/Tailwind design system:

```tsx
<CooeeUpdates feedUrl={feedUrl} theme="light" />
<CooeeUpdates feedUrl={feedUrl} theme="dark" />
<CooeeUpdates feedUrl={feedUrl} theme="system" />
```

For shadcn/ui projects, `theme="shadcn"` reads the existing semantic variables
for popovers, text, primary actions, muted content, borders, focus rings, fonts,
and radius. It follows whatever light/dark mechanism already updates those
variables, including Tailwind’s `.dark` class or a theme data attribute. No
Tailwind content configuration or package-specific CSS import is required.

```tsx
<CooeeUpdates feedUrl={feedUrl} theme="shadcn" />
```

Modern Tailwind v4 `--color-*` aliases and classic shadcn HSL variables are both
supported. Custom appearance values still take precedence over theme tokens.

```tsx
<CooeeUpdates
  feedUrl="https://api.cooee.sh/api/public/changelogs/acme/feed.json"
  theme="dark"
  appearance={{
    accentColor: "#155e75",
    accentTextColor: "#ffffff",
    cornerRadius: 12,
  }}
/>
```

When supplying accent colours, choose a foreground/background pair with at
least 4.5:1 contrast. The component otherwise uses accessible light and dark
defaults.

For a strict Content Security Policy, pass the nonce from your response's
`style-src 'nonce-…'` directive through `styleNonce`. Cooee does not require
`unsafe-inline` style permission when a valid nonce is supplied.

### Localized labels

Override only the strings you need. Count-aware labels are functions so they
can follow the plural rules for your locale.

```tsx
<CooeeUpdates
  feedUrl="https://api.cooee.sh/api/public/changelogs/acme/feed.json"
  buttonLabel="Nouveautés"
  labels={{
    articleLoadError: "Impossible de charger cet article.",
    articleLoading: "Chargement de l’article…",
    backToChangelog: "Retour au journal",
    changelog: "Journal des modifications",
    close: "Fermer les nouveautés",
    loading: "Chargement…",
    retry: "Réessayer",
    readMore: "Lire la suite",
    empty: "Aucune nouveauté.",
  }}
/>
```

## Behaviour and accessibility

- Every instance has unique disclosure, panel, and heading IDs.
- Opening moves focus to the close control. Escape and the close control
  return focus to the trigger; clicking outside dismisses without stealing
  focus.
- Loading, errors, empty results, and loaded counts use screen-reader live
  regions. Errors include a retry action.
- Controls use comfortable 44px targets, the panel stays within small
  viewports, keeps its header visible while scrolling, and supports RTL text,
  200% zoom, forced colours, and
  reduced-motion preferences.
- Feed changes cancel stale requests. Invalid responses and unavailable
  `localStorage` fail gracefully.

## Development

This package lives in the [cooee monorepo](https://github.com/cooeehq/cooee)
under `packages/embed-react`.

```bash
bun install
bun run --cwd packages/embed-react lint
bun run --cwd packages/embed-react typecheck
bun test packages/embed-react
bun run --cwd packages/embed-react build
```

`build` produces an ESM bundle via Vite and type declarations via `tsc` in
`dist/`.

## Releasing

Bump `version` in `package.json`, then push a matching `react-v*` tag (e.g.
`react-v0.1.1`). The `publish-react` GitHub Actions workflow lints, tests,
builds, and publishes to npm.
