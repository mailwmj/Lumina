import { v4 as uuidv4 } from 'uuid';

import type { Level, LogFields, Logger, LogConfig } from './types';
import { loadConfig, saveConfig, resetConfig } from './config';
import { isLevelEnabled, resolveLevel } from './levels';
import { resolveNamespace } from './namespace';
import { serializeFields } from './serialize';
import { globalTransport } from './transport';

function emit(level: Level, target: string, msg: string, fields?: LogFields): void {
  const config = loadConfig();
  const effective = resolveLevel(target, config);
  if (!isLevelEnabled(level, effective)) return;

  const message =
    fields && fields.err instanceof Error
      ? `${msg} | ${(fields.err as Error).stack ?? (fields.err as Error).message}`
      : msg;

  const entry = {
    id: uuidv4(),
    ts: Date.now(),
    level,
    target,
    message,
    fields: serializeFields(fields),
  };
  globalTransport.send(entry, config);
}

function makeLogger(target: string): Logger {
  return {
    debug: (msg, f) => emit('debug', target, msg, f),
    info: (msg, f) => emit('info', target, msg, f),
    warn: (msg, f) => emit('warn', target, msg, f),
    error: (msg, f) => emit('error', target, msg, f),
  };
}

export const logger: Logger = makeLogger(resolveNamespace(2));

export function getLogger(ns: string): Logger {
  return makeLogger(ns);
}

export function setLogConfig(cfg: Partial<LogConfig>): void {
  saveConfig(cfg);
}

export function getLogConfig(): LogConfig {
  return loadConfig();
}

export function resetLogConfig(): void {
  resetConfig();
}

export { useLogStore } from './store';
export type { LogEntry, LogConfig, Level, LogFields, Logger } from './types';