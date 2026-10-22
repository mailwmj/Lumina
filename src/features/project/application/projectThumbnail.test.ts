import { describe, expect, it } from 'vitest';
import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import { selectProjectThumbnail } from './projectThumbnail';

const image = (url: string, data = {}) => canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, { x: 0, y: 0 }, { imageUrl: url, ...data });
const upload = (url: string) => canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 }, { imageUrl: url });

describe('selectProjectThumbnail', () => {
  it('prefers the last completed result over uploads and uses its preview', () => {
    expect(selectProjectThumbnail([image('/first.png'), image('/latest.png', { previewImageUrl: '/preview.jpg' }), upload('/upload.png')])).toBe('/preview.jpg');
  });
  it('skips generating and failed results, then falls back to the last upload', () => {
    expect(selectProjectThumbnail([upload('/first-upload.png'), image('/pending.png', { isGenerating: true }), image('/failed.png', { generationError: 'failed' }), upload('/last-upload.png')])).toBe('/last-upload.png');
  });
  it('falls back to the original URL when a preview is inline or encoded', () => {
    expect(selectProjectThumbnail([image('/original.png', { previewImageUrl: 'data:image/png;base64,big' })])).toBe('/original.png');
    expect(selectProjectThumbnail([image('/original.png', { previewImageUrl: '__img_ref__:1' })])).toBe('/original.png');
    expect(selectProjectThumbnail([image('', { previewImageUrl: '/preview-only.jpg' })])).toBe('/preview-only.jpg');
  });
  it('never returns data URLs or imagePool references', () => {
    expect(selectProjectThumbnail([image('data:image/png;base64,big')])).toBeNull();
    expect(selectProjectThumbnail([image('__img_ref__:0')])).toBeNull();
    expect(selectProjectThumbnail([upload('data:image/png;base64,big')])).toBeNull();
  });
  it('returns null when there is no image', () => {
    expect(selectProjectThumbnail([])).toBeNull();
    expect(selectProjectThumbnail([image('')])).toBeNull();
  });
});
