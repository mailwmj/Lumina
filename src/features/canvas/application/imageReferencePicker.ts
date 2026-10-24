export const IMAGE_REFERENCE_PICKER_COLUMNS = 5;
export const IMAGE_REFERENCE_PICKER_MAX_ROWS = 3;
const THUMB_SIZE = 48;
const GAP = 4;
// p-1.5 padding plus the 1px border on each side.
const CHROME = 14;
const CARET_GAP = 6;
const VIEWPORT_MARGIN = 8;

export interface ImageReferencePickerCaretRect {
  left: number;
  top: number;
  bottom: number;
}

export interface ImageReferencePickerGeometry {
  left: number;
  top: number;
  columns: number;
  maxHeight: number;
}

/**
 * The picker is portaled to the viewport, so it keeps a constant size at every
 * canvas zoom. It opens below the `@` caret and flips above when the viewport
 * has no room underneath.
 */
export function resolveImageReferencePickerGeometry(
  caret: ImageReferencePickerCaretRect,
  itemCount: number,
  viewport: { width: number; height: number }
): ImageReferencePickerGeometry {
  const columns = Math.max(1, Math.min(IMAGE_REFERENCE_PICKER_COLUMNS, itemCount));
  const rows = Math.max(
    1,
    Math.min(IMAGE_REFERENCE_PICKER_MAX_ROWS, Math.ceil(itemCount / IMAGE_REFERENCE_PICKER_COLUMNS))
  );
  const width = columns * THUMB_SIZE + (columns - 1) * GAP + CHROME;
  const height = rows * THUMB_SIZE + (rows - 1) * GAP + CHROME;
  const left = Math.min(
    Math.max(caret.left - CARET_GAP, VIEWPORT_MARGIN),
    Math.max(VIEWPORT_MARGIN, viewport.width - width - VIEWPORT_MARGIN)
  );
  const below = caret.bottom + CARET_GAP;
  const fitsBelow = below + height <= viewport.height - VIEWPORT_MARGIN;
  const top = fitsBelow ? below : Math.max(VIEWPORT_MARGIN, caret.top - CARET_GAP - height);
  return { left, top, columns, maxHeight: height };
}

/**
 * Reads the text typed after the `@` trigger. Only digits keep the picker
 * open; anything else (a space, a letter, the `@` being deleted) ends the
 * session and leaves the typed text as-is.
 */
export function resolveImageReferencePickerQuery(
  value: string,
  triggerOffset: number,
  cursor: number | null
): string | null {
  if (cursor === null || cursor <= triggerOffset || value[triggerOffset] !== '@') {
    return null;
  }
  const query = value.slice(triggerOffset + 1, cursor);
  return /^\d*$/.test(query) ? query : null;
}

/** Indices of the references whose 1-based number starts with the query. */
export function filterImageReferencePickerItems(itemCount: number, query: string): number[] {
  return Array.from({ length: itemCount }, (_, index) => index)
    .filter((index) => String(index + 1).startsWith(query));
}

export function moveImageReferencePickerGridIndex(
  currentIndex: number,
  itemCount: number,
  columns: number,
  direction: 'left' | 'right' | 'up' | 'down'
): number {
  if (itemCount <= 0) {
    return 0;
  }
  if (direction === 'left' || direction === 'right') {
    const step = direction === 'right' ? 1 : -1;
    return (currentIndex + step + itemCount) % itemCount;
  }
  const next = currentIndex + (direction === 'down' ? columns : -columns);
  return next >= 0 && next < itemCount ? next : currentIndex;
}

/**
 * Pointer presses anywhere other than the current picker dismiss it. Keeping
 * this decision pure makes the document-level listener easy to regression-test.
 */
export function shouldCloseImageReferencePickerOnPointerDown(
  isPointerInsidePicker: boolean
): boolean {
  return !isPointerInsidePicker;
}
