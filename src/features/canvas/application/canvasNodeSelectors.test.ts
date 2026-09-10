import { describe, expect, it } from 'vitest';

import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
} from '../domain/canvasNodes';
import {
  createNodeInputGraphSelector,
  createSelectedNodeIdsSelector,
  createWorkflowNodesSelector,
} from './canvasNodeSelectors';

function createUploadNode(id: string): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPES.upload,
    position: { x: 10, y: 20 },
    data: {
      imageUrl: `file://${id}.png`,
      previewImageUrl: null,
      aspectRatio: '1:1',
    },
  };
}

describe('createWorkflowNodesSelector', () => {
  it('preserves its projection for position, selection, and dimension-only updates', () => {
    const selectWorkflowNodes = createWorkflowNodesSelector();
    const node = createUploadNode('upload-1');
    const initial = selectWorkflowNodes({ nodes: [node] });

    const layoutOnly = selectWorkflowNodes({
      nodes: [{
        ...node,
        position: { x: 140, y: 260 },
        selected: true,
        measured: { width: 320, height: 180 },
      }],
    });

    expect(layoutOnly).toBe(initial);
    expect(layoutOnly[0]).toEqual({
      id: node.id,
      type: node.type,
      data: node.data,
    });
    expect(layoutOnly[0]).not.toHaveProperty('position');
  });

  it('invalidates its projection for workflow data, type, add, and remove changes', () => {
    const selectWorkflowNodes = createWorkflowNodesSelector();
    const firstNode = createUploadNode('upload-1');
    const secondNode = createUploadNode('upload-2');
    const initial = selectWorkflowNodes({ nodes: [firstNode] });

    const dataChanged = selectWorkflowNodes({
      nodes: [{
        ...firstNode,
        data: { ...firstNode.data, imageUrl: 'file://updated.png' },
      }],
    });
    expect(dataChanged).not.toBe(initial);

    const typeChanged = selectWorkflowNodes({
      nodes: [{ ...firstNode, type: CANVAS_NODE_TYPES.exportImage }],
    });
    expect(typeChanged).not.toBe(dataChanged);

    const added = selectWorkflowNodes({ nodes: [firstNode, secondNode] });
    expect(added).not.toBe(typeChanged);

    const removed = selectWorkflowNodes({ nodes: [secondNode] });
    expect(removed).not.toBe(added);
  });
});

describe('createSelectedNodeIdsSelector', () => {
  it('updates only when the selected ID sequence changes', () => {
    const selectSelectedNodeIds = createSelectedNodeIdsSelector();
    const node = { ...createUploadNode('upload-1'), selected: true };
    const initial = selectSelectedNodeIds({ nodes: [node] });

    const positionChanged = selectSelectedNodeIds({
      nodes: [{ ...node, position: { x: 90, y: 120 } }],
    });
    expect(positionChanged).toBe(initial);

    const selectionChanged = selectSelectedNodeIds({
      nodes: [{ ...node, selected: false }],
    });
    expect(selectionChanged).not.toBe(initial);
    expect(selectionChanged).toEqual([]);
  });
});

describe('node input graph isolation', () => {
  it('keeps unrelated edits and dragging out of node subscriptions, but follows ancestors and ordered edges', () => {
    const select = createNodeInputGraphSelector('c');
    const nodes = ['a', 'b', 'c', 'unrelated'].map(createUploadNode);
    const edges = [
      { id: 'ab', source: 'a', target: 'b' },
      { id: 'bc', source: 'b', target: 'c' },
      { id: 'ac', source: 'a', target: 'c' },
    ];
    const initial = select({ nodes, edges });
    const moved = nodes.map(node => ({ ...node, position: { x: 100, y: 100 } }));
    expect(select({ nodes: moved, edges })).toBe(initial);
    const unrelated = moved.map(node => node.id === 'unrelated'
      ? { ...node, data: { ...node.data, imageUrl: 'new.png' } } : node);
    expect(select({ nodes: unrelated, edges })).toBe(initial);
    const ancestor = unrelated.map(node => node.id === 'a'
      ? { ...node, data: { ...node.data, imageUrl: 'ancestor.png' } } : node);
    expect(select({ nodes: ancestor, edges })).not.toBe(initial);
    const reordered = select({ nodes: ancestor, edges: [edges[2], edges[0], edges[1]] });
    expect(reordered.edges.filter(edge => edge.target === 'c').map(edge => edge.id)).toEqual(['ac', 'bc']);
    const detached = select({ nodes, edges: [] });
    expect(detached.workflowNodes.map(node => node.id)).toEqual(['c']);
    expect(select({ nodes: [], edges: [] }).workflowNodes).toEqual([]);
  });
  it('terminates for malformed cyclic input and preserves independent selector caches', () => {
    const state = { nodes: ['a', 'b', 'c'].map(createUploadNode), edges: [
      { id: 'ab', source: 'a', target: 'b' }, { id: 'ba', source: 'b', target: 'a' },
    ] };
    const a = createNodeInputGraphSelector('a');
    const c = createNodeInputGraphSelector('c');
    const result = a(state);
    expect(result.workflowNodes).toHaveLength(2);
    expect(c(state).workflowNodes).toHaveLength(1);
    expect(a(state)).toBe(result);
  });
});
