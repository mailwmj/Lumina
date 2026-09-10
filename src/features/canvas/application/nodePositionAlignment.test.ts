import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';

import {
  NODE_ALIGNMENT_SNAP_DISTANCE,
  resolveCenterPreservingPositionY,
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
        position: { x: 500, y: 155 },
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
        position: { x: 500, y: 105 },
        dragging: false,
      },
    ], [
      node('target', 100, 200, undefined, { width: 520, height: 200 }),
      node('moving', 500, 300, undefined, { width: 520, height: 300 }),
    ]);

    expect(changes[0]).toMatchObject({ position: { x: 500, y: 100 } });
  });

  it('follows every pointer position without sticking while dragging', () => {
    const nodes = [node('moving', 0, 0), node('target', 100, 100)];
    for (let x = 85; x <= 115; x++) {
      const changes = [{ id: 'moving', type: 'position' as const, position: { x, y: 100 }, dragging: true }];
      expect(snapNodePositionChanges(changes, nodes)).toBe(changes);
    }
  });

  it('does not align to distant or hidden nodes on drop', () => {
    const changes = [{ id: 'moving', type: 'position' as const, position: { x: 96, y: 50 }, dragging: false }];
    expect(snapNodePositionChanges(changes, [
      node('moving', 0, 0), node('remote', 100, 100000),
      { ...node('hidden', 100, 50), hidden: true },
    ])).toBe(changes);
  });

  it('keeps the drop correction within six screen pixels at any zoom', () => {
    for (const zoom of [0.25, 1, 4]) {
      const nodes = [node('moving', 0, 0), node('target', 100, 100)];
      const drop = (screenOffset: number) => [{
        id: 'moving', type: 'position' as const,
        position: { x: 100 + screenOffset / zoom, y: 100 + screenOffset / zoom }, dragging: false,
      }];
      expect(snapNodePositionChanges(drop(5), nodes, { zoom })[0]).toMatchObject({ position: { x: 100, y: 100 } });
      const outside = drop(7);
      expect(snapNodePositionChanges(outside, nodes, { zoom })).toBe(outside);
    }
  });

  it('preserves grid-aligned positions and programmatic moves', () => {
    const nodes = [node('moving', 0, 0), node('target', 100, 100)];
    const changes = [{ id: 'moving', type: 'position' as const, position: { x: 96, y: 96 }, dragging: false }];
    expect(snapNodePositionChanges(changes, nodes, { snapToGrid: true })).toBe(changes);
    const programmatic = [{ ...changes[0], dragging: undefined }];
    expect(snapNodePositionChanges(programmatic, nodes)).toBe(programmatic);
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
});
