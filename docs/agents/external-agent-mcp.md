# External Agent MCP

Lumina exposes the active canvas to Codex and other standard MCP clients through a bundled native
companion. Tauri owns the companion configuration and lifecycle; the live WebView remains the only
canvas state and mutation authority.

## Installed application

The macOS and Windows packages include `lumina-canvas-agent`. Lumina creates an owner-local config,
starts the companion with the app, stops it on exit, and does not display its bearer token.
End users do not install the repository, Node.js, Bun, or a separate MCP server package.

To connect Codex:

1. Open **Settings > External Agent** in Lumina.
2. Enable external Agent access and save.
3. Copy and run the displayed `codex mcp add lumina -- ...` command once in a terminal.
4. Start a new Codex task so it discovers the Lumina tool inventory.

The generated command contains the absolute executable and config paths for the current Lumina
installation. Moving the `.app` later requires running the newly displayed command again. Remove the
registration with `codex mcp remove lumina`.

## Process topology

```text
Codex or another MCP client
        | stdio MCP
bundled lumina-canvas-agent (mcp mode)
        | bearer-authenticated loopback HTTP
Lumina-managed lumina-canvas-agent (serve mode)
        | fetch-SSE + JSON
Lumina WebView
        |
live Zustand / React Flow canvas
```

## Tool workflow

1. Call `canvas_get_state` or `canvas_get_selection`.
2. Call `canvas_get_capabilities` before choosing node types, fields, or handles.
3. Submit `canvas_propose_changes` with the returned `projectId` and `revision`.
4. Poll `canvas_get_change_status` with the returned `proposalId` until it is `applied`, `stale`, or
   `failed`.

Despite the compatibility-preserving tool and response names, there is no approval queue. Lumina
revalidates the active project and revision, applies the complete change set immediately, and records
one history checkpoint. One canvas undo restores the entire batch. A concurrent canvas mutation makes
the request stale instead of partially applying it.

## CanvasChangeSet

P0 accepts only these operations:

- `create_node`: create a registry-approved manually configurable node using a temporary `clientId`.
- `update_node`: patch fields explicitly listed as writable in `nodeRegistry`.
- `move_node`: set a node position.
- `connect_nodes`: add a connection accepted by Lumina's typed connection validator.

Temporary `clientId` values can be referenced by later operations in the same change set. The apply
result returns their final Lumina node IDs.

## Security and privacy

- External access is disabled until the user enables it in Lumina settings.
- The server binds only to numeric loopback address `127.0.0.1`.
- Every bridge request except `/health` requires a high-entropy owner-local bearer token.
- API credentials, local paths, original image payloads, and SQLite snapshots are never returned.
- Only explicitly selected image nodes may include compressed 320px data-URL previews.
- One client can have only one in-flight change set.
- No active heartbeat returns `NO_ACTIVE_CANVAS`; there is no persisted-state fallback.
- Deletion, upload, generation, result creation, and closed-project access remain unavailable.

Enabling access authorizes compatible writes to the currently open project without an additional
dialog. The operation whitelist, revision check, atomic application, and one-step undo remain enforced.

## Development mode

Browser-only development retains the manual bridge fields:

```bash
npm install --prefix canvas-agent
npm run canvas-agent:build
npm run canvas-agent:config
npm run canvas-agent:start
```

Enter the generated URL and token in the browser settings. Register the source-based MCP entry with:

```bash
codex mcp add lumina -- node /absolute/path/to/Lumina/canvas-agent/dist/index.js mcp
```

Tauri development and production builds use the standalone binary automatically:

```bash
npm run tauri dev
npm run tauri build
```

## Verification

```bash
npm run canvas-agent:test
npm run canvas-agent:sidecar
npm run canvas-agent:sidecar:smoke
TAURI_DEV_HOST=127.0.0.1 npx vitest run
npx tsc --noEmit
cd src-tauri && cargo check
npm run build
```
