// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NodeInlineError } from './NodeInlineError';
import { NodeProgressOverlay } from './NodeProgressOverlay';
import { resolveNodeStatusSurfaceClass } from './nodeSurfaceStyles';

it('keeps the full provider error reachable while clamping the footer', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  const root = createRoot(container);
  const message = 'Provider returned 429: '.repeat(20);
  try {
    await act(async () => root.render(<NodeInlineError message={message} className="mt-1" />));
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.getAttribute('title')).toBe(message);
    expect(alert?.className).toContain('line-clamp-2');
    expect(alert?.className).toContain('mt-1');
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('maps simulated progress to the overlay width without covering the label', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<NodeProgressOverlay progress={0.25} />));
    const bar = container.querySelector<HTMLElement>('.pointer-events-none > div');
    expect(bar?.style.width).toBe('25%');
    expect(container.querySelector('.pointer-events-none')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('uses status tokens for danger and warning surfaces, never raw palette colors', () => {
  for (const tone of ['danger', 'warning'] as const) {
    for (const selected of [true, false]) {
      const className = resolveNodeStatusSurfaceClass(tone, selected);
      expect(className).toContain(`border-${tone}`);
      expect(className).not.toMatch(/red-|amber-|rgba\(/);
    }
  }
});
