import { completeImageGenerationResult } from './completeImageGenerationResult';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import { retryImageGenerationResult } from './imageGenerationRetry';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  runImageGenerationNode,
  runImageGenerationNodes,
} from './imageGenerationRun';

const gateway = vi.hoisted(() => ({
  setApiKey: vi.fn(),
  submitGenerateImageJobs: vi.fn(),
}));

vi.mock('@/features/canvas/application/canvasServices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/canvas/application/canvasServices')>();
  return {
    ...actual,
    canvasAiGateway: {
      ...actual.canvasAiGateway,
      setApiKey: gateway.setApiKey,
      submitGenerateImageJobs: gateway.submitGenerateImageJobs,
    },
  };
});

describe('shared image generation execution', () => {
  beforeEach(() => {
    gateway.setApiKey.mockResolvedValue(undefined);
    gateway.submitGenerateImageJobs.mockImplementation(async (
      _payload: unknown,
      outputCount: number,
      onSettled: (result: { status: 'fulfilled'; jobId: string }, index: number) => void,
      beforeSubmit?: () => void
    ) => {
      beforeSubmit?.();
      return Array.from({ length: outputCount }, (_, index) => {
        const result = { status: 'fulfilled' as const, jobId: `job-${index + 1}` };
        onSettled(result, index);
        return result;
      });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    useCanvasStore.getState().setCanvasData([], []);
    useSettingsStore.setState({
      openAiImageApi: {
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1',
        modelCatalog: null,
        selectedModelIds: [],
      },
      lastImageModelSelection: null,
    });
  });

  it('rejects nodes outside the existing image-generation node type', async () => {
    const upload = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 });
    useCanvasStore.getState().setCanvasData([upload], []);

    await expect(runImageGenerationNode(upload.id)).rejects.toMatchObject({
      code: 'NODE_NOT_FOUND',
    });
  });

  it('isolates invalid node failures in a batch without creating result nodes', async () => {
    const upload = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 });
    useCanvasStore.getState().setCanvasData([upload], []);

    const result = await runImageGenerationNodes([upload.id, 'missing']);

    expect(result.runs).toEqual([
      expect.objectContaining({ status: 'failed', sourceNodeId: upload.id }),
      expect.objectContaining({ status: 'failed', sourceNodeId: 'missing' }),
    ]);
    expect(useCanvasStore.getState().nodes).toEqual([upload]);
  });

  it('names generated results after the source node instead of its prompt', async () => {
    const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.imageEdit, { x: 0, y: 0 }, {
      displayName: 'Sweater front full-body',
      prompt: 'A very long production prompt that should remain in node data, not the result title.',
      model: 'ai-media/gpt-image-2',
      requestAspectRatio: '4:5',
      outputCount: 1,
    });
    useCanvasStore.getState().setCanvasData([source], []);
    useSettingsStore.setState({
      openAiImageApi: {
        apiKey: 'test-key',
        baseUrl: 'https://example.test/v1',
        modelCatalog: {
          models: [{ id: 'ai-media/gpt-image-2' }],
          refreshedAt: 1,
        },
        selectedModelIds: ['ai-media/gpt-image-2'],
      },
      lastImageModelSelection: {
        providerId: 'ai-media',
        modelId: 'ai-media/gpt-image-2',
      },
    });

    const result = await runImageGenerationNode(source.id);
    const resultNode = useCanvasStore.getState().nodes.find(
      (node) => node.id === result.resultNodeIds[0]
    );

    expect(resultNode?.data.displayName).toBe('Sweater front full-body · 结果');
    expect(resultNode?.data.displayName).not.toContain('production prompt');
  });

  it('submits the bounded reference asset while retaining the original node image', async () => {
    const reference = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 }, {
      imageUrl: 'file:///original-8k.png',
      previewImageUrl: 'file:///preview-1k.jpg',
      referenceImageUrl: 'file:///reference-4k.jpg',
      aspectRatio: '2:3',
    });
    const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.imageEdit, { x: 300, y: 0 }, {
      prompt: 'Create a model turnaround.',
      model: 'ai-media/gpt-image-2',
      requestAspectRatio: '16:9',
      outputCount: 1,
    });
    useCanvasStore.getState().setCanvasData([reference, source], [{
      id: 'reference-edge',
      source: reference.id,
      target: source.id,
      data: { valueType: 'image', inputOrder: 0 },
    }]);
    useSettingsStore.setState({
      openAiImageApi: {
        apiKey: 'test-key',
        baseUrl: 'https://example.test/v1',
        modelCatalog: {
          models: [{ id: 'ai-media/gpt-image-2' }],
          refreshedAt: 1,
        },
        selectedModelIds: ['ai-media/gpt-image-2'],
      },
      lastImageModelSelection: {
        providerId: 'ai-media',
        modelId: 'ai-media/gpt-image-2',
      },
    });

    await runImageGenerationNode(source.id);

    expect(gateway.submitGenerateImageJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: ['file:///reference-4k.jpg'],
      }),
      1,
      expect.any(Function),
      expect.any(Function)
    );
    expect(reference.data.imageUrl).toBe('file:///original-8k.png');
  });

  it('registers its result nodes before revalidating the authorized canvas', async () => {
    const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.imageEdit, { x: 0, y: 0 }, {
      prompt: 'Create one product image.',
      model: 'ai-media/gpt-image-2',
      requestAspectRatio: '1:1',
      outputCount: 1,
    });
    useCanvasStore.getState().setCanvasData([source], []);
    useSettingsStore.setState({
      openAiImageApi: {
        apiKey: 'test-key',
        baseUrl: 'https://example.test/v1',
        modelCatalog: {
          models: [{ id: 'ai-media/gpt-image-2' }],
          refreshedAt: 1,
        },
        selectedModelIds: ['ai-media/gpt-image-2'],
      },
      lastImageModelSelection: {
        providerId: 'ai-media',
        modelId: 'ai-media/gpt-image-2',
      },
    });
    const ownedResultNodeIds = new Set<string>();

    const result = await runImageGenerationNode(source.id, {
      assertCurrent: (newResultNodeIds = []) => {
        newResultNodeIds.forEach((nodeId) => ownedResultNodeIds.add(nodeId));
        const unexpectedNode = useCanvasStore.getState().nodes.find(
          (node) => node.id !== source.id && !ownedResultNodeIds.has(node.id)
        );
        if (unexpectedNode) {
          throw new Error(`Unregistered canvas mutation: ${unexpectedNode.id}`);
        }
      },
    });

    expect(result.submissions).toEqual([
      expect.objectContaining({ status: 'submitted', resultNodeId: result.resultNodeIds[0] }),
    ]);
  });

  it('revalidates after asynchronous request preparation before creating jobs or result nodes', async () => {
    const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.imageEdit, { x: 0, y: 0 }, {
      prompt: 'Authorized prompt',
      model: 'ai-media/gpt-image-2',
      requestAspectRatio: '1:1',
      outputCount: 1,
    });
    useCanvasStore.getState().setCanvasData([source], []);
    useSettingsStore.setState({
      openAiImageApi: {
        apiKey: 'test-key',
        baseUrl: 'https://example.test/v1',
        modelCatalog: {
          models: [{ id: 'ai-media/gpt-image-2' }],
          refreshedAt: 1,
        },
        selectedModelIds: ['ai-media/gpt-image-2'],
      },
      lastImageModelSelection: {
        providerId: 'ai-media',
        modelId: 'ai-media/gpt-image-2',
      },
    });
    let finishPreparation: (() => void) | undefined;
    const preparation = new Promise<void>((resolve) => {
      finishPreparation = resolve;
    });
    let providerSubmitted = false;
    gateway.submitGenerateImageJobs.mockImplementation(async (
      _payload: unknown,
      _outputCount: number,
      _onSettled: unknown,
      beforeSubmit?: () => void
    ) => {
      await preparation;
      beforeSubmit?.();
      providerSubmitted = true;
      return [];
    });
    const staleError = new Error('canvas_changed');
    let stale = false;
    const run = runImageGenerationNodes([source.id], {
      assertCurrent: () => {
        if (stale) {
          throw staleError;
        }
      },
    });
    await vi.waitFor(() => expect(gateway.submitGenerateImageJobs).toHaveBeenCalled());

    stale = true;
    finishPreparation?.();

    await expect(run).rejects.toBe(staleError);
    expect(providerSubmitted).toBe(false);
    expect(useCanvasStore.getState().nodes).toEqual([source]);
  });

  it('does not downgrade an already submitted batch to stale', async () => {
    const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.imageEdit, { x: 0, y: 0 }, {
      prompt: 'Authorized prompt',
      model: 'ai-media/gpt-image-2',
      requestAspectRatio: '1:1',
      outputCount: 1,
    });
    useCanvasStore.getState().setCanvasData([source], []);
    useSettingsStore.setState({
      openAiImageApi: {
        apiKey: 'test-key',
        baseUrl: 'https://example.test/v1',
        modelCatalog: {
          models: [{ id: 'ai-media/gpt-image-2' }],
          refreshedAt: 1,
        },
        selectedModelIds: ['ai-media/gpt-image-2'],
      },
      lastImageModelSelection: {
        providerId: 'ai-media',
        modelId: 'ai-media/gpt-image-2',
      },
    });
    let providerSubmitted = false;
    gateway.submitGenerateImageJobs.mockImplementation(async (
      _payload: unknown,
      _outputCount: number,
      onSettled: (result: { status: 'fulfilled'; jobId: string }, index: number) => void,
      beforeSubmit?: () => void
    ) => {
      beforeSubmit?.();
      providerSubmitted = true;
      const submission = { status: 'fulfilled' as const, jobId: 'job-submitted' };
      onSettled(submission, 0);
      return [submission];
    });

    const result = await runImageGenerationNodes([source.id], {
      assertCurrent: () => {
        if (providerSubmitted) {
          throw new Error('canvas_changed_after_submission');
        }
      },
    });

    expect(result.runs).toEqual([
      expect.objectContaining({
        status: 'started',
        submissions: [expect.objectContaining({ jobId: 'job-submitted' })],
      }),
    ]);
  });

  it('initializes each custom Gemini configuration independently in one batch', async () => {
    const firstProviderId = 'custom-openai:gemini-first' as const;
    const secondProviderId = 'custom-openai:gemini-second' as const;
    const firstModelId = `${firstProviderId}/gemini-3-pro-image-preview`;
    const secondModelId = `${secondProviderId}/gemini-3-pro-image-preview`;
    const firstSource = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.imageEdit, { x: 0, y: 0 }, {
      prompt: 'First image',
      model: firstModelId,
      requestAspectRatio: '1:1',
      outputCount: 1,
    });
    const secondSource = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.imageEdit, { x: 400, y: 0 }, {
      prompt: 'Second image',
      model: secondModelId,
      requestAspectRatio: '1:1',
      outputCount: 1,
    });
    useCanvasStore.getState().setCanvasData([firstSource, secondSource], []);
    useSettingsStore.setState({
      customImageApis: [
        {
          id: firstProviderId,
          name: 'Gemini First',
          protocol: 'gemini-native',
          apiKey: 'first-key',
          baseUrl: 'https://first.example/v1beta',
          modelCatalog: {
            models: [{ id: firstModelId }],
            refreshedAt: 1,
          },
          selectedModelIds: [firstModelId],
        },
        {
          id: secondProviderId,
          name: 'Gemini Second',
          protocol: 'gemini-native',
          apiKey: 'second-key',
          baseUrl: 'https://second.example/v1beta',
          modelCatalog: {
            models: [{ id: secondModelId }],
            refreshedAt: 1,
          },
          selectedModelIds: [secondModelId],
        },
      ],
    });

    await runImageGenerationNodes([firstSource.id, secondSource.id]);

    expect(gateway.setApiKey).toHaveBeenCalledTimes(2);
    expect(gateway.setApiKey).toHaveBeenCalledWith('gemini', 'first-key');
    expect(gateway.setApiKey).toHaveBeenCalledWith('gemini', 'second-key');
  });
  function setupRetryFixture(outputCount: 1 | 2 = 1) {
    const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.imageEdit, { x: 0, y: 0 }, {
      prompt: 'Current edited prompt', model: 'ai-media/gpt-image-2',
      requestAspectRatio: '16:9', size: '2K', outputCount,
    });
    const failed = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, { x: 400, y: 300 }, {
      generationError: 'previous failure', generationErrorDetails: 'old details',
      generationDebugContext: { sourceType: 'imageEdit' },
      generationJobId: 'old-job', generationRecoveryState: 'attention_required',
      isGenerating: false, imageUrl: null,
    });
    const success = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, { x: 400, y: 0 }, {
      imageUrl: 'file:///success.png', isGenerating: false, generationError: 'stale error',
    });
    useCanvasStore.getState().setCanvasData([source, failed, success], [
      { id: 'failed-edge', source: source.id, target: failed.id },
      { id: 'success-edge', source: source.id, target: success.id },
    ]);
    useSettingsStore.setState({
      openAiImageApi: {
        apiKey: 'test-key', baseUrl: 'https://example.test/v1',
        modelCatalog: { models: [{ id: 'ai-media/gpt-image-2' }], refreshedAt: 1 },
        selectedModelIds: ['ai-media/gpt-image-2'],
      },
      lastImageModelSelection: { providerId: 'ai-media', modelId: 'ai-media/gpt-image-2' },
    });
    return { source, failed, success };
  }

  it('retries a failed result in place with current source parameters and a new job ID', async () => {
    const { source, failed, success } = setupRetryFixture(2);
    const reference = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 0, y: -300 }, {
      imageUrl: 'file:///current-original.png', referenceImageUrl: 'file:///current-reference.jpg',
    });
    useCanvasStore.getState().setCanvasData([source, failed, success, reference], [
      ...useCanvasStore.getState().edges,
      { id: 'new-reference', source: reference.id, target: source.id, data: { valueType: 'image' } },
    ]);
    useCanvasStore.getState().updateNodeData(source.id, { prompt: 'New prompt before retry', extraParams: { seed: 42 } });
    gateway.submitGenerateImageJobs.mockImplementationOnce(async (payload, count, onSettled, beforeSubmit) => {
      beforeSubmit();
      const pending = useCanvasStore.getState().nodes.find((node) => node.id === failed.id)!;
      expect(pending.data).toMatchObject({ isGenerating: true, generationError: null, generationJobId: null,
        generationErrorDetails: null, generationRecoveryState: null, aspectRatio: '16:9' });
      expect(pending.position).toEqual(failed.position);
      expect(count).toBe(1);
      expect(payload).toMatchObject({ size: '2K', aspectRatio: '16:9',
        referenceImages: ['file:///current-reference.jpg'], extraParams: { seed: 42 } });
      expect(payload.prompt).toContain('New prompt before retry');
      onSettled({ status: 'fulfilled', jobId: 'new-retry-job' }, 0);
      return [];
    });
    const result = await retryImageGenerationResult(failed.id);
    expect(result.sourceNodeId).toBe(source.id);
    expect(result.resultNodeIds).toEqual([failed.id]);
    expect(useCanvasStore.getState().nodes.find((node) => node.id === failed.id)?.data.generationRecord).toMatchObject({ prompt: 'New prompt before retry', extraParams: { seed: 42 } });
    expect(useCanvasStore.getState().nodes).toHaveLength(4);
    expect(useCanvasStore.getState().nodes.find((node) => node.id === failed.id)?.data).toMatchObject({
      isGenerating: true, generationJobId: 'new-retry-job', generationError: null,
    });
    expect(useCanvasStore.getState().nodes.find((node) => node.id === success.id)).toEqual(success);
    expect(useCanvasStore.getState().history.past.some((snapshot) =>
      snapshot.nodes.find((node) => node.id === failed.id)?.data.generationError === 'previous failure'
    )).toBe(true);
  });

  it('reuses one failed downstream result and creates only one additional output for count two', async () => {
    const { source, failed, success } = setupRetryFixture(2);
    const result = await runImageGenerationNode(source.id, { reuseFailedResults: true });
    expect(result.resultNodeIds).toHaveLength(2);
    expect(result.resultNodeIds[0]).toBe(failed.id);
    expect(result.resultNodeIds).not.toContain(success.id);
    expect(useCanvasStore.getState().nodes).toHaveLength(4);
    expect(useCanvasStore.getState().nodes.find((node) => node.id === failed.id)?.position).toEqual(failed.position);
    expect(useCanvasStore.getState().nodes.find((node) => node.id === success.id)).toEqual(success);
  });

  it('never reuses a failed storyboard output manually connected to an image generator', async () => {
    const { source, failed } = setupRetryFixture();
    useCanvasStore.getState().updateNodeData(failed.id, {
      resultKind: 'storyboardGenOutput', generationDebugContext: { sourceType: 'storyboardGen' },
    });
    const before = useCanvasStore.getState().nodes.find((node) => node.id === failed.id);
    const result = await runImageGenerationNode(source.id, { reuseFailedResults: true });
    expect(result.resultNodeIds).not.toContain(failed.id);
    expect(useCanvasStore.getState().nodes.find((node) => node.id === failed.id)).toEqual(before);
  });

  it('records raw and readable prompts on Agent submission and preserves them through polling success', async () => {
    const { source } = setupRetryFixture();
    const reference = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: -300, y: 0 }, { imageUrl: '/reference.png' });
    useCanvasStore.getState().setCanvasData([...useCanvasStore.getState().nodes, reference], [
      ...useCanvasStore.getState().edges, { id: 'reference-edge', source: reference.id, target: source.id, data: { valueType: 'image' } },
    ]);
    useCanvasStore.getState().updateNodeData(source.id, { prompt: 'Use {{image-ref:reference-edge}}', extraParams: { seed: 42 } });
    const batch = await runImageGenerationNodes([source.id]);
    const run = batch.runs[0];
    expect(run.status).toBe('started');
    if (run.status !== 'started') throw new Error('Submission did not start');
    const id = run.resultNodeIds[0];
    const before = useCanvasStore.getState().nodes.find((node) => node.id === id)!.data.generationRecord;
    expect(before).toMatchObject({ prompt: 'Use {{image-ref:reference-edge}}', displayPrompt: 'Use 图片 1', modelId: 'ai-media/gpt-image-2',
      size: '2K', requestAspectRatio: '16:9', resolvedAspectRatio: '16:9', outputCount: 1, extraParams: { seed: 42 }, referenceImageCount: 1, createdAt: expect.any(Number), modelName: expect.any(String), providerName: expect.any(String) });
    completeImageGenerationResult(id, { imageUrl: '/result.png', previewImageUrl: '/preview.jpg', referenceImageUrl: '/reference.jpg' });
    const finished = useCanvasStore.getState().nodes.find((node) => node.id === id)!;
    expect(finished.data.isGenerating).toBe(false);
    expect(finished.data.generationDebugContext).toBeUndefined();
    expect(finished.data.generationRecord).toEqual(before);
  });

  it('retains generation parameters when a submission fails', async () => {
    const { source } = setupRetryFixture();
    gateway.submitGenerateImageJobs.mockImplementationOnce(async (_payload, _count, settled, beforeSubmit) => {
      beforeSubmit(); settled({ status: 'rejected', error: new Error('Provider failure') }, 0); return [];
    });
    const result = await runImageGenerationNode(source.id);
    expect(result.submissions[0].status).toBe('failed');
    const output = useCanvasStore.getState().nodes.find((node) => node.id === result.resultNodeIds[0])!;
    expect(output.data.generationRecord).toMatchObject({ prompt: 'Current edited prompt', modelId: 'ai-media/gpt-image-2', size: '2K', outputCount: 1 });
  });

  it('preserves the default Agent behavior of creating new results', async () => {
    const { source, failed } = setupRetryFixture(2);
    const result = await runImageGenerationNodes([source.id]);
    expect(result.runs[0]).toMatchObject({ status: 'started' });
    expect(useCanvasStore.getState().nodes).toHaveLength(5);
    expect(useCanvasStore.getState().nodes.find((node) => node.id === failed.id)).toEqual(failed);
  });

  it('returns SOURCE_NODE_NOT_FOUND without submitting when a retry source is missing or disconnected', async () => {
    const { failed } = setupRetryFixture();
    useCanvasStore.getState().setCanvasData([failed], []);
    await expect(retryImageGenerationResult(failed.id)).rejects.toMatchObject({ code: 'SOURCE_NODE_NOT_FOUND' });
    expect(gateway.setApiKey).not.toHaveBeenCalled();
    expect(gateway.submitGenerateImageJobs).not.toHaveBeenCalled();
  });

  it('shares the source submission lock between retry and normal generation', async () => {
    const { source, failed } = setupRetryFixture();
    let finishSetup!: () => void;
    gateway.setApiKey.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSetup = resolve; }));
    const retry = retryImageGenerationResult(failed.id);
    await vi.waitFor(() => expect(gateway.setApiKey).toHaveBeenCalled());
    await expect(runImageGenerationNode(source.id, { reuseFailedResults: true })).rejects.toMatchObject({ code: 'ALREADY_RUNNING' });
    await expect(retryImageGenerationResult(failed.id)).rejects.toMatchObject({ code: 'ALREADY_RUNNING' });
    finishSetup();
    await retry;
    expect(gateway.submitGenerateImageJobs).toHaveBeenCalledOnce();
  });

});
