import { afterEach, describe, expect, it } from 'vitest';

import { useCanvasStore } from '@/stores/canvasStore';

import { canvasNodeFactory } from './canvasServices';
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes';
import { isGenerationJobCurrent } from './generationJobGuard';

function seedNode(data: Record<string, unknown>) {
  const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, { x: 0, y: 0 });
  useCanvasStore.getState().setCanvasData(
    [{ ...node, id: 'n1', data: { ...node.data, ...data } } as typeof node],
    []
  );
}

describe('isGenerationJobCurrent', () => {
  afterEach(() => {
    useCanvasStore.getState().setCanvasData([], []);
  });

  it('accepts the job the node is still generating', () => {
    seedNode({ isGenerating: true, generationJobId: 'job-1' });
    expect(isGenerationJobCurrent('n1', 'job-1')).toBe(true);
  });

  it('rejects a job superseded by a newer one', () => {
    seedNode({ isGenerating: true, generationJobId: 'job-2' });
    expect(isGenerationJobCurrent('n1', 'job-1')).toBe(false);
  });

  it('rejects a job after the node was cancelled or removed', () => {
    seedNode({ isGenerating: false, generationJobId: null });
    expect(isGenerationJobCurrent('n1', 'job-1')).toBe(false);
    useCanvasStore.getState().setCanvasData([], []);
    expect(isGenerationJobCurrent('n1', 'job-1')).toBe(false);
  });
});
