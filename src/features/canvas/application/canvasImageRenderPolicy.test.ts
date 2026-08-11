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
  previewImageUrl = `file:///preview-${id}.jpg`
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
      aspectRatio: '1:1',
    },
  };
}

describe('canvas image render policy', () => {
  it('uses the thumbnail while the image is not the idle focus', () => {
    expect(resolveCanvasImageRenderSource({
      nodeId: 'image-1',
      imageUrl: 'file:///original.jpg',
      previewImageUrl: 'file:///preview.jpg',
      focusedNodeId: null,
      isInteractionActive: false,
    })).toBe('file:///preview.jpg');
  });

  it('uses the original only for the idle focused image', () => {
    expect(resolveCanvasImageRenderSource({
      nodeId: 'image-1',
      imageUrl: 'file:///original.jpg',
      previewImageUrl: 'file:///preview.jpg',
      focusedNodeId: 'image-1',
      isInteractionActive: false,
    })).toBe('file:///original.jpg');

    expect(resolveCanvasImageRenderSource({
      nodeId: 'image-1',
      imageUrl: 'file:///original.jpg',
      previewImageUrl: 'file:///preview.jpg',
      focusedNodeId: 'image-1',
      isInteractionActive: true,
    })).toBe('file:///preview.jpg');
  });

  it('falls back to the original when no distinct preview exists', () => {
    expect(hasDistinctCanvasImagePreview('file:///original.jpg', 'file:///original.jpg')).toBe(false);
    expect(resolveCanvasImageRenderSource({
      nodeId: 'image-1',
      imageUrl: 'file:///original.jpg',
      previewImageUrl: 'file:///original.jpg',
      focusedNodeId: null,
      isInteractionActive: false,
    })).toBe('file:///original.jpg');
  });

  it('prefers a selected, sufficiently large visible image over the center candidate', () => {
    const centered = createImageNode('centered', { x: 250, y: 150 }, { width: 500, height: 500 });
    const selected = createImageNode('selected', { x: 20, y: 80 }, { width: 500, height: 500 });

    expect(findCanvasImageFocusCandidate({
      nodes: [centered, selected],
      viewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { width: 1000, height: 800 },
      selectedNodeId: selected.id,
    })).toBe(selected.id);
  });

  it('uses the closest sufficiently large visible image when no image is selected', () => {
    const centered = createImageNode('centered', { x: 250, y: 150 }, { width: 500, height: 500 });
    const distant = createImageNode('distant', { x: -320, y: 80 }, { width: 500, height: 500 });

    expect(findCanvasImageFocusCandidate({
      nodes: [distant, centered],
      viewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { width: 1000, height: 800 },
      selectedNodeId: null,
    })).toBe(centered.id);
  });

  it('does not select an image that is too small on screen for inspection', () => {
    const small = createImageNode('small', { x: 300, y: 250 }, { width: 300, height: 300 });

    expect(findCanvasImageFocusCandidate({
      nodes: [small],
      viewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { width: 1000, height: 800 },
      selectedNodeId: small.id,
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
      selectedNodeId: child.id,
    })).toBe(child.id);
  });
});
