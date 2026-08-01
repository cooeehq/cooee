# Cooee changelog CLI

Run `npx cooee-changelog` inside a GitHub repository to connect it to hosted
Cooee. It first asks for the schedule, writing style, privacy labels, backfill,
and image preference directly in the terminal, then pairs with your signed-in
Cooee account in a browser. Once GitHub is approved, the command applies the
choices automatically.

GitHub sign-in and GitHub App repository permissions remain browser-only. The
CLI never reads GitHub credentials, source code, or diffs. When your Cooee
account already has access to the repository, the browser confirms it and the
terminal continues automatically.

Use `--repo owner/repository` when the current directory does not have a
GitHub `origin` remote. Self-hosted Cooee installations continue to use the
[Railway setup guide](https://github.com/cooeehq/cooee/blob/main/docs/self-hosting.md).

After the setup is complete, the CLI offers to install Cooee's optional PR
Labels skill for Codex, Claude, and other compatible coding agents. The skill
uses the developer's GitHub CLI access to add labels; the Cooee GitHub App stays
read-only.
