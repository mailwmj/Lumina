# Lumina Canvas Agent

`@lumina/canvas-agent` connects an external MCP client to the project currently open in Lumina.
It has two process modes:

- `serve`: authenticated loopback HTTP/SSE bridge used by the Lumina WebView.
- `mcp`: stdio MCP server used by Codex or another MCP client.

Both modes read the same owner-local configuration at `~/.lumina/canvas-agent.json`.

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

## P0 tools

- `canvas_get_state`
- `canvas_get_selection`
- `canvas_get_capabilities`
- `canvas_propose_changes`
- `canvas_get_change_status`

`canvas_propose_changes` only queues a `CanvasChangeSet`. Lumina applies it after one in-app batch
approval, and one undo restores the full batch. P0 does not expose deletion, uploads, AI generation,
result-node creation, closed projects, SQLite state, local media paths, or background canvas access.

The bridge binds only to `127.0.0.1`, requires a bearer token, limits request size, rejects unlisted
browser origins, and expires live canvas state when the WebView stops publishing heartbeats.
