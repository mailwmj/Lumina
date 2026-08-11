import {
  CANVAS_NODE_TYPES,
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
  batchSize: ImageResultBatchSize;
}

interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const IMAGE_RESULT_LANE_GAP = 28;

const MAX_VERTICAL_LANE_STEPS = 4;
const MAX_LANE_COLUMNS = 6;

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
    left.x < right.x + right.width + IMAGE_RESULT_LANE_GAP
    && left.x + left.width + IMAGE_RESULT_LANE_GAP > right.x
    && left.y < right.y + right.height + IMAGE_RESULT_LANE_GAP
    && left.y + left.height + IMAGE_RESULT_LANE_GAP > right.y
  );
}

function verticalLaneOffsets(): number[] {
  const offsets = [0];
  for (let step = 1; step <= MAX_VERTICAL_LANE_STEPS; step += 1) {
    offsets.push(step, -step);
  }
  return offsets;
}

/**
 * Finds the nearest available position in the result lane to the right of an image node.
 * Existing nodes are never moved and viewport visibility never changes the
 * direction of the result branch.
 */
export function resolveImageResultBatchPosition({
  sourceNodeId,
  nodes,
  batchSize,
}: ImageResultBatchPlacementInput): { x: number; y: number } {
  const sourceNode = nodes.find((node) => node.id === sourceNodeId);
  if (!sourceNode) {
    return { x: 100, y: 100 };
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const sourceRect = resolveNodeRect(sourceNode, nodesById);
  const baseX = sourceRect.x + sourceRect.width + IMAGE_RESULT_LANE_GAP;
  const baseY = sourceRect.y + sourceRect.height / 2 - batchSize.height / 2;
  const verticalStep = batchSize.height + IMAGE_RESULT_LANE_GAP;
  const horizontalStep = batchSize.width + IMAGE_RESULT_LANE_GAP;
  const ignoredNodeIds = new Set([sourceNodeId]);
  const obstacleNodes = nodes.filter(
    (node) => node.type !== CANVAS_NODE_TYPES.group && !ignoredNodeIds.has(node.id)
  );

  const collidesWithCanvas = (candidate: CanvasRect): boolean => obstacleNodes.some((node) => (
    rectsCollide(candidate, resolveNodeRect(node, nodesById))
  ));

  for (let column = 0; column <= MAX_LANE_COLUMNS; column += 1) {
    const x = baseX + column * horizontalStep;
    for (const verticalOffset of verticalLaneOffsets()) {
      const candidate = {
        x,
        y: baseY + verticalOffset * verticalStep,
        width: batchSize.width,
        height: batchSize.height,
      };
      if (!collidesWithCanvas(candidate)) {
        return { x: Math.round(candidate.x), y: Math.round(candidate.y) };
      }
    }
  }

  const rightmostObstacleEdge = obstacleNodes.reduce((rightEdge, node) => {
    const rect = resolveNodeRect(node, nodesById);
    return Math.max(rightEdge, rect.x + rect.width);
  }, baseX - IMAGE_RESULT_LANE_GAP);
  return {
    x: Math.round(Math.max(baseX, rightmostObstacleEdge + IMAGE_RESULT_LANE_GAP)),
    y: Math.round(baseY),
  };
}
