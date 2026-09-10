import { useCallback, useEffect, useState } from 'react';

// One observer for all canvas images. Bounds include overscan to prepare nearby
// thumbnails; removing src outside those bounds releases the DOM image resource.
const listeners = new Map<Element, (visible: boolean) => void>();
let observer: IntersectionObserver | undefined;
function observe(element: Element, listener: (visible: boolean) => void) {
  if (typeof IntersectionObserver === 'undefined') { listener(true); return () => {}; }
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
  }, { rootMargin: '320px' });
  listeners.set(element, listener);
  observer.observe(element);
  return () => {
    observer?.unobserve(element);
    listeners.delete(element);
    if (!listeners.size) { observer?.disconnect(); observer = undefined; }
  };
}

export function useViewportImage(eager: boolean) {
  const [element, setElement] = useState<HTMLImageElement | null>(null);
  const [visible, setVisible] = useState(false);
  const ref = useCallback((image: HTMLImageElement | null) => setElement(image), []);
  useEffect(() => {
    if (!element || eager) return;
    return observe(element, setVisible);
  }, [element, eager]);
  return { ref, visible: eager || visible };
}
