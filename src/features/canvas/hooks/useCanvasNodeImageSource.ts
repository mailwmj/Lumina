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
  const isFocused = useCanvasImageQualityStore(
    (state) => state.focusedNodeId === nodeId
  );
  const isOriginalRetained = useCanvasImageQualityStore(
    (state) => state.retainedOriginalNodeIds.includes(nodeId)
  );
  const retainOriginalNode = useCanvasImageQualityStore((state) => state.retainOriginalNode);
  const originalDisplaySource = useMemo(
    () => imageUrl ? resolveImageDisplayUrl(imageUrl) : null,
    [imageUrl]
  );
  const previewDisplaySource = useMemo(
    () => previewImageUrl ? resolveImageDisplayUrl(previewImageUrl) : null,
    [previewImageUrl]
  );
  // Nodes enter the canvas with their preview. A focused original is decoded
  // before the source changes, rather than starting a large decode in render.
  const [displaySource, setDisplaySource] = useState<string | null>(
    () => previewDisplaySource ?? originalDisplaySource
  );
  const hasLoadedOriginal = Boolean(
    originalDisplaySource && displaySource === originalDisplaySource
  );
  const preferredSource = useMemo(() => resolveCanvasImageRenderSource({
    nodeId,
    imageUrl,
    previewImageUrl,
    focusedNodeId: isFocused ? nodeId : null,
    retainedOriginalNodeIds: isOriginalRetained && hasLoadedOriginal ? [nodeId] : [],
  }), [
    imageUrl,
    isFocused,
    isOriginalRetained,
    nodeId,
    previewImageUrl,
  ]);
  const preferredDisplaySource = useMemo(
    () => preferredSource ? resolveImageDisplayUrl(preferredSource) : null,
    [preferredSource]
  );

  useEffect(() => {
    if (!preferredDisplaySource) {
      setDisplaySource(null);
      return;
    }

    const shouldPreloadOriginal = (
      isFocused
      && !hasLoadedOriginal
      && originalDisplaySource === preferredDisplaySource
      && previewDisplaySource
      && previewDisplaySource !== originalDisplaySource
    );
    if (!shouldPreloadOriginal) {
      if (
        isFocused
        && hasLoadedOriginal
        && previewDisplaySource
        && previewDisplaySource !== originalDisplaySource
        && preferredDisplaySource === originalDisplaySource
      ) {
        retainOriginalNode(nodeId);
      }
      setDisplaySource(preferredDisplaySource);
      return;
    }

    let cancelled = false;
    void preloadImage(preferredDisplaySource)
      .then(() => {
        if (!cancelled) {
          setDisplaySource(preferredDisplaySource);
          retainOriginalNode(nodeId);
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
  }, [
    hasLoadedOriginal,
    isFocused,
    originalDisplaySource,
    preferredDisplaySource,
    previewDisplaySource,
    retainOriginalNode,
  ]);

  return displaySource;
}
