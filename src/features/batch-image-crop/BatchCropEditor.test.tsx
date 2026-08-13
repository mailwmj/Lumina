// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { BatchCropEditor } from './BatchCropEditor';
import type { BatchCropImageItem } from './domain';

const item: BatchCropImageItem = {
  id: 'image-1',
  sourcePath: '/fixtures/source.jpg',
  fileName: 'source.jpg',
  fileSize: 1024,
  previewPath: '/fixtures/preview.jpg',
  thumbnailPath: '/fixtures/thumbnail.jpg',
  width: 3574,
  height: 5361,
  rotationDegrees: 0,
  status: 'pending',
  crop: null,
  automaticCrop: null,
  requiresReview: false,
  lowResolution: false,
};

const target = { id: '1440x1920', width: 1440, height: 1920 } as const;

function editor(itemValue: BatchCropImageItem | null) {
  return (
    <BatchCropEditor
      item={itemValue}
      target={target}
      index={0}
      total={itemValue ? 1 : 0}
      busy={false}
      onCropChange={() => undefined}
      onRestore={() => undefined}
      onConfirm={() => undefined}
      onRotate={() => undefined}
      onPrevious={() => undefined}
      onNext={() => undefined}
    />
  );
}

describe('BatchCropEditor preview lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 1200,
      height: 640,
      top: 0,
      right: 1200,
      bottom: 640,
      left: 0,
      toJSON: () => ({}),
    });

    vi.stubGlobal('ResizeObserver', class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the main preview when the first uploaded item arrives after mount', async () => {
    await act(async () => root.render(editor(null)));
    expect(container.querySelector('img')).toBeNull();

    await act(async () => root.render(editor(item)));

    const preview = container.querySelector('img');
    expect(preview).not.toBeNull();
    expect(preview?.getAttribute('src')).toBe(item.previewPath);
    expect(preview?.style.width).toBe('427px');
    expect(preview?.style.height).toBe('640px');
  });
});
