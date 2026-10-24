import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import { TurnBudgetCounter } from '../turnBudget';
import { executeGenerateImage, splitIntoOutputCounts } from './generateImageTool';

const run = vi.hoisted(() => ({ runImageGenerationNodes: vi.fn() }));

vi.mock('@/features/canvas/application/imageGenerationRun', () => run);
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: { getState: () => ({ getCurrentProject: () => ({ id: 'project-1' }) }) },
}));

const IMAGE_MODEL = 'test-image-model';

function referenceNode(id: string): CanvasNode {
  return {
    ...canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 }, { imageUrl: 'data:image/png;base64,AA' }),
    id,
  };
}

/** Each source node gets `outputCount` finished result nodes, like a provider that answers instantly. */
function finishInstantly() {
  run.runImageGenerationNodes.mockImplementation(async (sourceNodeIds: string[]) => ({
    runs: sourceNodeIds.map((sourceNodeId) => {
      const source = useCanvasStore.getState().nodes.find((node) => node.id === sourceNodeId)!;
      const count = (source.data as { outputCount?: number }).outputCount ?? 1;
      const resultNodeIds = Array.from({ length: count }, () => useCanvasStore.getState().addNode(
        CANVAS_NODE_TYPES.exportImage,
        { x: 0, y: 0 },
        { imageUrl: 'data:image/png;base64,BB' },
      ));
      return { status: 'started', sourceNodeId, resultNodeIds, submissions: [] };
    }),
  }));
}

function imageEditNodes() {
  return useCanvasStore.getState().nodes.filter((node) => node.type === CANVAS_NODE_TYPES.imageEdit);
}

function incomingSources(nodeId: string) {
  return useCanvasStore.getState().edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source);
}

beforeEach(() => {
  useCanvasStore.getState().setCanvasData([referenceNode('ref-1'), referenceNode('ref-2')], []);
  finishInstantly();
});

afterEach(() => {
  run.runImageGenerationNodes.mockReset();
  useCanvasStore.getState().setCanvasData([], []);
});

describe('splitIntoOutputCounts', () => {
  it('splits counts into the node output sizes 4, 2 and 1', () => {
    expect(splitIntoOutputCounts(1)).toEqual([1]);
    expect(splitIntoOutputCounts(3)).toEqual([2, 1]);
    expect(splitIntoOutputCounts(6)).toEqual([4, 2]);
    expect(splitIntoOutputCounts(8)).toEqual([4, 4]);
  });
});

describe('executeGenerateImage', () => {
  it('creates one imageEdit node with the selected model, prompt and reference edges, and returns ready results', async () => {
    const output = await executeGenerateImage(
      { prompt: 'a red fox', aspectRatio: '3:4', referenceNodeIds: ['ref-1', 'ref-2'] },
      { imageModelId: IMAGE_MODEL, budget: new TurnBudgetCounter(4, 0), requestedImageCount: null },
    );

    const [node] = imageEditNodes();
    expect(imageEditNodes()).toHaveLength(1);
    expect(node.data).toMatchObject({ prompt: 'a red fox', model: IMAGE_MODEL, outputCount: 1, requestAspectRatio: '3:4' });
    expect(incomingSources(node.id)).toEqual(['ref-1', 'ref-2']);
    expect(run.runImageGenerationNodes).toHaveBeenCalledWith([node.id]);
    expect(output).toMatchObject({ status: 'completed', grantedCount: 1, sourceNodeIds: [node.id] });
    expect(output.status === 'completed' && output.results.map((result) => result.status)).toEqual(['ready']);
  });

  it('makes one image when the user gave no count, even if the model asks for more', async () => {
    const output = await executeGenerateImage(
      { prompt: 'cat', count: 4 },
      { imageModelId: IMAGE_MODEL, budget: new TurnBudgetCounter(4, 0), requestedImageCount: null },
    );
    expect(output.grantedCount).toBe(1);
    expect(imageEditNodes().map((node) => (node.data as { outputCount: number }).outputCount)).toEqual([1]);
  });

  it('splits an explicit request for 3 images into a 2-output and a 1-output node with the same prompt and references', async () => {
    const output = await executeGenerateImage(
      { prompt: 'cat', count: 3, referenceNodeIds: ['ref-1'] },
      { imageModelId: IMAGE_MODEL, budget: new TurnBudgetCounter(4, 0), requestedImageCount: 3 },
    );
    const nodes = imageEditNodes();
    expect(nodes.map((node) => (node.data as { outputCount: number }).outputCount)).toEqual([2, 1]);
    expect(nodes.every((node) => (node.data as { prompt: string }).prompt === 'cat')).toBe(true);
    expect(nodes.map((node) => incomingSources(node.id))).toEqual([['ref-1'], ['ref-1']]);
    expect(output.status === 'completed' && output.results).toHaveLength(3);
  });

  it('truncates a request that exceeds the remaining budget', async () => {
    const output = await executeGenerateImage(
      { prompt: 'cat', count: 4 },
      { imageModelId: IMAGE_MODEL, budget: new TurnBudgetCounter(4, 2), requestedImageCount: 4 },
    );
    expect(output).toMatchObject({ status: 'completed', grantedCount: 2, truncatedFrom: 4, budget: { limit: 4, used: 4 } });
  });

  it('refuses without touching the canvas once the budget is used up', async () => {
    const output = await executeGenerateImage(
      { prompt: 'cat' },
      { imageModelId: IMAGE_MODEL, budget: new TurnBudgetCounter(4, 4), requestedImageCount: null },
    );
    expect(output).toMatchObject({ status: 'refused', grantedCount: 0 });
    expect(imageEditNodes()).toHaveLength(0);
    expect(run.runImageGenerationNodes).not.toHaveBeenCalled();
  });

  it('gives the budget back when nothing could be submitted', async () => {
    run.runImageGenerationNodes.mockResolvedValue({
      runs: [{ status: 'failed', sourceNodeId: 'x', error: 'API key required' }],
    });
    const budget = new TurnBudgetCounter(4, 0);
    const output = await executeGenerateImage(
      { prompt: 'cat' },
      { imageModelId: IMAGE_MODEL, budget, requestedImageCount: null },
    );
    expect(output).toMatchObject({ status: 'failed', grantedCount: 0, error: 'API key required' });
    expect(budget.remaining).toBe(4);
  });

  it('stops waiting on abort and reports results still generating as stopped_waiting', async () => {
    run.runImageGenerationNodes.mockImplementation(async (sourceNodeIds: string[]) => ({
      runs: [{
        status: 'started',
        sourceNodeId: sourceNodeIds[0],
        resultNodeIds: [useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.exportImage, { x: 0, y: 0 }, { isGenerating: true })],
        submissions: [],
      }],
    }));
    const controller = new AbortController();
    const pending = executeGenerateImage(
      { prompt: 'cat' },
      { imageModelId: IMAGE_MODEL, budget: new TurnBudgetCounter(4, 0), requestedImageCount: null },
      controller.signal,
    );
    await vi.waitFor(() => expect(run.runImageGenerationNodes).toHaveBeenCalled());
    controller.abort();
    const output = await pending;
    expect(output.status === 'completed' && output.results.map((result) => result.status)).toEqual(['stopped_waiting']);
  });
});
