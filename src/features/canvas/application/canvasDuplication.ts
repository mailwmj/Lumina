import type { CanvasEdge, CanvasNode, CanvasNodeType } from '../domain/canvasNodes';

export interface CanvasDuplicationSnapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface CanvasDuplicationNodeInput {
  type: CanvasNodeType;
  position: CanvasNode['position'];
  data: CanvasNode['data'];
}

/** Copies clipboard contents so later canvas updates cannot mutate the copy. */
export function cloneCanvasDuplicationSnapshot(snapshot: CanvasDuplicationSnapshot): CanvasDuplicationSnapshot {
  if (typeof structuredClone === 'function') {
    return structuredClone(snapshot);
  }
  return JSON.parse(JSON.stringify(snapshot)) as CanvasDuplicationSnapshot;
}

/** Selects the clipboard snapshot for paste, or the current canvas for regular duplication. */
export function selectCanvasDuplicationSource(
  sourceNodeIds: string[],
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  snapshot?: CanvasDuplicationSnapshot
): CanvasDuplicationSnapshot {
  const source = snapshot ?? { nodes, edges };
  const selectedIds = new Set(sourceNodeIds);
  const sourceNodes = source.nodes.filter((node) => selectedIds.has(node.id));
  const sourceIds = new Set(sourceNodes.map((node) => node.id));

  return {
    nodes: sourceNodes,
    edges: sortCanvasEdgesForDuplication(source.edges.filter(
      (edge) => sourceIds.has(edge.source) && sourceIds.has(edge.target)
    )),
  };
}

/** Mirrors addNode's input contract: parentId is not preserved when duplicating a node. */
export function createCanvasDuplicationNodeInput(
  node: CanvasNode,
  position: CanvasNode['position'],
  data: CanvasNode['data'] = node.data
): CanvasDuplicationNodeInput {
  return { type: node.type as CanvasNodeType, position, data };
}

export function remapCanvasDuplicationEdges(
  edges: CanvasEdge[],
  idMap: Map<string, string>
): Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }> {
  return edges.flatMap((edge) => {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    return source && target
      ? [{ source, target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle }]
      : [];
  });
}

/** Keeps each target/type input list in its user-defined order while duplicating a subgraph. */
export function sortCanvasEdgesForDuplication(edges: CanvasEdge[]): CanvasEdge[] {
  return edges
    .map((edge, index) => ({ edge, index }))
    .sort((left, right) => {
      const leftGroup = `${left.edge.target}\u0000${left.edge.data?.valueType ?? ''}`;
      const rightGroup = `${right.edge.target}\u0000${right.edge.data?.valueType ?? ''}`;
      const groupOrder = leftGroup.localeCompare(rightGroup);
      if (groupOrder !== 0) {
        return groupOrder;
      }
      const inputOrder = Number(left.edge.data?.inputOrder ?? 0)
        - Number(right.edge.data?.inputOrder ?? 0);
      return inputOrder || left.index - right.index;
    })
    .map(({ edge }) => edge);
}
