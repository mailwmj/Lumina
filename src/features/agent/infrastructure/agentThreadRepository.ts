import type { UIMessage } from 'ai';

import {
  deleteAgentThread,
  getAgentThreadMessages,
  listAgentNodeOrigins,
  listAgentThreads,
  upsertAgentMessages,
  upsertAgentNodeOrigins,
  upsertAgentThread,
  type AgentMessageRecord,
  type AgentNodeOriginRecord,
  type AgentThreadRecord,
} from '@/commands/agentThreads';

export const OMITTED_INLINE_DATA = '[inline data omitted]';
const INLINE_BASE64 = /^data:[^,]*;base64,/i;

/**
 * Transcripts never store pixels: view_images previews and any other inline base64 are
 * dropped. Images are referenced by node id and rendered from the canvas, which also keeps
 * them out of `prune_unreferenced_images`' way.
 */
export function stripInlineData(value: unknown): unknown {
  if (typeof value === 'string') {
    return INLINE_BASE64.test(value) ? OMITTED_INLINE_DATA : value;
  }
  if (Array.isArray(value)) {
    return value.map(stripInlineData);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'dataUrl')
        .map(([key, entry]) => [key, stripInlineData(entry)]),
    );
  }
  return value;
}

export function serializeAgentMessage(
  message: UIMessage,
  threadId: string,
  seq: number,
  createdAt: number,
): AgentMessageRecord {
  return {
    id: message.id,
    threadId,
    seq,
    role: message.role,
    partsJson: JSON.stringify(stripInlineData(message.parts)),
    metadataJson: message.metadata === undefined ? null : JSON.stringify(message.metadata),
    createdAt,
  };
}

export function deserializeAgentMessage<M extends UIMessage>(record: AgentMessageRecord): M {
  return {
    id: record.id,
    role: record.role,
    parts: JSON.parse(record.partsJson),
    ...(record.metadataJson ? { metadata: JSON.parse(record.metadataJson) } : {}),
  } as M;
}

export const agentThreadRepository = {
  listThreads: listAgentThreads,
  saveThread: upsertAgentThread,
  deleteThread: deleteAgentThread,
  saveMessages: upsertAgentMessages,
  listNodeOrigins: listAgentNodeOrigins,
  saveNodeOrigins: upsertAgentNodeOrigins,
  async loadMessages<M extends UIMessage>(threadId: string): Promise<M[]> {
    const records = await getAgentThreadMessages(threadId);
    return records.map((record) => deserializeAgentMessage<M>(record));
  },
};

export type { AgentMessageRecord, AgentNodeOriginRecord, AgentThreadRecord };
