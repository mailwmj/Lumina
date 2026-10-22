// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { ImageViewerModal } from './ImageViewerModal';
const mocks = vi.hoisted(() => ({ continue: vi.fn(), close: vi.fn(), navigate: vi.fn() }));
vi.mock('../application/continueFromImage', () => ({ continueFromImage: mocks.continue }));
vi.mock('../hooks/useImageViewerTransform', () => ({ useImageViewerTransform: () => ({ containerRef: { current: null }, imageRef: { current: null }, scaleDisplayRef: { current: null }, viewerOpacity: 1, resetView: () => {}, handleImageMouseDown: () => {}, handleContainerMouseMove: () => {}, handleContainerMouseUp: () => {}, handleImageMouseMove: () => {}, handleImageLoad: () => {}, isPointOnImageContent: () => true }) }));
describe('image viewer result actions', () => {
  let container: HTMLDivElement; let root: Root;
  beforeEach(async () => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); await i18n.changeLanguage('zh'); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  const render = async (nodeId?: string) => act(async () => root.render(<ImageViewerModal open imageUrl="/second.png" imageList={['/first.png', '/second.png']} currentIndex={1} nodeId={nodeId} onClose={mocks.close} onNavigate={mocks.navigate} />));
  it('shows the batch count and continues from the current node before closing', async () => {
    mocks.continue.mockReturnValue({ nodeId: 'new-generator', edgeId: 'edge' }); await render('second-node');
    expect(container.textContent).toContain(i18n.t('viewer.position', { index: 2, total: 2 }));
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t('nodeToolbar.continueFromImage')}"]`)!.click());
    expect(mocks.continue).toHaveBeenCalledWith('second-node'); expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('hides continue without node identity but retains download and image copy', async () => {
    await render();
    expect(container.querySelector(`button[aria-label="${i18n.t('nodeToolbar.continueFromImage')}"]`)).toBeNull();
    expect(container.querySelector(`button[aria-label="${i18n.t('nodeToolbar.copyImage')}"]`)).not.toBeNull();
    expect(container.querySelector(`button[aria-label="${i18n.t('nodeToolbar.download')}"]`)).not.toBeNull();
  });
  it('navigates with arrow keys while leaving editable focus alone', async () => {
    await render();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })));
    expect(mocks.navigate).toHaveBeenCalledWith('prev'); mocks.navigate.mockClear();
    const input = document.createElement('input'); container.append(input); input.focus();
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
