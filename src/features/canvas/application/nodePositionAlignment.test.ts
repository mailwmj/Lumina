import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';

import {
  NODE_ALIGNMENT_NEIGHBOR_RANGE,
  NODE_ALIGNMENT_SNAP_DISTANCE,
  resolveCenterPreservingPositionY,
  snapDragEndPositionsToGrid,
  snapNodePositionChanges,
} from './nodePositionAlignment';

type TestNode = Node<{ label: string }, 'test'>;

function node(
  id: string,
  x: number,
  y: number,
  parentId?: string,
  measured?: { width: number; height: number }
): TestNode {
  return {
    id,
    type: 'test',
    position: { x, y },
    data: { label: id },
    parentId,
    measured,
  };
}

describe('node position alignment', () => {
  it('keeps the handle center fixed when an automatic layout changes node height', () => {
    expect(resolveCenterPreservingPositionY(280, 232, 355)).toBe(218.5);
  });

  it('snaps a dragged node to a sibling top and left edge inside the threshold', () => {
    const changes = snapNodePositionChanges([
      {
        id: 'moving',
        type: 'position',
        position: { x: 110, y: 195 },
        positionAbsolute: { x: 510, y: 495 },
        dragging: false,
      },
    ], [
      node('target', 104, 200),
      node('moving', 20, 40),
    ]);

    expect(changes).toEqual([
      {
        id: 'moving',
        type: 'position',
        position: { x: 104, y: 200 },
        positionAbsolute: { x: 504, y: 500 },
        dragging: false,
      },
    ]);
  });

  it('leaves nodes free when they are outside the threshold or have another parent', () => {
    const change = {
      id: 'moving',
      type: 'position' as const,
      position: { x: 100 + NODE_ALIGNMENT_SNAP_DISTANCE + 1, y: 200 },
      dragging: false,
    };
    const changes = snapNodePositionChanges([change], [
      node('target', 100, 200, 'group-a'),
      node('moving', 20, 40),
    ]);

    expect(changes).toEqual([change]);
  });

  it('snaps different-height nodes to the same horizontal center line', () => {
    const changes = snapNodePositionChanges([
      {
        id: 'moving',
        type: 'position',
        position: { x: 500, y: 154 },
        dragging: false,
      },
    ], [
      node('target', 100, 200, undefined, { width: 520, height: 200 }),
      node('moving', 500, 300, undefined, { width: 520, height: 300 }),
    ]);

    expect(changes[0]).toMatchObject({ position: { x: 500, y: 150 } });
  });

  it('snaps different-height nodes to the same bottom edge', () => {
    const changes = snapNodePositionChanges([
      {
        id: 'moving',
        type: 'position',
        position: { x: 500, y: 104 },
        dragging: false,
      },
    ], [
      node('target', 100, 200, undefined, { width: 520, height: 200 }),
      node('moving', 500, 300, undefined, { width: 520, height: 300 }),
    ]);

    expect(changes[0]).toMatchObject({ position: { x: 500, y: 100 } });
  });

  it('does not distort a multi-node drag', () => {
    const changes = snapNodePositionChanges([
      { id: 'a', type: 'position', position: { x: 100, y: 100 }, dragging: false },
      { id: 'b', type: 'position', position: { x: 200, y: 100 }, dragging: false },
    ], [node('a', 0, 0), node('b', 50, 0), node('target', 96, 96)]);

    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ position: { x: 100, y: 100 } });
    expect(changes[1]).toMatchObject({ position: { x: 200, y: 100 } });
  });

  it('scales the snap threshold with zoom so it stays constant on screen', () => {
    const change = {
      id: 'moving',
      type: 'position' as const,
      position: { x: 100 + NODE_ALIGNMENT_SNAP_DISTANCE * 2, y: 500 },
      dragging: false,
    };
    const nodes = [node('target', 100, 200), node('moving', 20, 40)];

    expect(snapNodePositionChanges([change], nodes, 1)).toEqual([change]);
    expect(snapNodePositionChanges([change], nodes, 0.5)[0]).toMatchObject({
      position: { x: 100, y: 500 },
    });
  });

  it('ignores siblings that are far away from the dragged node', () => {
    const size = { width: 200, height: 100 };
    const change = {
      id: 'moving',
      type: 'position' as const,
      position: { x: 103, y: 100 + 100 + NODE_ALIGNMENT_NEIGHBOR_RANGE + 1 },
      dragging: false,
    };

    expect(snapNodePositionChanges([change], [
      node('target', 100, 100, undefined, size),
      node('moving', 0, 0, undefined, size),
    ])).toEqual([change]);
  });

  it('leaves in-progress drags free and snaps only the drag end to the grid', () => {
    const moving = { id: 'a', type: 'position' as const, position: { x: 100, y: 40 }, dragging: true };
    expect(snapDragEndPositionsToGrid([moving], 72)).toEqual([moving]);

    const [end] = snapDragEndPositionsToGrid([{
      id: 'a',
      type: 'position',
      position: { x: 100, y: 40 },
      positionAbsolute: { x: 300, y: 240 },
      dragging: false,
    }], 72);
    expect(end).toMatchObject({
      position: { x: 72, y: 72 },
      positionAbsolute: { x: 272, y: 272 },
    });
  });

  it('keeps the relative layout of a multi-node drag when snapping to the grid', () => {
    const changes = snapDragEndPositionsToGrid([
      { id: 'a', type: 'position', position: { x: 100, y: 40 }, dragging: false },
      { id: 'b', type: 'position', position: { x: 130, y: 95 }, dragging: false },
    ], 72);

    expect(changes[0]).toMatchObject({ position: { x: 72, y: 72 } });
    expect(changes[1]).toMatchObject({ position: { x: 102, y: 127 } });
  });
  it('does not magnetically snap while dragging or when grid snapping is enabled', () => {
    const change = { id: 'moving', type: 'position' as const, position: { x: 103, y: 200 }, dragging: true };
    const nodes = [node('target', 100, 200), node('moving', 20, 40)];
    expect(snapNodePositionChanges([change], nodes)).toEqual([change]);
    const end = { ...change, dragging: false };
    expect(snapNodePositionChanges([end], nodes, 1, true)).toEqual([end]);
    expect(snapNodePositionChanges([end], nodes)[0]).toMatchObject({ position: { x: 100, y: 200 } });
  });

});
