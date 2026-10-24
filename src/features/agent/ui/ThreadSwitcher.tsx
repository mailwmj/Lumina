import { Check, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentThreadRecord } from '@/commands/agentThreads';
import { EASE_OUT, SPRING_PRESS } from '@/components/beui/lib/ease';
import { cn } from '@/components/beui/lib/utils';

function useRelativeTime() {
  const { t } = useTranslation();
  return (timestamp: number) => {
    const minutes = Math.round((Date.now() - timestamp) / 60000);
    if (minutes < 1) return t('agent.thread.justNow');
    if (minutes < 60) return t('agent.thread.minutesAgo', { count: minutes });
    const hours = Math.round(minutes / 60);
    return hours < 24 ? t('agent.thread.hoursAgo', { count: hours }) : t('agent.thread.daysAgo', { count: Math.round(hours / 24) });
  };
}

function ThreadRow({ thread, active, onSelect, onRename, onDelete }: {
  thread: AgentThreadRecord;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const formatAgo = useRelativeTime();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const title = thread.title || t('agent.panel.untitled');

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (editing) {
    const commit = () => {
      setEditing(false);
      const next = inputRef.current?.value.trim();
      if (next && next !== thread.title) onRename(next);
    };
    return (
      <li className="px-1 py-0.5">
        <input
          ref={inputRef}
          defaultValue={thread.title}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) commit();
            if (event.key === 'Escape') setEditing(false);
          }}
          className="w-full rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm text-foreground outline-none"
        />
      </li>
    );
  }

  return (
    <li className="group flex items-center rounded-lg hover:bg-muted" onMouseLeave={() => setConfirmingDelete(false)}>
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-sm">
        <span className="min-w-0 flex-1 truncate text-foreground">{title}</span>
        <span className="shrink-0 text-xs text-muted-foreground group-hover:hidden">{formatAgo(thread.updatedAt)}</span>
        {active ? <Check className="size-3.5 shrink-0 text-foreground group-hover:hidden" /> : null}
      </button>
      <div className="hidden shrink-0 items-center pr-1 group-hover:flex">
        <button type="button" aria-label={t('agent.thread.rename')} onClick={() => setEditing(true)}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground">
          <Pencil className="size-3.5" />
        </button>
        {confirmingDelete ? (
          <button type="button" onClick={onDelete} className="rounded-md px-1.5 py-0.5 text-xs font-medium text-destructive">
            {t('agent.thread.confirmDelete')}
          </button>
        ) : (
          <button type="button" aria-label={t('agent.thread.delete')} onClick={() => setConfirmingDelete(true)}
            className="rounded-md p-1 text-muted-foreground hover:text-destructive">
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </li>
  );
}

export function ThreadSwitcher({ threads, activeThreadId, onSelect, onRename, onDelete }: {
  threads: AgentThreadRecord[];
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
  onRename: (threadId: string, title: string) => void;
  onDelete: (threadId: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion() ?? false;
  const containerRef = useRef<HTMLDivElement>(null);
  const active = threads.find((thread) => thread.id === activeThreadId);
  const title = active?.title || t('agent.panel.untitled');

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div ref={containerRef} className="relative min-w-0">
      <motion.button
        type="button"
        whileTap={reduce ? undefined : { scale: 0.97 }}
        transition={SPRING_PRESS}
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-[240px] items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-foreground hover:bg-muted"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={`${activeThreadId}:${title}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="truncate"
          >
            {title}
          </motion.span>
        </AnimatePresence>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={SPRING_PRESS}>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </motion.span>
      </motion.button>
      <AnimatePresence>
        {open ? (
          <motion.ul
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            style={{ transformOrigin: 'top left' }}
            className={cn('absolute left-0 top-9 z-30 max-h-80 w-72 overflow-y-auto rounded-xl border border-border bg-background p-1 shadow-lg')}
          >
            {threads.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                active={thread.id === activeThreadId}
                onSelect={() => { onSelect(thread.id); setOpen(false); }}
                onRename={(next) => onRename(thread.id, next)}
                onDelete={() => onDelete(thread.id)}
              />
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
