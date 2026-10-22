// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { CanvasToolbar } from './CanvasToolbar';
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ zoomIn: vi.fn(), zoomOut: vi.fn(), fitView: vi.fn() }) }));

describe('CanvasToolbar more menu', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    await i18n.changeLanguage('zh');
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  const more = () => container.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t('canvas.toolbar.more')}"]`)!;
  const item = () => document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
  const render = async (isLocked = false) => act(async () => root.render(<CanvasToolbar interactionMode="select" onInteractionModeChange={() => {}} isLocked={isLocked} />));

  it('hides the direct clear button and opens confirmation through More', async () => {
    await render();
    expect(container.querySelector(`button[aria-label="${i18n.t('canvas.toolbar.clear')}"]`)).toBeNull();
    expect(item()).toBeNull();
    await act(async () => more().click());
    expect(item().textContent).toBe(i18n.t('canvas.toolbar.clear'));
    expect(document.activeElement).toBe(item());
    await act(async () => item().click());
    expect(document.body.textContent).toContain(i18n.t('canvas.clearConfirm.title'));
    expect(document.body.textContent).toContain(i18n.t('canvas.clearConfirm.message', { shortcut: 'Ctrl+Z' }));
  });
  it('supports keyboard opening, Esc and outside dismissal, and disables clear while locked', async () => {
    await render(true);
    await act(async () => more().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(item().disabled).toBe(true);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(item()).toBeNull();
    expect(document.activeElement).toBe(more());
    await act(async () => more().click());
    await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(item()).toBeNull();
  });
  it('uses Command for the undo shortcut on macOS', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    await render();
    await act(async () => more().click());
    await act(async () => item().click());
    expect(document.body.textContent).toContain(i18n.t('canvas.clearConfirm.message', { shortcut: '⌘+Z' }));
    vi.restoreAllMocks();
  });
});
