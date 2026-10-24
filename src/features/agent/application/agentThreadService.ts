import type { UIMessage } from 'ai';

import {
  agentThreadRepository,
  serializeAgentMessage,
  type AgentNodeOriginRecord,
} from '@/features/agent/infrastructure/agentThreadRepository';
import { logger } from '@/lib/logger';

const STREAMING_WRITE_INTERVAL_MS = 500;
const THREAD_TITLE_LENGTH = 40;

interface PendingThreadWrite {
  projectId: string;
  messages: readonly UIMessage[];
}

// Last written form of each message, so only changed messages go to SQLite.
const savedSignatures = new Map<string, string>();
const createdAtById = new Map<string, number>();
const recordedOriginNodeIds = new Set<string>();
const pendingWrites = new Map<string, PendingThreadWrite>();
const streamingTimers = new Map<string, ReturnType<typeof setTimeout>>();
// One write chain per thread keeps writes ordered.
const writeChains = new Map<string, Promise<boolean>>();

function signatureOf(record: { seq: number; partsJson: string; metadataJson: string | null }): string {
  return `${record.seq}\u0000${record.partsJson}\u0000${record.metadataJson ?? ''}`;
}

export function deriveThreadTitle(messages: readonly UIMessage[]): string {
  const firstUser = messages.find((message) => message.role === 'user');
  const text = firstUser?.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(' ').trim() ?? '';
  return text.length > THREAD_TITLE_LENGTH ? `${text.slice(0, THREAD_TITLE_LENGTH)}…` : text;
}

/** Nodes created by generate_image, attributed to the assistant message that made them. */
export function collectNodeOrigins(
  projectId: string,
  threadId: string,
  messages: readonly UIMessage[],
): AgentNodeOriginRecord[] {
  return messages.flatMap((message) => message.parts.flatMap((part) => {
    const toolPart = part as { type: string; state?: string; output?: unknown };
    if (toolPart.type !== 'tool-generate_image' || toolPart.state !== 'output-available') return [];
    const output = toolPart.output as { sourceNodeIds?: string[]; results?: Array<{ nodeId: string }> };
    return [...(output.sourceNodeIds ?? []), ...(output.results ?? []).map((result) => result.nodeId)]
      .map((nodeId) => ({ nodeId, projectId, threadId, messageId: message.id }));
  }));
}

async function writeThread(threadId: string, { projectId, messages }: PendingThreadWrite): Promise<boolean> {
  const now = Date.now();
  const records = messages.flatMap((message, seq) => {
    const createdAt = createdAtById.get(message.id) ?? now;
    createdAtById.set(message.id, createdAt);
    const record = serializeAgentMessage(message, threadId, seq, createdAt);
    const signature = signatureOf(record);
    return savedSignatures.get(record.id) === signature ? [] : [{ record, signature }];
  });
  const origins = collectNodeOrigins(projectId, threadId, messages)
    .filter((origin) => !recordedOriginNodeIds.has(origin.nodeId));
  try {
    if (records.length) {
      await agentThreadRepository.saveMessages(threadId, records.map(({ record }) => record));
      records.forEach(({ record, signature }) => savedSignatures.set(record.id, signature));
    }
    if (origins.length) {
      await agentThreadRepository.saveNodeOrigins(origins);
      origins.forEach((origin) => recordedOriginNodeIds.add(origin.nodeId));
    }
    return true;
  } catch (error) {
    logger.error('failed to persist agent thread', error);
    return false;
  }
}

function flushThread(threadId: string): Promise<boolean> {
  const timer = streamingTimers.get(threadId);
  if (timer) {
    clearTimeout(timer);
    streamingTimers.delete(threadId);
  }
  const pending = pendingWrites.get(threadId);
  pendingWrites.delete(threadId);
  const previous = writeChains.get(threadId) ?? Promise.resolve(true);
  const next = previous.then((ok) => (pending ? writeThread(threadId, pending).then((written) => ok && written) : ok));
  writeChains.set(threadId, next);
  return next;
}

/**
 * Finished messages are written at once; while a reply streams, writes are throttled to one
 * per 500 ms. Only messages whose content changed since the last write are sent.
 */
export function persistAgentMessages(input: {
  projectId: string;
  threadId: string;
  messages: readonly UIMessage[];
  streaming: boolean;
}): Promise<boolean> | void {
  pendingWrites.set(input.threadId, { projectId: input.projectId, messages: input.messages });
  if (!input.streaming) {
    return flushThread(input.threadId);
  }
  if (!streamingTimers.has(input.threadId)) {
    streamingTimers.set(input.threadId, setTimeout(() => {
      streamingTimers.delete(input.threadId);
      void flushThread(input.threadId);
    }, STREAMING_WRITE_INTERVAL_MS));
  }
}

/** Called from App's single window-close guard (AGENTS.md §9); never registers its own listener. */
export async function flushAgentThreadPersists(): Promise<boolean> {
  const threadIds = new Set([...pendingWrites.keys(), ...writeChains.keys()]);
  const results = await Promise.all([...threadIds].map(flushThread));
  return results.every(Boolean);
}

/** Loads a thread and records what is already stored, so reopening it writes nothing. */
export async function loadAgentThreadMessages<M extends UIMessage>(projectId: string, threadId: string): Promise<M[]> {
  const messages = await agentThreadRepository.loadMessages<M>(threadId);
  messages.forEach((message, seq) => {
    const record = serializeAgentMessage(message, threadId, seq, 0);
    savedSignatures.set(record.id, signatureOf(record));
  });
  collectNodeOrigins(projectId, threadId, messages).forEach((origin) => recordedOriginNodeIds.add(origin.nodeId));
  return messages;
}

export function resetAgentThreadPersistence(): void {
  streamingTimers.forEach(clearTimeout);
  [savedSignatures, createdAtById, pendingWrites, streamingTimers, writeChains].forEach((map) => map.clear());
  recordedOriginNodeIds.clear();
}
