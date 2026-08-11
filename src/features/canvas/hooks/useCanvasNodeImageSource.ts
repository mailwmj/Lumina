import { useEffect, useMemo, useState } from 'react';

import {
  resolveCanvasImageRenderSource,
} from '@/features/canvas/application/canvasImageRenderPolicy';
import { useCanvasImageQualityStore } from '@/features/canvas/application/canvasImageQualityStore';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';

interface CanvasNodeImageSourceInput {
  nodeId: string;
  imageUrl: string | null | undefined;
  previewImageUrl: string | null | undefined;
}

function preloadImage(source: string): Promise<void> {
  const image = new Image();
  image.decoding = 'async';
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Image failed to load'));
  });

  image.src = source;
  return typeof image.decode === 'function'
    ? image.decode().catch(() => loaded)
    : loaded;
}

export function useCanvasNodeImageSource({
  nodeId,
  imageUrl,
  previewImageUrl,
}: CanvasNodeImageSourceInput): string | null {
  const shouldUseOriginal = useCanvasImageQualityStore(
    (state) => state.focusedNodeId === nodeId && !state.isInteractionActive
  );
  const preferredSource = useMemo(() => resolveCanvasImageRenderSource({
    nodeId,
    imageUrl,
    previewImageUrl,
    focusedNodeId: shouldUseOriginal ? nodeId : null,
    isInteractionActive: !shouldUseOriginal,
  }), [imageUrl, nodeId, previewImageUrl, shouldUseOriginal]);
  const preferredDisplaySource = useMemo(
    () => preferredSource ? resolveImageDisplayUrl(preferredSource) : null,
    [preferredSource]
  );
  const originalDisplaySource = useMemo(
    () => imageUrl ? resolveImageDisplayUrl(imageUrl) : null,
    [imageUrl]
  );
  const previewDisplaySource = useMemo(
    () => previewImageUrl ? resolveImageDisplayUrl(previewImageUrl) : null,
    [previewImageUrl]
  );
  const [displaySource, setDisplaySource] = useState<string | null>(preferredDisplaySource);

  useEffect(() => {
    if (!preferredDisplaySource) {
      setDisplaySource(null);
      return;
    }

    const shouldPreloadOriginal = (
      shouldUseOriginal
      && originalDisplaySource === preferredDisplaySource
      && previewDisplaySource
      && previewDisplaySource !== originalDisplaySource
    );
    if (!shouldPreloadOriginal) {
      setDisplaySource(preferredDisplaySource);
      return;
    }

    let cancelled = false;
    void preloadImage(preferredDisplaySource)
      .then(() => {
        if (!cancelled) {
          setDisplaySource(preferredDisplaySource);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDisplaySource(previewDisplaySource);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [originalDisplaySource, preferredDisplaySource, previewDisplaySource, shouldUseOriginal]);

  return displaySource;
}
