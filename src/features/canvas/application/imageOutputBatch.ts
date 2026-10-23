import {
  DEFAULT_ASPECT_RATIO,
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasNodeType,
  type ImageOutputCount,
  type ExportImageNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveFittedImageNodeSize } from '@/features/canvas/application/imageNodeSizing';
import {
  resolveImageResultBatchPositions,
} from '@/features/canvas/application/imageResultPlacement';
import {
  resolveErrorContent,
  type ResolvedErrorContent,
} from '@/features/canvas/application/errorDialog';
import type { GenerationDebugContext } from '@/features/canvas/application/generationErrorReport';

export interface ImageOutputBatchNode {
  nodeId: string;
  outputIndex: number;
}

interface CreateImageOutputBatchInput {
  sourceNodeId: string;
  outputCount: ImageOutputCount;
  aspectRatio?: string;
  resultNodeTitle: string;
  generationStartedAt: number;
  generationDurationMs: number;
  existingNodes: readonly CanvasNode[];
  targetResultNodeIds?: readonly string[];
  updateNodeData?: (nodeId: string, data: Partial<CanvasNodeData>) => void;
  addNodeBatch: (
    nodes: Array<{
      type: CanvasNodeType;
      position: { x: number; y: number };
      data?: Partial<CanvasNodeData>;
      width?: number;
      height?: number;
    }>
  ) => string[];
  addEdge: (source: string, target: string) => string | null;
}

interface MarkImageOutputNodeFailedInput {
  nodeId: string;
  generationError: unknown;
  fallbackMessage: string;
  generationDebugContext: GenerationDebugContext;
  updateNodeData: (nodeId: string, data: Partial<CanvasNodeData>) => void;
}

export interface ImageOutputNodeFailure {
  resolvedError: ResolvedErrorContent;
  generationDebugContext: GenerationDebugContext;
}

export function createImageOutputBatchNodes({
  sourceNodeId,
  outputCount,
  resultNodeTitle,
  generationStartedAt,
  generationDurationMs,
  aspectRatio = DEFAULT_ASPECT_RATIO,
  existingNodes,
  addNodeBatch,
  addEdge,
  targetResultNodeIds = [],
  updateNodeData,
}: CreateImageOutputBatchInput): ImageOutputBatchNode[] {
  const outputSize = resolveFittedImageNodeSize(
    aspectRatio,
    {
      width: EXPORT_RESULT_NODE_DEFAULT_WIDTH,
      height: EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
    },
    {
      minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
      minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
    }
  );
  const newCount = outputCount - targetResultNodeIds.length;
  const placements = newCount > 0 ? resolveImageResultBatchPositions({
    sourceNodeId,
    nodes: existingNodes,
    resultSize: outputSize,
    resultCount: newCount,
  }) : [];
  const generationBatchId = `${sourceNodeId}:generation:${generationStartedAt}`;

  const buildData = (outputIndex: number): Partial<CanvasNodeData> => ({
    aspectRatio,
    isGenerating: true,
    generationStartedAt,
    generationDurationMs,
    generationJobId: null,
    generationError: null,
    generationErrorDetails: null,
    generationDebugContext: undefined,
    generationProviderId: null,
    generationProviderName: null,
    generationModelName: null,
    generationClientSessionId: null,
    generationRecoveryState: null,
    generationRetryCount: 0,
    generationNextRetryAt: null,
    generationRetryError: null,
    resultKind: 'generic',
    displayName: outputCount === 1
      ? resultNodeTitle
      : `${resultNodeTitle} · ${outputIndex + 1}/${outputCount}`,
    generationBatchIndex: outputIndex,
    generationBatchSize: outputCount,
    generationBatchId,
  });
  targetResultNodeIds.forEach((nodeId, outputIndex) => {
    updateNodeData?.(nodeId, buildData(outputIndex));
  });
  const nodeIds = placements.length > 0 ? addNodeBatch(
    placements.map((position, index) => ({
      type: CANVAS_NODE_TYPES.exportImage,
      width: outputSize.width,
      height: outputSize.height,
      position,
      data: buildData(targetResultNodeIds.length + index),
    }))
  ) : [];
  nodeIds.forEach((nodeId) => addEdge(sourceNodeId, nodeId));
  return [...targetResultNodeIds, ...nodeIds].map((nodeId, outputIndex) => ({ nodeId, outputIndex }));
}

export function markImageOutputNodeFailed({
  nodeId,
  generationError,
  fallbackMessage,
  generationDebugContext,
  updateNodeData,
}: MarkImageOutputNodeFailedInput): ImageOutputNodeFailure {
  const resolvedError = resolveErrorContent(generationError, fallbackMessage);
  updateNodeData(nodeId, {
    isGenerating: false,
    generationStartedAt: null,
    generationJobId: null,
    generationProviderId: null,
    generationProviderName: null,
    generationModelName: null,
    generationClientSessionId: null,
    generationError: resolvedError.message,
    generationErrorDetails: resolvedError.details ?? null,
    generationDebugContext,
    generationRecoveryState: null,
    generationRetryCount: 0,
    generationNextRetryAt: null,
    generationRetryError: null,
  });
  return { resolvedError, generationDebugContext };
}

export function isImageGenerationOutput(data: ExportImageNodeData): boolean {
  // A generic export may also come from other tools; only explicit provenance is retryable.
  const context = data.generationDebugContext;
  return typeof context === 'object' && context !== null
    && 'sourceType' in context && context.sourceType === 'imageEdit';
}

export function isReusableFailedImageOutput(node: CanvasNode): boolean {
  const data = node.data as Record<string, unknown>;
  return node.type === CANVAS_NODE_TYPES.exportImage
    && isImageGenerationOutput(node.data as ExportImageNodeData)
    && typeof data.generationError === 'string' && data.generationError.trim().length > 0
    && !data.imageUrl && !data.isGenerating;
}

export function findReusableImageOutputs(
  sourceNodeId: string,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[]
): string[] {
  const targets = new Set(edges.filter((edge) => edge.source === sourceNodeId).map((edge) => edge.target));
  return nodes.filter((node) => targets.has(node.id) && isReusableFailedImageOutput(node)).map((node) => node.id);
}

/** Picks failed placeholders from a single earlier batch so one rerun never splits across two places. */
export function selectReusableImageOutputBatch(
  reusableIds: readonly string[],
  nodes: readonly CanvasNode[],
  outputCount: number
): string[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const batches = new Map<string, CanvasNode[]>();
  reusableIds.forEach((nodeId) => {
    const node = nodesById.get(nodeId);
    if (!node) return;
    const batchId = (node.data as ExportImageNodeData).generationBatchId ?? nodeId;
    batches.set(batchId, [...(batches.get(batchId) ?? []), node]);
  });
  // Later batches were added later, so prefer the most recent failure the user is looking at.
  const batch = Array.from(batches.values()).reverse().find((members) => members.length >= outputCount);
  if (!batch) return [];
  const batchIndexOf = (node: CanvasNode) => (node.data as ExportImageNodeData).generationBatchIndex ?? 0;
  return [...batch].sort((left, right) => batchIndexOf(left) - batchIndexOf(right))
    .slice(0, outputCount).map((node) => node.id);
}
