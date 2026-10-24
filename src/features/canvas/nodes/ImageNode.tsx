import { CanvasHandle as Handle } from '../ui/CanvasHandle';
import { buildGenerationBatchViewerItems } from '../application/imageViewerState';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react';
import { AlertTriangle, Image as ImageIcon, RefreshCw, Sparkles } from '@/components/ui/icons';
import { useTranslation } from 'react-i18next';
import { UiButton } from '@/components/ui';

import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  type CanvasNodeType,
  type ExportImageNodeData,
  type ImageEditNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  resolveMinEdgeFittedSize,
  resolveResizeMinConstraintsByAspect,
} from '@/features/canvas/application/imageNodeSizing';
import {
  resolveImageDisplayUrl,
} from '@/features/canvas/application/imageData';
import { useCanvasNodeImageSource } from '@/features/canvas/hooks/useCanvasNodeImageSource';
import { resolveImageFileName } from '@/features/canvas/application/imageMetadata';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  resolveNodeStatusSurfaceClass,
  resolveNodeSurfaceStateClass,
} from '@/features/canvas/ui/nodeSurfaceStyles';
import { NodeProgressOverlay } from '@/features/canvas/ui/NodeProgressOverlay';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { SelectedImageMetadata } from '@/features/canvas/ui/SelectedImageMetadata';
import { ImageGenerationFailureActions } from '@/features/canvas/ui/ImageGenerationFailureActions';
import { useCanvasStore } from '@/stores/canvasStore';

type ImageNodeProps = NodeProps & {
  id: string;
  data: ImageEditNodeData | ExportImageNodeData;
  selected?: boolean;
};

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

