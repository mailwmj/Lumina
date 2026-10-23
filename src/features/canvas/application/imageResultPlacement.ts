import {
  DEFAULT_NODE_WIDTH,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';

export interface ImageResultBatchSize {
  width: number;
  height: number;
}

export interface ImageResultBatchPlacementInput {
  sourceNodeId: string;
  nodes: readonly CanvasNode[];
  resultSize: ImageResultBatchSize;
  resultCount: number;
}

interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Horizontal distance from the source node, leaving room for the visible connection. */
export const IMAGE_RESULT_SOURCE_GAP = 72;
/** Distance between results of one batch; smaller than the batch gap so a batch reads as a unit. */
export const IMAGE_RESULT_ITEM_GAP = 16;
/** Minimum clearance between a new batch and any existing node, including earlier batches. */
export const IMAGE_RESULT_BATCH_GAP = 48;

const FALLBACK_ORIGIN = { x: 100, centerY: 100 };

function resolveNodeSize(node: CanvasNode): ImageResultBatchSize {
  const styleWidth = typeof node.style?.width === 'number' ? node.style.width : null;
  const styleHeight = typeof node.style?.height === 'number' ? node.style.height : null;
  const declaredWidth = typeof node.width === 'number' ? node.width : null;
  const declaredHeight = typeof node.height === 'number' ? node.height : null;

  return {
    width: node.measured?.width ?? declaredWidth ?? styleWidth ?? DEFAULT_NODE_WIDTH,
    height: node.measured?.height ?? declaredHeight ?? styleHeight ?? 200,
  };
}

function resolveAbsolutePosition(
  node: CanvasNode,
  nodesById: ReadonlyMap<string, CanvasNode>
): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  const visited = new Set<string>();

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodesById.get(parentId);
    if (!parent) {
      break;
    }
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }

  return { x, y };
}

function resolveNodeRect(
  node: CanvasNode,
  nodesById: ReadonlyMap<string, CanvasNode>
): CanvasRect {
  const position = resolveAbsolutePosition(node, nodesById);
  const size = resolveNodeSize(node);
  return { ...position, ...size };
}

function rectsCollide(left: CanvasRect, right: CanvasRect): boolean {
  return (
    left.x < right.x + right.width + IMAGE_RESULT_BATCH_GAP
    && left.x + left.width + IMAGE_RESULT_BATCH_GAP > right.x
    && left.y < right.y + right.height + IMAGE_RESULT_BATCH_GAP
    && left.y + left.height + IMAGE_RESULT_BATCH_GAP > right.y
  );
}

function resolveBatchGrid(resultCount: number): { columns: number; rows: number } {
  // 1 result: single slot; 2: vertical comparison strip; 3-4: 2x2 grid.
  const columns = resultCount > 2 ? 2 : 1;
  return { columns, rows: Math.ceil(resultCount / columns) };
}

/**
 * Finds the left-most free spot for the whole batch block, starting next to the source.
 * Candidates are the origin and the right clearance edge of each nearby obstacle; for each
 * one the block may shift vertically by at most half its height to stay visually attached.
 */
function resolveBatchBlockPosition(
  origin: { x: number; centerY: number },
  block: ImageResultBatchSize,
  obstacles: readonly CanvasRect[]
): { x: number; y: number } {
  const centeredY = origin.centerY - block.height / 2;
  const maxShift = block.height / 2;
  const bandTop = centeredY - maxShift - IMAGE_RESULT_BATCH_GAP;
  const bandBottom = centeredY + block.height + maxShift + IMAGE_RESULT_BATCH_GAP;
  const bandObstacles = obstacles.filter((obstacle) => (
    obstacle.y < bandBottom && obstacle.y + obstacle.height > bandTop
  ));
  const candidateXs = Array.from(new Set([
    origin.x,
    ...bandObstacles
      .map((obstacle) => obstacle.x + obstacle.width + IMAGE_RESULT_BATCH_GAP)
      .filter((x) => x > origin.x),
  ])).sort((left, right) => left - right);

  for (const x of candidateXs) {
    const columnObstacles = bandObstacles.filter((obstacle) => (
      obstacle.x < x + block.width + IMAGE_RESULT_BATCH_GAP
      && obstacle.x + obstacle.width + IMAGE_RESULT_BATCH_GAP > x
    ));
    const candidateYs = [
      centeredY,
      ...columnObstacles.flatMap((obstacle) => [
        obstacle.y + obstacle.height + IMAGE_RESULT_BATCH_GAP,
        obstacle.y - IMAGE_RESULT_BATCH_GAP - block.height,
      ]),
    ]
      .filter((y) => Math.abs(y - centeredY) <= maxShift)
      .sort((left, right) => Math.abs(left - centeredY) - Math.abs(right - centeredY));
    const y = candidateYs.find((candidateY) => !columnObstacles.some((obstacle) => (
      rectsCollide({ x, y: candidateY, ...block }, obstacle)
    )));
    if (y !== undefined) {
      return { x, y };
    }
  }

  // Unreachable: the last candidate lies right of every band obstacle, so its centered row is free.
  return { x: candidateXs[candidateXs.length - 1], y: centeredY };
}

/**
 * Places one generation batch to the right of its source node as a single block:
 * one result is centered on the source, two form a vertical strip, four form a 2x2 grid.
 * The block takes the free spot closest to the source, so space left by deleted results is
 * reused once the whole batch fits. Existing nodes, including groups, are obstacles and are
 * never moved; the block never jumps to the left of the source.
 */
export function resolveImageResultBatchPositions({
  sourceNodeId,
  nodes,
  resultSize,
  resultCount,
}: ImageResultBatchPlacementInput): Array<{ x: number; y: number }> {
  const safeResultCount = Math.max(0, Math.floor(resultCount));
  if (safeResultCount === 0) {
    return [];
  }

  const { columns, rows } = resolveBatchGrid(safeResultCount);
  const block = {
    width: columns * resultSize.width + (columns - 1) * IMAGE_RESULT_ITEM_GAP,
    height: rows * resultSize.height + (rows - 1) * IMAGE_RESULT_ITEM_GAP,
  };
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const sourceNode = nodesById.get(sourceNodeId);
  let blockPosition: { x: number; y: number };

  if (sourceNode) {
    const sourceRect = resolveNodeRect(sourceNode, nodesById);
    const obstacles = nodes
      .filter((node) => node.id !== sourceNodeId)
      .map((node) => resolveNodeRect(node, nodesById));
    blockPosition = resolveBatchBlockPosition(
      {
        x: sourceRect.x + sourceRect.width + IMAGE_RESULT_SOURCE_GAP,
        centerY: sourceRect.y + sourceRect.height / 2,
      },
      block,
      obstacles
    );
  } else {
    blockPosition = { x: FALLBACK_ORIGIN.x, y: FALLBACK_ORIGIN.centerY - block.height / 2 };
  }

  return Array.from({ length: safeResultCount }, (_, index) => ({
    x: Math.round(
      blockPosition.x + (index % columns) * (resultSize.width + IMAGE_RESULT_ITEM_GAP)
    ),
    y: Math.round(
      blockPosition.y + Math.floor(index / columns) * (resultSize.height + IMAGE_RESULT_ITEM_GAP)
    ),
  }));
}
