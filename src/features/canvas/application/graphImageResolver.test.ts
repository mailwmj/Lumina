import { describe, expect, it } from 'vitest';

import { DefaultGraphImageResolver } from './graphImageResolver';
import { canvasNodeFactory } from './canvasServices';
import { CANVAS_NODE_TYPES, type CanvasEdge, type CanvasNode } from '../domain/canvasNodes';

function createNode(type: CanvasNode['type'], id: string): CanvasNode {
  return {
    ...canvasNodeFactory.createNode(type, { x: 0, y: 0 }),
    id,
  };
}

describe('DefaultGraphImageResolver', () => {
  it('prefers the reference image and falls back to the original image', () => {
    const target = createNode(CANVAS_NODE_TYPES.imageEdit, 'target');
    const withReference = createNode(CANVAS_NODE_TYPES.upload, 'with-reference');
    withReference.data = {
      ...withReference.data,
      imageUrl: 'file:///original-4k.png',
      referenceImageUrl: 'file:///reference-4k.jpg',
    };
    const withoutReference = createNode(CANVAS_NODE_TYPES.upload, 'without-reference');
    withoutReference.data = {
      ...withoutReference.data,
      imageUrl: 'file:///legacy-original.png',
      referenceImageUrl: null,
    };
    const edges: CanvasEdge[] = [
      {
        id: 'reference-edge',
        source: withReference.id,
        target: target.id,
        sourceHandle: 'source',
        targetHandle: 'target',
      },
      {
        id: 'fallback-edge',
        source: withoutReference.id,
        target: target.id,
        sourceHandle: 'source',
        targetHandle: 'target',
      },
    ];

    expect(new DefaultGraphImageResolver().collectInputImages(
      target.id,
      [target, withReference, withoutReference],
      edges
    )).toEqual([
      'file:///reference-4k.jpg',
      'file:///legacy-original.png',
    ]);
  });
});
