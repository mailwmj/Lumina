import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';

import {
  NODE_ALIGNMENT_SNAP_DISTANCE,
  snapNodePositionChanges,
} from './nodePositionAlignment';

type TestNode = Node<{ label: string }, 'test'>;

function node(id: string, x: number, y: number, parentId?: string): TestNode {
  return {
    id,
    type: 'test',
    position: { x, y },
    data: { label: id },
    parentId,
  };
}

describe('node position alignment', () => {
  it('snaps a dragged node to a sibling top and left edge inside the threshold', () => {
    const changes = snapNodePositionChanges([
      {
        id: 'moving',
        type: 'position',
        position: { x: 110, y: 191 },
        positionAbsolute: { x: 510, y: 491 },
        dragging: true,
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
        dragging: true,
      },
    ]);
  });

  it('leaves nodes free when they are outside the threshold or have another parent', () => {
    const change = {
      id: 'moving',
      type: 'position' as const,
      position: { x: 100 + NODE_ALIGNMENT_SNAP_DISTANCE + 1, y: 200 },
      dragging: true,
    };
    const changes = snapNodePositionChanges([change], [
      node('target', 100, 200, 'group-a'),
      node('moving', 20, 40),
    ]);

    expect(changes).toEqual([change]);
  });

  it('does not distort a multi-node drag', () => {
    const changes = snapNodePositionChanges([
      { id: 'a', type: 'position', position: { x: 100, y: 100 }, dragging: true },
      { id: 'b', type: 'position', position: { x: 200, y: 100 }, dragging: true },
    ], [node('a', 0, 0), node('b', 50, 0), node('target', 96, 96)]);

    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ position: { x: 100, y: 100 } });
    expect(changes[1]).toMatchObject({ position: { x: 200, y: 100 } });
  });
});
