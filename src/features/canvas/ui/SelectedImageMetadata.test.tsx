// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readImageDimensions } from '@/commands/imageMetadata';
import { SelectedImageMetadata } from './SelectedImageMetadata';

vi.mock('@/commands/imageMetadata', () => ({ readImageDimensions: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('Image', vi.fn());
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('shares a header read across selected copies and viewport remounts without loading original pixels', async () => {
  vi.mocked(readImageDimensions).mockResolvedValue({ width: 4096, height: 3072 });
  const render = () => root.render(<>
    <SelectedImageMetadata filename="First" imageSource="/large-selected.png" />
    <SelectedImageMetadata filename="Copy" imageSource="/large-selected.png" />
  </>);
  await act(async () => render());
  expect(readImageDimensions).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('4096 × 3072');
  await act(async () => root.render(null));
  await act(async () => render());
  expect(readImageDimensions).toHaveBeenCalledTimes(1);
  expect(Image).not.toHaveBeenCalled();
});

it('keeps the filename on metadata failure without falling back to a large image load', async () => {
  vi.mocked(readImageDimensions).mockRejectedValue(new Error('missing file'));
  await act(async () => root.render(<SelectedImageMetadata filename="Missing" imageSource="/missing-metadata.png" />));
  expect(container.textContent).toBe('Missing');
  expect(Image).not.toHaveBeenCalled();
});

it('does not show dimensions from an obsolete image after the source changes', async () => {
  let resolveFirst!: (value: { width: number; height: number }) => void;
  vi.mocked(readImageDimensions)
    .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
    .mockResolvedValueOnce({ width: 100, height: 200 });
  await act(async () => root.render(<SelectedImageMetadata filename="Old" imageSource="/old-metadata.png" />));
  await act(async () => root.render(<SelectedImageMetadata filename="New" imageSource="/new-metadata.png" />));
  await act(async () => resolveFirst({ width: 9000, height: 6000 }));
  expect(container.textContent).toBe('New100 × 200');
});
