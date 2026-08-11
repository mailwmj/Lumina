import { describe, expect, it } from 'vitest';

import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import {
  createImageOutputBatchNodes,
  resolveImageOutputBatchLayout,
} from './imageOutputBatch';

describe('image output batch layout', () => {
  it('keeps a single output at the batch origin', () => {
    expect(resolveImageOutputBatchLayout(1, 384, 288)).toEqual({
      width: 384,
      height: 288,
      offsets: [{ x: 0, y: 0 }],
    });
  });

  it('lays out two outputs in a compact vertical comparison strip', () => {
    expect(resolveImageOutputBatchLayout(2, 384, 288)).toEqual({
      width: 384,
      height: 604,
      offsets: [
        { x: 0, y: 0 },
        { x: 0, y: 316 },
      ],
    });
  });

  it('lays out four outputs in a compact two-by-two grid', () => {
    expect(resolveImageOutputBatchLayout(4, 384, 288)).toEqual({
      width: 796,
      height: 604,
      offsets: [
        { x: 0, y: 0 },
        { x: 412, y: 0 },
        { x: 0, y: 316 },
        { x: 412, y: 316 },
      ],
    });
  });

  it('creates and connects one result node per output in reading order', () => {
    type CreateBatchInput = Parameters<typeof createImageOutputBatchNodes>[0];
    type BatchNodeInput = Parameters<CreateBatchInput['addNodeBatch']>[0][number];
    const addedNodes: BatchNodeInput[] = [];
    const edges: Array<{ source: string; target: string }> = [];
    const addNodeBatch: CreateBatchInput['addNodeBatch'] = (nodes) => {
      addedNodes.push(...nodes);
      return nodes.map((_, index) => `result-${index + 1}`);
    };
    const addEdge: CreateBatchInput['addEdge'] = (source, target) => {
      edges.push({ source, target });
      return `${source}-${target}`;
    };
    const result = createImageOutputBatchNodes({
      sourceNodeId: 'source-1',
      outputCount: 4,
      aspectRatio: '1:1',
      resultNodeTitle: 'City at dusk',
      generationStartedAt: 123,
      generationDurationMs: 45_000,
      existingNodes: [
        {
          id: 'source-1',
          type: CANVAS_NODE_TYPES.imageEdit,
          position: { x: 392, y: 182 },
          width: 220,
          height: 288,
          data: {} as never,
        },
      ],
      existingEdges: [],
      addNodeBatch,
      addEdge,
    });

    expect(result).toEqual([
      { nodeId: 'result-1', outputIndex: 0 },
      { nodeId: 'result-2', outputIndex: 1 },
      { nodeId: 'result-3', outputIndex: 2 },
      { nodeId: 'result-4', outputIndex: 3 },
    ]);
    expect(addedNodes.map(({ position }) => position)).toEqual([
      { x: 640, y: 24 },
      { x: 956, y: 24 },
      { x: 640, y: 340 },
      { x: 956, y: 340 },
    ]);
    expect(addedNodes.map(({ type }) => type)).toEqual(
      Array.from({ length: 4 }, () => CANVAS_NODE_TYPES.exportImage)
    );
    expect(addedNodes.map(({ data }) => data?.displayName)).toEqual([
      'City at dusk · 1/4',
      'City at dusk · 2/4',
      'City at dusk · 3/4',
      'City at dusk · 4/4',
    ]);
    expect(addedNodes.map(({ data }) => data?.generationBatchIndex)).toEqual([0, 1, 2, 3]);
    expect(addedNodes.map(({ data }) => data?.generationBatchId)).toEqual(
      Array.from({ length: 4 }, () => 'source-1:generation:123')
    );
    expect(addedNodes.map(({ data }) => data?.aspectRatio)).toEqual(['1:1', '1:1', '1:1', '1:1']);
    expect(addedNodes.map(({ width, height }) => ({ width, height }))).toEqual([
      { width: 288, height: 288 },
      { width: 288, height: 288 },
      { width: 288, height: 288 },
      { width: 288, height: 288 },
    ]);
    expect(edges).toEqual([
      { source: 'source-1', target: 'result-1' },
      { source: 'source-1', target: 'result-2' },
      { source: 'source-1', target: 'result-3' },
      { source: 'source-1', target: 'result-4' },
    ]);
  });
});
