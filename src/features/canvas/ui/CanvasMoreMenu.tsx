import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { UiIconButton, UiPanel } from '@/components/ui';
import { MoreHorizontal, Trash2 } from '@/components/ui/icons';

export function CanvasMoreMenu({ isLocked, onClear }: { isLocked: boolean; onClear: () => void }) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const trigger = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = (restoreFocus = false) => {
    setAnchor(null);
    if (restoreFocus) trigger.current?.querySelector('button')?.focus();
  };

  useEffect(() => {
    if (!anchor) return;
    (menu.current?.querySelector('button:not(:disabled)') as HTMLElement | null ?? menu.current)?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) {
        setAnchor(null);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setAnchor(null);
      trigger.current?.querySelector('button')?.focus();
    };
    const dismiss = () => setAnchor(null);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', dismiss);
    };
  }, [anchor]);

  return <>
    <div ref={trigger}>
      <UiIconButton
        label={t('canvas.toolbar.more')}
        aria-haspopup="menu" aria-expanded={Boolean(anchor)} aria-controls={anchor ? 'canvas-more-menu' : undefined}
        className="h-8 w-8 rounded-full"
        onClick={() => anchor ? close() : setAnchor(trigger.current!.getBoundingClientRect())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            setAnchor(trigger.current!.getBoundingClientRect());
          }
        }}
      ><MoreHorizontal className="h-4 w-4" /></UiIconButton>
    </div>
    {anchor && createPortal(
      <UiPanel
        className="fixed z-50 min-w-44 rounded-xl p-1 shadow-[var(--ui-shadow-panel)]"
        style={{ right: Math.max(8, window.innerWidth - anchor.right), bottom: window.innerHeight - anchor.top + 8 }}
      >
        <div id="canvas-more-menu" role="menu" aria-label={t('canvas.toolbar.more')} ref={menu} tabIndex={-1}
          onKeyDown={(event) => { if (event.key === 'Tab') close(); }}>
          <button type="button" role="menuitem" disabled={isLocked}
            className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm text-red-500 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => { close(); onClear(); }}>
            <Trash2 className="h-4 w-4" />{t('canvas.toolbar.clear')}
          </button>
        </div>
      </UiPanel>, document.body
    )}
  </>;
}
