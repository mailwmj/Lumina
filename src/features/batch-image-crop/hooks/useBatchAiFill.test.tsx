// @vitest-environment happy-dom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { persistImageSource } from '@/commands/image';
import { canvasAiGateway } from '@/features/canvas/application/canvasServices';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  createDefaultFixedCanvasDraft,
  type BatchCropImageItem,
} from '../domain';
import { renderBatchFixedCanvas } from '../infrastructure/tauriBatchImageCropGateway';
import { useBatchAiFill } from './useBatchAiFill';

const testModel = vi.hoisted(() => ({
  id: 'provider/edit-model',
  mediaType: 'image' as const,
  displayName: 'Edit Model',
  providerId: 'provider',
  providerName: 'Provider',
  description: '',
  eta: '1min',
  defaultAspectRatio: '1:1',
  defaultResolution: '2K',
  aspectRatios: [{ value: '1:1', label: '1:1' }],
  resolutions: [{ value: '1K', label: '1K' }, { value: '2K', label: '2K' }],
  resolveRequest: () => ({ requestModel: 'provider/edit-model', modeLabel: 'edit' }),
}));

vi.mock('@/commands/image', () => ({ persistImageSource: vi.fn() }));
vi.mock('@/features/canvas/application/canvasServices', () => ({
  canvasAiGateway: {
    setApiKey: vi.fn(),
    submitGenerateImageJob: vi.fn(),
    getGenerateImageJob: vi.fn(),
    retryGenerateImageJob: vi.fn(),
  },
}));
vi.mock('@/features/canvas/application/imageProviderRuntime', () => ({
  resolveImageProviderRuntime: () => ({
    backendProviderId: 'provider',
    apiKey: 'key',
    providerConfig: { provider_id: 'provider' },
  }),
}));
vi.mock('@/features/canvas/models/availableModels', () => ({
  listConfiguredImageModels: () => [testModel],
  resolveConfiguredImageModel: () => testModel,
}));
vi.mock('../infrastructure/tauriBatchImageCropGateway', () => ({
  renderBatchFixedCanvas: vi.fn(),
}));

function createItem(): BatchCropImageItem {
  return {
    id: 'image-1',
    sourcePath: '/fixtures/source.jpg',
    fileName: 'source.jpg',
    fileSize: 1024,
    previewPath: '/fixtures/preview.jpg',
    thumbnailPath: '/fixtures/thumbnail.jpg',
    width: 100,
    height: 200,
    rotationDegrees: 0,
    compositionMode: 'fixed',
    status: 'fixedReady',
    cropStatus: 'auto',
    crop: { x: 0, y: 0, width: 1, height: 1 },
    automaticCrop: { x: 0, y: 0, width: 1, height: 1 },
    requiresReview: false,
    lowResolution: false,
    fixedCanvas: {
      ...createDefaultFixedCanvasDraft('default prompt'),
      stage: 'fill',
      ready: true,
    },
  };
}

