import { create } from 'zustand';

interface CanvasImageQualityState {
  focusedNodeId: string | null;
  isInteractionActive: boolean;
  setFocusedNodeId: (nodeId: string | null) => void;
  setInteractionActive: (active: boolean) => void;
}

export const useCanvasImageQualityStore = create<CanvasImageQualityState>((set) => ({
  focusedNodeId: null,
  isInteractionActive: false,
  setFocusedNodeId: (nodeId) => set((state) => (
    state.focusedNodeId === nodeId ? state : { focusedNodeId: nodeId }
  )),
  setInteractionActive: (active) => set((state) => (
    state.isInteractionActive === active ? state : { isInteractionActive: active }
  )),
}));
