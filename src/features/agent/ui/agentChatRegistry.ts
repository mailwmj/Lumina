import { Chat } from '@ai-sdk/react';

import {
  AgentChatTransport,
  shouldResumeAfterToolOutput,
} from '@/features/agent/application/agentChatTransport';
import { persistThreadMessages } from '@/features/agent/application/agentThreadActions';
import { loadAgentThreadMessages } from '@/features/agent/application/agentThreadService';
import type { CanvasAgentUIMessage } from '@/features/agent/application/canvasAgent';
import { useAgentUiStore } from '@/features/agent/stores/agentUiStore';

type AgentChat = Chat<CanvasAgentUIMessage>;

// One Chat per thread, kept across thread switches so a background reply keeps streaming.
const chats = new Map<string, AgentChat>();
const pendingLoads = new Map<string, Promise<AgentChat>>();
const detachers = new Map<string, () => void>();

function threadModels(threadId: string) {
  const thread = useAgentUiStore.getState().threads.find((item) => item.id === threadId);
  return {
    llm: thread?.llmApiId && thread.llmModelId ? { apiId: thread.llmApiId, modelId: thread.llmModelId } : null,
    imageModelId: thread?.imageModelId ?? null,
    imageResolution: thread?.imageResolution ?? null,
  };
}

function isBusy(chat: AgentChat): boolean {
  return chat.status === 'submitted' || chat.status === 'streaming';
}

function createChat(threadId: string, messages: CanvasAgentUIMessage[]): AgentChat {
  const chat: AgentChat = new Chat<CanvasAgentUIMessage>({
    id: threadId,
    messages,
    transport: new AgentChatTransport(() => threadModels(threadId)),
    sendAutomaticallyWhen: shouldResumeAfterToolOutput,
  });
  // useChat subscribes the same way; the service throttles writes while streaming.
  const offMessages = chat['~registerMessagesCallback'](() => {
    persistThreadMessages(threadId, chat.messages, isBusy(chat));
  });
  const offStatus = chat['~registerStatusCallback'](() => {
    if (!isBusy(chat)) persistThreadMessages(threadId, chat.messages, false);
  });
  detachers.set(threadId, () => {
    offMessages();
    offStatus();
  });
  chats.set(threadId, chat);
  return chat;
}

export function getLoadedAgentChat(threadId: string): AgentChat | undefined {
  return chats.get(threadId);
}

/** Loads the thread's transcript once (saved threads only) and returns its Chat. */
export function ensureAgentChat(projectId: string, threadId: string): Promise<AgentChat> {
  const existing = chats.get(threadId);
  if (existing) return Promise.resolve(existing);
  const pending = pendingLoads.get(threadId);
  if (pending) return pending;

  const unsaved = useAgentUiStore.getState().unsavedThreadIds.includes(threadId);
  const load = (unsaved
    ? Promise.resolve<CanvasAgentUIMessage[]>([])
    : loadAgentThreadMessages<CanvasAgentUIMessage>(projectId, threadId))
    .then((messages) => chats.get(threadId) ?? createChat(threadId, messages))
    .finally(() => pendingLoads.delete(threadId));
  pendingLoads.set(threadId, load);
  return load;
}

export function disposeAgentChat(threadId: string): void {
  const chat = chats.get(threadId);
  if (chat && isBusy(chat)) void chat.stop();
  detachers.get(threadId)?.();
  detachers.delete(threadId);
  chats.delete(threadId);
}

/** On project switch: stop LLM streams. Started image jobs belong to their nodes and keep running. */
export function disposeAllAgentChats(): void {
  [...chats.keys()].forEach(disposeAgentChat);
}
