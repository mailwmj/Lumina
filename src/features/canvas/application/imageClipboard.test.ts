// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasNodeFactory } from './canvasServices';
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes';
import { CanvasImageClipboardSession, copyImageToSystemClipboard } from './imageClipboard';
import { copyCanvasSelection, routeCanvasImagePaste, handleCanvasPasteShortcut, handleCanvasImagePaste } from './canvasClipboard';

const native = vi.hoisted(() => vi.fn());
vi.mock('@/commands/image', async (original) => ({ ...await original<typeof import('@/commands/image')>(), copyImageSourceToClipboard: native }));
beforeEach(() => native.mockReset().mockResolvedValue(undefined));
afterEach(() => vi.restoreAllMocks());
const upload = (id = 'upload') => ({ ...canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 }, { imageUrl: '/original.png', previewImageUrl: '/preview.jpg' }), id });

describe('image clipboard application service', () => {
  it.each([
    ['/original.png', '/original.png'], ['file:///home/user/a.png', 'file:///home/user/a.png'],
    ['asset://localhost/%2Fhome%2Fuser%2Fa.png', '/home/user/a.png'],
    ['http://asset.localhost/C%3A%5Cimages%5Ca.png', 'C:\\images\\a.png'],
    ['data:image/png;base64,a', 'data:image/png;base64,a'], ['https://example.test/a.png', 'https://example.test/a.png'],
  ])('passes a supported original source %s to the native command', async (input, expected) => {
    expect(await copyImageToSystemClipboard(input)).toEqual({ ok: true });
    expect(native).toHaveBeenCalledWith(expected);
  });
  it('returns a displayable error on native failure and rejects unresolved imagePool tokens', async () => {
    native.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    expect(await copyImageToSystemClipboard('/original.png')).toEqual({ ok: false, error: 'Clipboard unavailable' });
    native.mockClear();
    expect(await copyImageToSystemClipboard('__img_ref__:0')).toMatchObject({ ok: false });
    expect(native).not.toHaveBeenCalled();
  });
});

describe('canvas image copy and paste routing', () => {
  const file = new File(['clipboard pixels'], 'pasted.png', { type: 'image/png' });
  function session() {
    return new CanvasImageClipboardSession({ copy: copyImageToSystemClipboard });
  }
  function keyCopy(nodes = [upload()], target: HTMLElement = document.body, metaKey = false) {
    const clipboard = session(); const internalCopy = vi.fn();
    const handler = (event: KeyboardEvent) => copyCanvasSelection(event, nodes, clipboard, internalCopy);
    target.addEventListener('keydown', handler);
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: !metaKey, metaKey, bubbles: true, cancelable: true }));
    target.removeEventListener('keydown', handler);
    return { clipboard, internalCopy };
  }
  it.each([false, true])('copies exactly one selected image to the system and preserves internal copy (meta=%s)', async (metaKey) => {
    const { internalCopy } = keyCopy([upload()], document.body, metaKey);
    await Promise.resolve(); expect(internalCopy).toHaveBeenCalledOnce(); expect(native).toHaveBeenCalledWith('/original.png');
    expect(native).not.toHaveBeenCalledWith('/preview.jpg');
  });
  it('copies multiple nodes internally without writing a system image', () => {
    const { internalCopy } = keyCopy([upload(), upload('second')]);
    expect(internalCopy).toHaveBeenCalledOnce(); expect(native).not.toHaveBeenCalled();
  });
  it.each(['input', 'textarea', 'div'])('leaves copying in an editable %s alone', (tag) => {
    const element = document.createElement(tag); if (tag === 'div') element.contentEditable = 'true';
    const { internalCopy } = keyCopy([upload()], element);
    expect(internalCopy).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled();
  });
  it('routes a pasted system image from this internal copy to node duplication without uploading', async () => {
    const { clipboard } = keyCopy(); const pasteNodes = vi.fn(); const pasteImage = vi.fn();
    await routeCanvasImagePaste(file, clipboard, { hasCopiedNodes: () => true, pasteNodes, pasteImage });
    expect(pasteNodes).toHaveBeenCalledOnce(); expect(pasteImage).not.toHaveBeenCalled();
  });
  it('claims the paste event before the Ctrl+V fallback and never uploads or duplicates twice', async () => {
    vi.useFakeTimers();
    const { clipboard } = keyCopy();
    const pasteNodes = vi.fn(), pasteImage = vi.fn();
    const ports = { selectedUploadNodeId: 'upload', imageHandled: { current: false }, hasCopiedNodes: () => true, pasteNodes, pasteImage };
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'v') handleCanvasPasteShortcut(event, ports);
    };
    const paste = (event: ClipboardEvent) => handleCanvasImagePaste(event, clipboard, ports);
    document.addEventListener('keydown', keydown); document.addEventListener('paste', paste);
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, cancelable: true }));
      const event = new Event('paste', { cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { items: [{ type: 'image/png', getAsFile: () => file }] } });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      await vi.runAllTimersAsync();
      expect(pasteNodes).toHaveBeenCalledOnce(); expect(pasteImage).not.toHaveBeenCalled();
    } finally { document.removeEventListener('keydown', keydown); document.removeEventListener('paste', paste); vi.useRealTimers(); }
  });

  it('imports the pasted image as an upload once ownership was lost to focus change', async () => {
    const clipboard = session(); clipboard.copySelection([upload()], null); clipboard.clear();
    const pasteNodes = vi.fn(); const pasteImage = vi.fn();
    await routeCanvasImagePaste(file, clipboard, { hasCopiedNodes: () => true, pasteNodes, pasteImage });
    expect(pasteNodes).not.toHaveBeenCalled(); expect(pasteImage).toHaveBeenCalledWith(file);
  });
  it('invalidates ownership on focus loss, failed native copy, or another system image copy', async () => {
    const clipboard = session(); clipboard.copySelection([upload()], null);
    expect(await clipboard.ownsPaste()).toBe(true);
    clipboard.clear();
    expect(await clipboard.ownsPaste()).toBe(false);
    clipboard.copySelection([upload()], null);
    await copyImageToSystemClipboard('/another.png');
    expect(await clipboard.ownsPaste()).toBe(false);
    native.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    clipboard.copySelection([upload()], null);
    expect(await clipboard.ownsPaste()).toBe(false);
  });
});
