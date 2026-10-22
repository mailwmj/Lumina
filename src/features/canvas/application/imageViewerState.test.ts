import { afterEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes';
import { canvasNodeFactory } from './canvasServices';
import { buildGenerationBatchViewerItems } from './imageViewerState';
const result = (id: string, index: number, data = {}) => ({ ...canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage,
  { x: 0, y: 0 }, { generationBatchId: 'batch', generationBatchIndex: index, imageUrl: `/${id}.png`, ...data }), id });
afterEach(() => useCanvasStore.getState().closeImageViewer());
describe('generation batch viewer list', () => {
  it('sorts by batch index and excludes other batches, generating and failed images', () => {
    const a = result('first', 0), b = result('second', 1);
    const nodes = [b, result('pending', 2, { isGenerating: true }), result('failed', 3, { generationError: 'failed' }),
      result('other', 0, { generationBatchId: 'other' }), result('empty', 4, { imageUrl: null }), a];
    expect(buildGenerationBatchViewerItems(b.id, nodes)).toEqual([{ url: '/first.png', nodeId: a.id }, { url: '/second.png', nodeId: b.id }]);
  });
  it('falls back to one image without batch metadata', () => {
    const node = result('legacy', 0, { generationBatchId: undefined });
    expect(buildGenerationBatchViewerItems(node.id, [node, result('unrelated', 1)])).toEqual([{ url: '/legacy.png', nodeId: node.id }]);
  });
});
describe('image viewer store compatibility', () => {
  it('preserves node identity when opening and navigating even when URLs match', () => {
    const store = useCanvasStore.getState();
    store.openImageViewer('/same.png', [{ url: '/same.png', nodeId: 'first' }, { url: '/same.png', nodeId: 'second' }], 'first');
    expect(useCanvasStore.getState().imageViewer.currentNodeId).toBe('first');
    store.navigateImageViewer('next');
    expect(useCanvasStore.getState().imageViewer).toMatchObject({ currentNodeId: 'second', currentIndex: 1 });
    store.navigateImageViewer('prev'); expect(useCanvasStore.getState().imageViewer.currentNodeId).toBe('first');
  });
  it('keeps URL-only callers working and clears identity on close', () => {
    const store = useCanvasStore.getState(); store.openImageViewer('/second.png', ['/first.png', '/second.png']);
    expect(useCanvasStore.getState().imageViewer).toMatchObject({ currentImageUrl: '/second.png', currentNodeId: null, currentIndex: 1, imageList: ['/first.png', '/second.png'] });
    store.navigateImageViewer('prev'); expect(useCanvasStore.getState().imageViewer.currentImageUrl).toBe('/first.png');
    store.closeImageViewer(); expect(useCanvasStore.getState().imageViewer).toMatchObject({ isOpen: false, currentNodeId: null });
  });
});
