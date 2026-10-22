import { afterEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { canvasNodeFactory } from './canvasServices';
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes';
import { canContinueFromImage, continueFromImage, takeContinueFromImageReference } from './continueFromImage';
import { createImageReferencePromptToken } from './imageReferencePrompt';

const initialSettings = useSettingsStore.getState();
afterEach(() => {
  useCanvasStore.getState().setCanvasData([], []);
  useSettingsStore.setState(initialSettings);
});

describe('continueFromImage', () => {
  it('creates one connected, selected generator with a reference and undoes the entire action once', () => {
    const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, { x: 0, y: 0 }, { imageUrl: '/result.png' });
    source.selected = true;
    source.width = 900;
    source.height = 500;
    const obstacle = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 928, y: -300 });
    obstacle.width = 600;
    obstacle.height = 1000;
    useCanvasStore.getState().setCanvasData([source, obstacle], []);
    useSettingsStore.setState({ lastImageGenerationOptions: { size: '4K', requestAspectRatio: '16:9', outputCount: 2, extraParams: { seed: 12 } } });
    const result = continueFromImage(source.id)!;
    const state = useCanvasStore.getState();
    const created = state.nodes.find((node) => node.id === result.nodeId)!;
    expect(state.nodes).toHaveLength(3);
    expect(created.type).toBe(CANVAS_NODE_TYPES.imageEdit);
    expect(created.position.x).toBeGreaterThanOrEqual(source.width);
    expect(created.position.x >= obstacle.position.x + obstacle.width || created.position.y >= obstacle.position.y + obstacle.height
      || created.position.y + 347 <= obstacle.position.y).toBe(true);
    expect(created.data).toMatchObject({ prompt: createImageReferencePromptToken(result.edgeId), size: '4K', requestAspectRatio: '16:9', outputCount: 2, extraParams: { seed: 12 } });
    expect(state.edges).toEqual([expect.objectContaining({ source: source.id, target: result.nodeId, sourceHandle: 'source', targetHandle: 'target', data: { valueType: 'image', inputOrder: 0 } })]);
    expect(state.selectedNodeId).toBe(result.nodeId);
    expect(state.nodes.filter((node) => node.selected).map((node) => node.id)).toEqual([result.nodeId]);
    expect(takeContinueFromImageReference(result.nodeId)).toBe(result.edgeId);
    expect(takeContinueFromImageReference(result.nodeId)).toBeUndefined();
    expect(state.history.past).toHaveLength(1);
    expect(state.undo()).toBe(true);
    expect(useCanvasStore.getState().nodes).toEqual([source, obstacle]);
    expect(useCanvasStore.getState().edges).toEqual([]);
    expect(useCanvasStore.getState().redo()).toBe(true);
    expect(useCanvasStore.getState().nodes.find((node) => node.id === result.nodeId)?.data.prompt).toBe(createImageReferencePromptToken(result.edgeId));
  });

  it.each([
    { imageUrl: null }, { imageUrl: '/old.png', isGenerating: true }, { imageUrl: '/old.png', generationError: 'failed' },
  ])('rejects unavailable result images: %j', (data) => {
    const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, { x: 0, y: 0 }, data);
    useCanvasStore.getState().setCanvasData([source], []);
    useCanvasStore.getState().updateNodeDataWithoutHistory(source.id, data);
    expect(canContinueFromImage(source)).toBe(false);
    expect(continueFromImage(source.id)).toBeNull();
    expect(useCanvasStore.getState().nodes).toHaveLength(1);
  });
});
