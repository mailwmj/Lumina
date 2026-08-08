import { afterEach, describe, expect, it } from 'vitest';

import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes';

import { useCanvasStore } from './canvasStore';

function createNode(type: CanvasNode['type'], id: string): CanvasNode {
  return {
    ...canvasNodeFactory.createNode(type, { x: 0, y: 0 }),
    id,
  };
}

describe('canvas store batch connections', () => {
  afterEach(() => {
    useCanvasStore.getState().setCanvasData([], []);
  });

  it('records a batch as one undoable history step', () => {
    const sourceA = createNode(CANVAS_NODE_TYPES.upload, 'source-a');
    const sourceB = createNode(CANVAS_NODE_TYPES.upload, 'source-b');
    const target = createNode(CANVAS_NODE_TYPES.imageEdit, 'target');
    const store = useCanvasStore.getState();

    store.setCanvasData([sourceA, sourceB, target], []);

    const addedCount = useCanvasStore.getState().onConnectBatch([
      {
        source: sourceA.id,
        target: target.id,
        sourceHandle: 'source',
        targetHandle: 'target',
      },
      {
        source: sourceB.id,
        target: target.id,
        sourceHandle: 'source',
        targetHandle: 'target',
      },
    ]);

    expect(addedCount).toBe(2);
    expect(useCanvasStore.getState().edges).toHaveLength(2);
    expect(useCanvasStore.getState().history.past).toHaveLength(1);

    expect(useCanvasStore.getState().undo()).toBe(true);
    expect(useCanvasStore.getState().edges).toHaveLength(0);

    expect(useCanvasStore.getState().redo()).toBe(true);
    expect(useCanvasStore.getState().edges).toHaveLength(2);
  });

  it('creates and connects a node batch as one undoable history step', () => {
    const source = createNode(CANVAS_NODE_TYPES.imageEdit, 'source');
    const store = useCanvasStore.getState();
    store.setCanvasData([source], []);

    const resultIds = useCanvasStore.getState().addNodeBatch(
      Array.from({ length: 4 }, (_, index) => ({
        type: CANVAS_NODE_TYPES.exportImage,
        position: { x: 300, y: index * 196 },
      }))
    );
    resultIds.forEach((resultId) => {
      useCanvasStore.getState().addEdge(source.id, resultId);
    });

    expect(useCanvasStore.getState().nodes).toHaveLength(5);
    expect(useCanvasStore.getState().edges).toHaveLength(4);
    expect(useCanvasStore.getState().history.past).toHaveLength(1);

    expect(useCanvasStore.getState().undo()).toBe(true);
    expect(useCanvasStore.getState().nodes.map((node) => node.id)).toEqual([source.id]);
    expect(useCanvasStore.getState().edges).toHaveLength(0);

    expect(useCanvasStore.getState().redo()).toBe(true);
    expect(useCanvasStore.getState().nodes).toHaveLength(5);
    expect(useCanvasStore.getState().edges).toHaveLength(4);
  });
});
