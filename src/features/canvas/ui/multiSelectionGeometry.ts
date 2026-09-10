import type { XYPosition } from '@xyflow/react';

interface SelectionNode {
  hidden?: boolean;
  width?: number;
  height?: number;
  measured: { width?: number; height?: number };
  internals: {
    positionAbsolute: XYPosition;
    handleBounds?: { source: Array<{ x: number; y: number; width: number; height: number }> | null };
  };
}

export interface SelectionGeometry {
  connector: XYPosition;
  sourceAnchors: Array<XYPosition & { nodeId: string }>;
}

/** React Flow already measures nodes and handles. Keep the overlay in flow coordinates. */
export function resolveMultiSelectionGeometry(
  nodeLookup: ReadonlyMap<string, SelectionNode>,
  selectedNodeIds: readonly string[],
  sourceNodeIds: readonly string[]
): SelectionGeometry | null {
  if (selectedNodeIds.length < 2 || sourceNodeIds.length < 2) return null;
  const bounds = (id: string) => {
    const node = nodeLookup.get(id);
    if (!node || node.hidden) return null;
    const width = node.measured.width ?? node.width ?? 0;
    const height = node.measured.height ?? node.height ?? 0;
    if (width <= 0 || height <= 0) return null;
    return { node, ...node.internals.positionAbsolute, width, height };
  };
  const selected = selectedNodeIds.flatMap(id => {
    const box = bounds(id);
    return box ? [box] : [];
  });
  if (!selected.length) return null;
  const sourceAnchors = sourceNodeIds.flatMap(nodeId => {
    const box = bounds(nodeId);
    if (!box) return [];
    const handle = box.node.internals.handleBounds?.source?.[0];
    return [{
      nodeId,
      x: box.x + (handle ? handle.x + handle.width / 2 : box.width),
      y: box.y + (handle ? handle.y + handle.height / 2 : box.height / 2),
    }];
  });
  if (sourceAnchors.length < 2) return null;
  return {
    connector: {
      x: Math.max(...selected.map(box => box.x + box.width)),
      y: (Math.min(...selected.map(box => box.y)) + Math.max(...selected.map(box => box.y + box.height))) / 2,
    },
    sourceAnchors,
  };
}

export function haveSameSelectionGeometry(a: SelectionGeometry | null, b: SelectionGeometry | null): boolean {
  if (a === b) return true;
  return Boolean(a && b
    && a.connector.x === b.connector.x && a.connector.y === b.connector.y
    && a.sourceAnchors.length === b.sourceAnchors.length
    && a.sourceAnchors.every((anchor, i) => anchor.nodeId === b.sourceAnchors[i].nodeId
      && anchor.x === b.sourceAnchors[i].x && anchor.y === b.sourceAnchors[i].y));
}
