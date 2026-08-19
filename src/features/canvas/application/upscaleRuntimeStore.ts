import { create } from 'zustand';

import type { UpscaleCommandErrorCode } from '@/commands/upscale';

export type UpscaleRuntimeStatus =
  | 'idle'
  | 'starting'
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type UpscaleRuntimeErrorCode =
  | UpscaleCommandErrorCode
  | 'NODE_NOT_FOUND'
  | 'PROJECT_REQUIRED'
  | 'INPUT_REQUIRED'
  | 'INPUT_COUNT_INVALID'
  | 'INPUT_UNAVAILABLE'
  | 'RESULT_UNAVAILABLE';

export interface UpscaleNodeRuntime {
  status: UpscaleRuntimeStatus;
  jobId: string | null;
  progress: number | null;
  errorCode: UpscaleRuntimeErrorCode | null;
  error: string | null;
  resultNodeId: string | null;
}

interface UpscaleRuntimeState {
  runtimesByNodeId: Record<string, UpscaleNodeRuntime | undefined>;
  setRuntime: (nodeId: string, patch: Partial<UpscaleNodeRuntime>) => void;
  clearRuntime: (nodeId: string) => void;
  clearAllRuntimes: () => void;
}

export function createIdleUpscaleRuntime(): UpscaleNodeRuntime {
  return {
    status: 'idle',
    jobId: null,
    progress: null,
    errorCode: null,
    error: null,
    resultNodeId: null,
  };
}

export function isUpscaleRuntimeActive(status: UpscaleRuntimeStatus): boolean {
  return status === 'starting'
    || status === 'queued'
    || status === 'running'
    || status === 'cancelling';
}

export const useUpscaleRuntimeStore = create<UpscaleRuntimeState>((set) => ({
  runtimesByNodeId: {},
  setRuntime: (nodeId, patch) => {
    set((state) => ({
      runtimesByNodeId: {
        ...state.runtimesByNodeId,
        [nodeId]: {
          ...(state.runtimesByNodeId[nodeId] ?? createIdleUpscaleRuntime()),
          ...patch,
        },
      },
    }));
  },
  clearRuntime: (nodeId) => {
    set((state) => {
      if (!(nodeId in state.runtimesByNodeId)) {
        return state;
      }
      const runtimesByNodeId = { ...state.runtimesByNodeId };
      delete runtimesByNodeId[nodeId];
      return { runtimesByNodeId };
    });
  },
  clearAllRuntimes: () => set((state) => (
    Object.keys(state.runtimesByNodeId).length === 0
      ? state
      : { runtimesByNodeId: {} }
  )),
}));
