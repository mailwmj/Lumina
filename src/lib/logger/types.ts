export type Level = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export interface LogConfig {
  level: Level;
  moduleLevels: Record<string, Level>;
  console: boolean;
  persist: boolean;
  consoleTimestamps: boolean;
}

export const DEFAULT_LOG_CONFIG: LogConfig = {
  level: 'debug',
  moduleLevels: {},
  console: true,
  persist: true,
  consoleTimestamps: false,
};

export interface LogEntry {
  id: string;
  ts: number;
  level: Level;
  target: string;
  message: string;
  fields: LogFields;
}