import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UiButton, UiTooltip } from '@/components/ui';
import { RefreshCw } from '@/components/ui/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { findImageGenerationSource, retryImageGenerationResult } from '../application/imageGenerationRetry';
import { isImageGenerationOutput } from '../application/imageOutputBatch';
import { ImageGenerationRunError } from '../application/imageGenerationRun';
import { showErrorDialog } from '../application/errorDialog';
import { buildGenerationErrorReport } from '../application/generationErrorReport';
import type { ExportImageNodeData } from '../domain/canvasNodes';

export function ImageGenerationFailureActions({ id, data }: { id: string; data: ExportImageNodeData }) {
  const { t } = useTranslation();
  const sourceNodeId = useCanvasStore((state) => findImageGenerationSource(id, state.nodes, state.edges));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retry = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await retryImageGenerationResult(id, {
        fallbackResultTitle: t('node.imageEdit.resultTitle'),
        fallbackErrorMessage: t('ai.error'),
      });
    } catch (failure) {
      const code = failure instanceof ImageGenerationRunError ? failure.code : null;
      const key = code === 'MODEL_REQUIRED' ? 'node.imageEdit.modelRequired'
        : code === 'API_KEY_REQUIRED' ? 'node.imageEdit.apiKeyRequired'
        : code === 'PROMPT_REQUIRED' ? 'node.imageEdit.promptRequired'
        : code === 'REFERENCE_IMAGES_UNAVAILABLE' ? 'node.textGeneration.imageUnavailable'
        : code === 'SOURCE_NODE_NOT_FOUND' ? 'node.imageNode.retrySourceMissing'
        : code === 'ALREADY_RUNNING' ? 'node.imageNode.sourceBusy'
        : 'node.imageNode.retryUnavailable';
      const message = t(key);
      if (code === 'MODEL_REQUIRED' || code === 'API_KEY_REQUIRED' || !code) {
        void showErrorDialog(message, t('common.error'));
      } else {
        setError(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="nodrag nowheel flex gap-2">
        {isImageGenerationOutput(data) && <UiTooltip content={!sourceNodeId ? t('node.imageNode.retrySourceMissing') : t('node.imageNode.retry')}>
          <span>
            <UiButton
              type="button" size="sm" variant="muted"
              className="gap-1.5"
              disabled={!sourceNodeId || isSubmitting}
              onClick={(event) => { event.stopPropagation(); void retry(); }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('node.imageNode.retry')}
            </UiButton>
          </span>
        </UiTooltip>}
        <UiButton
          type="button" size="sm" variant="muted"
          onClick={(event) => {
            event.stopPropagation();
            const errorMessage = typeof data.generationError === 'string' ? data.generationError : t('ai.error');
            const details = typeof data.generationErrorDetails === 'string' ? data.generationErrorDetails : undefined;
            void showErrorDialog(errorMessage, t('common.error'), details, buildGenerationErrorReport({
              errorMessage, errorDetails: details, context: data.generationDebugContext,
            }));
          }}
        >
          {t('node.imageNode.errorDetails')}
        </UiButton>
      </div>
      {error && <span role="alert" className="text-center text-[11px] text-red-300">{error}</span>}
    </>
  );
}
