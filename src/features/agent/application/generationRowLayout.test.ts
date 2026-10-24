import { describe, expect, it } from 'vitest';

import { CANVAS_NODE_TYPES, type CanvasNode, type CanvasNodeType } from '@/features/canvas/domain/canvasNodes';
import { resolveGenerationRowPositions } from './generationRowLayout';

function node(
  id: string,
  type: CanvasNodeType,
  rect: { x: number; y: number; width: number; height: number },
  data: Record<string, unknown> = {},
): CanvasNode {
  return {
    id,
    type,
    position: { x: rect.x, y: rect.y },
    measured: { width: rect.width, height: rect.height },
    data,
  } as CanvasNode;
}

const generation = (id: string, x: number, y: number, outputCount = 1) =>
  node(id, CANVAS_NODE_TYPES.imageEdit, { x, y, width: 520, height: 320 }, { outputCount });
const result = (id: string, x: number, y: number) =>
  node(id, CANVAS_NODE_TYPES.exportImage, { x, y, width: 288, height: 288 });

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe('resolveGenerationRowPositions', () => {
  it('stacks a conversation downward in its own column instead of extending the canvas to the right', () => {
    const nodes = [
      generation('gen-1', 1000, 0),
      result('res-1', 1592, 16),
      // Unrelated work further right must not pull the conversation over.
      node('other', CANVAS_NODE_TYPES.upload, { x: 4000, y: 0, width: 300, height: 300 }),
    ];

    const [position] = resolveGenerationRowPositions({
      nodes,
      threadNodeIds: ['gen-1', 'res-1'],
      referenceNodeIds: ['res-1'],
      rows: [{ outputCount: 1 }],
    });

    expect(position.x).toBe(1000);
    expect(position.y).toBeGreaterThanOrEqual(320);
    expect(position.y).toBeLessThan(600);
  });

  it('reserves room for results that have not been created yet', () => {
    // A 2x2 batch on 1:1 is 592px tall, centered on the generation node.
    const [position] = resolveGenerationRowPositions({
      nodes: [generation('gen-1', 0, 0, 4)],
      threadNodeIds: ['gen-1'],
      referenceNodeIds: [],
      rows: [{ outputCount: 1 }],
    });

    expect(position.x).toBe(0);
    expect(position.y).toBeGreaterThanOrEqual(160 + 296);
  });

  it('places several rows of one call under each other without overlapping', () => {
    const positions = resolveGenerationRowPositions({
      nodes: [],
      threadNodeIds: [],
      referenceNodeIds: [],
      rows: [{ outputCount: 4 }, { outputCount: 2 }, { outputCount: 1 }],
    });

    expect(new Set(positions.map((position) => position.x)).size).toBe(1);
    const tops = positions.map((position) => position.y);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    // Each row is at least as tall as its result block, so the next generation node starts below it.
    expect(tops[1] - tops[0]).toBeGreaterThanOrEqual(592 / 2 + 320 / 2);
  });

  it('starts a new conversation next to its reference image', () => {
    const [position] = resolveGenerationRowPositions({
      nodes: [node('ref', CANVAS_NODE_TYPES.upload, { x: 0, y: 500, width: 300, height: 300 })],
      threadNodeIds: [],
      referenceNodeIds: ['ref'],
      rows: [{ outputCount: 1 }],
    });

    expect(position.x).toBe(460);
    expect(position.y + 160).toBeCloseTo(650, -1);
  });

  it('starts a new conversation without references in a fresh column right of the canvas', () => {
    const [position] = resolveGenerationRowPositions({
      nodes: [generation('earlier-thread', 0, 0), result('earlier-result', 592, 16)],
      threadNodeIds: [],
      referenceNodeIds: [],
      rows: [{ outputCount: 1 }],
    });

    expect(position.x).toBe(592 + 288 + 160);
  });

  it('slides a row below a node the user put in the column, keeping the column', () => {
    const blocker = node('blocker', CANVAS_NODE_TYPES.upload, { x: 1200, y: 420, width: 400, height: 400 });
    const [position] = resolveGenerationRowPositions({
      nodes: [generation('gen-1', 1000, 0), blocker],
      threadNodeIds: ['gen-1'],
      referenceNodeIds: [],
      rows: [{ outputCount: 1 }],
    });

    expect(position.x).toBe(1000);
    expect(overlaps({ ...position, width: 520 + 72 + 288, height: 320 }, { x: 1200, y: 420, width: 400, height: 400 }))
      .toBe(false);
    expect(position.y).toBeGreaterThan(820);
  });
});
