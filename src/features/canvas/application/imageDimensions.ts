import { readImageDimensions, type ImageDimensions } from '@/commands/imageMetadata';

// Image assets have immutable paths. Share pending reads and settled dimensions
// across selection changes and viewport unmounts without retaining image pixels.
const cache = new Map<string, Promise<ImageDimensions | null>>();
const MAX_CACHED_DIMENSIONS = 256;

export function getImageDimensions(source: string): Promise<ImageDimensions | null> {
  if (!source || /^(?:https?|data|blob):/i.test(source)) return Promise.resolve(null);
  const existing = cache.get(source);
  if (existing) return existing;
  const result = readImageDimensions(source).catch(() => {
    cache.delete(source);
    return null;
  });
  cache.set(source, result);
  if (cache.size > MAX_CACHED_DIMENSIONS) cache.delete(cache.keys().next().value!);
  return result;
}
