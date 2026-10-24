# beUI (vendored)

Copied from https://github.com/starc007/ui-components (MIT, see LICENSE) in October 2026. The upstream commit was not recorded at vendoring time; diff against upstream `main` of that month when re-syncing.

Only the import closure used by the built-in Agent panel is kept. Removed upstream modules: `agents/agent-code` (and its `shiki` dependency), `agents/tool-result`, `agents/citations`, `motion/preview-rail`, `motion/text-scramble`, `motion/magnetic`, `motion/button/{magnetic,metallic}`, and helpers only they used.

## Local patches

React 18 / Tailwind v3 compatibility:

- `inert`: React 18 has no boolean `inert` prop; components spread `inertProps()` from `lib/utils.ts`.
- Read-only refs: callback refs assign through `(ref as { current: T | null }).current` instead of mutating a `RefObject` typed as read-only.
- `Array.prototype.at()` replaced with index access for the WebView targets Lumina supports.
- Tailwind v4 utilities missing in v3: `scrollbar-hide` is defined in `src/index.css`; shadcn-style color tokens (`background`, `foreground`, `muted`, `primary`, …) are mapped onto Lumina's neutral palette in `tailwind.config.js`.

Lumina-specific trims:

- `StreamingResponse` keeps only the content wrapper (no copy/retry/feedback/sources bar).
- `MessageScroller` drops the `navigation="rail"` mode; `label` is required.
- `ReasoningText` drops the `scramble` variant; `phrases` is required.
- User-facing strings are props so callers pass i18n text: `ApprovalCard.labels`, `PromptInput.labels`, `ImageGeneration.retryLabel`, plus the existing `placeholder` / `submitLabel` / `activeLabel` / `summary` / `moreLabel` / `lessLabel` props.
