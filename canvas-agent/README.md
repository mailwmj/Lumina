# Lumina Canvas Agent

`@lumina/canvas-agent` connects an external MCP client to the project currently open in Lumina.
It has two process modes:

- `serve`: authenticated loopback HTTP/SSE bridge used by the Lumina WebView.
- `mcp`: stdio MCP server used by Codex or another MCP client.

Both modes read the same owner-local configuration. Packaged Lumina passes its application config
path explicitly with `--config`; source-based development defaults to `~/.lumina/canvas-agent.json`.

The packaged executable is compiled with Bun and bundled by Tauri. Bun is a build-time dependency,
not an end-user runtime requirement.

## Development setup

From the Lumina repository root:

```bash
npm install --prefix canvas-agent
npm run canvas-agent:build
npm run canvas-agent:config
```

Copy the displayed URL and token into Lumina under **Settings > External Agent**, enable the
connection, then keep the bridge running in a terminal:

```bash
npm run canvas-agent:start
```

Register the stdio entry with Codex using an absolute path:

```bash
codex mcp add lumina -- node /absolute/path/to/Lumina/canvas-agent/dist/index.js mcp
```

The current Codex CLI accepts stdio MCP servers through `codex mcp add <name> -- <command...>`.
Remove the development registration with:

```bash
codex mcp remove lumina
```

## MCP tools

- `canvas_get_state`
- `canvas_get_selection`
- `canvas_get_capabilities`
- `canvas_propose_changes`
- `canvas_get_change_status`
- `canvas_import_images`
- `canvas_run_nodes`
- `canvas_get_node_images`
- `canvas_get_action_status`

`canvas_propose_changes` sends a bounded `CanvasChangeSet` to the live Lumina canvas. Lumina validates
and applies it directly as one atomic history step, so one undo restores the full batch. The surface
does not expose deletion, arbitrary result-node creation, closed projects, SQLite state, local media
paths, or background canvas access.

Media import, existing image-node execution, and explicit result-image reads use action tools. Actions
complete inline when Lumina responds within eight seconds; only a returned `pending` action requires
`canvas_get_action_status`. Imported references and positionless generation nodes use readable column
layout, while generation itself reuses the same application service as Lumina's Generate button.

The bridge binds only to `127.0.0.1`, requires a bearer token, limits request size, rejects unlisted
browser origins, and expires live canvas state when the WebView stops publishing heartbeats.
