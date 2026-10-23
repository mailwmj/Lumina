import { useEffect, useRef, useState } from 'react';
import { NodeToolbar, useReactFlow } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { UiButton, UiPanel, UiTooltip } from '@/components/ui';
import { X } from '@/components/ui/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { canvasEventBus } from '../application/canvasServices';
import { findImageGenerationSource } from '../application/imageGenerationRetry';
import { restoreGenerationRecord } from '../application/generationRecord';
import { isExportImageNode } from '../domain/canvasNodes';
import { NODE_TOOLBAR_ALIGN, NODE_TOOLBAR_POPOVER_OFFSET, NODE_TOOLBAR_POSITION, NODE_TOOLBAR_CLASS } from './nodeToolbarConfig';
import { logger } from '@/lib/logger';

export function GenerationRecordPopover() {
  const { t, i18n } = useTranslation();
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [anchorNodeId, setAnchorNodeId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const node = nodes.find((item) => item.id === nodeId);
  const record = node && isExportImageNode(node) ? node.data.generationRecord : undefined;
  const source = nodeId ? findImageGenerationSource(nodeId, nodes, edges) : null;
  const flow = useReactFlow();
  useEffect(() => canvasEventBus.subscribe('generation-record/open', ({ nodeId: id }) => {
    setNodeId(id); setAnchorNodeId(id); setMessage(null); setCopied(false);
  }), []);
  useEffect(() => {
    if (!nodeId) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setNodeId(null); };
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) setNodeId(null); };
    document.addEventListener('keydown', escape);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside); };
  }, [nodeId]);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!nodeId || !record) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(record.displayPrompt);
      setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1100);
    } catch (error) { logger.error('Failed to copy generation prompt', error); setMessage(t('generationRecord.copyFailed')); }
  };
  return <NodeToolbar nodeId={anchorNodeId ?? nodeId} isVisible position={NODE_TOOLBAR_POSITION} align={NODE_TOOLBAR_ALIGN}
    offset={NODE_TOOLBAR_POPOVER_OFFSET} className={NODE_TOOLBAR_CLASS}>
    <div ref={panel} role="dialog" aria-label={t('generationRecord.title')} className="nodrag nowheel">
      <UiPanel className="w-96 max-w-[calc(100vw-24px)] rounded-xl p-3 shadow-[var(--ui-shadow-panel)]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-text-dark">{t('generationRecord.title')}</span>
          <button type="button" aria-label={t('common.close')} onClick={() => setNodeId(null)} className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-[var(--ui-hover)] hover:text-text-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"><X className="h-4 w-4" /></button>
        </div>
        <p className="nowheel max-h-40 select-text overflow-auto whitespace-pre-wrap break-words text-sm text-text-dark">{record.displayPrompt}</p>
        <dl className="my-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-text-muted">
          {[
            ['model', `${record.providerName} · ${record.modelName}`], ['size', record.size],
            ['ratio', `${record.requestAspectRatio} → ${record.resolvedAspectRatio}`],
            ['outputs', record.outputCount], ['references', record.referenceImageCount],
            ['time', new Date(record.createdAt).toLocaleString(i18n.language)],
          ].map(([key, value]) => <div key={key} className="contents"><dt>{t(`generationRecord.${key}`)}</dt><dd className="break-words">{value}</dd></div>)}
        </dl>
        <div className="flex flex-wrap gap-2">
          <UiButton size="sm" onClick={() => void copy()}>{t(copied ? 'nodeToolbar.copied' : 'generationRecord.copyPrompt')}</UiButton>
          <UiTooltip content={source ? t('generationRecord.restore') : t('node.imageNode.retrySourceMissing')}>
            <span><UiButton size="sm" disabled={!source} onClick={() => {
              const result = restoreGenerationRecord(nodeId, { ...flow, setSelectedNode: useCanvasStore.getState().setSelectedNode });
              if (result.status === 'restored') setAnchorNodeId(result.sourceNodeId);
              setMessage(result.status === 'restored' ? t(result.modelRestored ? 'generationRecord.restored' : 'generationRecord.modelUnavailable')
                : t('node.imageNode.retrySourceMissing'));
            }}>{t('generationRecord.restore')}</UiButton></span>
          </UiTooltip>
        </div>
        {message && <p role="status" className="mt-2 text-xs text-text-muted">{message}</p>}
      </UiPanel>
    </div>
  </NodeToolbar>;
}
