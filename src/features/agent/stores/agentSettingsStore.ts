import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { TEXT_REASONING_EFFORTS, type TextReasoningEffort } from '@/features/canvas/models/types';
import type { AgentModelSelection } from '@/features/agent/infrastructure/agentModelFactory';

export const AGENT_MAX_IMAGES_LIMIT = 8;
export const DEFAULT_AGENT_MAX_IMAGES_PER_TURN = 4;
export const DEFAULT_AGENT_REASONING_EFFORT: TextReasoningEffort = 'max';

export interface AgentModelCapabilities {
  tools: boolean;
  vision: boolean;
  probedAt: number;
}

export interface AgentModelChoice {
  llm: AgentModelSelection | null;
  imageModelId: string | null;
}

interface AgentSettingsState {
  maxImagesPerTurn: number;
  reasoningEffort: TextReasoningEffort | null;
  /** Seeds the model pickers of a new thread; each thread then keeps its own choice. */
  lastModelChoice: AgentModelChoice;
  /** Keyed by `agentModelCapabilityKey`. */
  modelCapabilities: Record<string, AgentModelCapabilities>;
  setMaxImagesPerTurn: (value: number) => void;
  setReasoningEffort: (value: TextReasoningEffort | null) => void;
  setLastModelChoice: (choice: AgentModelChoice) => void;
  setModelCapabilities: (selection: AgentModelSelection, capabilities: AgentModelCapabilities) => void;
}

export function agentModelCapabilityKey(selection: AgentModelSelection): string {
  return `${selection.apiId}/${selection.modelId}`;
}

export function normalizeMaxImagesPerTurn(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_AGENT_MAX_IMAGES_PER_TURN;
  }
  return Math.min(AGENT_MAX_IMAGES_LIMIT, Math.max(1, Math.round(numeric)));
}

function normalizeReasoningEffort(value: unknown): TextReasoningEffort | null {
  if (value === null) {
    return null;
  }
  return TEXT_REASONING_EFFORTS.includes(value as TextReasoningEffort)
    ? value as TextReasoningEffort
    : DEFAULT_AGENT_REASONING_EFFORT;
}

function normalizeSelection(value: unknown): AgentModelSelection | null {
  const record = value as Partial<AgentModelSelection> | null | undefined;
  return typeof record?.apiId === 'string' && typeof record.modelId === 'string' && record.apiId && record.modelId
    ? { apiId: record.apiId, modelId: record.modelId }
    : null;
}

function normalizeModelChoice(value: unknown): AgentModelChoice {
  const record = value as Partial<AgentModelChoice> | null | undefined;
  return {
    llm: normalizeSelection(record?.llm),
    imageModelId: typeof record?.imageModelId === 'string' && record.imageModelId ? record.imageModelId : null,
  };
}

export const useAgentSettingsStore = create<AgentSettingsState>()(
  persist(
    (set) => ({
      maxImagesPerTurn: DEFAULT_AGENT_MAX_IMAGES_PER_TURN,
      reasoningEffort: DEFAULT_AGENT_REASONING_EFFORT,
      lastModelChoice: { llm: null, imageModelId: null },
      modelCapabilities: {},
      setMaxImagesPerTurn: (value) => set({ maxImagesPerTurn: normalizeMaxImagesPerTurn(value) }),
      setReasoningEffort: (value) => set({ reasoningEffort: normalizeReasoningEffort(value) }),
      setLastModelChoice: (choice) => set({ lastModelChoice: normalizeModelChoice(choice) }),
      setModelCapabilities: (selection, capabilities) => set((state) => ({
        modelCapabilities: { ...state.modelCapabilities, [agentModelCapabilityKey(selection)]: capabilities },
      })),
    }),
    {
      name: 'agent-settings-storage',
      version: 1,
      merge: (persisted, current) => {
        const record = (persisted ?? {}) as Partial<AgentSettingsState>;
        return {
          ...current,
          maxImagesPerTurn: normalizeMaxImagesPerTurn(record.maxImagesPerTurn ?? current.maxImagesPerTurn),
          reasoningEffort: 'reasoningEffort' in record
            ? normalizeReasoningEffort(record.reasoningEffort)
            : current.reasoningEffort,
          lastModelChoice: normalizeModelChoice(record.lastModelChoice),
          modelCapabilities: record.modelCapabilities && typeof record.modelCapabilities === 'object'
            ? record.modelCapabilities
            : {},
        };
      },
    }
  )
);
