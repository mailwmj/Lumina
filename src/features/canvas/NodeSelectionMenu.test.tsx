// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { CANVAS_NODE_TYPES } from './domain/canvasNodes';
import { NodeSelectionMenu } from './NodeSelectionMenu';

describe('NodeSelectionMenu entry navigation', () => {
  let root: Root;
  let container: HTMLDivElement;
  const close = vi.fn();
  const select = vi.fn();
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    close.mockReset();
    select.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<NodeSelectionMenu position={{ x: 0, y: 0 }} onClose={close} onSelect={select} />));
    await act(async () => vi.advanceTimersByTime(32));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('places keyboard focus in the menu and closes with Escape without creating a node', async () => {
    const first = container.querySelector('button')!;
    expect(document.activeElement).toBe(first);
    await act(async () => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      vi.advanceTimersByTime(200);
    });
    expect(close).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
  });
  it('continues to create the node represented by a registry menu item', async () => {
    await act(async () => {
      container.querySelector('button')!.click();
      vi.advanceTimersByTime(200);
    });
    expect(select).toHaveBeenCalledWith(CANVAS_NODE_TYPES.upload);
  });
});
