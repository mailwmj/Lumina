import { memo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Hand,
  MousePointer2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid3X3,
} from 'lucide-react';
import { useReactFlow } from '@xyflow/react';

import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

interface CanvasToolbarProps {
  isLocked?: boolean;
  interactionMode: CanvasInteractionMode;
  onInteractionModeChange: (mode: CanvasInteractionMode) => void;
}

export type CanvasInteractionMode = 'select' | 'pan';

export const CanvasToolbar = memo(({
  isLocked = false,
  interactionMode,
  onInteractionModeChange,
}: CanvasToolbarProps) => {
  const { t } = useTranslation();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const clearCanvas = useCanvasStore((state) => state.clearCanvas);
  const snapToGridEnabled = useSettingsStore((state) => state.snapToGridEnabled);
  const setSnapToGridEnabled = useSettingsStore((state) => state.setSnapToGridEnabled);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleClearClick = useCallback(() => {
    if (isLocked) return;
    setShowClearConfirm(true);
  }, [isLocked]);

  const handleClearConfirm = useCallback(() => {
    clearCanvas();
    setShowClearConfirm(false);
  }, [clearCanvas]);

  const handleClearCancel = useCallback(() => {
    setShowClearConfirm(false);
  }, []);

  return (
    <>
      <div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border-dark bg-surface-dark px-2 py-1.5 shadow-lg">
        <div className="flex items-center gap-1 rounded-full bg-bg-dark/70 p-1">
          <button
            type="button"
            onClick={() => onInteractionModeChange('select')}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${interactionMode === 'select'
              ? 'bg-[var(--canvas-selection-active-bg)] text-[var(--canvas-selection-accent)]'
              : 'text-text-muted hover:bg-surface-dark'
            }`}
            title={t('canvas.toolbar.selectMode')}
            aria-label={t('canvas.toolbar.selectMode')}
            aria-pressed={interactionMode === 'select'}
          >
            <MousePointer2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onInteractionModeChange('pan')}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${interactionMode === 'pan'
              ? 'bg-[var(--canvas-selection-active-bg)] text-[var(--canvas-selection-accent)]'
              : 'text-text-muted hover:bg-surface-dark'
            }`}
            title={t('canvas.toolbar.panMode')}
            aria-label={t('canvas.toolbar.panMode')}
            aria-pressed={interactionMode === 'pan'}
          >
            <Hand className="h-4 w-4" />
          </button>
        </div>

        <div className="h-6 w-px bg-border-dark" />

        <button
          onClick={() => zoomIn()}
          disabled={isLocked}
          className="rounded p-1.5 transition-colors hover:bg-bg-dark disabled:opacity-50"
          title={t('canvas.toolbar.zoomIn')}
        >
          <ZoomIn className="h-4 w-4 text-text-muted" />
        </button>

        <button
          onClick={() => zoomOut()}
          disabled={isLocked}
          className="rounded p-1.5 transition-colors hover:bg-bg-dark disabled:opacity-50"
          title={t('canvas.toolbar.zoomOut')}
        >
          <ZoomOut className="h-4 w-4 text-text-muted" />
        </button>

        <button
          onClick={() => fitView({ padding: 0.2 })}
          className="rounded p-1.5 transition-colors hover:bg-bg-dark"
          title={t('canvas.toolbar.fitView')}
        >
          <Maximize2 className="h-4 w-4 text-text-muted" />
        </button>

        <div className="h-6 w-px bg-border-dark" />

        <button
          onClick={() => setSnapToGridEnabled(!snapToGridEnabled)}
          className={`rounded p-1.5 transition-colors ${snapToGridEnabled ? 'bg-accent/20 text-accent' : 'hover:bg-bg-dark text-text-muted'}`}
          title={t('canvas.toolbar.snapToGrid')}
        >
          <Grid3X3 className="h-4 w-4" />
        </button>

        <button
          onClick={handleClearClick}
          disabled={isLocked}
          className="rounded p-1.5 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          title={t('common.delete')}
        >
          <svg className="h-4 w-4 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>

      {showClearConfirm && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
          onClick={handleClearCancel}
        >
          <div
            className="rounded-lg border border-border-dark bg-surface-dark p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-lg font-medium text-text-dark">
              {t('canvas.clearConfirm.title', '确认清空画布？')}
            </h3>
            <p className="mb-4 text-sm text-text-muted">
              {t('canvas.clearConfirm.message', '此操作不可撤销，所有节点和连线都将被删除。')}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleClearCancel}
                className="flex-1 rounded-lg border border-border-dark bg-bg-dark px-4 py-2 text-sm text-text-dark hover:bg-border-dark/50"
              >
                {t('common.cancel', '取消')}
              </button>
              <button
                onClick={handleClearConfirm}
                className="flex-1 rounded-lg bg-red-500 px-4 py-2 text-sm text-white hover:bg-red-600"
              >
                {t('common.confirm', '确认删除')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

CanvasToolbar.displayName = 'CanvasToolbar';
