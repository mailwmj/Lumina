import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ZodError } from 'zod';

import type { CanvasAgentConfig } from '../config.js';
import {
  CanvasAgentError,
  canvasAgentToolDescriptions,
  canvasAgentToolNames,
  canvasAgentToolSchemas,
  type CanvasAgentErrorPayload,
  type CanvasAgentToolName,
} from '../canvas/protocol.js';

interface ToolHttpResponse {
  ok?: boolean;
  result?: unknown;
  error?: CanvasAgentErrorPayload;
}

const MCP_INSTRUCTIONS = [
  'Lumina exposes only the project currently open in the desktop app.',
  'Read canvas_get_state before changing the canvas and reuse its projectId and revision.',
  'canvas_propose_changes validates and atomically applies one bounded change set without an in-app approval step.',
  'Poll canvas_get_change_status until Lumina reports applied, stale, or failed.',
  'Deletion, uploads, result-node creation, and AI generation are intentionally unavailable.',
].join(' ');

export async function startMcpServer(config: CanvasAgentConfig): Promise<void> {
  const server = new McpServer(
    { name: 'lumina-canvas', version: '0.1.0' },
    { instructions: MCP_INSTRUCTIONS }
  );
  canvasAgentToolNames.forEach((name) => registerTool(server, config, name));
  await server.connect(new StdioServerTransport());
}

function registerTool(
  server: McpServer,
  config: CanvasAgentConfig,
  name: CanvasAgentToolName
): void {
  const schema = canvasAgentToolSchemas[name];
  server.registerTool(
    name,
    {
      description: canvasAgentToolDescriptions[name],
      inputSchema: schema.shape,
    },
    async (rawInput: unknown) => {
      try {
        const input = schema.parse(rawInput);
        const result = await postTool(config, name, input);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const payload = toErrorPayload(error);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: payload }, null, 2) }],
        };
      }
    }
  );
}

async function postTool(
  config: CanvasAgentConfig,
  name: CanvasAgentToolName,
  input: unknown
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${config.url}/api/tools`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, input }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new CanvasAgentError(
      'BRIDGE_UNAVAILABLE',
      'Lumina Canvas Agent is not running or cannot be reached.',
      error instanceof Error ? error.message : String(error)
    );
  }

  const body = await response.json() as ToolHttpResponse;
  if (!response.ok || !body.ok) {
    throw new CanvasAgentError(
      body.error?.code ?? 'TOOL_CALL_FAILED',
      body.error?.message ?? 'The canvas tool call failed.',
      body.error?.details
    );
  }
  return body.result;
}

function toErrorPayload(error: unknown): CanvasAgentErrorPayload {
  if (error instanceof CanvasAgentError) {
    return error.toPayload();
  }
  if (error instanceof ZodError) {
    return {
      code: 'INVALID_ARGUMENTS',
      message: 'The MCP tool arguments are invalid.',
      details: error.issues,
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}
