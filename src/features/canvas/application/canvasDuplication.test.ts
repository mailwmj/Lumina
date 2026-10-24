import { describe, expect, it } from 'vitest';

import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes';
import {
  cloneCanvasDuplicationSnapshot,
  createCanvasDuplicationNodeInput,
  remapCanvasDuplicationEdges,
  selectCanvasDuplicationSource,
  sortCanvasEdgesForDuplication,
} from './canvasDuplication';

function edge(
  id: string,
  source: string,
  target: string,
  valueType: 'text' | 'image',
  inputOrder: number
): CanvasEdge {
  return { id, source, target, data: { valueType, inputOrder } };
}

describe('canvas subgraph duplication ordering', () => {
  it('preserves each target/type order even when edge groups are interleaved', () => {
    const edges = [
      edge('text-later', 'text-a', 'target', 'text', 1),
      edge('image', 'image-a', 'target', 'image', 0),
      edge('other-target', 'text-c', 'other', 'text', 0),
      edge('text-earlier', 'text-b', 'target', 'text', 0),
    ];

    const sorted = sortCanvasEdgesForDuplication(edges);
    const targetTextSources = sorted
      .filter((item) => item.target === 'target' && item.data?.valueType === 'text')
      .map((item) => item.source);

    expect(targetTextSources).toEqual(['text-b', 'text-a']);
  });
});

describe('canvas duplication sources', () => {
  const node = (id: string, prompt: string, parentId?: string): CanvasNode => ({
    id,
    type: 'imageNode',
    position: { x: 12, y: 24 },
    data: { imageUrl: null, aspectRatio: '1:1', prompt },
    ...(parentId ? { parentId } : {}),
  } as CanvasNode);

  it('pastes snapshot nodes and remaps internal edges after their sources leave the canvas', () => {
    const snapshot = {
      nodes: [node('a', 'copied A'), node('b', 'copied B')],
      edges: [edge('ab', 'a', 'b', 'image', 0), edge('external', 'outside', 'a', 'image', 1)],
    };

    const selected = selectCanvasDuplicationSource(['a', 'b'], [], [], snapshot);
    const remapped = remapCanvasDuplicationEdges(selected.edges, new Map([
      ['a', 'a-copy'],
      ['b', 'b-copy'],
    ]));

    expect(selected.nodes.map((item) => item.data.prompt)).toEqual(['copied A', 'copied B']);
    expect(remapped).toEqual([{
      source: 'a-copy', target: 'b-copy', sourceHandle: undefined, targetHandle: undefined,
    }]);
  });

  it('keeps copied content after the live canvas node is modified', () => {
    const original = node('a', 'before');
    const snapshot = cloneCanvasDuplicationSnapshot({ nodes: [original], edges: [] });
    original.data.prompt = 'after';

    const selected = selectCanvasDuplicationSource(['a'], [original], [], snapshot);

    expect(selected.nodes[0].data.prompt).toBe('before');
  });

  it('duplicates a parented node as a root at its offset position, matching addNode behavior', () => {
    const child = node('child', 'child prompt', 'group');
    const input = createCanvasDuplicationNodeInput(child, { x: child.position.x + 44, y: child.position.y + 30 });

    expect(input).toEqual({
      type: 'imageNode',
      position: { x: 56, y: 54 },
      data: child.data,
    });
    expect(input).not.toHaveProperty('parentId');
  });
});