export const ImageNode = memo(({ id, data, selected, type, width, height }: ImageNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const viewerImages = useCallback(() => buildGenerationBatchViewerItems(id, useCanvasStore.getState().nodes)
    .map((item) => ({ ...item, url: resolveImageDisplayUrl(item.url) })), [id]);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeDataWithoutHistory = useCanvasStore(
    (state) => state.updateNodeDataWithoutHistory
  );
  const [now, setNow] = useState(() => Date.now());
  const isExportResultNode = type === CANVAS_NODE_TYPES.exportImage;
  const isGenerating = typeof data.isGenerating === 'boolean' ? data.isGenerating : false;
  const generationError =
    typeof (data as { generationError?: unknown }).generationError === 'string'
      ? ((data as { generationError?: string }).generationError ?? '').trim()
      : '';
  const hasGenerationError =
    isExportResultNode && !isGenerating && !data.imageUrl && generationError.length > 0;
  const generationRecoveryState =
    data.generationRecoveryState === 'retrying'
    || data.generationRecoveryState === 'attention_required'
    || data.generationRecoveryState === 'retry_requested'
      ? data.generationRecoveryState
      : null;
  const generationRetryError =
    typeof data.generationRetryError === 'string' ? data.generationRetryError.trim() : '';
  const requiresManualRequery =
    isExportResultNode && isGenerating && generationRecoveryState === 'attention_required';
  const generationStartedAt =
    typeof data.generationStartedAt === 'number' ? data.generationStartedAt : null;
  const generationDurationMs =
    typeof data.generationDurationMs === 'number' ? data.generationDurationMs : 60000;
  const resolvedAspectRatio = data.aspectRatio || DEFAULT_ASPECT_RATIO;
  const compactSize = resolveMinEdgeFittedSize(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const resizeConstraints = resolveResizeMinConstraintsByAspect(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const resizeMinWidth = resizeConstraints.minWidth;
  const resizeMinHeight = resizeConstraints.minHeight;
  const resolvedWidth = resolveNodeDimension(width, compactSize.width);
  const resolvedHeight = resolveNodeDimension(height, compactSize.height);
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(type as CanvasNodeType, data),
    [data, type]
  );
  const metadataFileName = useMemo(
    () => resolveImageFileName(data.imageUrl, resolvedTitle),
    [data.imageUrl, resolvedTitle]
  );

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    if (!isGenerating) {
      return;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 300);

    return () => {
      window.clearInterval(timer);
    };
  }, [isGenerating]);

  const simulatedProgress = useMemo(() => {
    if (!isGenerating) {
      return 0;
    }

    const startedAt = generationStartedAt ?? Date.now();
    const duration = Math.max(1000, generationDurationMs);
    const elapsed = Math.max(0, now - startedAt);

    return Math.min(elapsed / duration, 0.96);
  }, [generationDurationMs, generationStartedAt, isGenerating, now]);

  const waitedMinutes = useMemo(() => {
    if (!isGenerating || generationStartedAt === null) {
      return 0;
    }

    const elapsed = Math.max(0, now - generationStartedAt);
    return Math.floor(elapsed / 60000);
  }, [generationStartedAt, isGenerating, now]);

  const waitingResultText = useMemo(() => {
    if (!isExportResultNode) {
      return t('node.imageNode.selectToEdit');
    }

    if (generationRecoveryState === 'retrying' || generationRecoveryState === 'retry_requested') {
      return t('node.imageNode.recoveringResult');
    }

    if (!isGenerating || waitedMinutes < 2) {
      return t('node.imageNode.waitingResult');
    }

    return t('node.imageNode.waitingResultDelayed', { minutes: waitedMinutes });
  }, [generationRecoveryState, isExportResultNode, isGenerating, t, waitedMinutes]);

  const imageSource = useCanvasNodeImageSource({
    nodeId: id,
    imageUrl: data.imageUrl,
    previewImageUrl: data.previewImageUrl,
    referenceImageUrl: data.referenceImageUrl,
  });

  // 获取原图 URL 用于查看器
  const originalImageUrl = useMemo(() => {
    if (!data.imageUrl) return null;
    return resolveImageDisplayUrl(data.imageUrl);
  }, [data.imageUrl]);

  return (
    <div
      className={`
        group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 p-0 transition-colors duration-150
        ${hasGenerationError
          ? resolveNodeStatusSurfaceClass('danger', selected)
          : requiresManualRequery
            ? resolveNodeStatusSurfaceClass('warning', selected)
            : resolveNodeSurfaceStateClass(selected)}
      `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      aria-busy={isGenerating}
      onClick={() => setSelectedNode(id)}
    >
      <div
        className={`relative h-full w-full overflow-hidden rounded-[var(--node-radius)] ${hasGenerationError ? 'bg-transparent' : 'bg-bg-dark'}`}
      >
        {data.imageUrl ? (
          <CanvasNodeImage
            src={imageSource ?? ''}
            alt={isExportResultNode ? t('node.imageNode.resultAlt') : t('node.imageNode.generatedAlt')}
            viewerSourceUrl={originalImageUrl}
            viewerImageList={viewerImages}
            viewerNodeId={id}
            className="h-full w-full object-contain"
            showResolutionPreview={false}
          />
        ) : hasGenerationError ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-danger">
            <AlertTriangle className="h-7 w-7 opacity-90" />
            <span className="text-center text-xs font-medium leading-5 text-danger">
              {t('node.imageNode.generationFailed')}
            </span>
            <span className="max-h-[88px] overflow-y-auto break-words text-center text-node-sm text-danger/90">
              {generationError}
            </span>
            <ImageGenerationFailureActions id={id} data={data as ExportImageNodeData} />
          </div>
        ) : requiresManualRequery ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-warning">
            <AlertTriangle className="h-7 w-7 opacity-90" />
            <span className="text-center text-xs font-medium leading-5">
              {t('node.imageNode.requeryRequired')}
            </span>
            {generationRetryError && (
              <span className="max-h-[44px] overflow-y-auto break-words text-center text-node-sm text-warning/80">
                {generationRetryError}
              </span>
            )}
            <UiButton
              type="button"
              size="sm"
              variant="muted"
              className="nodrag nowheel z-10 gap-1.5 border-warning/35 bg-warning/10 text-warning hover:bg-warning/20"
              onClick={(event) => {
                event.stopPropagation();
                updateNodeDataWithoutHistory(id, {
                  generationRecoveryState: 'retry_requested',
                  generationNextRetryAt: null,
                  generationRetryError: null,
                });
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('node.imageNode.requeryTask')}
            </UiButton>
            <span className="text-center text-node-xs text-warning/70">
              {t('node.imageNode.requeryTaskHint')}
            </span>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-text-muted/85">
            {isExportResultNode ? (
              <ImageIcon className="h-7 w-7 opacity-60" />
            ) : (
              <Sparkles className="h-7 w-7 opacity-60" />
            )}
            <span className="px-4 text-center text-[12px] leading-6">
              {waitingResultText}
            </span>
          </div>
        )}

        {isGenerating && !requiresManualRequery && (
          <NodeProgressOverlay progress={simulatedProgress} />
        )}
      </div>

      {selected && originalImageUrl && (
        <SelectedImageMetadata
          filename={metadataFileName}
          imageSource={originalImageUrl}
        />
      )}

      <Handle
        type="target"
        id="target"
        position={Position.Left}
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
      />
      <NodeResizeHandle
        minWidth={resizeMinWidth}
        minHeight={resizeMinHeight}
        maxWidth={1600}
        maxHeight={1600}
      />
    </div>
  );
});

ImageNode.displayName = 'ImageNode';
