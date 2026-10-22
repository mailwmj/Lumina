import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { canvasNodeFactory } from './canvasServices';
import { CANVAS_NODE_TYPES, type ImageGenerationRecord } from '../domain/canvasNodes';
import { buildGenerationRecord, restoreGenerationRecord } from './generationRecord';

export const record: ImageGenerationRecord = {
  prompt: 'Use {{image-ref:reference-edge}}', displayPrompt: 'Use 图片 1', modelId: 'ai-media/gpt-image-2',
  modelName: 'GPT Image 2', providerName: 'OpenAI', size: '4K', requestAspectRatio: 'auto', resolvedAspectRatio: '16:9',
  outputCount: 2, extraParams: { seed: 42, nested: { quality: 'high' } }, referenceImageCount: 1, createdAt: 100,
};
const originalSettings = useSettingsStore.getState();
afterEach(() => { useCanvasStore.getState().setCanvasData([], []); useSettingsStore.setState(originalSettings); });
function fixture() {
  const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.imageEdit, { x: 0, y: 0 }, { prompt: 'Before', model: 'old-model', size: '1K', outputCount: 1, requestAspectRatio: '1:1', extraParams: {} });
  const result = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, { x: 700, y: 0 }, { imageUrl: '/image.png', generationRecord: record });
  useCanvasStore.getState().setCanvasData([source, result], [{ id: 'generated', source: source.id, target: result.id }]);
  return { source, result };
}
describe('generation record restore', () => {
  it('restores all parameters in one undoable update and selects and locates the source', () => {
    const { source, result } = fixture();
    useSettingsStore.setState({ openAiImageApi: { apiKey: 'key', baseUrl: 'https://test/v1', modelCatalog: { models: [{ id: record.modelId }], refreshedAt: 1 }, selectedModelIds: [record.modelId] } });
    const setCenter = vi.fn().mockResolvedValue(true);
    const restored = restoreGenerationRecord(result.id, {
      setSelectedNode: useCanvasStore.getState().setSelectedNode,
      getInternalNode: () => ({ measured: { width: 520, height: 232 }, internals: { positionAbsolute: { x: 0, y: 0 } } }),
      getViewport: () => ({ zoom: 1 }), setCenter,
    });
    expect(setCenter).toHaveBeenCalledWith(260, 116, { zoom: 1, duration: 240 });
    expect(restored).toEqual({ status: 'restored', sourceNodeId: source.id, modelRestored: true });
    expect(useCanvasStore.getState().nodes.find((node) => node.id === source.id)?.data).toMatchObject({ prompt: record.prompt, model: record.modelId, size: record.size, requestAspectRatio: 'auto', outputCount: 2, extraParams: record.extraParams });
    expect(useCanvasStore.getState().selectedNodeId).toBe(source.id);
    expect(useCanvasStore.getState().history.past).toHaveLength(1);
    expect(useCanvasStore.getState().undo()).toBe(true);
    expect(useCanvasStore.getState().nodes.find((node) => node.id === source.id)?.data).toEqual(source.data);
  });
  it('returns an explicit missing-source result without changing history', () => {
    const { result } = fixture(); useCanvasStore.getState().setCanvasData([result], []);
    expect(restoreGenerationRecord(result.id)).toEqual({ status: 'source-missing' });
    expect(useCanvasStore.getState().history.past).toHaveLength(0);
  });
  it('keeps the current model when unavailable while restoring the other parameters', () => {
    const { source, result } = fixture();
    useSettingsStore.setState({ openAiImageApi: { ...originalSettings.openAiImageApi, selectedModelIds: [] } });
    expect(restoreGenerationRecord(result.id)).toMatchObject({ status: 'restored', modelRestored: false });
    expect(useCanvasStore.getState().nodes.find((node) => node.id === source.id)?.data).toMatchObject({ model: 'old-model', prompt: record.prompt, size: '4K', outputCount: 2, extraParams: record.extraParams });
  });
  it('snapshots plain parameters without inline media or reference asset fields', () => {
    const snapshot = buildGenerationRecord({ ...record, extraParams: { seed: 42, inline: 'data:image/png;base64,secret' } });
    expect(snapshot.extraParams).toEqual({ seed: 42 });
    expect(snapshot).not.toHaveProperty('imageUrl');
    expect(snapshot).not.toHaveProperty('referenceImages');
  });
});
