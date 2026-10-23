// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes';
import { selectWorkflowNodes } from '../application/canvasNodeSelectors';
import { useCanvasStore } from '@/stores/canvasStore';
import { useCanvasImagePreviewBackfill } from './useCanvasImagePreviewBackfill';

const { createNodeImagePreview } = vi.hoisted(() => ({ createNodeImagePreview: vi.fn() }));
vi.mock('@/features/canvas/application/imageData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/canvas/application/imageData')>()),
  createNodeImagePreview,
}));

function imageNode(id: string): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPES.upload,
    position: { x: 0, y: 0 },
    data: { imageUrl: `${id}.png`, previewImageUrl: null, referenceImageUrl: null },
  } as CanvasNode;
}

function Harness() {
  const workflowNodes = useCanvasStore(selectWorkflowNodes);
  const updateNodeDataWithoutHistory = useCanvasStore((state) => state.updateNodeDataWithoutHistory);
  useCanvasImagePreviewBackfill({
    projectId: 'project',
    workflowNodes,
    isInteractionActive: false,
    updateNodeDataWithoutHistory,
  });
  return null;
}

describe('useCanvasImagePreviewBackfill', () => {
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    createNodeImagePreview.mockReset();
    useCanvasStore.setState({ nodes: [imageNode('a'), imageNode('b')] });
    root = createRoot(document.createElement('div'));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps backfilling slow previews after applying an earlier result', async () => {
    createNodeImagePreview.mockImplementation((imageUrl: string) => new Promise((resolve) => {
      // Large images take longer than the idle delay to decode.
      setTimeout(() => resolve({
        previewImageUrl: `${imageUrl}.preview`,
        referenceImageUrl: `${imageUrl}.reference`,
      }), 2_000);
    }));

    act(() => root.render(<Harness />));
    for (let step = 0; step < 10; step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
    }

    const data = useCanvasStore.getState().nodes.map((node) => node.data.previewImageUrl);
    expect(data).toEqual(['a.png.preview', 'b.png.preview']);
    expect(createNodeImagePreview).toHaveBeenCalledTimes(2);
  });
});
