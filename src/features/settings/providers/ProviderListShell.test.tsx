// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';

import { ProviderListShell } from './ProviderListShell';

describe('ProviderListShell', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage('zh');
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

  it('shows a selected provider detail immediately instead of waiting in a transparent transition', async () => {
    const onDetailChange = vi.fn();
    await act(async () => {
      root.render(
        <ProviderListShell
          items={[{ id: 'provider-a', name: 'Provider A' }]}
          getItemId={(item) => item.id}
          getItemTitle={(item) => item.name}
          onAdd={() => 'provider-b'}
          onRemove={() => undefined}
          onDetailChange={onDetailChange}
          renderDetail={(item) => <div data-testid="provider-detail">{item.name}</div>}
          addLabel="Add"
          removeLabel="Remove"
          emptyLabel="Empty"
        />
      );
    });

    const providerButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Provider A'));
    expect(providerButton).toBeDefined();

    await act(async () => {
      providerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const detail = container.querySelector('[data-testid="provider-detail"]');
    expect(detail).not.toBeNull();
    expect(detail?.closest('[class*="opacity-"]')).toBeNull();
    expect(onDetailChange).toHaveBeenLastCalledWith(true);
  });

  it('restores a deleted provider at its old position when the user clicks undo', async () => {
    let items = [
      { id: 'a', name: 'Provider A' },
      { id: 'b', name: 'Provider B' },
      { id: 'c', name: 'Provider C' },
    ];
    const render = () => root.render(
      <ProviderListShell
        items={items}
        getItemId={(item) => item.id}
        getItemTitle={(item) => item.name}
        onAdd={() => 'd'}
        onRemove={(id) => { items = items.filter((item) => item.id !== id); render(); }}
        onRestore={(item, index) => {
          const next = [...items];
          next.splice(index, 0, item);
          items = next;
          render();
        }}
        renderDetail={(item) => <div>{item.name}</div>}
        addLabel="Add"
        removeLabel="Remove"
        emptyLabel="Empty"
      />
    );
    const click = async (element: Element | null | undefined) => {
      expect(element).toBeTruthy();
      await act(async () => element?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    };
    const buttonWithText = (text: string) => Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes(text));

    await act(async () => render());
    await click(buttonWithText('Provider B'));
    await click(container.querySelector('[aria-label="Remove"]'));

    expect(items.map((item) => item.id)).toEqual(['a', 'c']);
    expect(container.textContent).toContain('已删除「Provider B」');

    await click(buttonWithText('撤销'));

    expect(items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(container.textContent).not.toContain('已删除');
  });
});
