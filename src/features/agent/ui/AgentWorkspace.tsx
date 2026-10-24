import { motion } from 'motion/react';
import { type PointerEvent as ReactPointerEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SPRING_PANEL } from '@/components/beui/lib/ease';
import { cn, inertProps } from '@/components/beui/lib/utils';
import { MessageCircle } from '@/components/ui/icons';
import { AGENT_PANEL_DEFAULT_WIDTH, useAgentUiStore } from '@/features/agent/stores/agentUiStore';
import { Canvas } from '@/features/canvas/Canvas';
import { CanvasToolbarButton } from '@/features/canvas/CanvasToolbar';
import { AgentPanel } from './AgentPanel';
import { useAgentCanvasBridge } from './useAgentCanvasBridge';

function ResizeHandle() {
  const [active, setActive] = useState(false);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = useAgentUiStore.getState().panelWidth;
    setActive(true);
    document.body.style.cursor = 'col-resize';
    const move = (moveEvent: PointerEvent) => useAgentUiStore.getState().setPanelWidth(startWidth + startX - moveEvent.clientX);
    const up = () => {
      setActive(false);
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
  useAgentCanvasBridge(projectId);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="absolute inset-y-0 left-0" style={{ right: open ? width : 0 }}>
        <Canvas
          toolbarActions={
            <CanvasToolbarButton
              label={t(open ? 'agent.panel.collapse' : 'agent.panel.open')}
              active={open}
              aria-pressed={open}
              aria-expanded={open}
              onClick={() => setPanelOpen(!open)}
            >
              <MessageCircle className="h-4 w-4" />
            </CanvasToolbarButton>
          }
        />
      </div>
      {/* Slides by transform only: animating width would re-lay out the canvas every frame. */}
      <motion.aside
        initial={false}
        animate={open ? { x: 0, visibility: 'visible' } : { x: width, transitionEnd: { visibility: 'hidden' } }}
        transition={SPRING_PANEL}
        style={{ width }}
        aria-hidden={!open}
        {...inertProps(!open)}
        className="absolute inset-y-0 right-0 z-10 will-change-transform"
      >
        {open ? <ResizeHandle /> : null}
        <AgentPanel />
      </motion.aside>
    </div>
  );
}
