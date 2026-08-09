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

describe('canvas store typed input ordering', () => {
  afterEach(() => {
    useCanvasStore.getState().setCanvasData([], []);
  });

  it('stores independent append order for text and image inputs', () => {
    const textA = createNode(CANVAS_NODE_TYPES.textGeneration, 'text-a');
    const imageA = createNode(CANVAS_NODE_TYPES.upload, 'image-a');
    const textB = createNode(CANVAS_NODE_TYPES.textGeneration, 'text-b');
    const target = createNode(CANVAS_NODE_TYPES.textGeneration, 'target');
    useCanvasStore.getState().setCanvasData([textA, imageA, textB, target], []);

    useCanvasStore.getState().onConnect({ source: textA.id, target: target.id, sourceHandle: null, targetHandle: null });
    useCanvasStore.getState().onConnect({ source: imageA.id, target: target.id, sourceHandle: null, targetHandle: null });
    useCanvasStore.getState().onConnect({ source: textB.id, target: target.id, sourceHandle: null, targetHandle: null });

    expect(useCanvasStore.getState().edges.map((edge) => edge.data)).toEqual([
      { valueType: 'text', inputOrder: 0 },
      { valueType: 'image', inputOrder: 0 },
      { valueType: 'text', inputOrder: 1 },
    ]);
  });

  it('reorders one input type as a single undoable step', () => {
    const first = createNode(CANVAS_NODE_TYPES.textGeneration, 'first');
    const second = createNode(CANVAS_NODE_TYPES.textGeneration, 'second');
    const target = createNode(CANVAS_NODE_TYPES.textGeneration, 'target');
    useCanvasStore.getState().setCanvasData([first, second, target], []);
    useCanvasStore.getState().onConnectBatch([
      { source: first.id, target: target.id, sourceHandle: null, targetHandle: null },
      { source: second.id, target: target.id, sourceHandle: null, targetHandle: null },
    ]);
    const historyBeforeReorder = useCanvasStore.getState().history.past.length;

    expect(useCanvasStore.getState().reorderNodeInput(
      target.id,
      'text',
      second.id,
      first.id
    )).toBe(true);

    const orderedSources = [...useCanvasStore.getState().edges]
      .sort((left, right) => Number(left.data?.inputOrder) - Number(right.data?.inputOrder))
      .map((edge) => edge.source);
    expect(orderedSources).toEqual([second.id, first.id]);
    expect(useCanvasStore.getState().history.past).toHaveLength(historyBeforeReorder + 1);

    expect(useCanvasStore.getState().undo()).toBe(true);
    expect(useCanvasStore.getState().edges.map((edge) => edge.source)).toEqual([first.id, second.id]);
    expect(useCanvasStore.getState().edges.map((edge) => edge.data?.inputOrder)).toEqual([0, 1]);
  });
});