function createProcessingItem(id: string, jobId: string): BatchCropImageItem {
  const item = createItem();
  return {
    ...item,
    id,
    fileName: `${id}.jpg`,
    status: 'aiProcessing',
    fixedCanvas: {
      ...item.fixedCanvas,
      ai: {
        ...item.fixedCanvas.ai,
        status: 'processing',
        jobId,
      },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('useBatchAiFill', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useBatchAiFill>;
  let latestItems: BatchCropImageItem[];
  const onDialogClose = vi.fn();
  const onToast = vi.fn();

  function Harness() {
    const [items, setItems] = useState([createItem()]);
    latestItems = items;
    latest = useBatchAiFill({
      batchId: 'batch-1',
      items,
      selectedItem: items[0] ?? null,
      target: { id: '1440x1440', width: 1440, height: 1440 },
      setItems,
      onDialogClose,
      onToast,
    });
    return null;
  }

  function MultiJobHarness() {
    const [items, setItems] = useState([
      createProcessingItem('image-1', 'job-1'),
      createProcessingItem('image-2', 'job-2'),
    ]);
    latestItems = items;
    latest = useBatchAiFill({
      batchId: 'batch-1',
      items,
      selectedItem: items[0] ?? null,
      target: { id: '1440x1440', width: 1440, height: 1440 },
      setItems,
      onDialogClose,
      onToast,
    });
    return null;
  }

  beforeEach(async () => {
    await i18n.changeLanguage('zh');
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    useSettingsStore.setState({ lastBatchAiFillSelection: null });
    vi.mocked(renderBatchFixedCanvas).mockResolvedValue({ renderedPath: '/cache/fixed.jpg' });
    vi.mocked(canvasAiGateway.setApiKey).mockResolvedValue(undefined);
    vi.mocked(persistImageSource).mockResolvedValue('/outputs/filled.jpg');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('auto-accepts a successful result and remembers model plus resolution', async () => {
    vi.mocked(canvasAiGateway.submitGenerateImageJob).mockResolvedValue('job-1');
    vi.mocked(canvasAiGateway.getGenerateImageJob).mockResolvedValue({
      job_id: 'job-1',
      status: 'succeeded',
      result: 'data:image/jpeg;base64,result',
    });

    await act(async () => latest.submit({
      modelId: testModel.id,
      resolution: '1K',
      prompt: 'fill the background',
    }));
    expect(latestItems[0]?.fixedCanvas.ai.status).toBe('processing');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1800);
    });

    expect(latestItems[0]?.fixedCanvas.ai.status).toBe('accepted');
    expect(latestItems[0]?.fixedCanvas.ready).toBe(true);
    expect(latestItems[0]?.fixedCanvas.ai.resultPath).toBe('/outputs/filled.jpg');
    expect(useSettingsStore.getState().lastBatchAiFillSelection).toEqual({
      modelId: testModel.id,
      resolution: '1K',
    });
  });

  it('polls and completes multiple AI jobs independently after navigation', async () => {
    vi.mocked(canvasAiGateway.getGenerateImageJob).mockImplementation(async (jobId) => ({
      job_id: jobId,
      status: 'succeeded',
      result: `data:image/jpeg;base64,${jobId}`,
    }));
    vi.mocked(persistImageSource).mockImplementation(async (source) => (
      String(source).includes('job-1') ? '/outputs/filled-1.jpg' : '/outputs/filled-2.jpg'
    ));
    await act(async () => root.render(<MultiJobHarness />));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1800);
    });

    expect(canvasAiGateway.getGenerateImageJob).toHaveBeenCalledTimes(2);
    expect(latestItems.map((item) => item.fixedCanvas.ai.status)).toEqual(['accepted', 'accepted']);
    expect(latestItems.map((item) => item.status)).toEqual(['aiGenerated', 'aiGenerated']);
  });

  it('cancels an in-flight submission and ignores its late task id', async () => {
    const submission = deferred<string>();
    vi.mocked(canvasAiGateway.submitGenerateImageJob).mockReturnValue(submission.promise);

    let pending!: Promise<void>;
    await act(async () => {
      pending = latest.submit({
        modelId: testModel.id,
        resolution: '2K',
        prompt: 'fill the background',
      });
      await Promise.resolve();
    });
    expect(latest.submitting).toBe(true);

    await act(async () => latest.cancelSelectedAi());
    expect(latest.submitting).toBe(false);
    submission.resolve('late-job');
    await act(async () => pending);

    expect(latestItems[0]?.fixedCanvas.ai.status).toBe('idle');
    expect(latestItems[0]?.fixedCanvas.ready).toBe(true);
    expect(latestItems[0]?.fixedCanvas.ai.jobId).toBeUndefined();
    expect(useSettingsStore.getState().lastBatchAiFillSelection).toBeNull();
  });

  it('does not contact the provider when cancellation finishes before submission', async () => {
    const rendering = deferred<{ renderedPath: string }>();
    vi.mocked(renderBatchFixedCanvas).mockReturnValue(rendering.promise);

    let pending!: Promise<void>;
    await act(async () => {
      pending = latest.submit({
        modelId: testModel.id,
        resolution: '2K',
        prompt: 'fill the background',
      });
      await Promise.resolve();
    });
    await act(async () => latest.cancelSelectedAi());
    rendering.resolve({ renderedPath: '/cache/late.jpg' });
    await act(async () => pending);

    expect(canvasAiGateway.submitGenerateImageJob).not.toHaveBeenCalled();
    expect(latestItems[0]?.fixedCanvas.ready).toBe(true);
  });

  it('restores the pre-AI canvas and ignores a result persisted after cancellation', async () => {
    const persisted = deferred<string>();
    vi.mocked(canvasAiGateway.submitGenerateImageJob).mockResolvedValue('job-2');
    vi.mocked(canvasAiGateway.getGenerateImageJob).mockResolvedValue({
      job_id: 'job-2',
      status: 'succeeded',
      result: 'data:image/jpeg;base64,result',
    });
    vi.mocked(persistImageSource).mockReturnValue(persisted.promise);

    await act(async () => latest.submit({
      modelId: testModel.id,
      resolution: '2K',
      prompt: 'fill the background',
    }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1800);
      await Promise.resolve();
    });
    expect(persistImageSource).toHaveBeenCalled();

    await act(async () => latest.cancelSelectedAi());
    expect(latestItems[0]?.fixedCanvas.ai.status).toBe('idle');
    expect(latestItems[0]?.fixedCanvas.ready).toBe(true);

    persisted.resolve('/outputs/late.jpg');
    await act(async () => { await Promise.resolve(); });
    expect(latestItems[0]?.fixedCanvas.ai.resultPath).toBeUndefined();
  });
});
