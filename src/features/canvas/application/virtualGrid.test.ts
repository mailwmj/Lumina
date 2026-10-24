import { expect, it } from 'vitest';
import { getVirtualGridIndices } from './virtualGrid';

it('mounts only visible rows plus overscan for 300 frames', () => {
  const initial = getVirtualGridIndices(300, 3, 140, 0, 400);
  expect(initial).toHaveLength(15);
  const scrolled = getVirtualGridIndices(300, 3, 140, 4200, 400, [0, 299]);
  expect(scrolled).toContain(0);
  expect(scrolled).toContain(299);
  expect(scrolled).toContain(90);
  expect(scrolled).not.toContain(30);
  expect(scrolled.length).toBeLessThan(30);
});
it('clamps after deletion/resize and handles empty or partial rows', () => {
  expect(getVirtualGridIndices(0, 3, 100, 1000, 400)).toEqual([]);
  expect(getVirtualGridIndices(5, 3, 100, 1000, 400)).toEqual([0, 1, 2, 3, 4]);
});
