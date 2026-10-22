import { isImageEditNode, type CanvasEdge, type CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { isReusableFailedImageOutput } from './imageOutputBatch';
import { ImageGenerationRunError, runImageGenerationNode, type RunImageGenerationNodeOptions } from './imageGenerationRun';
import { useCanvasStore } from '@/stores/canvasStore';

export function findImageGenerationSource(
  resultNodeId: string,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[]
): string | null {
  for (const edge of edges) {
    if (edge.target === resultNodeId && nodes.some((node) => node.id === edge.source && isImageEditNode(node))) {
      return edge.source;
    }
  }
  return null;
}

export async function retryImageGenerationResult(
  resultNodeId: string,
  options: Pick<RunImageGenerationNodeOptions, 'fallbackErrorMessage' | 'fallbackResultTitle'> = {}
) {
  const { nodes, edges } = useCanvasStore.getState();
  const sourceNodeId = findImageGenerationSource(resultNodeId, nodes, edges);
  if (!sourceNodeId) {
    throw new ImageGenerationRunError('SOURCE_NODE_NOT_FOUND', 'The upstream image generation node is missing or disconnected.');
  }
  const resultNode = nodes.find((node) => node.id === resultNodeId);
  if (!resultNode || !isReusableFailedImageOutput(resultNode)) {
    throw new ImageGenerationRunError('RESULT_NOT_RETRYABLE', 'The result is no longer available for retry.');
  }
  return runImageGenerationNode(sourceNodeId, { ...options, targetResultNodeIds: [resultNodeId] });
}
