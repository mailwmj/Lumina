import { describe, expect, it } from 'vitest';

import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasWorkflowNode,
} from '@/features/canvas/domain/canvasNodes';

import { estimateUpscaleDimensions, resolveUpscaleInput } from './upscaleInput';

function imageEdge(source: string, target: string, inputOrder: number): CanvasEdge {
  return {
    id: `edge-${source}-${target}`,
    source,
    target,
    sourceHandle: 'source',
    targetHandle: 'target',
    data: { valueType: 'image', inputOrder },
  };
}

describe('upscale input resolution', () => {
  it('resolves one connected, persisted image source', () => {
    const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 }, {
      displayName: 'Portrait',
      imageUrl: 'C:\\project\\uploads\\portrait.jpg',
      aspectRatio: '4:5',
    });
    const upscale = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upscale, { x: 300, y: 0 });

    expect(resolveUpscaleInput(
      upscale.id,
      [source, upscale],
      [imageEdge(source.id, upscale.id, 0)]
    )).toEqual({
      ok: true,
      sourceNodeId: source.id,
      sourceImageUrl: 'C:\\project\\uploads\\portrait.jpg',
      sourceDisplayName: 'Portrait',
      aspectRatio: '4:5',
    });
  });

  it('requires exactly one image and never substitutes a preview URL', () => {
    const first = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 }, {
      imageUrl: null,
      previewImageUrl: 'C:\\project\\uploads\\preview.jpg',
    });
    const second = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 240 }, {
      imageUrl: 'C:\\project\\uploads\\second.jpg',
    });
    const upscale = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upscale, { x: 300, y: 0 });
    const nodes: CanvasWorkflowNode[] = [first, second, upscale];

    expect(resolveUpscaleInput(upscale.id, nodes, [])).toEqual({
      ok: false,
      code: 'INPUT_REQUIRED',
    });
    expect(resolveUpscaleInput(upscale.id, nodes, [imageEdge(first.id, upscale.id, 0)])).toEqual({
      ok: false,
      code: 'INPUT_UNAVAILABLE',
    });
    expect(resolveUpscaleInput(upscale.id, nodes, [
      imageEdge(first.id, upscale.id, 0),
      imageEdge(second.id, upscale.id, 1),
    ])).toEqual({
      ok: false,
      code: 'INPUT_COUNT_INVALID',
    });
  });
});

describe('upscale dimension estimate', () => {
  it('calculates the displayed 2x and 4x output dimensions', () => {
    expect(estimateUpscaleDimensions(1200, 800, 2)).toEqual({
      inputWidth: 1200,
      inputHeight: 800,
      outputWidth: 2400,
      outputHeight: 1600,
    });
    expect(estimateUpscaleDimensions(1200, 800, 4)).toMatchObject({
      outputWidth: 4800,
      outputHeight: 3200,
    });
  });

  it('does not show a size for an unavailable image dimension', () => {
    expect(estimateUpscaleDimensions(0, 800, 2)).toBeNull();
  });
});
