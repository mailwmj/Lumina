import { describe, expect, it } from 'vitest';

import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeType,
} from '@/features/canvas/domain/canvasNodes';
import { resolveImageResultBatchPosition } from './imageResultPlacement';

function node(
  id: string,
  type: CanvasNodeType,
  x: number,
  y: number,
  width: number,
  height: number,
  options: {
    parentId?: string;
    resultKind?: 'generic';
  } = {}
): CanvasNode {
  return {
    id,
    type,
    position: { x, y },
    width,
    height,
    parentId: options.parentId,
    data: options.resultKind ? { resultKind: options.resultKind } : {},
  } as CanvasNode;
}

function edge(source: string, target: string): CanvasEdge {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
  } as CanvasEdge;
}

describe('image result placement', () => {
  const batchSize = { width: 288, height: 288 };

  it('places the first batch to the right of the source and aligns their centers', () => {
    const source = node('source', CANVAS_NODE_TYPES.imageEdit, 100, 200, 320, 240);

    expect(resolveImageResultBatchPosition({
      sourceNodeId: source.id,
      nodes: [source],
      edges: [],
      batchSize,
    })).toEqual({ x: 448, y: 176 });
  });

  it('continues repeated generations to the right of the existing direct results', () => {
    const source = node('source', CANVAS_NODE_TYPES.imageEdit, 100, 200, 320, 240);
    const result = node(
      'result',
      CANVAS_NODE_TYPES.exportImage,
      448,
      176,
      288,
      288,
      { resultKind: 'generic' }
    );

    expect(resolveImageResultBatchPosition({
      sourceNodeId: source.id,
      nodes: [source, result],
      edges: [edge(source.id, result.id)],
      batchSize,
    })).toEqual({ x: 764, y: 176 });
  });

  it('uses a lower right-lane slot before moving to another column when the direct slot is occupied', () => {
    const source = node('source', CANVAS_NODE_TYPES.imageEdit, 100, 200, 320, 240);
    const blocker = node('blocker', CANVAS_NODE_TYPES.textGeneration, 448, 176, 288, 288);

    expect(resolveImageResultBatchPosition({
      sourceNodeId: source.id,
      nodes: [source, blocker],
      edges: [],
      batchSize,
    })).toEqual({ x: 448, y: 492 });
  });

  it('moves further right rather than placing a dense result branch on the left', () => {
    const source = node('source', CANVAS_NODE_TYPES.imageEdit, 100, 200, 320, 240);
    const blocker = node('blocker', CANVAS_NODE_TYPES.textGeneration, 448, -5_000, 288, 10_000);

    expect(resolveImageResultBatchPosition({
      sourceNodeId: source.id,
      nodes: [source, blocker],
      edges: [],
      batchSize,
    })).toEqual({ x: 764, y: 176 });
  });

  it('uses absolute source coordinates while ignoring its group container as an obstacle', () => {
    const group = node('group', CANVAS_NODE_TYPES.group, 1_000, 800, 900, 640);
    const source = node(
      'source',
      CANVAS_NODE_TYPES.imageEdit,
      100,
      50,
      320,
      240,
      { parentId: group.id }
    );

    expect(resolveImageResultBatchPosition({
      sourceNodeId: source.id,
      nodes: [group, source],
      edges: [],
      batchSize,
    })).toEqual({ x: 1_448, y: 826 });
  });
});
