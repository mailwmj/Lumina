// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import '@/i18n';
import { RenameDialog } from './RenameDialog';

it('does not submit a project name while confirming an IME candidate', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const confirm = vi.fn();
  const close = vi.fn();
  try {
    await act(async () => root.render(<RenameDialog isOpen title="New" defaultValue="春日" onConfirm={confirm} onClose={close} />));
    const input = container.querySelector('input')!;
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
    expect(confirm).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(confirm).toHaveBeenCalledWith('春日');
    expect(close).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
