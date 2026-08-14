# External Agent MCP

Lumina P0 exposes the active canvas to external Agents through a local companion process. Codex is
the first acceptance client, while the tool contract remains standard MCP.

## Process topology

```text
Codex or another MCP client
        | stdio MCP
canvas-agent (mcp mode)
        | bearer-authenticated loopback HTTP
canvas-agent (serve mode)
        | fetch-SSE + JSON
Lumina WebView
        |
live Zustand / React Flow canvas
```

Tauri and SQLite are not MCP state sources. The WebView publishes the current project snapshot and
is the only component allowed to validate and apply a proposal.

## Start and register

```bash
npm install --prefix canvas-agent
npm run canvas-agent:build
npm run canvas-agent:config
npm run canvas-agent:start
```

In Lumina, open **Settings > External Agent**, enter the URL and token returned by
`canvas-agent:config`, enable the connection, and save.

In another terminal, register the stdio mode with Codex. Use the repository's absolute path:

```bash
codex mcp add lumina -- node /absolute/path/to/Lumina/canvas-agent/dist/index.js mcp
```

Restart the relevant Codex task after changing MCP registration so the tool inventory is refreshed.

## Tool workflow

1. Call `canvas_get_state` or `canvas_get_selection`.
2. Call `canvas_get_capabilities` before choosing node types, fields, or handles.
3. Submit `canvas_propose_changes` with the returned `projectId` and `revision`.
4. Wait for the user to approve or reject the complete batch in Lumina.
5. Poll `canvas_get_change_status` with the returned `proposalId`.

A project switch, node/media mutation, position change, or edge change invalidates a pending proposal.
Selection and viewport changes do not invalidate it. Approval revalidates the live revision and then
commits nodes, edges, and one history checkpoint in a single Zustand update.

## CanvasChangeSet

P0 accepts only these operations:

- `create_node`: create a registry-approved manually configurable node using a temporary `clientId`.
- `update_node`: patch fields explicitly listed as writable in `nodeRegistry`.
- `move_node`: set a node position.
- `connect_nodes`: add a connection accepted by Lumina's existing typed connection validator.

Temporary `clientId` values can be referenced by later operations in the same change set. The apply
result returns their final Lumina node IDs.

## Security and privacy

- The server binds to numeric loopback address `127.0.0.1` only.
- Every bridge request except `/health` requires the generated bearer token.
- The WebView accepts only a configured `127.0.0.1` HTTP endpoint.
- API credentials, local paths, original image payloads, and SQLite snapshots are never returned.
- Only explicitly selected image nodes may include compressed 320px data-URL previews.
- One client can have only one pending proposal.
- No active heartbeat returns `NO_ACTIVE_CANVAS`; there is no persisted-state fallback.
- Deletion, upload, generation, result creation, and closed-project access are absent from P0 tools.

## Verification

```bash
npm run canvas-agent:build
npm run canvas-agent:test
TAURI_DEV_HOST=127.0.0.1 npx vitest run
npx tsc --noEmit
npm run build
```
