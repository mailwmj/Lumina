import { memo, useCallback, useEffect, useMemo } from 'react';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react';
import { AlertTriangle, Check, Loader2, Maximize2 } from '@/components/ui/icons';
import { useTranslation } from 'react-i18next';

import type { UpscaleNodeData, UpscaleScale } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeSurfaceStateClass } from '@/features/canvas/ui/nodeSurfaceStyles';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_FOOTER_CLASS,
  NODE_CONTROL_ICON_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { UiButton, UiSelect } from '@/components/ui';
import { selectWorkflowNodes } from '@/features/canvas/application/canvasNodeSelectors';
import { resolveUpscaleInput } from '@/features/canvas/application/upscaleInput';
import {
  cancelUpscaleRun,
  runUpscaleNode,
} from '@/features/canvas/application/upscaleRun';
import {
  isUpscaleRuntimeActive,
  useUpscaleRuntimeStore,
  type UpscaleRuntimeErrorCode,
  type UpscaleRuntimeStatus,
} from '@/features/canvas/application/upscaleRuntimeStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

const UPSCALE_NODE_WIDTH = 264;
const UPSCALE_NODE_HEIGHT = 154;

type UpscaleNodeProps = NodeProps & {
  id: string;
  data: UpscaleNodeData;
  selected?: boolean;
};

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 1
    ? Math.round(value)
    : fallback;
}

function getInputStatusKey(errorCode: UpscaleRuntimeErrorCode | null): string {
  if (errorCode === 'INPUT_COUNT_INVALID') {
    return 'node.upscale.inputCountInvalid';
  }
  if (errorCode === 'INPUT_UNAVAILABLE') {
    return 'node.upscale.inputUnavailable';
  }
  return 'node.upscale.inputMissing';
}

function getBackendStatusKey(errorCode: UpscaleRuntimeErrorCode | null): string | null {
  switch (errorCode) {
    case 'INPUT_NOT_FOUND':
      return 'node.upscale.inputUnavailable';
    case 'INVALID_SCALE':
      return 'node.upscale.invalidScale';
    case 'UNSUPPORTED_IMAGE':
      return 'node.upscale.unsupportedImage';
    case 'IMAGE_TOO_LARGE':
      return 'node.upscale.imageTooLarge';
    case 'SIDECAR_UNAVAILABLE':
      return 'node.upscale.sidecarUnavailable';
    case 'SIDECAR_FAILED':
      return 'node.upscale.sidecarFailed';
    case 'CACHE_FAILED':
      return 'node.upscale.cacheFailed';
    case 'JOB_NOT_FOUND':
      return 'node.upscale.jobNotFound';
    case 'INVALID_RESPONSE':
      return 'node.upscale.invalidResponse';
    case 'INTERNAL_ERROR':
      return 'node.upscale.internalError';
    case 'CANCELLED':
      return 'node.upscale.cancelled';
    default:
      return null;
  }
}

