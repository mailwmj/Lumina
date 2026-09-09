// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { useProjectStore } from '@/stores/projectStore';
import { ProjectManager } from './ProjectManager';

describe('ProjectManager project discovery and recovery', () => {
  let container: HTMLDivElement;
  let root: Root;
  const original = useProjectStore.getState();
  const openProject = vi.fn();
  const projects = [
    { id: 'old', name: 'Alpha storyboard', createdAt: 200, updatedAt: 300, nodeCount: 2 },
    { id: 'recent', name: '春日品牌', createdAt: 100, updatedAt: 500, nodeCount: 8 },
  ];
  const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const search = async (value: string) => {
    const input = container.querySelector('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    openProject.mockReset();
    useProjectStore.setState({ projects, isOpeningProject: false, currentProjectId: null, openProject });
    await i18n.changeLanguage('zh');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<ProjectManager onOpenBatchCrop={() => undefined} />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useProjectStore.setState(original, true);
    vi.unstubAllGlobals();
  });

  it('starts with recently edited projects and supports trimmed case-insensitive search', async () => {
    expect(container.querySelector('article button')?.getAttribute('aria-label')).toBe('打开项目：春日品牌');
    await search('  ALPHA  ');
    expect(container.querySelectorAll('article')).toHaveLength(1);
    expect(container.querySelector('article')?.textContent).toContain('Alpha storyboard');
    await search('missing');
    expect(container.textContent).toContain('没有找到匹配的项目');
    expect(container.querySelectorAll('article')).toHaveLength(0);
    const clear = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === '清空搜索')!;
    await act(async () => clear.click());
    expect(container.querySelectorAll('article')).toHaveLength(2);
  });

  it('keeps card actions separate from opening the project', async () => {
    button('重命名').focus();
    await act(async () => button('重命名').click());
    expect(openProject).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(button('重命名'));
    await act(async () => button('打开项目：春日品牌').click());
    expect(openProject).toHaveBeenCalledWith('recent');
  });

  it('shows pending feedback, then a retry even when opening fails within one render batch', async () => {
    openProject.mockImplementation(() => useProjectStore.setState({ isOpeningProject: true }));
    await act(async () => button('打开项目：春日品牌').click());
    expect(container.textContent).toContain('正在打开项目');
    expect(button('打开项目：春日品牌').disabled).toBe(true);
    await act(async () => useProjectStore.setState({ isOpeningProject: false }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('无法打开项目「春日品牌」');
    openProject.mockImplementation(() => {
      useProjectStore.setState({ isOpeningProject: true });
      useProjectStore.setState({ isOpeningProject: false });
    });
    const retry = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === '重试')!;
    await act(async () => retry.click());
    expect(openProject).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
