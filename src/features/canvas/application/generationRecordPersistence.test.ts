import { expect, it, vi } from 'vitest';
import { useProjectStore } from '@/stores/projectStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { canvasNodeFactory } from './canvasServices';
import { CANVAS_NODE_TYPES, type ImageGenerationRecord } from '../domain/canvasNodes';
const save = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/commands/projectState', () => ({ upsertProjectRecord: save, createProjectDirs: vi.fn().mockResolvedValue(undefined) }));
it('persists generation parameters untouched while encoding image fields into the image pool', async () => {
  vi.useFakeTimers();
  const initial = useProjectStore.getState();
  try {
    const record: ImageGenerationRecord = { prompt: '{{image-ref:edge}} portrait', displayPrompt: '图片 1 portrait', modelId: 'model', modelName: 'Model', providerName: 'Provider', size: '2K', requestAspectRatio: 'auto', resolvedAspectRatio: '1:1', outputCount: 1, extraParams: { seed: 42 }, referenceImageCount: 1, createdAt: 100 };
    useProjectStore.getState().createProject('Record persistence'); await vi.runAllTimersAsync();
    const output = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, { x: 0, y: 0 }, { imageUrl: '/result.png', generationRecord: record });
    useCanvasStore.getState().setCanvasData([output], []);
    useProjectStore.getState().saveCurrentProject([output], []); await vi.runAllTimersAsync();
    const saved = save.mock.calls[save.mock.calls.length - 1][0];
    const persisted = JSON.parse(saved.nodesJson)[0];
    expect(persisted.data.imageUrl).toMatch(/^__img_ref__:/);
    expect(persisted.data.generationRecord).toEqual(record);
    expect(JSON.parse(saved.historyJson).imagePool).not.toContain(record.displayPrompt);
  } finally {
    await vi.runAllTimersAsync(); vi.useRealTimers(); useProjectStore.setState(initial, true);
    useCanvasStore.getState().setCanvasData([], []);
  }
});