export const UpscaleNode = memo(({ id, data, selected, width, height }: UpscaleNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const workflowNodes = useCanvasStore(selectWorkflowNodes);
  const edges = useCanvasStore((state) => state.edges);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const runtime = useUpscaleRuntimeStore((state) => state.runtimesByNodeId[id]);
  const scale: UpscaleScale = data.scale === 4 ? 4 : 2;
  const status: UpscaleRuntimeStatus = runtime?.status ?? 'idle';
  const isActive = isUpscaleRuntimeActive(status);
  const resolvedWidth = resolveNodeDimension(width, UPSCALE_NODE_WIDTH);
  const resolvedHeight = resolveNodeDimension(height, UPSCALE_NODE_HEIGHT);
  const input = useMemo(
    () => resolveUpscaleInput(id, workflowNodes, edges),
    [edges, id, workflowNodes]
  );

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  const statusText = useMemo(() => {
    if (status === 'failed') {
      if (runtime?.errorCode === 'NON_SRGB_INPUT') {
        return t('node.upscale.nonSrgb');
      }
      if (
        runtime?.errorCode === 'INPUT_REQUIRED'
        || runtime?.errorCode === 'INPUT_COUNT_INVALID'
        || runtime?.errorCode === 'INPUT_UNAVAILABLE'
      ) {
        return t(getInputStatusKey(runtime.errorCode));
      }
      if (runtime?.errorCode === 'PROJECT_REQUIRED') {
        return t('node.upscale.projectRequired');
      }
      if (runtime?.errorCode === 'RESULT_UNAVAILABLE') {
        return t('node.upscale.resultUnavailable');
      }
      const backendStatusKey = getBackendStatusKey(runtime?.errorCode ?? null);
      if (backendStatusKey) {
        return t(backendStatusKey);
      }
      return t('node.upscale.backendError', {
        message: t('node.upscale.unknownError'),
      });
    }

    if (!input.ok && status === 'idle') {
      return t(getInputStatusKey(input.code));
    }

    if (!currentProjectId && status === 'idle') {
      return t('node.upscale.projectRequired');
    }

    if (status === 'starting' || status === 'running') {
      return t('node.upscale.running');
    }
    if (status === 'queued') {
      return t('node.upscale.queued');
    }
    if (status === 'cancelling') {
      return t('node.upscale.cancelling');
    }
    if (status === 'cancelled') {
      return t('node.upscale.cancelled');
    }
    if (status === 'succeeded') {
      return t('node.upscale.completed');
    }
    return t('node.upscale.srgbOnly');
  }, [currentProjectId, input, runtime?.errorCode, status, t]);

  const handleRun = useCallback(() => {
    void runUpscaleNode(id, { resultTitle: t('node.upscale.resultTitle') });
  }, [id, t]);

  const handleCancel = useCallback(() => {
    void cancelUpscaleRun(id);
  }, [id]);

  const canRun = input.ok && Boolean(currentProjectId);
  const hasError = status === 'failed' || (!input.ok && status === 'idle');
  const hasSuccess = status === 'succeeded';

  return (
    <div
      className={`
        group relative flex h-full flex-col gap-2 overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
        ${hasError
          ? 'border-red-500/70 bg-[rgba(127,29,29,0.12)] hover:border-red-400/80'
          : resolveNodeSurfaceStateClass(selected)}
      `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <header className="flex min-w-0 items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/12 text-accent">
          <Maximize2 className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-xs font-medium text-text-dark">{t('node.upscale.title')}</h3>
          <p className="truncate text-[10px] text-text-muted">
            {input.ok ? input.sourceDisplayName : t('node.upscale.inputLabel')}
          </p>
        </div>
      </header>

      <div className="min-w-0 rounded-md border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)] px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-text-muted">{t('node.upscale.scale')}</span>
          <UiSelect
            aria-label={t('node.upscale.scale')}
            compact
            className={`nodrag nowheel w-[72px] ${NODE_CONTROL_CHIP_CLASS} !h-6 !justify-between`}
            value={String(scale)}
            disabled={isActive}
            onChange={(event) => {
              updateNodeData(id, { scale: Number(event.target.value) === 4 ? 4 : 2 });
            }}
          >
            <option value="2">{t('node.upscale.scale2')}</option>
            <option value="4">{t('node.upscale.scale4')}</option>
          </UiSelect>
        </div>
      </div>

      <div
        className={`flex min-h-5 items-center gap-1.5 text-[10px] leading-4 ${
          hasError
            ? 'text-red-300'
            : hasSuccess
              ? 'text-emerald-400'
              : 'text-text-muted'
        }`}
      >
        {isActive ? (
          <Loader2 className={`${NODE_CONTROL_ICON_CLASS} shrink-0 animate-spin`} />
        ) : hasError ? (
          <AlertTriangle className={`${NODE_CONTROL_ICON_CLASS} shrink-0`} />
        ) : hasSuccess ? (
          <Check className={`${NODE_CONTROL_ICON_CLASS} shrink-0`} />
        ) : null}
        <span className="min-w-0 break-words">{statusText}</span>
      </div>

      <footer className={`${NODE_CONTROL_FOOTER_CLASS} gap-1`}>
        <span className="text-[10px] text-text-muted">{t('node.upscale.srgbOnly')}</span>
        <div className="ml-auto" />
        {isActive ? (
          <UiButton
            type="button"
            variant="muted"
            size="sm"
            className={`nodrag nowheel shrink-0 ${NODE_CONTROL_PRIMARY_BUTTON_CLASS}`}
            onClick={(event) => {
              event.stopPropagation();
              handleCancel();
            }}
          >
            {t('node.upscale.cancel')}
          </UiButton>
        ) : (
          <UiButton
            type="button"
            variant="primary"
            size="sm"
            className={`nodrag nowheel shrink-0 ${NODE_CONTROL_PRIMARY_BUTTON_CLASS}`}
            disabled={!canRun}
            title={!canRun ? statusText : undefined}
            onClick={(event) => {
              event.stopPropagation();
              handleRun();
            }}
          >
            <Maximize2 className={NODE_CONTROL_ICON_CLASS} />
            {t('node.upscale.start')}
          </UiButton>
        )}
      </footer>

      <Handle type="target" id="target" position={Position.Left} />
      <Handle type="source" id="source" position={Position.Right} />
    </div>
  );
});

UpscaleNode.displayName = 'UpscaleNode';
