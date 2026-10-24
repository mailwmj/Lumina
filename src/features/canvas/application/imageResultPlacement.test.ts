import { describe, expect, it } from 'vitest';

import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
  type CanvasNodeType,
} from '@/features/canvas/domain/canvasNodes';
import {
  IMAGE_RESULT_BATCH_GAP,
  IMAGE_RESULT_ITEM_GAP,
  IMAGE_RESULT_SOURCE_GAP,
  resolveImageResultBatchPositions,
} from './imageResultPlacement';

function node(
  id: string,
  type: CanvasNodeType,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { parentId?: string } = {}
): CanvasNode {
  return {
    id,
    type,
    position: { x, y },
    width,
    height,
    parentId: options.parentId,
    data: {},
  } as CanvasNode;
}

function result(id: string, x: number, y: number, width = 288, height = 288): CanvasNode {
  return node(id, CANVAS_NODE_TYPES.exportImage, x, y, width, height);
}

describe('image result placement', () => {
  const resultSize = { width: 288, height: 288 };
  // Source right edge 420, vertical center 320.
  const source = node('source', CANVAS_NODE_TYPES.imageEdit, 100, 200, 320, 240);
  const resultStep = resultSize.height + IMAGE_RESULT_BATCH_GAP;
  /** Results are connected from the source like real generation outputs; other nodes are not. */
  const edgesFromSource = (nodes: CanvasNode[]) => nodes
    .filter((item) => item.type === CANVAS_NODE_TYPES.exportImage)
    .map((item) => ({ source: source.id, target: item.id }));
  const place = (nodes: CanvasNode[], resultCount: number, size = resultSize) => (
    resolveImageResultBatchPositions({
      sourceNodeId: source.id,
      nodes: [source, ...nodes],
      edges: edgesFromSource(nodes),
      resultSize: size,
      resultCount,
    })
  );
  const runRepeatedly = (nodes: CanvasNode[], runs: number) => {
    const results: CanvasNode[] = [];
    for (let run = 0; run < runs; run += 1) {
      const [position] = place([...nodes, ...results], 1);
      results.push(result(`run-${run}`, position.x, position.y));
    }
    return results.map(({ position }) => position);
  };

  it('uses distinct source, item, and batch gaps so a batch reads as one unit', () => {
    expect(IMAGE_RESULT_SOURCE_GAP).toBe(72);
    expect(IMAGE_RESULT_ITEM_GAP).toBeLessThan(IMAGE_RESULT_BATCH_GAP);
  });

  it('centers a single result on the source', () => {
    expect(place([], 1)).toEqual([{ x: 492, y: 176 }]);
  });

  it('stacks two results as a vertical strip centered on the source', () => {
    expect(place([], 2)).toEqual([
      { x: 492, y: 24 },
      { x: 492, y: 328 },
    ]);
  });

  it('lays four results out as a centered 2x2 grid in reading order', () => {
    expect(place([], 4)).toEqual([
      { x: 492, y: 24 },
      { x: 796, y: 24 },
      { x: 492, y: 328 },
      { x: 796, y: 328 },
    ]);
  });

  it('keeps repeated runs in one result column growing downward instead of drifting right', () => {
    expect(runRepeatedly([], 5)).toEqual([0, 1, 2, 3, 4].map((run) => ({
      x: 492,
      y: 176 + run * resultStep,
    })));
  });

  it('stacks a later batch below a kept earlier batch instead of mixing them', () => {
    const firstBatch = place([], 4).map(({ x, y }, index) => result(`first-${index}`, x, y));

    expect(place(firstBatch, 4)).toEqual([
      { x: 492, y: 664 },
      { x: 796, y: 664 },
      { x: 492, y: 968 },
      { x: 796, y: 968 },
    ]);
  });

  it('refills the space of a deleted earlier batch when the whole batch fits', () => {
    const keptLaterBatch = result('later', 492, 176 + resultStep);

    expect(place([keptLaterBatch], 1)).toEqual([{ x: 492, y: 176 }]);
  });

  it('stacks below a kept batch when the freed gap cannot hold the whole batch', () => {
    const keptLaterBatch = result('later', 828, 176);

    expect(place([keptLaterBatch], 4)).toEqual([
      { x: 492, y: 512 },
      { x: 796, y: 512 },
      { x: 492, y: 816 },
      { x: 796, y: 816 },
    ]);
  });

  it('stacks below the actual bottom edge of an earlier result with a different ratio', () => {
    const tallResult = result('tall', 492, 64, 288, 512);

    expect(place([tallResult], 1)).toEqual([{ x: 492, y: 624 }]);
  });

  it('shifts the batch slightly when an obstacle only clips its centered position', () => {
    const note = node('note', CANVAS_NODE_TYPES.textAnnotation, 492, 0, 288, 150);

    expect(place([note], 1)).toEqual([{ x: 492, y: 198 }]);
  });

  it('moves the whole batch past an obstacle that blocks the column', () => {
    const blocker = node('blocker', CANVAS_NODE_TYPES.textGeneration, 492, -1_000, 288, 3_000);

    expect(place([blocker], 4)).toEqual([
      { x: 828, y: 24 },
      { x: 1_132, y: 24 },
      { x: 828, y: 328 },
      { x: 1_132, y: 328 },
    ]);
  });

  it('never stacks past a foreign node, so every run stays in the same column beside it', () => {
    const note = node('note', CANVAS_NODE_TYPES.textAnnotation, 492, 250, 288, 200);

    expect(runRepeatedly([note], 2)).toEqual([
      { x: 828, y: 176 },
      { x: 828, y: 176 + resultStep },
    ]);
  });

  it('opens a new column instead of reaching beside the next workflow row', () => {
    // A second workflow starts right below the source; its results will use the same lane.
    const nextRowSource = node('next-row', CANVAS_NODE_TYPES.imageEdit, 100, 560, 320, 240);

    expect(runRepeatedly([nextRowSource], 2)).toEqual([
      { x: 492, y: 176 },
      { x: 828, y: 176 },
    ]);
  });

  it('stacks below its own result rather than jumping past the downstream chain', () => {
    const ownResult = result('own', 492, 176);
    const downstreamEditor = node('downstream', CANVAS_NODE_TYPES.imageEdit, 900, 200, 320, 240);
    const downstreamResult = node('downstream-result', CANVAS_NODE_TYPES.exportImage, 1_292, 176, 288, 288);

    expect(resolveImageResultBatchPositions({
      sourceNodeId: source.id,
      nodes: [source, ownResult, downstreamEditor, downstreamResult],
      edges: [
        { source: source.id, target: ownResult.id },
        { source: ownResult.id, target: downstreamEditor.id },
        { source: downstreamEditor.id, target: downstreamResult.id },
      ],
      resultSize,
      resultCount: 1,
    })).toEqual([{ x: 492, y: 176 + resultStep }]);
  });

  it('places results outside the group that contains the source and stacks them there', () => {
    const group = node('group', CANVAS_NODE_TYPES.group, 1_000, 800, 900, 640);
    const groupedSource = node(
      'grouped-source',
      CANVAS_NODE_TYPES.imageEdit,
      100,
      50,
      320,
      240,
      { parentId: group.id }
    );
    const placeGrouped = (results: CanvasNode[]) => resolveImageResultBatchPositions({
      sourceNodeId: groupedSource.id,
      nodes: [group, groupedSource, ...results],
      edges: results.map((item) => ({ source: groupedSource.id, target: item.id })),
      resultSize,
      resultCount: 1,
    });

    const [first] = placeGrouped([]);
    expect(first).toEqual({ x: 1_948, y: 826 });
    expect(placeGrouped([result('first', first.x, first.y)])).toEqual([
      { x: 1_948, y: 826 + resultStep },
    ]);
  });
});
