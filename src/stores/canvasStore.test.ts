import { afterEach, describe, expect, it } from 'vitest';

import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes';

import { useCanvasStore } from './canvasStore';
import { useSettingsStore } from './settingsStore';

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

  it('rejects incompatible and cyclic connections at the store boundary', () => {
    const textA = createNode(CANVAS_NODE_TYPES.textGeneration, 'text-a');
    const textB = createNode(CANVAS_NODE_TYPES.textGeneration, 'text-b');
    const video = createNode(CANVAS_NODE_TYPES.videoUpload, 'video');
    useCanvasStore.getState().setCanvasData([textA, textB, video], []);

    useCanvasStore.getState().onConnect({
      source: video.id,
      target: textA.id,
      sourceHandle: 'source',
      targetHandle: 'target',
    });
    expect(useCanvasStore.getState().edges).toHaveLength(0);

    useCanvasStore.getState().onConnect({
      source: textA.id,
      target: textB.id,
      sourceHandle: 'source',
      targetHandle: 'target',
    });
    useCanvasStore.getState().onConnect({
      source: textB.id,
      target: textA.id,
      sourceHandle: 'source',
      targetHandle: 'target',
    });
    expect(useCanvasStore.getState().edges).toHaveLength(1);
  });

  it('preserves stored edges that are temporarily incompatible with a mutable node mode', () => {
    const image = createNode(CANVAS_NODE_TYPES.upload, 'image');
    const sd2 = createNode(CANVAS_NODE_TYPES.sd2VideoGen, 'sd2');
    sd2.data = { ...sd2.data, generationMode: 'extend' };
    const storedEdge = {
      id: 'stored-image-edge',
      source: image.id,
      target: sd2.id,
      sourceHandle: 'source',
      targetHandle: 'target-images',
      data: { valueType: 'image' as const, inputOrder: 0 },
    };

    useCanvasStore.getState().setCanvasData([image, sd2], [storedEdge]);

    expect(useCanvasStore.getState().edges).toHaveLength(1);
  });
});

describe('canvas store text editing history', () => {
  afterEach(() => {
    useCanvasStore.getState().setCanvasData([], []);
  });

  it('groups a continuous text edit burst into one undo step', () => {
    const node = createNode(CANVAS_NODE_TYPES.textGeneration, 'text-node');
    useCanvasStore.getState().setCanvasData([node], []);

    useCanvasStore.getState().updateNodeDataCoalesced(node.id, { inputText: '你' }, 'local-input');
    useCanvasStore.getState().updateNodeDataCoalesced(node.id, { inputText: '你好' }, 'local-input');
    useCanvasStore.getState().updateNodeDataCoalesced(node.id, { inputText: '你好世界' }, 'local-input');

    expect(useCanvasStore.getState().history.past).toHaveLength(1);
    expect(useCanvasStore.getState().undo()).toBe(true);
    expect((useCanvasStore.getState().nodes[0].data as { inputText?: string }).inputText).toBe('');
  });

  it('ends a typing burst when another undoable edit occurs', () => {
    const node = createNode(CANVAS_NODE_TYPES.textGeneration, 'text-node');
    useCanvasStore.getState().setCanvasData([node], []);

    useCanvasStore.getState().updateNodeDataCoalesced(
      node.id,
      { inputText: 'first input' },
      'local-input'
    );
    useCanvasStore.getState().updateNodeDataCoalesced(
      node.id,
      { generatedText: 'edited result' },
      'result'
    );
    useCanvasStore.getState().updateNodeDataCoalesced(
      node.id,
      { inputText: 'second input' },
      'local-input'
    );

    expect(useCanvasStore.getState().history.past).toHaveLength(3);
    expect(useCanvasStore.getState().undo()).toBe(true);
    expect(useCanvasStore.getState().nodes[0].data).toMatchObject({
      inputText: 'first input',
      generatedText: 'edited result',
    });
  });
});

describe('canvas store text generation sizing', () => {
  afterEach(() => {
    useCanvasStore.getState().setCanvasData([], []);
  });

  it('locks context-driven dimensions after a user resize', () => {
    const node = createNode(CANVAS_NODE_TYPES.textGeneration, 'text-node');
    useCanvasStore.getState().setCanvasData([node], []);

    useCanvasStore.getState().onNodesChange([{
      id: node.id,
      type: 'dimensions',
      dimensions: { width: 760, height: 480 },
      resizing: false,
    }]);

    expect(useCanvasStore.getState().nodes.find((item) => item.id === node.id)?.data)
      .toMatchObject({ isSizeManuallyAdjusted: true });
  });

  it('does not treat a programmatic size sync as a manual text-node resize', () => {
    const node = createNode(CANVAS_NODE_TYPES.textGeneration, 'text-node');
    useCanvasStore.getState().setCanvasData([node], []);

    useCanvasStore.getState().onNodesChange([{
      id: node.id,
      type: 'dimensions',
      dimensions: { width: 760, height: 480 },
      resizing: false,
      setAttributes: true,
    }]);

    expect(useCanvasStore.getState().nodes.find((item) => item.id === node.id)?.data)
      .toMatchObject({ isSizeManuallyAdjusted: false });
  });
});

describe('new text generation node defaults', () => {
  afterEach(() => {
    useCanvasStore.getState().setCanvasData([], []);
    useSettingsStore.setState({ lastTextGenerationModelSelection: null });
  });

  it('inherits the last text generation provider and model', () => {
    useSettingsStore.setState({
      textApis: [{
        id: 'provider-a',
        name: 'Provider A',
        apiKey: 'secret',
        baseUrl: 'https://gateway.example/v1',
        modelId: 'model-a',
        modelCatalog: null,
        selectedModelIds: ['model-a'],
        enabled: false,
      }],
      lastTextGenerationModelSelection: { apiId: 'provider-a', modelId: 'model-a' },
    });

    const nodeId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.textGeneration,
      { x: 0, y: 0 }
    );
    const data = useCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.data;

    expect(data).toMatchObject({ textApiId: 'provider-a', textModelId: 'model-a' });
  });

  it('preserves an unavailable last selection instead of silently falling back', () => {
    useSettingsStore.setState({
      textApis: [{
        id: 'provider-a',
        name: 'Provider A',
        apiKey: 'secret',
        baseUrl: 'https://gateway.example/v1',
        modelId: 'available-model',
        modelCatalog: null,
        selectedModelIds: ['available-model'],
        enabled: false,
      }],
      lastTextGenerationModelSelection: {
        apiId: 'removed-provider',
        modelId: 'removed-model',
      },
    });

    const nodeId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.textGeneration,
      { x: 0, y: 0 }
    );
    const data = useCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.data;

    expect(data).toMatchObject({
      textApiId: 'removed-provider',
      textModelId: 'removed-model',
    });
  });
});
