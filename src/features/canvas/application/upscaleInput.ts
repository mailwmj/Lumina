import {
  DEFAULT_ASPECT_RATIO,
  isExportImageNode,
  isImageEditNode,
  isStoryboardGenNode,
  isUploadNode,
  type CanvasEdge,
  type CanvasWorkflowNode,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { getNodeSourceDataTypes } from '@/features/canvas/domain/nodeRegistry';

export type UpscaleInputErrorCode =
  | 'INPUT_REQUIRED'
  | 'INPUT_COUNT_INVALID'
  | 'INPUT_UNAVAILABLE';

export type UpscaleInputResolution =
  | {
    ok: true;
    sourceNodeId: string;
    sourceImageUrl: string;
    sourceDisplayName: string;
    aspectRatio: string;
  }
  | {
    ok: false;
    code: UpscaleInputErrorCode;
  };

function resolveImageSource(node: CanvasWorkflowNode): string | null {
  if (isUploadNode(node) || isImageEditNode(node) || isExportImageNode(node) || isStoryboardGenNode(node)) {
    const source = node.data.imageUrl;
    return typeof source === 'string' && source.trim() ? source.trim() : null;
  }
  return null;
}

function resolveNodeAspectRatio(node: CanvasWorkflowNode): string {
  if (isUploadNode(node) || isImageEditNode(node) || isExportImageNode(node) || isStoryboardGenNode(node)) {
    const aspectRatio = node.data.aspectRatio;
    return typeof aspectRatio === 'string' && aspectRatio.trim()
      ? aspectRatio.trim()
      : DEFAULT_ASPECT_RATIO;
  }
  return DEFAULT_ASPECT_RATIO;
}

function isImageInputEdge(edge: CanvasEdge, sourceNode: CanvasWorkflowNode): boolean {
  const sourceDataTypes = getNodeSourceDataTypes(sourceNode.type);
  if (edge.data?.valueType) {
    return edge.data.valueType === 'image' && sourceDataTypes.includes('image');
  }
  return sourceDataTypes.length === 1 && sourceDataTypes[0] === 'image';
}

function sortInputEdges(edges: readonly CanvasEdge[]): CanvasEdge[] {
  return edges
    .map((edge, index) => ({ edge, index }))
    .sort((left, right) => {
      const leftOrder = Number.isFinite(left.edge.data?.inputOrder)
        ? Number(left.edge.data?.inputOrder)
        : left.index;
      const rightOrder = Number.isFinite(right.edge.data?.inputOrder)
        ? Number(right.edge.data?.inputOrder)
        : right.index;
      return leftOrder - rightOrder || left.index - right.index;
    })
    .map(({ edge }) => edge);
}

export function resolveUpscaleInput(
  nodeId: string,
  nodes: readonly CanvasWorkflowNode[],
  edges: readonly CanvasEdge[]
): UpscaleInputResolution {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const inputEdges = sortInputEdges(edges.filter((edge) => {
    if (edge.target !== nodeId) {
      return false;
    }
    const sourceNode = nodesById.get(edge.source);
    return Boolean(sourceNode && isImageInputEdge(edge, sourceNode));
  }));

  if (inputEdges.length === 0) {
    return { ok: false, code: 'INPUT_REQUIRED' };
  }
  if (inputEdges.length > 1) {
    return { ok: false, code: 'INPUT_COUNT_INVALID' };
  }

  const sourceNode = nodesById.get(inputEdges[0].source);
  if (!sourceNode) {
    return { ok: false, code: 'INPUT_UNAVAILABLE' };
  }

  const sourceImageUrl = resolveImageSource(sourceNode);
  if (!sourceImageUrl) {
    return { ok: false, code: 'INPUT_UNAVAILABLE' };
  }

  return {
    ok: true,
    sourceNodeId: sourceNode.id,
    sourceImageUrl,
    sourceDisplayName: resolveNodeDisplayName(sourceNode.type, sourceNode.data),
    aspectRatio: resolveNodeAspectRatio(sourceNode),
  };
}
