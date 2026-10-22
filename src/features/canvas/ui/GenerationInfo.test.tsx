// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { useCanvasStore } from '@/stores/canvasStore';
import { canvasNodeFactory } from '../application/canvasServices';
import { CANVAS_NODE_TYPES, type ImageGenerationRecord } from '../domain/canvasNodes';
import { NodeActionToolbar } from './NodeActionToolbar';
import { GenerationRecordPopover } from './GenerationRecordPopover';
import { useSettingsStore } from '@/stores/settingsStore';

const mocks = vi.hoisted(() => ({ writeText: vi.fn(), setCenter: vi.fn().mockResolvedValue(true) }));
vi.mock('@xyflow/react', async (original) => ({
  ...await original<typeof import('@xyflow/react')>(), NodeToolbar: ({ children, nodeId }: { children: ReactNode; nodeId: string }) => <div data-toolbar-node={nodeId}>{children}</div>,
  useReactFlow: () => ({ getViewport: () => ({ zoom: 1 }), setCenter: mocks.setCenter,
    getInternalNode: () => ({ measured: { width: 520, height: 232 }, internals: { positionAbsolute: { x: 0, y: 0 } } }) }),
}));
const record: ImageGenerationRecord = { prompt: '{{image-ref:edge}} portrait', displayPrompt: '图片 1 portrait', modelId: 'unavailable-model',
  modelName: 'Original model', providerName: 'Original provider', size: '4K', requestAspectRatio: 'auto', resolvedAspectRatio: '2:3', outputCount: 2,
  referenceImageCount: 1, extraParams: { seed: 42 }, createdAt: 100 };
describe('generation info toolbar and popover', () => {
  let container: HTMLDivElement; let root: Root;
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText: mocks.writeText.mockResolvedValue(undefined) } as unknown as Clipboard);
    await i18n.changeLanguage('zh'); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); useCanvasStore.getState().setCanvasData([], []); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function button(label: string) { return Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label)!; }
  async function render(withRecord = true, withSource = false) {
    const result = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, { x: 700, y: 0 }, { imageUrl: '/output.png', ...(withRecord ? { generationRecord: record } : {}) });
    const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.imageEdit, { x: 0, y: 0 }, { model: 'current-model' });
    useCanvasStore.getState().setCanvasData(withSource ? [source, result] : [result], withSource ? [{ id: 'source-edge', source: source.id, target: result.id }] : []);
    await act(async () => root.render(<><NodeActionToolbar node={result} /><GenerationRecordPopover /></>));
    return { source, result };
  }
  it('only offers generation info on results with a record and copies the readable prompt', async () => {
    await render(false); expect(button(i18n.t('generationRecord.title'))).toBeUndefined();
    await render(); await act(async () => button(i18n.t('generationRecord.title')).click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(record.displayPrompt);
    expect(button(i18n.t('generationRecord.restore')).disabled).toBe(true);
    await act(async () => button(i18n.t('generationRecord.copyPrompt')).click());
    expect(mocks.writeText).toHaveBeenCalledWith(record.displayPrompt);
    expect(mocks.writeText).not.toHaveBeenCalledWith(record.prompt);
    expect(button(i18n.t('nodeToolbar.copied'))).toBeTruthy();
  });
  it('keeps a model-unavailable notice in the popover after restoring and locating the source', async () => {
    const settings = useSettingsStore.getState();
    useSettingsStore.setState({ openAiImageApi: { ...settings.openAiImageApi, selectedModelIds: [] } });
    try {
      const { source } = await render(true, true);
      await act(async () => button(i18n.t('generationRecord.title')).click());
      await act(async () => button(i18n.t('generationRecord.restore')).click());
      expect(container.querySelector('[role="status"]')?.textContent).toBe(i18n.t('generationRecord.modelUnavailable'));
      expect(useCanvasStore.getState().nodes.find((node) => node.id === source.id)?.data).toMatchObject({ model: 'current-model', size: '4K', prompt: record.prompt });
      expect(mocks.setCenter).toHaveBeenCalled();
      expect(container.querySelector('[role="dialog"]')?.closest('[data-toolbar-node]')?.getAttribute('data-toolbar-node')).toBe(source.id);
    } finally { useSettingsStore.setState(settings); }
  });
});
