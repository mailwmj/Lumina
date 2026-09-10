// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasNodeImage } from './CanvasNodeImage';
let root: Root;
let container: HTMLDivElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.unstubAllGlobals(); });
it('only assigns image sources near the viewport and releases them on exit, including srcSet', async () => {
  let update: IntersectionObserverCallback;
  const unobserve = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { update = callback; }
    observe() {}
    unobserve = unobserve;
    disconnect() {}
  });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CanvasNodeImage src="preview.png" srcSet="detail.png 2x" viewerSourceUrl="original.png" />));
  const image = container.querySelector('img')!;
  expect(image.getAttribute('src')).toBeNull();
  expect(image.getAttribute('srcset')).toBeNull();
  const notify = async (visible: boolean) => act(async () => update([
    { target: image, isIntersecting: visible } as unknown as IntersectionObserverEntry,
  ], {} as IntersectionObserver));
  await notify(true);
  expect(image.getAttribute('src')).toBe('preview.png');
  expect(image.dataset.viewerSrc).toBe('original.png');
  await notify(false);
  expect(image.getAttribute('src')).toBeNull();
  expect(image.getAttribute('srcset')).toBeNull();
  act(() => root.unmount());
  expect(unobserve).toHaveBeenCalledWith(image);
});
