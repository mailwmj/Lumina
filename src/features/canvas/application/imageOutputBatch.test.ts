import { describe, expect, it } from 'vitest';

import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';
import {
  createImageOutputBatchNodes,
  selectReusableImageOutputBatch,
} from './imageOutputBatch';

describe('image output batch layout', () => {
  it('creates four outputs as one 2x2 batch centered right of the source', () => {
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
      { x: 684, y: 30 },
      { x: 988, y: 30 },
      { x: 684, y: 334 },
      { x: 988, y: 334 },
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

  it('places a new batch to the right of an earlier batch from the same source', () => {
    type CreateBatchInput = Parameters<typeof createImageOutputBatchNodes>[0];
    type BatchNodeInput = Parameters<CreateBatchInput['addNodeBatch']>[0][number];
    const addedNodes: BatchNodeInput[] = [];
    const addNodeBatch: CreateBatchInput['addNodeBatch'] = (nodes) => {
      addedNodes.push(...nodes);
      return nodes.map((_, index) => `new-result-${index + 1}`);
    };
    const addEdge: CreateBatchInput['addEdge'] = () => 'edge-id';
    const source: CanvasNode = {
      id: 'source-1',
      type: CANVAS_NODE_TYPES.imageEdit,
      position: { x: 392, y: 182 },
      width: 220,
      height: 288,
      data: {} as never,
    };
    const existingResult: CanvasNode = {
      id: 'existing-result',
      type: CANVAS_NODE_TYPES.exportImage,
      position: { x: 684, y: 182 },
      width: 288,
      height: 288,
      data: { resultKind: 'generic' } as never,
    };

    createImageOutputBatchNodes({
      sourceNodeId: source.id,
      outputCount: 2,
      aspectRatio: '1:1',
      resultNodeTitle: 'City at dusk',
      generationStartedAt: 456,
      generationDurationMs: 45_000,
      existingNodes: [source, existingResult],
      addNodeBatch,
      addEdge,
    });

    expect(addedNodes.map(({ position }) => position)).toEqual([
      { x: 1_020, y: 30 },
      { x: 1_020, y: 334 },
    ]);
  });
});

describe('failed image output reuse', () => {
  const failed = (id: string, generationBatchId: string, generationBatchIndex: number): CanvasNode => ({
    id,
    type: CANVAS_NODE_TYPES.exportImage,
    position: { x: 0, y: 0 },
    data: { generationBatchId, generationBatchIndex } as never,
  });

  it('reuses failed placeholders only when one batch can hold the whole rerun', () => {
    const nodes = [failed('a-2', 'a', 2), failed('a-0', 'a', 0)];

    expect(selectReusableImageOutputBatch(['a-2', 'a-0'], nodes, 4)).toEqual([]);
    expect(selectReusableImageOutputBatch(['a-2', 'a-0'], nodes, 2)).toEqual(['a-0', 'a-2']);
  });

  it('never combines failed placeholders from different batches and prefers the latest batch', () => {
    const nodes = [failed('a-0', 'a', 0), failed('b-0', 'b', 0)];

    expect(selectReusableImageOutputBatch(['a-0', 'b-0'], nodes, 2)).toEqual([]);
    expect(selectReusableImageOutputBatch(['a-0', 'b-0'], nodes, 1)).toEqual(['b-0']);
  });
});
