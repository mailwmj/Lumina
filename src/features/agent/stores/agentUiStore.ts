import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { AgentThreadRecord } from '@/commands/agentThreads';
import {
  AGENT_MAX_DRAFT_REFS,
  type AgentDraft,
  type AgentDraftRef,
  type AgentNodeOrigin,
} from '@/features/agent/domain/types';

export const AGENT_PANEL_MIN_WIDTH = 340;
export const AGENT_PANEL_MAX_WIDTH = 640;
export const AGENT_PANEL_DEFAULT_WIDTH = 400;
const EMPTY_DRAFT: AgentDraft = { text: '', refs: [] };

interface AgentUiState {
  panelOpen: boolean;
  panelWidth: number;
  projectId: string | null;
  /** Threads of the open project, newest first. Unsaved ones exist only until their first send. */
  threads: AgentThreadRecord[];
  unsavedThreadIds: string[];
  activeThreadId: string | null;
  /** Unsent drafts survive thread switches. */
  drafts: Record<string, AgentDraft>;
  nodeOrigins: Record<string, AgentNodeOrigin>;
  focusRequest: (AgentNodeOrigin & { at: number }) | null;
  setPanelOpen: (open: boolean) => void;
  setPanelWidth: (width: number) => void;
  resetProject: (projectId: string | null, threads: AgentThreadRecord[], nodeOrigins: Record<string, AgentNodeOrigin>) => void;
  upsertThread: (thread: AgentThreadRecord, options?: { unsaved?: boolean }) => void;
  removeThread: (threadId: string) => void;
  setActiveThreadId: (threadId: string | null) => void;
  setDraftText: (threadId: string, text: string) => void;
  addDraftRefs: (threadId: string, refs: AgentDraftRef[]) => void;
  removeDraftRef: (threadId: string, refId: string) => void;
  clearDraft: (threadId: string) => void;
  addNodeOrigins: (origins: Record<string, AgentNodeOrigin>) => void;
  requestFocus: (origin: AgentNodeOrigin) => void;
}

export function getAgentDraft(state: Pick<AgentUiState, 'drafts'>, threadId: string | null): AgentDraft {
  return (threadId && state.drafts[threadId]) || EMPTY_DRAFT;
}

function clampPanelWidth(width: number): number {
  return Math.round(Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, width)));
}

export const useAgentUiStore = create<AgentUiState>()(
  persist(
    (set) => ({
      panelOpen: true,
      panelWidth: AGENT_PANEL_DEFAULT_WIDTH,
      projectId: null,
      threads: [],
      unsavedThreadIds: [],
      activeThreadId: null,
      drafts: {},
      nodeOrigins: {},
      focusRequest: null,
      setPanelOpen: (panelOpen) => set({ panelOpen }),
      setPanelWidth: (width) => set({ panelWidth: clampPanelWidth(width) }),
      resetProject: (projectId, threads, nodeOrigins) => set({
        projectId,
        threads,
        nodeOrigins,
        unsavedThreadIds: [],
        activeThreadId: threads[0]?.id ?? null,
        drafts: {},
        focusRequest: null,
      }),
      upsertThread: (thread, options) => set((state) => ({
        threads: [thread, ...state.threads.filter((item) => item.id !== thread.id)]
          .sort((a, b) => b.updatedAt - a.updatedAt),
        unsavedThreadIds: options?.unsaved
          ? [...new Set([...state.unsavedThreadIds, thread.id])]
          : state.unsavedThreadIds.filter((id) => id !== thread.id),
      })),
      removeThread: (threadId) => set((state) => {
        const threads = state.threads.filter((thread) => thread.id !== threadId);
        const { [threadId]: _removed, ...drafts } = state.drafts;
        return {
          threads,
          drafts,
          unsavedThreadIds: state.unsavedThreadIds.filter((id) => id !== threadId),
          nodeOrigins: Object.fromEntries(Object.entries(state.nodeOrigins).filter(([, origin]) => origin.threadId !== threadId)),
          activeThreadId: state.activeThreadId === threadId ? threads[0]?.id ?? null : state.activeThreadId,
        };
      }),
      setActiveThreadId: (activeThreadId) => set({ activeThreadId }),
      setDraftText: (threadId, text) => set((state) => ({
        drafts: { ...state.drafts, [threadId]: { ...getAgentDraft(state, threadId), text } },
      })),
      addDraftRefs: (threadId, refs) => set((state) => {
        const draft = getAgentDraft(state, threadId);
        const known = new Set(draft.refs.map((ref) => ref.nodeId ?? ref.id));
        const next = [...draft.refs, ...refs.filter((ref) => !known.has(ref.nodeId ?? ref.id))].slice(0, AGENT_MAX_DRAFT_REFS);
        return { drafts: { ...state.drafts, [threadId]: { ...draft, refs: next } } };
      }),
      removeDraftRef: (threadId, refId) => set((state) => {
        const draft = getAgentDraft(state, threadId);
        return { drafts: { ...state.drafts, [threadId]: { ...draft, refs: draft.refs.filter((ref) => ref.id !== refId) } } };
      }),
      clearDraft: (threadId) => set((state) => ({ drafts: { ...state.drafts, [threadId]: EMPTY_DRAFT } })),
      addNodeOrigins: (origins) => set((state) => ({ nodeOrigins: { ...state.nodeOrigins, ...origins } })),
      requestFocus: (origin) => set({
        panelOpen: true,
        activeThreadId: origin.threadId,
        focusRequest: { ...origin, at: Date.now() },
      }),
    }),
    {
      name: 'agent-ui-storage',
      version: 1,
      // Only layout is remembered across restarts; threads and origins come from SQLite.
      partialize: (state) => ({ panelOpen: state.panelOpen, panelWidth: state.panelWidth }),
    }
  )
);
