import { useCanvasStore } from '@/stores/canvasStore';
import { CANVAS_NODE_TYPES, isExportImageNode, isUploadNode, type CanvasWorkflowNode } from '../domain/canvasNodes';
import { createImageReferencePromptToken } from './imageReferencePrompt';
import { resolveImageResultBatchPositions } from './imageResultPlacement';
import { resolveTextGenerationLayout } from './textGenerationLayout';

// One-shot port: React may mount the new node after the toolbar action returns.
const pendingReferences = new Map<string, string>();

export function takeContinueFromImageReference(nodeId: string): string | undefined {
  const edgeId = pendingReferences.get(nodeId);
  pendingReferences.delete(nodeId);
  return edgeId;
}

export function canContinueFromImage(node: CanvasWorkflowNode): boolean {
  return (isUploadNode(node) || isExportImageNode(node))
    && Boolean(node.data.imageUrl)
    && !node.data.isGenerating && !node.data.generationError;
}

export function continueFromImage(sourceNodeId: string): { nodeId: string; edgeId: string } | null {
  const state = useCanvasStore.getState();
  const source = state.nodes.find((node) => node.id === sourceNodeId);
  if (!source || !canContinueFromImage(source)) return null;
  const size = resolveTextGenerationLayout({ hasImageContext: true, hasResult: false });
  const [position] = resolveImageResultBatchPositions({
    sourceNodeId, nodes: state.nodes, resultSize: size, resultCount: 1,
  });
  // addEdge and initialization do not add history; the batch snapshot covers the entire action.
  // addNodeBatch uses the same registry and remembered model/options as menu creation.
  const [nodeId] = state.addNodeBatch([{ type: CANVAS_NODE_TYPES.imageEdit, position }]);
  const edgeId = state.addEdge(sourceNodeId, nodeId)!;
  state.updateNodeDataWithoutHistory(nodeId, { prompt: createImageReferencePromptToken(edgeId) });
  state.onNodesChange(useCanvasStore.getState().nodes.map((node) => ({
    id: node.id, type: 'select' as const, selected: node.id === nodeId,
  })));
  state.setSelectedNode(nodeId);
  // Discard unconsumed requests for nodes removed before React mounted them (e.g. immediate undo).
  for (const id of pendingReferences.keys()) {
    if (!useCanvasStore.getState().nodes.some((node) => node.id === id)) pendingReferences.delete(id);
  }
  pendingReferences.set(nodeId, edgeId);
  return { nodeId, edgeId };
}
