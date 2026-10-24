import { describe, expect, it } from 'vitest';
import { haveSameSelectionGeometry, resolveMultiSelectionGeometry } from './multiSelectionGeometry';

type SelectionNode = Parameters<typeof resolveMultiSelectionGeometry>[0] extends ReadonlyMap<string, infer N> ? N : never;

function node(x: number, y: number, width = 200, height = 100): SelectionNode {
  return { measured: { width, height }, internals: { positionAbsolute: { x, y } } };
}

describe('multi-selection overlay geometry', () => {
  it('anchors to the full selection and measured source handles without reading DOM', () => {
    const nodes = new Map<string, SelectionNode>([
      ['a', { ...node(100, 200), internals: { positionAbsolute: { x: 100, y: 200 },
        handleBounds: { source: [{ x: 194, y: 40, width: 12, height: 12 }] } } }],
      ['b', node(500, 400, 300, 200)],
    ]);
    expect(resolveMultiSelectionGeometry(nodes, ['a', 'b'], ['a', 'b'])).toEqual({
      connector: { x: 800, y: 400 },
      sourceAnchors: [{ nodeId: 'a', x: 300, y: 246 }, { nodeId: 'b', x: 800, y: 500 }],
    });
  });

  it('uses absolute positions for grouped nodes and includes measured nodes outside the viewport', () => {
    const nodes = new Map([['child', node(600, 800)], ['offscreen', node(2000, 3000)]]);
    expect(resolveMultiSelectionGeometry(nodes, ['child', 'offscreen'], ['child', 'offscreen'])?.connector)
      .toEqual({ x: 2200, y: 1950 });
  });

  it('keeps geometry equal across viewport-only updates, but detects movement and resize', () => {
    const nodes = new Map([['a', node(0, 0)], ['b', node(300, 200)]]);
    const initial = resolveMultiSelectionGeometry(nodes, ['a', 'b'], ['a', 'b']);
    expect(haveSameSelectionGeometry(initial, resolveMultiSelectionGeometry(nodes, ['a', 'b'], ['a', 'b']))).toBe(true);
    nodes.set('b', node(320, 200));
    expect(haveSameSelectionGeometry(initial, resolveMultiSelectionGeometry(nodes, ['a', 'b'], ['a', 'b']))).toBe(false);
    nodes.set('b', node(300, 200, 220));
    expect(haveSameSelectionGeometry(initial, resolveMultiSelectionGeometry(nodes, ['a', 'b'], ['a', 'b']))).toBe(false);
  });

  it('does not produce a connector with fewer than two usable sources', () => {
    const nodes = new Map<string, SelectionNode>([['a', node(0, 0)], ['hidden', { ...node(200, 200), hidden: true }], ['unmeasured', node(100, 100, 0, 0)]]);
    expect(resolveMultiSelectionGeometry(nodes, ['a', 'hidden', 'unmeasured'], ['a', 'hidden', 'unmeasured'])).toBeNull();
    expect(resolveMultiSelectionGeometry(nodes, ['a', 'deleted'], ['a', 'deleted'])).toBeNull();
  });
});
