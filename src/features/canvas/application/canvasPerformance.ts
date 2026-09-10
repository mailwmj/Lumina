interface Measurement { count: number; totalMs: number; maxMs: number }
const measurements = new Map<string, Measurement>();
let enabled = false;

/** Explicitly enabled by diagnostics/benchmarks; ordinary sessions pay no timing cost. */
export function setCanvasPerformanceEnabled(value: boolean): void { enabled = value; }

export function recordCanvasNodeRender(nodeType: string, elapsedMs: number, nodeId?: string): void {
  if (!enabled) return;
  recordCanvasMeasurement(`node-render:${nodeType}`, elapsedMs);
  if (nodeId) recordCanvasMeasurement(`node:${nodeId}`, elapsedMs);
}

export function recordCanvasMeasurement(phase: string, elapsedMs: number): void {
  if (!enabled || !Number.isFinite(elapsedMs) || elapsedMs < 0) return;
  if (!measurements.has(phase) && measurements.size >= 1024) return;
  const current = measurements.get(phase) ?? { count: 0, totalMs: 0, maxMs: 0 };
  measurements.set(phase, {
    count: current.count + 1,
    totalMs: current.totalMs + elapsedMs,
    maxMs: Math.max(current.maxMs, elapsedMs),
  });
}

export function measureCanvasPhase<T>(phase: string, work: () => T): T {
  if (!enabled) return work();
  const start = performance.now();
  try { return work(); }
  finally { recordCanvasMeasurement(phase, performance.now() - start); }
}

export function getCanvasPerformanceSnapshot() {
  return Object.fromEntries([...measurements].map(([phase, value]) => [phase, {
    ...value, averageMs: value.totalMs / value.count,
  }]));
}

export function resetCanvasPerformanceSnapshot(): void { measurements.clear(); }
