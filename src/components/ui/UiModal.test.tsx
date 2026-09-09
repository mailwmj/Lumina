// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UiButton, UiInput, UiModal, UiSelect } from './primitives';

function Harness() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Open</button>
    <UiModal isOpen={open} title="Edit project" onClose={() => setOpen(false)} footer={<UiButton>Save</UiButton>}>
      <UiInput aria-label="Name" />
      <UiSelect aria-label="Sort"><option value="recent">Recent</option><option value="name">Name</option></UiSelect>
    </UiModal>
  </>;
}

describe('UiModal keyboard navigation', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('labels the dialog, focuses its input, wraps Tab, and restores the trigger on Escape', async () => {
    const trigger = container.querySelector('button')!;
    trigger.focus();
    await act(async () => trigger.click());
    const modal = container.querySelector('[role="dialog"]')!;
    expect(document.getElementById(modal.getAttribute('aria-labelledby')!)?.textContent).toBe('Edit project');
    expect(document.activeElement).toBe(container.querySelector('input'));
    const buttons = modal.querySelectorAll('button');
    const last = buttons[buttons.length - 1];
    last.focus();
    await act(async () => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(buttons[0]);
    await act(async () => buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(last);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(trigger);
    expect(modal.closest('[inert]')).not.toBeNull();
  });

  it('lets Escape close a select menu before closing the modal', async () => {
    await act(async () => container.querySelector('button')!.click());
    const select = container.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
    await act(async () => select.click());
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(select.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[role="dialog"]')!.closest('[inert]')).toBeNull();
  });
});
