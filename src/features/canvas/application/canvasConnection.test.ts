import { describe, expect, it } from 'vitest';

import { canvasNodeFactory } from './canvasServices';
import { buildBatchConnectionPlan } from './canvasConnection';
import { CANVAS_NODE_TYPES, type CanvasEdge, type CanvasNode } from '../domain/canvasNodes';

function createNode(type: CanvasNode['type'], id: string): CanvasNode {
  return {
    ...canvasNodeFactory.createNode(type, { x: 0, y: 0 }),
    id,
  };
}

describe('batch canvas connections', () => {
  it('plans one input edge for each selected image node', () => {
    const nodes = [
      createNode(CANVAS_NODE_TYPES.upload, 'source-a'),
      createNode(CANVAS_NODE_TYPES.upload, 'source-b'),
      createNode(CANVAS_NODE_TYPES.imageEdit, 'target'),
    ];

    const plan = buildBatchConnectionPlan(
      ['source-a', 'source-b'],
      'target',
      nodes,
      []
    );

    expect(plan.invalidSourceIds).toEqual([]);
    expect(plan.connections).toEqual([
      {
        source: 'source-a',
        target: 'target',
        sourceHandle: 'source',
        targetHandle: 'target',
      },
      {
        source: 'source-b',
        target: 'target',
        sourceHandle: 'source',
        targetHandle: 'target',
      },
    ]);
  });

  it('skips existing edges without failing the rest of the batch', () => {
    const nodes = [
      createNode(CANVAS_NODE_TYPES.upload, 'source-a'),
      createNode(CANVAS_NODE_TYPES.upload, 'source-b'),
      createNode(CANVAS_NODE_TYPES.imageEdit, 'target'),
    ];
    const edges: CanvasEdge[] = [
      {
        id: 'existing',
        source: 'source-a',
        target: 'target',
        sourceHandle: 'source',
        targetHandle: 'target',
      },
    ];

    const plan = buildBatchConnectionPlan(
      ['source-a', 'source-b'],
      'target',
      nodes,
      edges
    );

    expect(plan.skippedDuplicateCount).toBe(1);
    expect(plan.invalidSourceIds).toEqual([]);
    expect(plan.connections.map((connection) => connection.source)).toEqual(['source-b']);
  });

  it('applies SD2 input capacity to the whole simulated batch', () => {
    const sources = Array.from({ length: 10 }, (_, index) =>
      createNode(CANVAS_NODE_TYPES.upload, `source-${index}`)
    );
    const target = createNode(CANVAS_NODE_TYPES.sd2VideoGen, 'target');

    const plan = buildBatchConnectionPlan(
      sources.map((source) => source.id),
      target.id,
      [...sources, target],
      []
    );

    expect(plan.connections).toHaveLength(9);
    expect(plan.invalidSourceIds).toEqual(['source-9']);
  });
});
