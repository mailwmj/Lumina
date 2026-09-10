import type {
  CanvasNode,
  CanvasEdge,
  CanvasWorkflowNode,
} from '../domain/canvasNodes';

interface CanvasNodesState {
  nodes: CanvasNode[];
}

function hasSameWorkflowNodes(
  current: readonly CanvasWorkflowNode[],
  next: readonly CanvasNode[]
): boolean {
  return current.length === next.length && current.every((node, index) => {
    const nextNode = next[index];
    return node.id === nextNode.id
      && node.type === nextNode.type
      && node.data === nextNode.data;
  });
}

export function createWorkflowNodesSelector() {
  let sourceNodes: readonly CanvasNode[] | null = null;
  let workflowNodes: readonly CanvasWorkflowNode[] = [];

  return ({ nodes }: CanvasNodesState): readonly CanvasWorkflowNode[] => {
    if (nodes === sourceNodes) {
      return workflowNodes;
    }
    sourceNodes = nodes;

    if (hasSameWorkflowNodes(workflowNodes, nodes)) {
      return workflowNodes;
    }

    workflowNodes = nodes.map((node) => ({
      id: node.id,
      type: node.type,
      data: node.data,
    }));
    return workflowNodes;
  };
}

export function createSelectedNodeIdsSelector() {
  let sourceNodes: readonly CanvasNode[] | null = null;
  let selectedNodeIds: string[] = [];

  return ({ nodes }: CanvasNodesState): string[] => {
    if (nodes === sourceNodes) {
      return selectedNodeIds;
    }
    sourceNodes = nodes;

    const nextSelectedNodeIds = nodes.flatMap((node) => node.selected ? [node.id] : []);
    const hasSameSelection = selectedNodeIds.length === nextSelectedNodeIds.length
      && selectedNodeIds.every((nodeId, index) => nodeId === nextSelectedNodeIds[index]);
    if (hasSameSelection) {
      return selectedNodeIds;
    }

    selectedNodeIds = nextSelectedNodeIds;
    return selectedNodeIds;
  };
}

export const selectWorkflowNodes = createWorkflowNodesSelector();
export const selectSelectedNodeIds = createSelectedNodeIdsSelector();

// Weak keys release old snapshots after history drops them. All node selectors
// share one index build per snapshot, rather than each scanning the whole canvas.
const nodeIndexes = new WeakMap<readonly CanvasNode[], Map<string, CanvasNode>>();
const edgeIndexes = new WeakMap<readonly CanvasEdge[], Map<string, CanvasEdge[]>>();

function indexNodes(nodes: readonly CanvasNode[]) {
  let index = nodeIndexes.get(nodes);
  if (!index) {
    index = new Map(nodes.map(node => [node.id, node]));
    nodeIndexes.set(nodes, index);
  }
  return index;
}

function indexInputs(edges: readonly CanvasEdge[]) {
  let index = edgeIndexes.get(edges);
  if (!index) {
    index = new Map();
    for (const edge of edges) {
      const incoming = index.get(edge.target) ?? [];
      incoming.push(edge);
      index.set(edge.target, incoming);
    }
    edgeIndexes.set(edges, index);
  }
  return index;
}

export function createNodeSelector(nodeId: string) {
  return ({ nodes }: { nodes: readonly CanvasNode[] }) => indexNodes(nodes).get(nodeId);
}

/** Stable input subgraph, including transitive text sources and original edge order. */
export function createNodeInputGraphSelector(nodeId: string) {
  let lastNodes: readonly CanvasNode[] | null = null;
  let lastEdges: readonly CanvasEdge[] | null = null;
  let dependencies = [nodeId];
  let inputEdges: CanvasEdge[] = [];
  let result: { workflowNodes: CanvasWorkflowNode[]; edges: CanvasEdge[] } = {
    workflowNodes: [], edges: [],
  };
  return (state: { nodes: readonly CanvasNode[]; edges: readonly CanvasEdge[] }) => {
    if (state.nodes === lastNodes && state.edges === lastEdges) return result;
    if (state.edges !== lastEdges) {
      const incoming = indexInputs(state.edges);
      const included = new Set([nodeId]);
      const pending = [nodeId];
      const collected: CanvasEdge[] = [];
      while (pending.length) {
        for (const edge of incoming.get(pending.pop()!) ?? []) {
          collected.push(edge);
          if (!included.has(edge.source)) {
            included.add(edge.source);
            pending.push(edge.source);
          }
        }
      }
      dependencies = [...included];
      // Per-target order is kept by indexInputs, which is all input resolvers use.
      inputEdges = collected;
    }
    lastNodes = state.nodes;
    lastEdges = state.edges;
    const byId = indexNodes(state.nodes);
    const nextNodes = dependencies.flatMap(id => {
      const node = byId.get(id);
      return node ? [{ id: node.id, type: node.type, data: node.data }] : [];
    });
    const sameNodes = nextNodes.length === result.workflowNodes.length
      && nextNodes.every((node, i) => {
        const previous = result.workflowNodes[i];
        return previous.id === node.id && previous.type === node.type && previous.data === node.data;
      });
    const sameEdges = inputEdges.length === result.edges.length
      && inputEdges.every((edge, i) => edge === result.edges[i]);
    if (!sameNodes || !sameEdges) {
      result = { workflowNodes: sameNodes ? result.workflowNodes : nextNodes,
        edges: sameEdges ? result.edges : inputEdges };
    }
    return result;
  };
}
