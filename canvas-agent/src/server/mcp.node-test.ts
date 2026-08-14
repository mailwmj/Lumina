import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { canvasAgentToolNames } from '../canvas/protocol.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('stdio MCP initializes and lists exactly the P0 canvas tools', { timeout: 8_000 }, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-mcp-test-'));
  const child = spawn(process.execPath, [path.join(PACKAGE_ROOT, 'dist/index.js'), 'mcp'], {
    cwd: PACKAGE_ROOT,
    env: {
      ...process.env,
      LUMINA_CANVAS_AGENT_CONFIG: path.join(tempDir, 'canvas-agent.json'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const responses = createResponseReader(child.stdout);
  try {
    send(child.stdin, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'lumina-smoke-test', version: '1.0.0' },
      },
    });
    const initialized = await responses.waitFor(1);
    assert.equal(initialized.error, undefined, stderr);

    send(child.stdin, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    });
    send(child.stdin, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    const listed = await responses.waitFor(2);
    assert.equal(listed.error, undefined, stderr);
    const result = listed.result as { tools?: Array<{ name?: string }> };
    assert.deepEqual(
      result.tools?.map((tool) => tool.name).sort(),
      [...canvasAgentToolNames].sort()
    );
  } finally {
    child.stdin.end();
    child.kill('SIGTERM');
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: unknown;
}

function send(stream: NodeJS.WritableStream, message: unknown): void {
  stream.write(`${JSON.stringify(message)}\n`);
}

function createResponseReader(stream: NodeJS.ReadableStream) {
  let buffer = '';
  const responses = new Map<number, JsonRpcResponse>();
  const waiters = new Map<number, (value: JsonRpcResponse) => void>();
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        const message = JSON.parse(line) as JsonRpcResponse;
        if (typeof message.id === 'number') {
          const waiter = waiters.get(message.id);
          if (waiter) {
            waiters.delete(message.id);
            waiter(message);
          } else {
            responses.set(message.id, message);
          }
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }
  });

  return {
    waitFor(id: number): Promise<JsonRpcResponse> {
      const existing = responses.get(id);
      if (existing) {
        responses.delete(id);
        return Promise.resolve(existing);
      }
      return new Promise((resolve) => {
        waiters.set(id, resolve);
      });
    },
  };
}
