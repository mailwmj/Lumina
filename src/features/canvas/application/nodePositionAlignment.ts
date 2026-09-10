import type { NodeBase, NodeChange, NodePositionChange, XYPosition } from '@xyflow/system';

export const NODE_ALIGNMENT_SNAP_DISTANCE = 6;

interface AlignableNode extends NodeBase {
  position: XYPosition;
  parentId?: string;
}

type NodeDimension = 'width' | 'height';

interface NodeAlignmentOptions {
  zoom?: number;
  snapToGrid?: boolean;
}

const NODE_ALIGNMENT_NEIGHBOR_DISTANCE = 160;

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

/** Align a single drop to nearby siblings; never resist the pointer during a drag. */
export function snapNodePositionChanges<NodeType extends AlignableNode>(
  changes: NodeChange<NodeType>[],
  nodes: NodeType[],
  { zoom = 1, snapToGrid = false }: NodeAlignmentOptions = {}
): NodeChange<NodeType>[] {
  if (snapToGrid) return changes;
  const positionChanges = changes.filter(isPositionChange);
  if (positionChanges.length !== 1) {
    return changes;
  }

  const [positionChange] = positionChanges;
  // Programmatic moves and active drags must retain their exact coordinates.
  if (positionChange.dragging !== false) return changes;
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const distance = NODE_ALIGNMENT_SNAP_DISTANCE / scale;
  const neighborDistance = NODE_ALIGNMENT_NEIGHBOR_DISTANCE / scale;
  const movingNode = nodes.find((node) => node.id === positionChange.id);
  if (!movingNode) {
    return changes;
  }

  const movingWidth = resolveNodeDimension(movingNode, 'width') ?? 0;
  const movingHeight = resolveNodeDimension(movingNode, 'height') ?? 0;
  const { x, y } = positionChange.position;
  const siblingNodes = nodes.filter((node) => {
    if (node.id === movingNode.id || node.parentId !== movingNode.parentId || node.hidden) {
      return false;
    }
    const width = resolveNodeDimension(node, 'width') ?? 0;
    const height = resolveNodeDimension(node, 'height') ?? 0;
    const gapX = Math.max(0, node.position.x - x - movingWidth, x - node.position.x - width);
    const gapY = Math.max(0, node.position.y - y - movingHeight, y - node.position.y - height);
    return Math.hypot(gapX, gapY) <= neighborDistance;
  });
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

  const snappedPosition = {
    x: alignedX ?? positionChange.position.x,
    y: alignedY ?? positionChange.position.y,
  };
  const delta = {
    x: snappedPosition.x - positionChange.position.x,
    y: snappedPosition.y - positionChange.position.y,
  };

  return changes.map((change) => {
    if (change !== positionChange) {
      return change;
    }
    return {
      ...change,
      position: snappedPosition,
      positionAbsolute: change.positionAbsolute
        ? {
          x: change.positionAbsolute.x + delta.x,
          y: change.positionAbsolute.y + delta.y,
        }
        : undefined,
    };
  });
}
