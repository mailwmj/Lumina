import { describe, expect, it } from 'vitest';

import {
  filterImageReferencePickerItems,
  moveImageReferencePickerGridIndex,
  resolveImageReferencePickerGeometry,
  resolveImageReferencePickerQuery,
  shouldCloseImageReferencePickerOnPointerDown,
} from './imageReferencePicker';

const viewport = { width: 1280, height: 800 };

describe('image reference picker', () => {
  it('opens below the @ caret at a fixed size and flips above near the viewport bottom', () => {
    const below = resolveImageReferencePickerGeometry({ left: 300, top: 200, bottom: 220 }, 5, viewport);
    expect(below).toEqual({ left: 294, top: 226, columns: 5, maxHeight: 62 });

    const above = resolveImageReferencePickerGeometry({ left: 300, top: 760, bottom: 780 }, 5, viewport);
    expect(above.top).toBe(760 - 6 - 62);
  });

  it('keeps the picker inside the viewport and caps it at three rows', () => {
    const geometry = resolveImageReferencePickerGeometry({ left: 1270, top: 100, bottom: 120 }, 20, viewport);
    expect(geometry.left + 5 * 48 + 4 * 4 + 14).toBeLessThanOrEqual(viewport.width - 8);
    expect(geometry.maxHeight).toBe(3 * 48 + 2 * 4 + 14);
  });

  it('keeps the picker open only while digits follow the @', () => {
    expect(resolveImageReferencePickerQuery('看@', 1, 2)).toBe('');
    expect(resolveImageReferencePickerQuery('看@12', 1, 4)).toBe('12');
    expect(resolveImageReferencePickerQuery('看@1 ', 1, 4)).toBeNull();
    expect(resolveImageReferencePickerQuery('mail@a', 4, 6)).toBeNull();
    expect(resolveImageReferencePickerQuery('看', 1, 1)).toBeNull();
  });

  it('filters references by the number typed after @', () => {
    expect(filterImageReferencePickerItems(12, '')).toHaveLength(12);
    expect(filterImageReferencePickerItems(12, '1')).toEqual([0, 9, 10, 11]);
    expect(filterImageReferencePickerItems(5, '3')).toEqual([2]);
    expect(filterImageReferencePickerItems(5, '9')).toEqual([]);
  });

  it('moves through the grid with arrow keys', () => {
    expect(moveImageReferencePickerGridIndex(4, 7, 5, 'right')).toBe(5);
    expect(moveImageReferencePickerGridIndex(0, 7, 5, 'left')).toBe(6);
    expect(moveImageReferencePickerGridIndex(1, 7, 5, 'down')).toBe(6);
    expect(moveImageReferencePickerGridIndex(3, 7, 5, 'down')).toBe(3);
    expect(moveImageReferencePickerGridIndex(6, 7, 5, 'up')).toBe(1);
  });

  it('closes for every pointer press outside the picker itself', () => {
    expect(shouldCloseImageReferencePickerOnPointerDown(true)).toBe(false);
    expect(shouldCloseImageReferencePickerOnPointerDown(false)).toBe(true);
  });
});
