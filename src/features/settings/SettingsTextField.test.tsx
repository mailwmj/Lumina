// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsTextInput } from './SettingsTextField';

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('SettingsTextInput', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('keeps the draft local while typing so store normalization cannot fight the user', async () => {
    const onCommit = vi.fn();
    await act(async () => {
      root.render(<SettingsTextInput value="" onCommit={onCommit} />);
    });
    const input = container.querySelector('input')!;

    await act(async () => typeInto(input, 'my relay '));

    expect(input.value).toBe('my relay ');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('auto-saves on blur, once', async () => {
    const onCommit = vi.fn();
    await act(async () => {
      root.render(<SettingsTextInput value="old" onCommit={onCommit} />);
    });
    const input = container.querySelector('input')!;

    await act(async () => typeInto(input, 'new'));
    await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('new');
  });

  it('does not lose an edit when the dialog closes before the field blurs', async () => {
    const onCommit = vi.fn();
    await act(async () => {
      root.render(<SettingsTextInput value="" onCommit={onCommit} />);
    });

    await act(async () => typeInto(container.querySelector('input')!, 'sk-typed'));
    await act(async () => root.render(<div />));

    expect(onCommit).toHaveBeenCalledWith('sk-typed');
  });

  it('shows the normalized value the store hands back after a commit', async () => {
    let stored = '';
    const render = () => root.render(
      <SettingsTextInput value={stored} onCommit={(next) => { stored = next.trim(); render(); }} />
    );
    await act(async () => render());
    const input = container.querySelector('input')!;

    await act(async () => typeInto(input, '  https://relay.example/v1  '));
    await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

    expect(input.value).toBe('https://relay.example/v1');
  });
});
