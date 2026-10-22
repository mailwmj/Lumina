import { useCanvasStore } from '@/stores/canvasStore';
import { DEFAULT_ASPECT_RATIO } from '../domain/canvasNodes';

/** Shared success finalizer for the polling path. Durable generationRecord is preserved. */
export function completeImageGenerationResult(nodeId: string, image: {
  imageUrl: string; previewImageUrl: string; referenceImageUrl: string; aspectRatio?: string;
}): void {
  useCanvasStore.getState().updateNodeData(nodeId, {
    ...image, aspectRatio: image.aspectRatio?.trim() || DEFAULT_ASPECT_RATIO,
    isGenerating: false, generationStartedAt: null, generationJobId: null,
    generationProviderId: null, generationProviderName: null, generationModelName: null,
    generationClientSessionId: null, generationStoryboardMetadata: undefined,
    generationError: null, generationErrorDetails: null, generationDebugContext: undefined,
    generationRecoveryState: null, generationRetryCount: 0, generationNextRetryAt: null,
    generationRetryError: null,
  });
}
