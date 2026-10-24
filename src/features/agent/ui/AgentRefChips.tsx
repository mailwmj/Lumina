import { ImageOff, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';

import { SPRING_LAYOUT } from '@/components/beui/lib/ease';
import type { AgentDraftRef, AgentRef } from '@/features/agent/domain/types';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasStore } from '@/stores/canvasStore';
import { nodeThumbnail } from './agentDraftRefs';

interface ChipItem {
  id: string;
  name: string;
  thumbnail: string | null;
}

function Chips({ items, onRemove }: { items: ChipItem[]; onRemove?: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <motion.div layout className="flex flex-wrap gap-1.5">
      <AnimatePresence initial={false}>
        {items.map((item, index) => (
          <motion.span
            key={item.id}
            layout
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={SPRING_LAYOUT}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/60 py-0.5 pl-0.5 pr-1.5 text-xs text-foreground"
          >
            {item.thumbnail
              ? <img src={item.thumbnail} alt="" className="size-5 rounded-md object-cover" />
              : <span className="grid size-5 place-items-center rounded-md bg-muted"><ImageOff className="size-3 text-muted-foreground" /></span>}
            <span className="max-w-[120px] truncate">{t('agent.composer.refLabel', { index: index + 1, name: item.name })}</span>
            {onRemove ? (
              <button type="button" aria-label={t('agent.composer.removeRef')} onClick={() => onRemove(item.id)} className="text-muted-foreground hover:text-foreground">
                <X className="size-3" />
              </button>
            ) : null}
          </motion.span>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

export function DraftRefChips({ refs, onRemove }: { refs: AgentDraftRef[]; onRemove: (id: string) => void }) {
  return <Chips items={refs.map((ref) => ({ id: ref.id, name: ref.name, thumbnail: ref.thumbnail }))} onRemove={onRemove} />;
}

/** Chips of a sent message, rendered from the live canvas nodes. */
export function MessageRefChips({ refs }: { refs: AgentRef[] }) {
  const { t } = useTranslation();
  const nodes = useCanvasStore((state) => state.nodes);
  const items = refs.map((ref) => {
    const node = nodes.find((candidate) => candidate.id === ref.nodeId);
    return {
      id: ref.nodeId,
      name: node ? resolveNodeDisplayName(node.type, node.data) : t('agent.image.missing'),
      thumbnail: nodeThumbnail(node),
    };
  });
  return <Chips items={items} />;
}
