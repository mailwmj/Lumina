import { afterEach, describe, expect, it } from 'vitest';

import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  runImageGenerationNode,
  runImageGenerationNodes,
} from './imageGenerationRun';

describe('shared image generation execution', () => {
  afterEach(() => {
    useCanvasStore.getState().setCanvasData([], []);
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
});
