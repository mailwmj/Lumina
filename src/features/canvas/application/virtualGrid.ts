export function getVirtualGridIndices(
  count: number, columns: number, rowHeight: number, scrollTop: number,
  viewportHeight: number, pinned: readonly number[] = [], overscan = 2,
): number[] {
  const cols = Math.max(1, Math.floor(columns));
  const stride = Math.max(1, rowHeight);
  const rows = Math.ceil(count / cols);
  const first = Math.max(0, Math.min(rows - 1, Math.floor(scrollTop / stride)) - overscan);
  const last = Math.min(rows, Math.ceil((scrollTop + viewportHeight) / stride) + overscan);
  const indices = new Set<number>();
  for (let i = first * cols; i < Math.min(count, last * cols); i++) indices.add(i);
  for (const i of pinned) if (i >= 0 && i < count) indices.add(i);
  return [...indices].sort((a, b) => a - b);
}
