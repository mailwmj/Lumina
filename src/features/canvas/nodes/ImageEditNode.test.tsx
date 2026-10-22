// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { canvasNodeFactory } from '../application/canvasServices';
import { CANVAS_NODE_TYPES, type ImageEditNodeData, type ExportImageNodeData } from '../domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { ImageEditNode } from './ImageEditNode';
import { ImageGenerationFailureActions } from '../ui/ImageGenerationFailureActions';

const mocks = vi.hoisted(() => ({
  showErrorDialog: vi.fn(), setApiKey: vi.fn(), submit: vi.fn(), updateInternals: vi.fn(),
}));
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...await importOriginal<typeof import('@xyflow/react')>(),
  Handle: () => null,
  useReactFlow: () => ({}),
  useUpdateNodeInternals: () => mocks.updateInternals,
}));
vi.mock('../ui/NodeResizeHandle', () => ({ NodeResizeHandle: () => null }));
vi.mock('../ui/ModelParamsControls', () => ({ ModelParamsControls: () => null }));
vi.mock('../ui/ImageReferencePromptInput', () => ({ ImageReferencePromptInput: () => null }));
vi.mock('../application/errorDialog', async (importOriginal) => ({
  ...await importOriginal<typeof import('../application/errorDialog')>(),
  showErrorDialog: mocks.showErrorDialog,
}));
vi.mock('../application/canvasServices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../application/canvasServices')>();
  return { ...actual, canvasAiGateway: { ...actual.canvasAiGateway,
    setApiKey: mocks.setApiKey, submitGenerateImageJobs: mocks.submit,
  } };
});

describe('image generation error presentation', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.clearAllMocks();
    mocks.setApiKey.mockResolvedValue(undefined);
    await i18n.changeLanguage('zh');
    useSettingsStore.setState({
      openAiImageApi: {
        apiKey: 'test-key', baseUrl: 'https://example.test/v1',
        modelCatalog: { models: [{ id: 'ai-media/gpt-image-2' }], refreshedAt: 1 },
        selectedModelIds: ['ai-media/gpt-image-2'],
      },
      lastImageModelSelection: { providerId: 'ai-media', modelId: 'ai-media/gpt-image-2' },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useCanvasStore.getState().setCanvasData([], []);
    vi.unstubAllGlobals();
  });

  async function renderSource(prompt: string) {
    const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.imageEdit, { x: 0, y: 0 }, {
      prompt, model: 'ai-media/gpt-image-2', requestAspectRatio: '1:1', size: '1K', outputCount: 1,
    });
    useCanvasStore.getState().setCanvasData([source], []);
    function Source() {
      const node = useCanvasStore((state) => state.nodes.find((item) => item.id === source.id)!);
      return <ImageEditNode {...({ id: source.id, data: node.data as ImageEditNodeData } as Parameters<typeof ImageEditNode>[0])} />;
    }
    await act(async () => root.render(<Source />));
    return source;
  }

  async function clickGenerate() {
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === i18n.t('canvas.generate'))!;
    expect(button).toBeTruthy();
    await act(async () => button.click());
  }

  it('shows an empty-prompt error inline without a dialog and clears it when input changes', async () => {
    const source = await renderSource('');
    await clickGenerate();
    expect(container.textContent).toContain(i18n.t('node.imageEdit.promptRequired'));
    expect(mocks.showErrorDialog).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    await act(async () => useCanvasStore.getState().updateNodeData(source.id, { prompt: 'Updated prompt' }));
    expect(container.textContent).not.toContain(i18n.t('node.imageEdit.promptRequired'));
  });

  it('keeps submission failures on the result node without a source error or automatic dialog', async () => {
    mocks.submit.mockImplementationOnce(async (_request, _count, settled, beforeSubmit) => {
      beforeSubmit();
      settled({ status: 'rejected', error: new Error('Provider rejected the request') }, 0);
      return [];
    });
    const source = await renderSource('Create an image');
    await clickGenerate();
    await act(async () => {
      await vi.waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    });
    const result = useCanvasStore.getState().nodes.find((node) => node.type === CANVAS_NODE_TYPES.exportImage)!;
    expect(result.data).toMatchObject({ isGenerating: false, generationError: 'Provider rejected the request' });
    expect(mocks.showErrorDialog).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Provider rejected the request');
    expect(useCanvasStore.getState().nodes.find((node) => node.id === source.id)?.data.generationError).toBeUndefined();
  });

  it('shows details without a retry button for failed storyboard output', async () => {
    const data = {
      imageUrl: null, aspectRatio: '1:1', resultKind: 'storyboardGenOutput',
      generationError: 'Storyboard failure', generationDebugContext: { sourceType: 'storyboardGen' },
    } as ExportImageNodeData;
    await act(async () => root.render(<ImageGenerationFailureActions id="storyboard-result" data={data} />));
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.some((button) => button.textContent === i18n.t('node.imageNode.retry'))).toBe(false);
    expect(buttons.some((button) => button.textContent === i18n.t('node.imageNode.errorDetails'))).toBe(true);
  });

  it('opens stored error details and a copyable report only after the user requests them', async () => {
    const data = {
      imageUrl: null, aspectRatio: '1:1',
      generationError: 'Provider failure', generationErrorDetails: 'Detailed provider response',
      generationDebugContext: { sourceType: 'imageEdit', requestModel: 'model-current' },
    } as ExportImageNodeData;
    await act(async () => root.render(<ImageGenerationFailureActions id="disconnected" data={data} />));
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.find((item) => item.textContent?.includes(i18n.t('node.imageNode.retry')))?.disabled).toBe(true);
    expect(mocks.showErrorDialog).not.toHaveBeenCalled();
    await act(async () => buttons.find((item) => item.textContent === i18n.t('node.imageNode.errorDetails'))!.click());
    expect(mocks.showErrorDialog).toHaveBeenCalledWith(
      'Provider failure', i18n.t('common.error'), 'Detailed provider response',
      expect.stringContaining('model-current')
    );
  });
});
