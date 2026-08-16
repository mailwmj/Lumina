import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
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
      onSettled: (result: { status: 'fulfilled'; jobId: string }, index: number) => void
    ) => Array.from({ length: outputCount }, (_, index) => {
      const result = { status: 'fulfilled' as const, jobId: `job-${index + 1}` };
      onSettled(result, index);
      return result;
    }));
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
});
