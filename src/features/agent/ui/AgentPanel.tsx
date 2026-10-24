import type { Chat } from '@ai-sdk/react';
import { ImagePlus, PanelRightClose, SquarePen } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type DragEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EASE_OUT, SPRING_LAYOUT } from '@/components/beui/lib/ease';
import {
  createAgentThread,
  deleteAgentThreadById,
  renameAgentThread,
} from '@/features/agent/application/agentThreadActions';
import type { CanvasAgentUIMessage } from '@/features/agent/application/canvasAgent';
import { useAgentUiStore } from '@/features/agent/stores/agentUiStore';
import { disposeAgentChat, ensureAgentChat, getLoadedAgentChat } from './agentChatRegistry';
import { readImageFiles } from './agentDraftRefs';
import { AgentConversation } from './AgentConversation';
import { ThreadSwitcher } from './ThreadSwitcher';

function useActiveChat(projectId: string | null, threadId: string | null) {
  const [chat, setChat] = useState<Chat<CanvasAgentUIMessage> | undefined>(
    () => (threadId ? getLoadedAgentChat(threadId) : undefined),
  );
  useEffect(() => {
    if (!projectId || !threadId) {
      setChat(undefined);
      return;
    }
    let cancelled = false;
    setChat(getLoadedAgentChat(threadId));
    void ensureAgentChat(projectId, threadId).then((loaded) => {
      if (!cancelled) setChat(loaded);
    });
    return () => { cancelled = true; };
  }, [projectId, threadId]);
  return chat?.id === threadId ? chat : undefined;
}

const ICON_BUTTON = 'rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground';

export function AgentPanel() {
  const { t } = useTranslation();
  const projectId = useAgentUiStore((state) => state.projectId);
  const threads = useAgentUiStore((state) => state.threads);
  const activeThreadId = useAgentUiStore((state) => state.activeThreadId);
  const { setPanelOpen, setActiveThreadId, addDraftRefs } = useAgentUiStore.getState();
  const thread = threads.find((item) => item.id === activeThreadId);
  const chat = useActiveChat(projectId, activeThreadId);
  const [dragging, setDragging] = useState(false);

  const isFileDrag = (event: DragEvent) => event.dataTransfer.types.includes('Files');

  return (
    <div
      className="relative flex h-full flex-col border-l border-border bg-background"
      onDragOver={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!isFileDrag(event) || !activeThreadId) return;
        event.preventDefault();
        setDragging(false);
        void readImageFiles(event.dataTransfer.files, t('agent.composer.pastedImage'))
          .then((refs) => addDraftRefs(activeThreadId, refs));
      }}
    >
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 px-2.5">
        <ThreadSwitcher
          threads={threads}
          activeThreadId={activeThreadId}
          onSelect={setActiveThreadId}
          onRename={(threadId, title) => void renameAgentThread(threadId, title)}
          onDelete={(threadId) => {
            disposeAgentChat(threadId);
            void deleteAgentThreadById(threadId);
          }}
        />
        <div className="flex items-center gap-0.5">
          <button type="button" aria-label={t('agent.panel.newThread')} title={t('agent.panel.newThread')}
            onClick={() => projectId && createAgentThread(projectId)} className={ICON_BUTTON}>
            <SquarePen className="size-4" />
          </button>
          <button type="button" aria-label={t('agent.panel.collapse')} title={t('agent.panel.collapse')}
            onClick={() => setPanelOpen(false)} className={ICON_BUTTON}>
            <PanelRightClose className="size-4" />
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          {chat && thread ? (
            <motion.div
              key={thread.id}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="absolute inset-0"
            >
              <AgentConversation chat={chat} thread={thread} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {dragging ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-foreground/30 bg-background/85 text-sm text-foreground"
          >
            <motion.span initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={SPRING_LAYOUT}>
              <ImagePlus className="size-6" />
            </motion.span>
            {t('agent.panel.dropImages')}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
