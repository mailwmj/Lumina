import type { NodeBase, NodeChange, NodePositionChange, XYPosition } from '@xyflow/system';

// Both distances are in screen pixels and get converted with the viewport zoom.
export const NODE_ALIGNMENT_SNAP_DISTANCE = 6;
export const NODE_ALIGNMENT_NEIGHBOR_RANGE = 240;

interface AlignableNode extends NodeBase {
  position: XYPosition;
  parentId?: string;
}

type NodeDimension = 'width' | 'height';

export function resolveCenterPreservingPositionY(
  currentY: number,
  previousHeight: number,
  nextHeight: number
): number {
  return currentY + (previousHeight - nextHeight) / 2;
}

function isPositionChange<NodeType extends NodeBase>(
  change: NodeChange<NodeType>
): change is NodePositionChange & { position: XYPosition } {
  return change.type === 'position' && Boolean(change.position);
}

function offsetPositionChange(
  change: NodePositionChange & { position: XYPosition },
  delta: XYPosition
): NodePositionChange {
  return {
    ...change,
    position: {
      x: change.position.x + delta.x,
      y: change.position.y + delta.y,
    },
    positionAbsolute: change.positionAbsolute
      ? {
        x: change.positionAbsolute.x + delta.x,
        y: change.positionAbsolute.y + delta.y,
      }
      : undefined,
  };
}

function resolveNodeDimension(node: AlignableNode, dimension: NodeDimension): number | null {
  const measured = node.measured?.[dimension];
  if (typeof measured === 'number' && Number.isFinite(measured)) {
    return measured;
  }

  const declared = node[dimension];
  return typeof declared === 'number' && Number.isFinite(declared) ? declared : null;
}

function alignmentOffsets(size: number | null): number[] {
  return size === null ? [0] : [0, size / 2, size];
}

function intervalGap(startA: number, sizeA: number | null, startB: number, sizeB: number | null): number {
  const endA = startA + (sizeA ?? 0);
  const endB = startB + (sizeB ?? 0);
  return Math.max(0, startB - endA, startA - endB);
}

function isAlignmentNeighbor(
  position: XYPosition,
  movingNode: AlignableNode,
  siblingNode: AlignableNode,
  range: number
): boolean {
  const gapX = intervalGap(
    position.x,
    resolveNodeDimension(movingNode, 'width'),
    siblingNode.position.x,
    resolveNodeDimension(siblingNode, 'width')
  );
  const gapY = intervalGap(
    position.y,
    resolveNodeDimension(movingNode, 'height'),
    siblingNode.position.y,
    resolveNodeDimension(siblingNode, 'height')
  );
  return gapX <= range && gapY <= range;
}

function closestAlignedCoordinate(
  coordinate: number,
  movingSize: number | null,
  siblingNodes: AlignableNode[],
  axis: keyof XYPosition,
  dimension: NodeDimension,
  distance: number
): number | null {
  const movingOffsets = alignmentOffsets(movingSize);
  let nearest: number | null = null;
  let nearestDistance = distance;

  for (const siblingNode of siblingNodes) {
    const siblingOffsets = alignmentOffsets(resolveNodeDimension(siblingNode, dimension));
    const comparableAnchorCount = Math.min(movingOffsets.length, siblingOffsets.length);

    for (let index = 0; index < comparableAnchorCount; index += 1) {
      const candidate = siblingNode.position[axis] + siblingOffsets[index] - movingOffsets[index];
      const candidateDistance = Math.abs(candidate - coordinate);
      if (candidateDistance <= nearestDistance) {
        nearest = candidate;
        nearestDistance = candidateDistance;
      }
    }
  }

  return nearest;
}

/**
 * Aligns a single node on release, unless grid snapping owns its final position.
 * Thresholds are screen-space so the magnet feels the same at every zoom level,
 * and only nearby siblings participate so distant nodes don't make drags stutter.
 */
export function snapNodePositionChanges<NodeType extends AlignableNode>(
  changes: NodeChange<NodeType>[],
  nodes: NodeType[],
  zoom = 1,
  snapToGrid = false
): NodeChange<NodeType>[] {
  const positionChanges = changes.filter(isPositionChange);
  if (snapToGrid || positionChanges.length !== 1 || positionChanges[0].dragging !== false) {
    return changes;
  }

  const [positionChange] = positionChanges;
  const movingNode = nodes.find((node) => node.id === positionChange.id);
  if (!movingNode) {
    return changes;
  }

  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const distance = NODE_ALIGNMENT_SNAP_DISTANCE / scale;
  const neighborRange = NODE_ALIGNMENT_NEIGHBOR_RANGE / scale;
  const siblingNodes = nodes.filter(
    (node) => node.id !== movingNode.id
      && node.parentId === movingNode.parentId
      && isAlignmentNeighbor(positionChange.position, movingNode, node, neighborRange)
  );
  const alignedX = closestAlignedCoordinate(
    positionChange.position.x,
    resolveNodeDimension(movingNode, 'width'),
    siblingNodes,
    'x',
    'width',
    distance
  );
  const alignedY = closestAlignedCoordinate(
    positionChange.position.y,
    resolveNodeDimension(movingNode, 'height'),
    siblingNodes,
    'y',
    'height',
    distance
  );

  if (alignedX === null && alignedY === null) {
    return changes;
  }

  const delta = {
    x: (alignedX ?? positionChange.position.x) - positionChange.position.x,
    y: (alignedY ?? positionChange.position.y) - positionChange.position.y,
  };

  return changes.map((change) => (
    change === positionChange ? offsetPositionChange(positionChange, delta) : change
  ));
}

/**
 * Snaps the final positions of a finished drag to the grid. Dragging itself
 * stays free so it follows the pointer smoothly; multi-node drags share the
 * offset of the first node to keep their relative layout intact.
 */
export function snapDragEndPositionsToGrid<NodeType extends NodeBase>(
  changes: NodeChange<NodeType>[],
  gridSize: number
): NodeChange<NodeType>[] {
  const dragEndChanges = changes.filter(
    (change): change is NodePositionChange & { position: XYPosition } => (
      isPositionChange(change) && change.dragging === false
    )
  );
  const [referenceChange] = dragEndChanges;
  const dragEndChangeSet = new Set<NodeChange<NodeType>>(dragEndChanges);
  if (!referenceChange || !Number.isFinite(gridSize) || gridSize <= 0) {
    return changes;
  }

  const { x, y } = referenceChange.position;
  const delta = {
    x: Math.round(x / gridSize) * gridSize - x,
    y: Math.round(y / gridSize) * gridSize - y,
  };
  if (delta.x === 0 && delta.y === 0) {
    return changes;
  }

  return changes.map((change) => (
    isPositionChange(change) && dragEndChangeSet.has(change)
      ? offsetPositionChange(change, delta)
      : change
  ));
}
