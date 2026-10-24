import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getVirtualGridIndices } from '../application/virtualGrid';

interface Props {
  count: number;
  columns: number;
  aspectRatio: string;
  gap: number;
  draggedIndex: number;
  renderFrame: (index: number) => ReactNode;
}

/** Fixed geometry keeps scroll offsets stable while unmounting offscreen editors/images. */
export function VirtualStoryboardGrid({ count, columns, aspectRatio, gap, draggedIndex, renderFrame }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 300, height: 260 });
  const [scrollTop, setScrollTop] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => setSize(previous => {
      const next = { width: root.clientWidth, height: root.clientHeight };
      return previous.width === next.width && previous.height === next.height ? previous : next;
    });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const cols = Math.max(1, Math.floor(columns));
  const [w, h] = aspectRatio.split(/[/:]/).map(Number);
  const ratio = w > 0 && h > 0 ? w / h : 1;
  const cellWidth = Math.max(1, (size.width - gap * (cols - 1)) / cols);
  const cellHeight = cellWidth / ratio + 40;
  const stride = cellHeight + gap;
  const indices = useMemo(() => getVirtualGridIndices(
    count, cols, stride, scrollTop, size.height, [focusedIndex, draggedIndex],
  ), [count, cols, stride, scrollTop, size.height, focusedIndex, draggedIndex]);

  // Pointer sorting can continue beyond the visible rows, including under canvas zoom.
  useEffect(() => {
    if (draggedIndex < 0) return;
    let pointerY: number | null = null;
    let raf = 0;
    const move = (event: PointerEvent) => { pointerY = event.clientY; };
    const tick = () => {
      const root = rootRef.current;
      if (root && pointerY !== null) {
        const rect = root.getBoundingClientRect();
        const margin = Math.min(40, rect.height / 4);
        const delta = pointerY < rect.top + margin ? -8 : pointerY > rect.bottom - margin ? 8 : 0;
        if (delta) root.scrollTop += delta * root.clientHeight / Math.max(1, rect.height);
      }
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener('pointermove', move);
    raf = requestAnimationFrame(tick);
    return () => { window.removeEventListener('pointermove', move); cancelAnimationFrame(raf); };
  }, [draggedIndex]);

  return (
    <div ref={rootRef} data-storyboard-scroll className="ui-scrollbar nowheel min-h-0 flex-1 overflow-auto"
      onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
      onWheelCapture={event => event.stopPropagation()}
      onFocusCapture={event => {
        const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-frame-index]');
        if (cell) setFocusedIndex(Number(cell.dataset.frameIndex));
      }}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedIndex(-1);
      }}>
      <div className="relative rounded-lg bg-[var(--ui-border-soft)]"
        style={{ height: Math.max(0, Math.ceil(count / cols) * stride - gap) }}>
        {indices.map(index => (
          <div key={index} data-frame-index={index} className="absolute"
            style={{ left: (index % cols) * (cellWidth + gap), top: Math.floor(index / cols) * stride,
              width: cellWidth, height: cellHeight }}>
            {renderFrame(index)}
          </div>
        ))}
      </div>
    </div>
  );
}
