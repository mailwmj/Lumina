// Dev-only persistence for the browser canvas fixture.
import type {
  AgentMessageRecord,
  AgentNodeOriginRecord,
  AgentThreadRecord,
} from '@/commands/agentThreads';

const STORAGE_KEY = 'lumina-mock-agent-threads';
interface State {
  threads: AgentThreadRecord[];
  messages: AgentMessageRecord[];
  origins: AgentNodeOriginRecord[];
}
let state: State | undefined;

function getState(): State {
  if (state) return state;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as State;
      if (Array.isArray(parsed.threads) && Array.isArray(parsed.messages) && Array.isArray(parsed.origins)) {
        state = parsed;
        return state;
      }
    }
  } catch {
    // Storage may be blocked or contain invalid JSON; continue in memory.
  }
  state = { threads: [], messages: [], origins: [] };
  return state;
}

function persist(data: State): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Keep the in-memory state when storage is unavailable or full.
  }
}

/** Clear both the cached state and persisted fixture data between tests. */
export function resetMockAgentThreads(): void {
  state = undefined;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Reset must also work when storage is unavailable.
  }
}

export function handleMockAgentThreadCommand(
  cmd: string,
  args: unknown
): { handled: true; value: unknown } | { handled: false } {
  switch (cmd) {
    case 'list_agent_threads': {
      const { projectId } = args as { projectId: string };
      return { handled: true, value: getState().threads
        .filter((thread) => thread.projectId === projectId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((thread) => ({ ...thread })) };
    }
    case 'get_agent_thread_messages': {
      const { threadId } = args as { threadId: string };
      return { handled: true, value: getState().messages
        .filter((message) => message.threadId === threadId)
        .sort((a, b) => a.seq - b.seq)
        .map((message) => ({ ...message })) };
    }
    case 'upsert_agent_thread': {
      const { thread } = args as { thread: AgentThreadRecord };
      const data = getState();
      const index = data.threads.findIndex((item) => item.id === thread.id);
      if (index === -1) data.threads.push({ ...thread });
      else data.threads[index] = { ...thread, createdAt: data.threads[index].createdAt };
      persist(data);
      return { handled: true, value: null };
    }
    case 'upsert_agent_messages': {
      const { threadId, messages } = args as { threadId: string; messages: AgentMessageRecord[] };
      // Validate the entire batch before making any changes, matching the SQL transaction.
      for (const message of messages) {
        if (message.threadId !== threadId) {
          throw new Error(`Failed to upsert agent messages: message ${message.id} thread_id does not match ${threadId}`);
        }
      }
      const data = getState();
      let updatedAt = Date.now();
      for (const message of messages) {
        updatedAt = Math.max(updatedAt, message.createdAt);
        const index = data.messages.findIndex((item) => item.id === message.id);
        if (index === -1) data.messages.push({ ...message });
        else {
          const existing = data.messages[index];
          data.messages[index] = { ...existing, seq: message.seq, role: message.role,
            partsJson: message.partsJson, metadataJson: message.metadataJson };
        }
      }
      const thread = data.threads.find((item) => item.id === threadId);
      if (thread) thread.updatedAt = Math.max(thread.updatedAt, updatedAt);
      persist(data);
      return { handled: true, value: null };
    }
    case 'delete_agent_thread': {
      const { threadId } = args as { threadId: string };
      const data = getState();
      data.threads = data.threads.filter((thread) => thread.id !== threadId);
      data.messages = data.messages.filter((message) => message.threadId !== threadId);
      data.origins = data.origins.filter((origin) => origin.threadId !== threadId);
      persist(data);
      return { handled: true, value: null };
    }
    case 'upsert_agent_node_origins': {
      const { origins } = args as { origins: AgentNodeOriginRecord[] };
      const data = getState();
      for (const origin of origins) {
        const index = data.origins.findIndex((item) => item.nodeId === origin.nodeId);
        if (index === -1) data.origins.push({ ...origin });
        else data.origins[index] = { ...origin };
      }
      persist(data);
      return { handled: true, value: null };
    }
    case 'list_agent_node_origins': {
      const { projectId } = args as { projectId: string };
      return { handled: true, value: getState().origins
        .filter((origin) => origin.projectId === projectId)
        .map((origin) => ({ ...origin })) };
    }
    default:
      return { handled: false };
  }
}
