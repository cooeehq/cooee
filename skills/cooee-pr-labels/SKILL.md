---
name: cooee-pr-labels
description: Classify the active GitHub pull request for Cooee before it is merged. Use when creating, updating, reviewing, or preparing a PR in a repository whose merged PRs feed a Cooee changelog; inspect existing labels, add the clear Cooee category label with GitHub CLI, and ask the user to confirm or clarify privacy-sensitive or ambiguous work.
---

# Cooee PR Labels

Keep Cooee’s changelog classification accurate without asking the user to
remember labels. Use the authenticated GitHub CLI; no Cooee API token is
needed.

## Workflow

1. When work is likely to result in a PR, inspect the active PR as soon as one
   exists:

   ```bash
   bash scripts/cooee-pr-label.sh status
   ```

   Run the command from this skill directory. If no PR exists yet, do not create
   one just to label it; classify once the agent creates or is given the PR.

2. Read the implemented change, the PR title/body, and current labels. Preserve
   every existing label. If an existing `cooee:<category>` label is present,
   leave it unchanged. If more than one Cooee category is present, ask the user
   which one should win rather than choosing.

3. Classify a clear customer-facing change and apply the label immediately:

   | Change                                                            | Label               |
   | ----------------------------------------------------------------- | ------------------- |
   | New user capability                                               | `cooee:feature`     |
   | Better existing customer workflow, quality, speed, or reliability | `cooee:improvement` |
   | Fixes a customer-visible regression or incorrect behaviour        | `cooee:fix`         |
   | Customer-relevant upkeep with no feature or regression fix        | `cooee:maintenance` |

   ```bash
   bash scripts/cooee-pr-label.sh apply cooee:fix
   ```

   State what was applied and the one-sentence reason. The helper creates the
   GitHub label if it is missing, then adds it without replacing any labels.

4. Ask before applying a privacy or skip label. Ask a direct question when the
   work is internal-only, security-sensitive, involves credentials, customer or
   partner data, an unreleased initiative, or has no clear customer outcome:

   > This PR may not belong in the public changelog. Should I add
   > `cooee:skip` so Cooee excludes it?

   After confirmation, apply `cooee:skip`. Use `cooee:internal` only when that
   is the repository’s established convention. `cooee:private` works only if
   the Cooee workspace has explicitly added it under Privacy labels; otherwise
   use the default `cooee:skip`.

5. Ask for a category when more than one category is plausible, the customer
   impact is unknown, or a configured custom category may apply. Do not invent a
   custom label. Once the user answers, apply that exact `cooee:<category-id>`
   label.

## Guardrails

- Use `cooee:fix`, not `cooee:bugfix`: category overrides must match a Cooee
  category ID. The default IDs are `feature`, `improvement`, `fix`, and
  `maintenance`.
- Never apply a category label to a PR marked `cooee:skip`, `cooee:internal`, or
  a configured privacy label without the user explicitly deciding it should be
  publishable.
- Never remove, replace, or bulk-set labels. The helper only adds one label.
- If `gh` is unavailable, unauthenticated, cannot find a PR, or lacks write
  permission, explain the blocker and give the exact label to add. Do not claim
  that Cooee was updated.
- Tell the user that the label affects Cooee only after GitHub receives it; Cooee
  uses the labels captured for the merged PR.

## Helper commands

```bash
# Inspect the PR for the current branch, or pass a number/URL explicitly.
bash scripts/cooee-pr-label.sh status [PR]

# Add exactly one Cooee label, preserving every existing label.
bash scripts/cooee-pr-label.sh apply cooee:improvement [PR]
```
