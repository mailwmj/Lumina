import type { UIMessage } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  collectNodeOrigins,
  deriveThreadTitle,
  flushAgentThreadPersists,
  persistAgentMessages,
  resetAgentThreadPersistence,
} from './agentThreadService';

const repo = vi.hoisted(() => ({
  saveMessages: vi.fn(async () => undefined),
  saveNodeOrigins: vi.fn(async () => undefined),
}));

vi.mock('@/features/agent/infrastructure/agentThreadRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/agent/infrastructure/agentThreadRepository')>();
  return { ...actual, agentThreadRepository: { ...actual.agentThreadRepository, ...repo } };
});

function user(id: string, text: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] };
}

function assistant(id: string, text: string, generated?: { sourceNodeIds: string[]; results: Array<{ nodeId: string }> }): UIMessage {
  const parts: unknown[] = [{ type: 'text', text }];
  if (generated) {
    parts.push({ type: 'tool-generate_image', toolCallId: 'c', state: 'output-available', input: {}, output: generated });
  }
  return { id, role: 'assistant', parts } as UIMessage;
}

function savedMessageIds(callIndex: number): string[] {
  const [, records] = repo.saveMessages.mock.calls[callIndex] as unknown as [string, Array<{ id: string }>];
  return records.map((record) => record.id);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetAgentThreadPersistence();
});

afterEach(() => {
  vi.useRealTimers();
  repo.saveMessages.mockClear();
  repo.saveNodeOrigins.mockClear();
});

const base = { projectId: 'p1', threadId: 't1' };

describe('persistAgentMessages', () => {
  it('writes a finished message immediately and only sends messages that changed', async () => {
    const first = [user('u1', 'hi'), assistant('a1', 'hello')];
    await persistAgentMessages({ ...base, messages: first, streaming: false });
    await persistAgentMessages({ ...base, messages: [...first, user('u2', 'more')], streaming: false });

    expect(savedMessageIds(0)).toEqual(['u1', 'a1']);
    expect(savedMessageIds(1)).toEqual(['u2']);
  });

  it('throttles writes while a reply is streaming and keeps only the latest content', async () => {
    persistAgentMessages({ ...base, messages: [user('u1', 'hi'), assistant('a1', 'he')], streaming: true });
    persistAgentMessages({ ...base, messages: [user('u1', 'hi'), assistant('a1', 'hell')], streaming: true });
    expect(repo.saveMessages).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(repo.saveMessages).toHaveBeenCalledTimes(1);
    const [, records] = repo.saveMessages.mock.calls[0] as unknown as [string, Array<{ partsJson: string }>];
    expect(records[1].partsJson).toContain('hell');
  });

  it('flushes pending streaming writes on window close', async () => {
    persistAgentMessages({ ...base, messages: [user('u1', 'hi')], streaming: true });
    await expect(flushAgentThreadPersists()).resolves.toBe(true);
    expect(savedMessageIds(0)).toEqual(['u1']);
  });

  it('records node origins once per node, attributed to the generating message', async () => {
    const messages = [user('u1', 'cat'), assistant('a1', 'done', { sourceNodeIds: ['gen'], results: [{ nodeId: 'r1' }] })];
    await persistAgentMessages({ ...base, messages, streaming: false });
    await persistAgentMessages({ ...base, messages: [...messages, user('u2', 'ok')], streaming: false });

    expect(repo.saveNodeOrigins).toHaveBeenCalledTimes(1);
    expect(repo.saveNodeOrigins).toHaveBeenCalledWith([
      { nodeId: 'gen', projectId: 'p1', threadId: 't1', messageId: 'a1' },
      { nodeId: 'r1', projectId: 'p1', threadId: 't1', messageId: 'a1' },
    ]);
  });

  it('reports failure to the close guard and retries the write next time', async () => {
    repo.saveMessages.mockRejectedValueOnce(new Error('disk full'));
    await expect(persistAgentMessages({ ...base, messages: [user('u1', 'hi')], streaming: false })).resolves.toBe(false);
    await persistAgentMessages({ ...base, messages: [user('u1', 'hi')], streaming: false });
    expect(savedMessageIds(1)).toEqual(['u1']);
  });
});

describe('thread helpers', () => {
  it('titles a thread from its first user message', () => {
    expect(deriveThreadTitle([user('u1', '  画一只猫  '), user('u2', 'x')])).toBe('画一只猫');
    expect(deriveThreadTitle([user('u1', 'a'.repeat(50))])).toHaveLength(41);
  });

  it('collects origins only from finished generate_image outputs', () => {
    expect(collectNodeOrigins('p', 't', [assistant('a', 'x')])).toEqual([]);
  });
});
