import { Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type PointerEvent as ReactPointerEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SPRING_PANEL, SPRING_PRESS } from '@/components/beui/lib/ease';
import { cn } from '@/components/beui/lib/utils';
import { AGENT_PANEL_DEFAULT_WIDTH, useAgentUiStore } from '@/features/agent/stores/agentUiStore';
import { Canvas } from '@/features/canvas/Canvas';
import { AgentPanel } from './AgentPanel';
import { useAgentCanvasBridge } from './useAgentCanvasBridge';

function ResizeHandle({ onResizingChange }: { onResizingChange: (resizing: boolean) => void }) {
  const [active, setActive] = useState(false);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = useAgentUiStore.getState().panelWidth;
    setActive(true);
    onResizingChange(true);
    document.body.style.cursor = 'col-resize';
    const move = (moveEvent: PointerEvent) => useAgentUiStore.getState().setPanelWidth(startWidth + startX - moveEvent.clientX);
    const up = () => {
      setActive(false);
      onResizingChange(false);
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={() => useAgentUiStore.getState().setPanelWidth(AGENT_PANEL_DEFAULT_WIDTH)}
      className="group absolute inset-y-0 left-0 z-30 w-2 -translate-x-1/2 cursor-col-resize"
    >
      <div className={cn('mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-foreground/25', active && 'bg-foreground/40')} />
    </div>
  );
}

/** The canvas with the Agent panel docked on its right. */
export function AgentWorkspace({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const open = useAgentUiStore((state) => state.panelOpen);
  const width = useAgentUiStore((state) => state.panelWidth);
  const setPanelOpen = useAgentUiStore((state) => state.setPanelOpen);
  const [resizing, setResizing] = useState(false);
  useAgentCanvasBridge(projectId);

  return (
    <div className="flex h-full w-full">
      <div className="relative h-full min-w-0 flex-1">
        <Canvas />
        <AnimatePresence>
          {!open ? (
            <motion.button
              type="button"
              aria-label={t('agent.panel.open')}
              title={t('agent.panel.open')}
              initial={{ opacity: 0, scale: 0.6, x: 12 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.6, x: 12 }}
              whileTap={{ scale: 0.94 }}
              transition={SPRING_PRESS}
              onClick={() => setPanelOpen(true)}
              className="absolute right-4 top-4 z-20 flex size-10 items-center justify-center rounded-2xl bg-foreground text-background shadow-lg"
            >
              <Sparkles className="size-4" />
            </motion.button>
          ) : null}
        </AnimatePresence>
      </div>
      <motion.aside
        initial={false}
        animate={{ width: open ? width : 0 }}
        transition={resizing ? { duration: 0 } : SPRING_PANEL}
        className="relative h-full shrink-0"
      >
        {open ? <ResizeHandle onResizingChange={setResizing} /> : null}
        <div className="h-full overflow-hidden">
          <div style={{ width }} className="h-full">
            <AgentPanel />
          </div>
        </div>
      </motion.aside>
    </div>
  );
}
