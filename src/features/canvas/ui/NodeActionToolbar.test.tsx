// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { canvasNodeFactory } from '../application/canvasServices';
import { CANVAS_NODE_TYPES, type CanvasNodeData, type CanvasNodeType } from '../domain/canvasNodes';
import { NodeActionToolbar } from './NodeActionToolbar';
const copy = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
vi.mock('../application/imageClipboard', async (original) => ({
  ...await original<typeof import('../application/imageClipboard')>(), copyImageToSystemClipboard: copy,
}));
vi.mock('@xyflow/react', async (original) => ({
  ...await original<typeof import('@xyflow/react')>(), NodeToolbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('NodeActionToolbar continue generation', () => {
  let container: HTMLDivElement; let root: Root;
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); await i18n.changeLanguage('zh');
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  const render = async (type: CanvasNodeType, data: Partial<CanvasNodeData>) => {
    const node = canvasNodeFactory.createNode(type, { x: 0, y: 0 }, data);
    await act(async () => root.render(<NodeActionToolbar node={node} />));
    return Array.from(container.querySelectorAll('button')).find((button) => button.textContent === i18n.t('nodeToolbar.continueFromImage'));
  };
  it.each([CANVAS_NODE_TYPES.exportImage, CANVAS_NODE_TYPES.upload])('shows the action on an available image: %s', async (type) => {
    expect(await render(type, { imageUrl: '/image.png' })).toBeTruthy();
  });
  it.each([
    { imageUrl: null }, { imageUrl: '/image.png', isGenerating: true }, { imageUrl: '/image.png', generationError: 'failed' },
  ])('hides the action on an unavailable result: %j', async (data) => {
    expect(await render(CANVAS_NODE_TYPES.exportImage, data)).toBeUndefined();
  });
  it('offers image copy on uploads and passes the original image source to the application service', async () => {
    await render(CANVAS_NODE_TYPES.upload, { imageUrl: '/original.png', previewImageUrl: '/preview.jpg' });
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t('nodeToolbar.copyImage')}"]`)!;
    expect(button).toBeTruthy();
    await act(async () => button.click());
    expect(copy).toHaveBeenCalledWith('/original.png');
  });

});
