#!/usr/bin/env node
import { loadConfig } from './config.js';
import { startHttpServer } from './server/http.js';
import { startMcpServer } from './server/mcp.js';

const command = process.argv[2] ?? 'serve';
const config = loadConfig(true);

if (command === 'mcp') {
  await startMcpServer(config);
} else if (command === 'config') {
  process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
} else if (command === 'serve') {
  const server = startHttpServer(config);
  const close = () => server.close(() => process.exit(0));
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} else {
  console.error(`Unknown command: ${command}`);
  process.exitCode = 1;
}
