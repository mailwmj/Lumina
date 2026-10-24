import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readImageDimensions } from '@/commands/imageMetadata';
import { getImageDimensions } from './imageDimensions';

vi.mock('@/commands/imageMetadata', () => ({ readImageDimensions: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe('image dimensions header probe', () => {
  it('normalizes WebView asset URLs and shares the read with the original path', async () => {
    vi.mocked(readImageDimensions).mockResolvedValue({ width: 4096, height: 3072 });
    const reads = await Promise.all([
      getImageDimensions('http://asset.localhost/C%3A%5Cimages%5Cdimensions.png'),
      getImageDimensions('C:\\images\\dimensions.png'),
    ]);
    expect(readImageDimensions).toHaveBeenCalledExactlyOnceWith('C:\\images\\dimensions.png');
    expect(reads).toEqual([{ width: 4096, height: 3072 }, { width: 4096, height: 3072 }]);
  });

  it('does not download remote, data or blob sources for metadata', async () => {
    for (const source of ['https://example.test/large.png', 'data:image/png;base64,AA', 'blob:test', '']) {
      expect(await getImageDimensions(source)).toBeNull();
    }
    expect(readImageDimensions).not.toHaveBeenCalled();
  });

  it('allows a later read to recover after a file was unavailable', async () => {
    vi.mocked(readImageDimensions).mockRejectedValueOnce(new Error('missing'))
      .mockResolvedValueOnce({ width: 100, height: 200 });
    expect(await getImageDimensions('/missing-then-created.png')).toBeNull();
    expect(await getImageDimensions('/missing-then-created.png')).toEqual({ width: 100, height: 200 });
    expect(readImageDimensions).toHaveBeenCalledTimes(2);
  });
});
