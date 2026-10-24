import { invoke } from '@tauri-apps/api/core';

export interface AgentThreadRecord {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  llmApiId: string | null;
  llmModelId: string | null;
  imageModelId: string | null;
  imageResolution: string | null;
}

export interface AgentMessageRecord {
  id: string;
  threadId: string;
  seq: number;
  role: string;
  partsJson: string;
  metadataJson: string | null;
  createdAt: number;
}

export interface AgentNodeOriginRecord {
  nodeId: string;
  projectId: string;
  threadId: string;
  messageId: string;
}

export async function listAgentThreads(projectId: string): Promise<AgentThreadRecord[]> {
  return await invoke<AgentThreadRecord[]>('list_agent_threads', { projectId });
}

export async function getAgentThreadMessages(threadId: string): Promise<AgentMessageRecord[]> {
  return await invoke<AgentMessageRecord[]>('get_agent_thread_messages', { threadId });
}

export async function upsertAgentThread(thread: AgentThreadRecord): Promise<void> {
  await invoke('upsert_agent_thread', { thread });
}

export async function upsertAgentMessages(
  threadId: string,
  messages: AgentMessageRecord[]
): Promise<void> {
  await invoke('upsert_agent_messages', { threadId, messages });
}

export async function deleteAgentThread(threadId: string): Promise<void> {
  await invoke('delete_agent_thread', { threadId });
}

export async function upsertAgentNodeOrigins(origins: AgentNodeOriginRecord[]): Promise<void> {
  await invoke('upsert_agent_node_origins', { origins });
}

export async function listAgentNodeOrigins(projectId: string): Promise<AgentNodeOriginRecord[]> {
  return await invoke<AgentNodeOriginRecord[]>('list_agent_node_origins', { projectId });
}
