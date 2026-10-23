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
  const place = (nodes: CanvasNode[], resultCount: number, size = resultSize) => (
    resolveImageResultBatchPositions({
      sourceNodeId: source.id,
      nodes: [source, ...nodes],
      resultSize: size,
      resultCount,
    })
  );

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

  it('places a later batch to the right of a kept earlier batch instead of mixing them', () => {
    const firstBatch = place([], 4).map(({ x, y }, index) => result(`first-${index}`, x, y));

    expect(place(firstBatch, 4)).toEqual([
      { x: 1_132, y: 24 },
      { x: 1_436, y: 24 },
      { x: 1_132, y: 328 },
      { x: 1_436, y: 328 },
    ]);
  });

  it('refills the space of a deleted earlier batch when the whole batch fits', () => {
    const keptLaterBatch = result('later', 828, 176);

    expect(place([keptLaterBatch], 1)).toEqual([{ x: 492, y: 176 }]);
  });

  it('skips a gap that cannot hold the whole batch rather than splitting it', () => {
    const keptLaterBatch = result('later', 828, 176);

    expect(place([keptLaterBatch], 4)).toEqual([
      { x: 1_164, y: 24 },
      { x: 1_468, y: 24 },
      { x: 1_164, y: 328 },
      { x: 1_468, y: 328 },
    ]);
  });

  it('starts after the actual right edge of an earlier result with a different ratio', () => {
    const wideResult = result('wide', 492, 176, 512, 288);

    expect(place([wideResult], 1)).toEqual([{ x: 1_052, y: 176 }]);
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

  it('places results outside the group that contains the source', () => {
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

    expect(resolveImageResultBatchPositions({
      sourceNodeId: groupedSource.id,
      nodes: [group, groupedSource],
      resultSize,
      resultCount: 1,
    })).toEqual([{ x: 1_948, y: 826 }]);
  });
});
