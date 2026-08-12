import { describe, expect, it } from 'vitest';

import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';
import {
  findCanvasImageFocusCandidate,
  hasDistinctCanvasImagePreview,
  resolveCanvasImageRenderSource,
} from './canvasImageRenderPolicy';

function createImageNode(
  id: string,
  position: { x: number; y: number },
  size: { width: number; height: number },
  previewImageUrl = `file:///preview-${id}.jpg`,
  aspectRatio = '1:1'
): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPES.exportImage,
    position,
    width: size.width,
    height: size.height,
    data: {
      imageUrl: `file:///original-${id}.jpg`,
      previewImageUrl,
      aspectRatio,
    },
  };
}

describe('canvas image render policy', () => {
  it('uses the thumbnail while the image is not focused', () => {
    expect(resolveCanvasImageRenderSource({
      nodeId: 'image-1',
      imageUrl: 'file:///original.jpg',
      previewImageUrl: 'file:///preview.jpg',
      focusedNodeId: null,
    })).toBe('file:///preview.jpg');
  });

  it('does not keep a focused, zoomed image on its thumbnail during wheel interaction', () => {
    expect(resolveCanvasImageRenderSource({
      nodeId: 'image-1',
      imageUrl: 'file:///original.jpg',
      previewImageUrl: 'file:///preview.jpg',
      focusedNodeId: 'image-1',
    })).toBe('file:///original.jpg');
  });

  it('falls back to the original when no distinct preview exists', () => {
    expect(hasDistinctCanvasImagePreview('file:///original.jpg', 'file:///original.jpg')).toBe(false);
    expect(resolveCanvasImageRenderSource({
      nodeId: 'image-1',
      imageUrl: 'file:///original.jpg',
      previewImageUrl: 'file:///original.jpg',
      focusedNodeId: null,
    })).toBe('file:///original.jpg');
  });

  it('prefers the image under the zoom point over the center candidate', () => {
    const centered = createImageNode('centered', { x: 250, y: 150 }, { width: 500, height: 500 });
    const pointed = createImageNode('pointed', { x: 20, y: 80 }, { width: 500, height: 500 });

    expect(findCanvasImageFocusCandidate({
      nodes: [centered, pointed],
      viewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { width: 1000, height: 800 },
      focusPoint: { x: 120, y: 180 },
    })).toBe(pointed.id);
  });

  it('renders the just-resized image only after its displayed content reaches the threshold', () => {
    const belowThreshold = createImageNode(
      'below-threshold',
      { x: 300, y: 250 },
      { width: 179, height: 179 }
    );
    const resized = createImageNode(
      'resized',
      { x: 300, y: 250 },
      { width: 180, height: 180 }
    );

    expect(findCanvasImageFocusCandidate({
      nodes: [belowThreshold],
      viewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { width: 1000, height: 800 },
      preferredNodeId: belowThreshold.id,
      devicePixelRatio: 2,
    })).toBeNull();

    expect(findCanvasImageFocusCandidate({
      nodes: [resized],
      viewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { width: 1000, height: 800 },
      preferredNodeId: resized.id,
      devicePixelRatio: 2,
    })).toBe(resized.id);
  });

  it('uses the closest sufficiently large visible image to the canvas center by default', () => {
    const centered = createImageNode('centered', { x: 250, y: 150 }, { width: 500, height: 500 });
    const distant = createImageNode('distant', { x: -320, y: 80 }, { width: 500, height: 500 });

    expect(findCanvasImageFocusCandidate({
      nodes: [distant, centered],
      viewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { width: 1000, height: 800 },
    })).toBe(centered.id);
  });

  it('uses actual physical pixels so high-density displays do not need oversized nodes', () => {
    const image = createImageNode('image', { x: 300, y: 250 }, { width: 180, height: 180 });

    expect(findCanvasImageFocusCandidate({
      nodes: [image],
      viewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { width: 1000, height: 800 },
      devicePixelRatio: 2,
    })).toBe(image.id);

    expect(findCanvasImageFocusCandidate({
      nodes: [image],
      viewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { width: 1000, height: 800 },
      devicePixelRatio: 1,
    })).toBeNull();
  });

  it('measures the contained image instead of blank space in a stretched node', () => {
    const letterboxed = createImageNode(
      'letterboxed',
      { x: 300, y: 250 },
      { width: 600, height: 200 },
      undefined,
      '1:1'
    );

    expect(findCanvasImageFocusCandidate({
      nodes: [letterboxed],
      viewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { width: 1000, height: 800 },
      devicePixelRatio: 1,
    })).toBeNull();
  });

  it('uses absolute positions for image nodes nested in a group', () => {
    const group: CanvasNode = {
      id: 'group-1',
      type: CANVAS_NODE_TYPES.group,
      position: { x: 250, y: 150 },
      width: 700,
      height: 600,
      data: { label: 'Group' },
    };
    const child = {
      ...createImageNode('child', { x: 0, y: 0 }, { width: 500, height: 500 }),
      parentId: group.id,
    };

    expect(findCanvasImageFocusCandidate({
      nodes: [group, child],
      viewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { width: 1000, height: 800 },
      preferredNodeId: child.id,
    })).toBe(child.id);
  });
});
