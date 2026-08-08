# Issue tracker: GitHub

Issues and specs for this repo live in the public GitHub repository `mailwmj/opencanvas`.
Use the `gh` CLI with `--repo mailwmj/opencanvas` for all operations. This checkout also
has an `upstream` remote, so do not rely on automatic remote inference.

## Conventions

- **Create an issue**: `gh issue create --repo mailwmj/opencanvas --title "..." --body "..."`
- **Read an issue**: `gh issue view <number> --repo mailwmj/opencanvas --comments`
- **List issues**: `gh issue list --repo mailwmj/opencanvas --state open`
- **Comment on an issue**: `gh issue comment <number> --repo mailwmj/opencanvas --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --repo mailwmj/opencanvas --add-label "..."` / `--remove-label "..."`
- **Close an issue**: `gh issue close <number> --repo mailwmj/opencanvas --comment "..."`

## Pull requests as a triage surface

PRs are not a triage request surface for this repo.

## Wayfinding operations

When a wayfinding flow is used, create the map and child issues in `mailwmj/opencanvas`.
Use GitHub's native issue dependencies when available; otherwise record `Blocked by: #<n>`
at the top of each child issue.
