import type { UIMessage } from 'ai';
import { v4 as uuidv4 } from 'uuid';

import type { AgentThreadRecord } from '@/commands/agentThreads';
import type { AgentDraftRef, AgentMessageMetadata, AgentNodeOrigin } from '@/features/agent/domain/types';
import { agentThreadRepository } from '@/features/agent/infrastructure/agentThreadRepository';
import { useAgentSettingsStore, type AgentModelChoice } from '@/features/agent/stores/agentSettingsStore';
import { useAgentUiStore } from '@/features/agent/stores/agentUiStore';
import { importCanvasAgentImages } from '@/features/canvas-agent/application/importCanvasAgentImages';
import { listConfiguredTextModels } from '@/features/canvas/application/textModelSelection';
import { listConfiguredImageModels } from '@/features/canvas/models/availableModels';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { collectNodeOrigins, deriveThreadTitle, persistAgentMessages } from './agentThreadService';
import { parseRequestedImageCount } from './turnBudget';

/** Last used models if still configured, otherwise the first configured ones. */
export function resolveDefaultModelChoice(): AgentModelChoice {
  const settings = useSettingsStore.getState();
  const textModels = listConfiguredTextModels(settings.textApis);
  const imageModels = listConfiguredImageModels(settings);
  const last = useAgentSettingsStore.getState().lastModelChoice;
  const llm = textModels.find((model) => model.apiId === last.llm?.apiId && model.modelId === last.llm?.modelId)
    ?? textModels[0];
  const image = imageModels.find((model) => model.id === last.imageModelId) ?? imageModels[0];
  return {
    llm: llm ? { apiId: llm.apiId, modelId: llm.modelId } : null,
    imageModelId: image?.id ?? null,
    imageResolution: last.imageResolution,
  };
}

/** A new thread lives only in memory until its first message is sent. */
export function createAgentThread(projectId: string): AgentThreadRecord {
  const now = Date.now();
  const choice = resolveDefaultModelChoice();
  const thread: AgentThreadRecord = {
    id: uuidv4(),
    projectId,
    title: '',
    createdAt: now,
    updatedAt: now,
    llmApiId: choice.llm?.apiId ?? null,
    llmModelId: choice.llm?.modelId ?? null,
    imageModelId: choice.imageModelId,
    imageResolution: choice.imageResolution,
  };
  const store = useAgentUiStore.getState();
  store.upsertThread(thread, { unsaved: true });
  store.setActiveThreadId(thread.id);
  return thread;
}

export async function loadAgentProject(projectId: string): Promise<void> {
  const [threads, origins] = await Promise.all([
    agentThreadRepository.listThreads(projectId),
    agentThreadRepository.listNodeOrigins(projectId),
  ]);
  const nodeOrigins: Record<string, AgentNodeOrigin> = Object.fromEntries(
    origins.map((origin) => [origin.nodeId, { threadId: origin.threadId, messageId: origin.messageId }]),
  );
  useAgentUiStore.getState().resetProject(projectId, threads, nodeOrigins);
  if (threads.length === 0) {
    createAgentThread(projectId);
  }
}

function findThread(threadId: string): AgentThreadRecord | undefined {
  return useAgentUiStore.getState().threads.find((thread) => thread.id === threadId);
}

async function saveThread(thread: AgentThreadRecord): Promise<void> {
  const store = useAgentUiStore.getState();
  const unsaved = store.unsavedThreadIds.includes(thread.id);
  store.upsertThread(thread, { unsaved });
  if (!unsaved) {
    await agentThreadRepository.saveThread(thread);
  }
}

export async function renameAgentThread(threadId: string, title: string): Promise<void> {
  const thread = findThread(threadId);
  const trimmed = title.trim();
  if (thread && trimmed) {
    await saveThread({ ...thread, title: trimmed, updatedAt: Date.now() });
  }
}

export async function updateAgentThreadModels(threadId: string, choice: AgentModelChoice): Promise<void> {
  const thread = findThread(threadId);
  if (!thread) return;
  useAgentSettingsStore.getState().setLastModelChoice(choice);
  await saveThread({
    ...thread,
    llmApiId: choice.llm?.apiId ?? null,
    llmModelId: choice.llm?.modelId ?? null,
    imageModelId: choice.imageModelId,
    imageResolution: choice.imageResolution,
  });
}

export async function deleteAgentThreadById(threadId: string): Promise<void> {
  const store = useAgentUiStore.getState();
  if (!store.unsavedThreadIds.includes(threadId)) {
    await agentThreadRepository.deleteThread(threadId);
  }
  store.removeThread(threadId);
  const { projectId, threads } = useAgentUiStore.getState();
  if (projectId && threads.length === 0) {
    createAgentThread(projectId);
  }
}

/**
 * Turns a draft into what `sendMessage` needs: uploads become upload nodes on the canvas
 * (so the canvas stays the source of truth), refs become node ids, and the explicit image
 * count is parsed here rather than reported by the model. Saves the thread on first send.
 */
export async function prepareAgentMessage(threadId: string, text: string, refs: AgentDraftRef[]): Promise<{
  text: string;
  metadata: AgentMessageMetadata;
}> {
  const projectId = useProjectStore.getState().getCurrentProject()?.id;
  const thread = findThread(threadId);
  if (!projectId || !thread) {
    throw new Error('No conversation is open.');
  }
  const uploads = refs.filter((ref) => !ref.nodeId && ref.source);
  const imported = uploads.length
    ? await importCanvasAgentImages({
      projectId,
      images: uploads.map((ref) => ({ clientId: ref.id, source: ref.source!, displayName: ref.name })),
      assertCurrent: () => undefined,
    })
    : { nodeIdMap: {} as Record<string, string> };
  const nodeIds = refs.flatMap((ref) => ref.nodeId ?? imported.nodeIdMap[ref.id] ?? []);

  if (useAgentUiStore.getState().unsavedThreadIds.includes(threadId) || !thread.title) {
    const saved = { ...thread, title: thread.title || deriveThreadTitle([{ id: '', role: 'user', parts: [{ type: 'text', text }] }]) };
    useAgentUiStore.getState().upsertThread(saved);
    await agentThreadRepository.saveThread(saved);
  }
  return {
    text,
    metadata: { refs: nodeIds.map((nodeId) => ({ nodeId })), requestedImageCount: parseRequestedImageCount(text) },
  };
}

/** Persists a thread's transcript and publishes any new node origins to the panel. */
export function persistThreadMessages(threadId: string, messages: readonly UIMessage[], streaming: boolean): void {
  const projectId = useAgentUiStore.getState().projectId;
  if (!projectId || useAgentUiStore.getState().unsavedThreadIds.includes(threadId)) return;
  void persistAgentMessages({ projectId, threadId, messages, streaming });
  const origins = collectNodeOrigins(projectId, threadId, messages);
  const known = useAgentUiStore.getState().nodeOrigins;
  const fresh = origins.filter((origin) => !known[origin.nodeId]);
  if (fresh.length) {
    useAgentUiStore.getState().addNodeOrigins(Object.fromEntries(
      fresh.map((origin) => [origin.nodeId, { threadId: origin.threadId, messageId: origin.messageId }]),
    ));
  }
}
