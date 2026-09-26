# Coding-agent PR labels

If this repository is not connected to Cooee yet, start the hosted setup first:

```bash
npx cooee-changelog
```

It first asks for the schedule, writing style, privacy labels, and backfill in
the terminal, then uses a short browser pairing step for Cooee sign-in and any
required GitHub App permission. After approval, it applies those choices
automatically and offers to install this skill. It then asks whether to add a
managed Cooee instruction block to the current repository's `AGENTS.md`, when
the checkout matches the connected repository. It never reads your GitHub CLI
credentials, and it changes `AGENTS.md` only after confirmation without
committing or pushing it.

The Cooee PR Labels skill helps Codex, Claude, and other skill-compatible
coding agents classify a pull request before it merges. It reads the PR connected
to the task through the authenticated GitHub CLI, recommends one Cooee label,
and always asks for confirmation before changing GitHub. It can replace a wrong
Cooee label after confirmation while preserving every unrelated label.

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

The skill recommends one of Cooee’s default category overrides:
`cooee:feature`, `cooee:improvement`, `cooee:fix`, or `cooee:maintenance`.
Cooee reads the confirmed label from the merged PR and uses it as the changelog
category.

`cooee:feature` is reserved for a genuinely new capability or a significant
expansion of existing functionality. Incremental additions and refinements to
existing workflows belong under `cooee:improvement`. Work that restores expected
or correct behaviour is `cooee:fix`, even when it also refactors or improves the
implementation. Changes with no useful public customer outcome should normally
be `cooee:skip`, not Improvement.

The default privacy labels are `cooee:skip` and `cooee:internal`. The skill asks
before applying any label so the developer confirms both the category and whether
Cooee should exclude the PR. `cooee:private` is supported only if it has been added under Cooee’s Privacy
labels settings; otherwise use `cooee:skip`. `cooee:bugfix` is not a default
category label—use `cooee:fix`.

For custom categories, have the agent apply the configured category ID, for
example `cooee:release-note`. It will create a missing GitHub label when it has
permission. It replaces an existing Cooee label only after the developer
confirms the exact old and new labels, and it preserves unrelated labels.
