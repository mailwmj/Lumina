import { create } from 'zustand';

export const MAX_RETAINED_ORIGINAL_IMAGE_NODES = 3;

interface CanvasImageQualityState {
  focusedNodeId: string | null;
  isInteractionActive: boolean;
  retainedOriginalNodeIds: string[];
  setFocusedNodeId: (nodeId: string | null) => void;
  setInteractionActive: (active: boolean) => void;
  retainOriginalNode: (nodeId: string) => void;
  retainVisibleOriginalNodes: (visibleNodeIds: readonly string[]) => void;
  clearRetainedOriginalNodes: () => void;
}

export const useCanvasImageQualityStore = create<CanvasImageQualityState>((set) => ({
  focusedNodeId: null,
  isInteractionActive: false,
  retainedOriginalNodeIds: [],
  setFocusedNodeId: (nodeId) => set((state) => (
    state.focusedNodeId === nodeId ? state : { focusedNodeId: nodeId }
  )),
  setInteractionActive: (active) => set((state) => (
    state.isInteractionActive === active ? state : { isInteractionActive: active }
  )),
  retainOriginalNode: (nodeId) => set((state) => {
    const retainedOriginalNodeIds = [
      ...state.retainedOriginalNodeIds.filter((id) => id !== nodeId),
      nodeId,
    ].slice(-MAX_RETAINED_ORIGINAL_IMAGE_NODES);
    return { retainedOriginalNodeIds };
  }),
  retainVisibleOriginalNodes: (visibleNodeIds) => set((state) => {
    const visibleNodeIdSet = new Set(visibleNodeIds);
    const retainedOriginalNodeIds = state.retainedOriginalNodeIds.filter(
      (nodeId) => visibleNodeIdSet.has(nodeId)
    );
    return retainedOriginalNodeIds.length === state.retainedOriginalNodeIds.length
      ? state
      : { retainedOriginalNodeIds };
  }),
  clearRetainedOriginalNodes: () => set((state) => (
    state.retainedOriginalNodeIds.length === 0 ? state : { retainedOriginalNodeIds: [] }
  )),
}));
