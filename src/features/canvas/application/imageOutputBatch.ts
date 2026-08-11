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
} from '@/features/canvas/domain/canvasNodes';
import { resolveFittedImageNodeSize } from '@/features/canvas/application/imageNodeSizing';
import {
  IMAGE_RESULT_LANE_GAP,
  resolveImageResultBatchPosition,
} from '@/features/canvas/application/imageResultPlacement';
import {
  resolveErrorContent,
  type ResolvedErrorContent,
} from '@/features/canvas/application/errorDialog';
import type { GenerationDebugContext } from '@/features/canvas/application/generationErrorReport';

export interface ImageOutputBatchLayout {
  width: number;
  height: number;
  offsets: Array<{ x: number; y: number }>;
}

const IMAGE_OUTPUT_BATCH_GAP = IMAGE_RESULT_LANE_GAP;

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
  existingEdges: readonly CanvasEdge[];
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

export function resolveImageOutputBatchLayout(
  outputCount: ImageOutputCount,
  nodeWidth: number,
  nodeHeight: number
): ImageOutputBatchLayout {
  if (outputCount === 1) {
    return {
      width: nodeWidth,
      height: nodeHeight,
      offsets: [{ x: 0, y: 0 }],
    };
  }

  const columnCount = outputCount === 2 ? 1 : 2;
  const rowCount = Math.ceil(outputCount / columnCount);
  return {
    width: columnCount * nodeWidth + (columnCount - 1) * IMAGE_OUTPUT_BATCH_GAP,
    height: rowCount * nodeHeight + (rowCount - 1) * IMAGE_OUTPUT_BATCH_GAP,
    offsets: Array.from({ length: outputCount }, (_, index) => ({
      x: (index % columnCount) * (nodeWidth + IMAGE_OUTPUT_BATCH_GAP),
      y: Math.floor(index / columnCount) * (nodeHeight + IMAGE_OUTPUT_BATCH_GAP),
    })),
  };
}

export function createImageOutputBatchNodes({
  sourceNodeId,
  outputCount,
  resultNodeTitle,
  generationStartedAt,
  generationDurationMs,
  aspectRatio = DEFAULT_ASPECT_RATIO,
  existingNodes,
  existingEdges,
  addNodeBatch,
  addEdge,
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
  const layout = resolveImageOutputBatchLayout(outputCount, outputSize.width, outputSize.height);
  const batchPosition = resolveImageResultBatchPosition({
    sourceNodeId,
    nodes: existingNodes,
    edges: existingEdges,
    batchSize: { width: layout.width, height: layout.height },
  });
  const generationBatchId = `${sourceNodeId}:generation:${generationStartedAt}`;

  const nodeIds = addNodeBatch(
    layout.offsets.map((offset, outputIndex) => ({
      type: CANVAS_NODE_TYPES.exportImage,
      width: outputSize.width,
      height: outputSize.height,
      position: {
        x: batchPosition.x + offset.x,
        y: batchPosition.y + offset.y,
      },
      data: {
        aspectRatio,
        isGenerating: true,
        generationStartedAt,
        generationDurationMs,
        resultKind: 'generic',
        displayName: outputCount === 1
          ? resultNodeTitle
          : `${resultNodeTitle} · ${outputIndex + 1}/${outputCount}`,
        generationBatchIndex: outputIndex,
        generationBatchSize: outputCount,
        generationBatchId,
      },
    }))
  );

  return nodeIds.map((nodeId, outputIndex) => {
    addEdge(sourceNodeId, nodeId);
    return { nodeId, outputIndex };
  });
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
    generationClientSessionId: null,
    generationError: resolvedError.message,
    generationErrorDetails: resolvedError.details ?? null,
    generationDebugContext,
  });
  return { resolvedError, generationDebugContext };
}
