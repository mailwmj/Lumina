import type { XYPosition } from '@xyflow/react';

export interface FlowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const GENERATED_RESULT_REVEAL_DURATION_MS = 240;

function unionRects(rects: readonly FlowRect[]): FlowRect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function containsRect(outer: FlowRect, inner: FlowRect): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

/**
 * Decides where to pan, keeping the zoom, so freshly placed results are seen.
 * Returns null while the results are already fully visible, so the view never moves needlessly.
 * Prefers keeping the source in view too; when both do not fit, the results win.
 */
export function resolveGeneratedResultRevealCenter(
  visible: FlowRect,
  resultRects: readonly FlowRect[],
  sourceRect: FlowRect | null
): XYPosition | null {
  if (resultRects.length === 0) {
    return null;
  }
  const results = unionRects(resultRects);
  if (containsRect(visible, results)) {
    return null;
  }
  const withSource = sourceRect ? unionRects([sourceRect, results]) : results;
  const target = withSource.width <= visible.width && withSource.height <= visible.height
    ? withSource
    : results;
  return { x: target.x + target.width / 2, y: target.y + target.height / 2 };
}
