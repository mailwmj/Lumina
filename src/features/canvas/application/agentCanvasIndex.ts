import { create } from 'zustand';
import type { CanvasNode } from '../domain/canvasNodes';
import { getNodeSourceDataTypes } from '../domain/nodeRegistry';

interface AgentCanvasIndexState {
  referencedNodeIds: ReadonlySet<string>;
  originNodeIds: ReadonlySet<string>;
  setReferencedNodeIds: (ids: Iterable<string>) => void;
  setOriginNodeIds: (ids: Iterable<string>) => void;
}

export const useAgentCanvasIndex = create<AgentCanvasIndexState>((set) => ({
  referencedNodeIds: new Set<string>(),
  originNodeIds: new Set<string>(),
  setReferencedNodeIds: (ids) => set({ referencedNodeIds: new Set(ids) }),
  setOriginNodeIds: (ids) => set({ originNodeIds: new Set(ids) }),
}));

// Accept the same data projection used by the toolbars as well as full canvas nodes.
export function canAddNodeToAgentChat(node: Pick<CanvasNode, 'type' | 'data'>): boolean {
  return Boolean(node.type && getNodeSourceDataTypes(node.type).includes('image'))
    && Boolean(node.data.previewImageUrl || node.data.imageUrl)
    && node.data.isGenerating !== true;
}
