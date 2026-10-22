// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { ImageCopyButton } from './ImageCopyButton';
const copy = vi.hoisted(() => vi.fn());
vi.mock('../application/imageClipboard', () => ({ copyImageToSystemClipboard: copy }));
it('shows copied feedback and inline errors without a modal', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); await i18n.changeLanguage('en');
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    copy.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'Clipboard busy' });
    await act(async () => root.render(<ImageCopyButton source="/original.png" className="" />));
    await act(async () => container.querySelector('button')!.click());
    expect(copy).toHaveBeenCalledWith('/original.png'); expect(container.textContent).toContain(i18n.t('nodeToolbar.copied'));
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Clipboard busy'); expect(container.querySelector('[role="dialog"]')).toBeNull();
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
