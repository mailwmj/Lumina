let flushPendingCanvasPersist: (() => void) | null = null;

export function registerCanvasPersistFlush(flush: () => void): () => void {
  flushPendingCanvasPersist = flush;
  return () => {
    if (flushPendingCanvasPersist === flush) {
      flushPendingCanvasPersist = null;
    }
  };
}

export function flushCanvasPersist(): void {
  flushPendingCanvasPersist?.();
}
