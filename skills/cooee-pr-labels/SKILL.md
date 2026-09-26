---
name: cooee-pr-labels
description: Classify every connected GitHub pull request for Cooee before it is merged. Use when creating, updating, reviewing, or preparing a PR in a repository whose merged PRs feed a Cooee changelog; inspect the connected PR, recommend one Cooee label, and get the user's confirmation before adding or replacing it.
---

# Cooee PR Labels

Keep Cooee’s changelog classification accurate without asking the user to
remember labels. Use the authenticated GitHub CLI; no Cooee API token is
needed.

## Workflow

1. Treat a PR attached or connected to the current task as the target PR. Inspect
   it as soon as it exists, even when the user did not explicitly ask about
   labels:

   ```bash
   bash scripts/cooee-pr-label.sh status <PR URL or number>
   ```

   Run the command from this skill directory. Always pass the connected PR URL
   when one is available, and keep using that exact URL for subsequent commands.
   This prevents a different PR for the current branch or checkout from being
   changed. If the task has no connected PR, resolve the PR for the current
   branch with `status` and use the returned URL thereafter. If no PR exists yet,
   do not create one just to label it; classify once the agent creates or is
   given the PR.

2. Read the implemented change, the PR title/body, and current labels. Judge the
   primary customer outcome, not the type of code changed or optimistic wording
   in the title. Existing Cooee labels are evidence, not a decision: verify them
   and recommend a replacement if one is wrong. Never leave multiple Cooee
   category labels on the PR.

3. Recommend exactly one label using this order of precedence:

   | Change                                                                           | Label               |
   | -------------------------------------------------------------------------------- | ------------------- |
   | Genuinely new user capability or significant expansion of existing functionality | `cooee:feature`     |
   | Corrects broken, regressed, or incorrect behaviour users reasonably expected     | `cooee:fix`         |
   | Deliberately makes an already-correct customer workflow or outcome better        | `cooee:improvement` |
   | Customer-relevant upkeep with no feature or regression fix                       | `cooee:maintenance` |

   Recommend `cooee:skip` instead when the change has no useful public customer
   outcome, is internal-only, or is sensitive. A fix remains `cooee:fix` even
   when its implementation also refactors or improves reliability. Use
   `cooee:improvement` only for an intentional enhancement beyond the correct
   baseline, not as a fallback for uncertainty.

4. Always ask the user to confirm before changing GitHub. Include the exact PR,
   current Cooee label (or "none"), recommended label, and a one-sentence reason:

   > PR #123 currently has `cooee:improvement`. This corrects behaviour that was
   > producing the wrong result, so I recommend `cooee:fix`. Should I replace it?

   Do not treat silence, a previous label, or a seemingly obvious classification
   as confirmation. Do not apply a label in the same response that first asks.

5. Be especially explicit about privacy or skip labels. Ask a direct question when the
   work is internal-only, security-sensitive, involves credentials, customer or
   partner data, an unreleased initiative, or has no clear customer outcome:

   > This PR may not belong in the public changelog. Should I add
   > `cooee:skip` so Cooee excludes it?

   After confirmation, apply `cooee:skip`. Use `cooee:internal` only when that
   is the repository’s established convention. `cooee:private` works only if
   the Cooee workspace has explicitly added it under Privacy labels; otherwise
   use the default `cooee:skip`.

6. After the user confirms, mutate the same connected PR and include the required
   confirmation flag:

   ```bash
   bash scripts/cooee-pr-label.sh apply --confirmed cooee:fix <PR URL>
   bash scripts/cooee-pr-label.sh replace --confirmed cooee:improvement cooee:fix <PR URL>
   ```

   `apply` preserves every existing label. Use `replace` only when the user has
   confirmed both the existing label and its replacement; it removes only the
   named old label. If more than one Cooee label is present, list all of them and
   ask the user which one should win before making any change. State what was
   applied and why.

7. Ask for a category when more than one category is plausible, the customer
   impact is unknown, or a configured custom category may apply. Do not invent a
   custom label. Once the user answers, apply that exact `cooee:<category-id>`
   label to the connected PR.

## Guardrails

- Use `cooee:fix`, not `cooee:bugfix`: category overrides must match a Cooee
  category ID. The default IDs are `feature`, `improvement`, `fix`, and
  `maintenance`.
- Never add, replace, or remove a Cooee label without explicit confirmation in
  the current conversation. The helper's `--confirmed` flag records that the
  confirmation happened; it does not replace asking.
- Reserve `cooee:feature` for new work or a significant addition that
  materially changes what users can do. Small options, controls, views, steps,
  UX refinements, and quality, speed, or reliability gains in existing logic
  are `cooee:improvement`. If the change restores expected behaviour, use
  `cooee:fix`, even if it also improves implementation quality.
- Never apply a category label to a PR marked `cooee:skip`, `cooee:internal`, or
  a configured privacy label without the user explicitly deciding it should be
  publishable.
- Never bulk-set labels. A confirmed replacement may remove only the specific
  old Cooee label named by the user and add the confirmed new one.
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
bash scripts/cooee-pr-label.sh apply --confirmed cooee:improvement <PR URL>

# Replace one incorrect Cooee label after the user confirms both labels.
bash scripts/cooee-pr-label.sh replace --confirmed cooee:improvement cooee:fix <PR URL>
```
