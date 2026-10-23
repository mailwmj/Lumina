// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';

import { SettingsDialog } from './SettingsDialog';

const initialSettings = useSettingsStore.getState();

describe('SettingsDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  const buttons = () => Array.from(container.querySelectorAll('button'));
  const buttonWithText = (text: string) => buttons().find((button) => button.textContent?.includes(text));
  const headings = () => Array.from(container.querySelectorAll('h2')).map((heading) => heading.textContent);
  const click = async (element: Element | undefined | null) => {
    expect(element).toBeTruthy();
    await act(async () => element?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  };

  beforeEach(async () => {
    await i18n.changeLanguage('zh');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    useSettingsStore.setState(initialSettings, true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('opens on the overview and sends an unconfigured capability straight to its provider tab', async () => {
    await act(async () => {
      root.render(<SettingsDialog isOpen onClose={() => undefined} />);
    });

    expect(headings()).toContain('概览');
    expect(container.textContent).toContain('视频生成');

    await click(buttonWithText('视频生成'));

    expect(headings()).toContain('模型服务');
    expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe('视频');
    expect(buttonWithText('Seedance 2.0')).toBeDefined();
  });

  it('hides the page heading while editing a provider and restores it after leaving the page', async () => {
    await act(async () => {
      root.render(
        <SettingsDialog isOpen onClose={() => undefined} initialCategory="services" initialProviderKind="video" />
      );
    });

    await click(buttonWithText('Seedance 2.0'));
    expect(headings()).not.toContain('模型服务');

    await click(buttonWithText('生成偏好'));
    await click(buttonWithText('模型服务'));
    expect(headings()).toContain('模型服务');
  });

  it('applies a change immediately, with no save button to forget', async () => {
    await act(async () => {
      root.render(<SettingsDialog isOpen onClose={() => undefined} initialCategory="generation" />);
    });
    const before = useSettingsStore.getState().storyboardGenKeepStyleConsistent;

    expect(buttons().some((button) => button.textContent === '保存')).toBe(false);

    await click(container.querySelector('[role="checkbox"][aria-label="分镜图风格与参考图保持一致"]'));

    expect(useSettingsStore.getState().storyboardGenKeepStyleConsistent).toBe(!before);
  });
});
