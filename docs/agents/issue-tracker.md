# Issue tracker: GitHub

Issues and specs for this repo live in the public GitHub repository `mailwmj/Lumina`.
Use the `gh` CLI with `--repo mailwmj/Lumina` for all operations. Do not rely on
automatic remote inference; this checkout may use a local mirror or renamed remote.

## Conventions

- **Create an issue**: `gh issue create --repo mailwmj/Lumina --title "..." --body "..."`
- **Read an issue**: `gh issue view <number> --repo mailwmj/Lumina --comments`
- **List issues**: `gh issue list --repo mailwmj/Lumina --state open`
- **Comment on an issue**: `gh issue comment <number> --repo mailwmj/Lumina --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --repo mailwmj/Lumina --add-label "..."` / `--remove-label "..."`
- **Close an issue**: `gh issue close <number> --repo mailwmj/Lumina --comment "..."`

## Pull requests as a triage surface

PRs are not a triage request surface for this repo.

## Wayfinding operations

When a wayfinding flow is used, create the map and child issues in `mailwmj/Lumina`.
Use GitHub's native issue dependencies when available; otherwise record `Blocked by: #<n>`
at the top of each child issue.
