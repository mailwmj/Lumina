import { afterEach, describe, expect, it } from 'vitest';
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from './canvasStore';

const store = () => useCanvasStore.getState();
afterEach(() => store().setCanvasData([], []));

function pastePair() {
  store().beginHistoryBatch();
  try {
    const text = store().addNode(CANVAS_NODE_TYPES.textGeneration, { x: 10, y: 20 });
    const image = store().addNode(CANVAS_NODE_TYPES.imageEdit, { x: 500, y: 20 });
    store().onNodesChange([text, image].map(id => ({
      id, type: 'dimensions' as const, dimensions: { width: 300, height: 200 }, setAttributes: true,
    })));
    store().onConnect({ source: text, target: image, sourceHandle: 'source', targetHandle: 'target' });
    return [text, image];
  } finally {
    store().endHistoryBatch();
  }
}

describe('canvas history batches', () => {
  it('undoes and redoes nodes, sizes and internal edges together without an empty step', () => {
    pastePair();
    const before = { nodes: store().nodes, edges: store().edges };
    const ids = pastePair();
    const pasted = { nodes: store().nodes, edges: store().edges };
    expect(store().history.past).toHaveLength(2);
    expect(store().undo()).toBe(true);
    expect(store().nodes).toEqual(before.nodes);
    expect(store().edges).toEqual(before.edges);
    expect(store().redo()).toBe(true);
    expect(store().nodes).toEqual(pasted.nodes);
    expect(store().edges).toEqual(pasted.edges);
    expect(store().nodes.find(node => node.id === ids[0])).toMatchObject({ width: 300, height: 200 });
    expect(store().undo()).toBe(true);
    expect(store().undo()).toBe(true);
    expect(store().nodes).toHaveLength(0);
    expect(store().undo()).toBe(false);
  });

  it('includes Alt drag movement and nested duplication in one undo checkpoint', () => {
    pastePair();
    const before = { nodes: store().nodes, edges: store().edges };
    store().beginHistoryBatch();
    const ids = pastePair();
    for (const dragging of [true, true, false, false]) {
      store().onNodesChange(ids.map(id => ({ id, type: 'position', position: { x: 700, y: 500 }, dragging })));
    }
    store().endHistoryBatch();
    expect(store().history.past).toHaveLength(2);
    expect(store().undo()).toBe(true);
    expect(store().nodes).toEqual(before.nodes);
    expect(store().edges).toEqual(before.edges);
    expect(store().redo()).toBe(true);
    expect(store().nodes.filter(node => ids.includes(node.id)).every(node => node.position.x === 700)).toBe(true);
  });

  it('does not record empty batches or carry batches into another canvas', () => {
    store().beginHistoryBatch();
    store().endHistoryBatch();
    expect(store().undo()).toBe(false);
    store().beginHistoryBatch();
    store().setCanvasData([], []);
    store().endHistoryBatch();
    pastePair();
    expect(store().history.past).toHaveLength(1);
  });

  it('round trips 300 deterministic random sequences of batched edits', () => {
    let seed = 12345;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let run = 0; run < 300; run++) {
      store().setCanvasData([], []);
      const expected = [{ nodes: store().nodes, edges: store().edges }];
      for (let step = 0; step < 1 + Math.floor(random() * 12); step++) {
        store().beginHistoryBatch();
        if (random() < 0.5 || store().nodes.length === 0) pastePair();
        else {
          const node = store().nodes[Math.floor(random() * store().nodes.length)];
          const position = { x: random() * 1000, y: random() * 1000 };
          store().onNodesChange([{ id: node.id, type: 'position', position, dragging: true }]);
          store().onNodesChange([{ id: node.id, type: 'position', position, dragging: false }]);
        }
        store().endHistoryBatch();
        expected.push({ nodes: store().nodes, edges: store().edges });
      }
      for (let index = expected.length - 2; index >= 0; index--) {
        expect(store().undo()).toBe(true);
        expect({ nodes: store().nodes, edges: store().edges }).toEqual(expected[index]);
      }
      expect(store().undo()).toBe(false);
      for (const snapshot of expected.slice(1)) {
        expect(store().redo()).toBe(true);
        expect({ nodes: store().nodes, edges: store().edges }).toEqual(snapshot);
      }
      expect(store().redo()).toBe(false);
    }
  });
});
