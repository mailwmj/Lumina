import { motion } from 'motion/react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { EASE_OUT } from '@/components/beui/lib/ease';
import type { AgentDraftRef } from '@/features/agent/domain/types';
import { useCanvasStore } from '@/stores/canvasStore';
import { draftRefFromNode } from './agentDraftRefs';

/** The @ picker: every finished image on the canvas, already-picked ones disabled. */
export function CanvasImagePicker({ excludedNodeIds, onPick }: {
  excludedNodeIds: ReadonlySet<string>;
  onPick: (ref: AgentDraftRef) => void;
}) {
  const { t } = useTranslation();
  const nodes = useCanvasStore((state) => state.nodes);
  const refs = useMemo(() => nodes.flatMap((node) => draftRefFromNode(node) ?? []), [nodes]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ duration: 0.18, ease: EASE_OUT }}
      style={{ transformOrigin: 'bottom left' }}
      className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-72 overflow-y-auto rounded-xl border border-border bg-background p-2 shadow-lg"
    >
      {refs.length ? (
        <div className="grid grid-cols-3 gap-1.5">
          {refs.map((ref) => (
            <button
              key={ref.id}
              type="button"
              disabled={excludedNodeIds.has(ref.nodeId ?? '')}
              // Keep focus in the textarea so typing continues after picking.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(ref)}
              className="group rounded-lg p-1 text-left hover:bg-muted disabled:opacity-40"
            >
              <img src={ref.thumbnail} alt="" className="aspect-square w-full rounded-md object-cover" />
              <span className="mt-1 block truncate text-[11px] text-muted-foreground group-hover:text-foreground">{ref.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t('agent.composer.noCanvasImages')}</p>
      )}
    </motion.div>
  );
}
