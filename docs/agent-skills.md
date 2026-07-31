# Coding-agent PR labels

The Cooee PR Labels skill helps Codex, Claude, and other skill-compatible
coding agents classify a pull request before it merges. It reads the active PR
through the authenticated GitHub CLI, preserves its labels, and adds the Cooee
category label when the customer impact is clear. For private, sensitive, or
ambiguous work, it asks for confirmation instead of guessing.

Install it globally from GitHub:

```bash
npx skills add cooeehq/cooee --skill cooee-pr-labels -g
```

The Skills CLI will offer the installed coding agents, so select Codex and/or
Claude when prompted.

Then tell an agent:

```text
Use $cooee-pr-labels to classify the active PR.
```

The skill uses `gh`, so each developer needs GitHub CLI access to the target
repository:

```bash
gh auth login
```

For obvious customer-facing work, the skill adds one of Cooee’s default
category overrides: `cooee:feature`, `cooee:improvement`, `cooee:fix`, or
`cooee:maintenance`. Cooee reads that label from the merged PR and uses it as
the changelog category.

The default privacy labels are `cooee:skip` and `cooee:internal`. The skill asks
before applying either so the developer decides whether Cooee should exclude the
PR. `cooee:private` is supported only if it has been added under Cooee’s Privacy
labels settings; otherwise use `cooee:skip`. `cooee:bugfix` is not a default
category label—use `cooee:fix`.

For custom categories, have the agent apply the configured category ID, for
example `cooee:release-note`. It will create a missing GitHub label when it has
permission, but it never removes or replaces labels.
