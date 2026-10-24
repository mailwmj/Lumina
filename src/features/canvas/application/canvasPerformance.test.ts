import { afterEach, expect, it } from 'vitest';
import { getCanvasPerformanceSnapshot, measureCanvasPhase, resetCanvasPerformanceSnapshot,
  setCanvasPerformanceEnabled } from './canvasPerformance';
afterEach(() => { setCanvasPerformanceEnabled(false); resetCanvasPerformanceSnapshot(); });
it('preserves return values and exceptions and stays empty unless enabled', () => {
  expect(measureCanvasPhase('test', () => 42)).toBe(42);
  expect(getCanvasPerformanceSnapshot()).toEqual({});
  setCanvasPerformanceEnabled(true);
  expect(measureCanvasPhase('test', () => 42)).toBe(42);
  expect(() => measureCanvasPhase('test', () => { throw new Error('failure'); })).toThrow('failure');
  expect(getCanvasPerformanceSnapshot().test.count).toBe(2);
});
