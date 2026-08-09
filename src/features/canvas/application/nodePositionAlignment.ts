import type { NodeBase, NodeChange, NodePositionChange, XYPosition } from '@xyflow/system';

export const NODE_ALIGNMENT_SNAP_DISTANCE = 12;

interface AlignableNode extends NodeBase {
  position: XYPosition;
  parentId?: string;
}

function isPositionChange<NodeType extends NodeBase>(
  change: NodeChange<NodeType>
): change is NodePositionChange & { position: XYPosition } {
  return change.type === 'position' && Boolean(change.position);
}

function closestCoordinate(
  coordinate: number,
  candidates: number[],
  distance: number
): number | null {
  let nearest: number | null = null;
  let nearestDistance = distance;

  for (const candidate of candidates) {
    const candidateDistance = Math.abs(candidate - coordinate);
    if (candidateDistance <= nearestDistance) {
      nearest = candidate;
      nearestDistance = candidateDistance;
    }
  }

  return nearest;
}

/**
 * Makes a single dragged node magnetically align its top or left edge with a
 * sibling node. Grid snapping remains independent; this also works when the
 * grid is hidden and aligns directly to the thing the user can see.
 */
export function snapNodePositionChanges<NodeType extends AlignableNode>(
  changes: NodeChange<NodeType>[],
  nodes: NodeType[],
  distance = NODE_ALIGNMENT_SNAP_DISTANCE
): NodeChange<NodeType>[] {
  const positionChanges = changes.filter(isPositionChange);
  if (positionChanges.length !== 1) {
    return changes;
  }

  const [positionChange] = positionChanges;
  const movingNode = nodes.find((node) => node.id === positionChange.id);
  if (!movingNode) {
    return changes;
  }

  const siblingNodes = nodes.filter(
    (node) => node.id !== movingNode.id && node.parentId === movingNode.parentId
  );
  const alignedX = closestCoordinate(
    positionChange.position.x,
    siblingNodes.map((node) => node.position.x),
    distance
  );
  const alignedY = closestCoordinate(
    positionChange.position.y,
    siblingNodes.map((node) => node.position.y),
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
