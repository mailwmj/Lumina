import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessageRecord, AgentNodeOriginRecord, AgentThreadRecord } from '@/commands/agentThreads';
import { handleMockAgentThreadCommand as handle, resetMockAgentThreads } from './mockAgentThreadsIpc';

const KEY = 'lumina-mock-agent-threads';
let storage: Map<string, string>;

function thread(id: string, projectId = 'p', updatedAt = 1): AgentThreadRecord {
  return { id, projectId, title: id, createdAt: 1, updatedAt,
    llmApiId: null, llmModelId: null, imageModelId: null, imageResolution: null };
}
function message(id: string, threadId: string, seq = 1): AgentMessageRecord {
  return { id, threadId, seq, role: 'user', partsJson: ' opaque parts \n',
    metadataJson: ' opaque metadata \n', createdAt: 3 };
}
function origin(nodeId: string, threadId: string, projectId = 'p'): AgentNodeOriginRecord {
  return { nodeId, threadId, projectId, messageId: `m-${threadId}` };
}
function threads(projectId = 'p'): AgentThreadRecord[] {
  const result = handle('list_agent_threads', { projectId });
  expect(result.handled).toBe(true);
  return result.handled ? result.value as AgentThreadRecord[] : [];
}
function messages(threadId: string): AgentMessageRecord[] {
  const result = handle('get_agent_thread_messages', { threadId });
  expect(result.handled).toBe(true);
  return result.handled ? result.value as AgentMessageRecord[] : [];
}
function origins(projectId = 'p'): AgentNodeOriginRecord[] {
  const result = handle('list_agent_node_origins', { projectId });
  expect(result.handled).toBe(true);
  return result.handled ? result.value as AgentNodeOriginRecord[] : [];
}

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  resetMockAgentThreads();
  vi.spyOn(Date, 'now').mockReturnValue(1000);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browser Agent thread IPC', () => {
  it('isolates projects, sorts threads and bumps timestamps using now, batch maximum and existing time', () => {
    for (const item of [thread('older'), thread('newer', 'p', 2), thread('foreign', 'q', 3)]) {
      expect(handle('upsert_agent_thread', { thread: item })).toEqual({ handled: true, value: null });
    }
    expect(threads().map((item) => item.id)).toEqual(['newer', 'older']);
    expect(threads('q')).toEqual([thread('foreign', 'q', 3)]);
    handle('upsert_agent_messages', { threadId: 'older', messages: [message('m', 'older')] });
    expect(threads().map((item) => [item.id, item.updatedAt])).toEqual([['older', 1000], ['newer', 2]]);
    const future = { ...message('future', 'older'), createdAt: 5000 };
    handle('upsert_agent_messages', { threadId: 'older', messages: [future, message('last', 'older')] });
    expect(threads()[0].updatedAt).toBe(5000);
    handle('upsert_agent_messages', { threadId: 'older', messages: [] });
    expect(threads()[0].updatedAt).toBe(5000);
    handle('upsert_agent_messages', { threadId: 'newer', messages: [] });
    expect(threads().find((item) => item.id === 'newer')?.updatedAt).toBe(1000);
    expect(threads('q')).toEqual([thread('foreign', 'q', 3)]);
  });

  it('updates all mutable thread fields by id while preserving createdAt', () => {
    handle('upsert_agent_thread', { thread: thread('t') });
    const updated: AgentThreadRecord = { ...thread('t', 'q', 9), title: 'Renamed',
      createdAt: 99, llmApiId: 'api', llmModelId: 'llm', imageModelId: 'image', imageResolution: '4K' };
    handle('upsert_agent_thread', { thread: updated });
    expect(threads()).toEqual([]);
    expect(threads('q')).toEqual([{ ...updated, createdAt: 1 }]);
  });

  it('upserts messages idempotently, orders by seq and preserves opaque strings and createdAt', () => {
    handle('upsert_agent_thread', { thread: thread('t') });
    const later = message('later', 't', 2);
    const earlier = message('earlier', 't', 1);
    handle('upsert_agent_messages', { threadId: 't', messages: [later, earlier] });
    expect(messages('t')).toEqual([earlier, later]);
    const updated = { ...later, seq: 0, role: 'assistant', partsJson: ' updated \n',
      metadataJson: null, createdAt: 99 };
    for (let i = 0; i < 2; i++) {
      handle('upsert_agent_messages', { threadId: 't', messages: [updated] });
    }
    expect(messages('t')).toEqual([{ ...updated, createdAt: 3 }, earlier]);
    const sameSeq = message('same-seq', 't', 1);
    handle('upsert_agent_messages', { threadId: 't', messages: [sameSeq] });
    expect(messages('t')).toHaveLength(3);
    expect(messages('t').map((item) => item.seq)).toEqual([0, 1, 1]);
  });

  it('preserves message ownership on id conflicts, matching the SQL conflict update', () => {
    const existing = message('shared', 'a');
    handle('upsert_agent_messages', { threadId: 'a', messages: [existing] });
    handle('upsert_agent_messages', { threadId: 'b', messages: [{ ...existing, threadId: 'b', seq: 4 }] });
    expect(messages('a')).toEqual([{ ...existing, seq: 4 }]);
    expect(messages('b')).toEqual([]);
  });

  it('rejects a mismatched threadId without writing any part of the batch or timestamp', () => {
    handle('upsert_agent_thread', { thread: thread('t') });
    const existing = message('existing', 't');
    handle('upsert_agent_messages', { threadId: 't', messages: [existing] });
    const before = threads();
    const stored = storage.get(KEY);
    vi.mocked(Date.now).mockReturnValue(2000);
    expect(() => handle('upsert_agent_messages', { threadId: 't', messages: [
      { ...existing, partsJson: 'must not update' }, message('valid', 't'), message('invalid', 'other'),
    ] })).toThrow('thread_id does not match');
    expect(messages('t')).toEqual([existing]);
    expect(messages('other')).toEqual([]);
    expect(threads()).toEqual(before);
    expect(storage.get(KEY)).toBe(stored);
  });

  it('cascades deletion to messages and origins while preserving another thread in the same project', () => {
    for (const id of ['a', 'b']) {
      handle('upsert_agent_thread', { thread: thread(id) });
      handle('upsert_agent_messages', { threadId: id, messages: [message(`m-${id}`, id)] });
      handle('upsert_agent_node_origins', { origins: [origin(`node-${id}`, id)] });
    }
    const remaining = threads().find((item) => item.id === 'b');
    handle('delete_agent_thread', { threadId: 'a' });
    expect(threads()).toEqual([remaining]);
    expect(messages('a')).toEqual([]);
    expect(messages('b')).toEqual([message('m-b', 'b')]);
    expect(origins()).toEqual([origin('node-b', 'b')]);
  });

  it('updates origins by nodeId and filters by project', () => {
    handle('upsert_agent_node_origins', { origins: [origin('n', 'a'), origin('other', 'b')] });
    const updated = { ...origin('n', 'c', 'q'), messageId: 'new-message' };
    handle('upsert_agent_node_origins', { origins: [updated, updated] });
    expect(origins()).toEqual([origin('other', 'b')]);
    expect(origins('q')).toEqual([updated]);
  });

  it('persists all records and reloads them from localStorage with a fresh module cache', async () => {
    handle('upsert_agent_thread', { thread: thread('t') });
    handle('upsert_agent_messages', { threadId: 't', messages: [message('m', 't')] });
    handle('upsert_agent_node_origins', { origins: [origin('n', 't')] });
    const expected = { threads: threads(), messages: messages('t'), origins: origins() };
    expect(JSON.parse(storage.get(KEY)!)).toEqual(expected);
    vi.resetModules();
    const { handleMockAgentThreadCommand: reloaded } = await import('./mockAgentThreadsIpc');
    expect(reloaded('list_agent_threads', { projectId: 'p' })).toEqual({ handled: true, value: expected.threads });
    expect(reloaded('get_agent_thread_messages', { threadId: 't' })).toEqual({ handled: true, value: expected.messages });
    expect(reloaded('list_agent_node_origins', { projectId: 'p' })).toEqual({ handled: true, value: expected.origins });
    reloaded('delete_agent_thread', { threadId: 't' });
    vi.resetModules();
    const { handleMockAgentThreadCommand: afterDelete } = await import('./mockAgentThreadsIpc');
    expect(afterDelete('list_agent_threads', { projectId: 'p' })).toEqual({ handled: true, value: [] });
    expect(afterDelete('get_agent_thread_messages', { threadId: 't' })).toEqual({ handled: true, value: [] });
    expect(afterDelete('list_agent_node_origins', { projectId: 'p' })).toEqual({ handled: true, value: [] });
  });

  it('copies inputs and outputs so callers cannot mutate cached records', () => {
    const t = thread('t');
    const m = message('m', 't');
    const o = origin('n', 't');
    handle('upsert_agent_thread', { thread: t });
    handle('upsert_agent_messages', { threadId: 't', messages: [m] });
    handle('upsert_agent_node_origins', { origins: [o] });
    t.title = 'input mutation';
    m.partsJson = 'input mutation';
    o.messageId = 'input mutation';
    threads()[0].title = 'output mutation';
    messages('t')[0].partsJson = 'output mutation';
    origins()[0].messageId = 'output mutation';
    expect(threads()[0].title).toBe('t');
    expect(messages('t')).toEqual([message('m', 't')]);
    expect(origins()).toEqual([origin('n', 't')]);
  });

  it('keeps working in memory when storage reads, writes and removal throw', () => {
    const unavailable = () => { throw new Error('Storage unavailable'); };
    vi.stubGlobal('localStorage', { getItem: unavailable, setItem: unavailable, removeItem: unavailable });
    resetMockAgentThreads();
    handle('upsert_agent_thread', { thread: thread('t') });
    handle('upsert_agent_messages', { threadId: 't', messages: [message('m', 't')] });
    expect(threads()[0].id).toBe('t');
    expect(messages('t')).toEqual([message('m', 't')]);
  });

  it('falls back to memory for malformed persisted JSON and resets both state and storage', () => {
    storage.set(KEY, 'invalid JSON');
    expect(threads()).toEqual([]);
    handle('upsert_agent_thread', { thread: thread('t') });
    resetMockAgentThreads();
    expect(storage.has(KEY)).toBe(false);
    expect(threads()).toEqual([]);
  });

  it('leaves non-Agent commands unhandled without touching storage', () => {
    expect(handle('list_project_summaries', undefined)).toEqual({ handled: false });
    expect(storage.size).toBe(0);
  });
});
