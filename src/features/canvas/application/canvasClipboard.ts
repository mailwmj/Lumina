import type { CanvasWorkflowNode } from '../domain/canvasNodes';
import { CanvasImageClipboardSession, isCanvasTypingTarget } from './imageClipboard';
import { shouldSuppressKeyboardCommand } from './compositionInputState';

export function copyCanvasSelection(event: KeyboardEvent, nodes: readonly CanvasWorkflowNode[], session: CanvasImageClipboardSession,
  copyNodes: () => void): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'c' || event.shiftKey
    || shouldSuppressKeyboardCommand(event) || isCanvasTypingTarget(event.target) || nodes.length === 0) return false;
  event.preventDefault();
  copyNodes();
  void session.copySelection(nodes, event.target);
  return true;
}

export async function routeCanvasImagePaste(file: File, session: CanvasImageClipboardSession, ports: {
  hasCopiedNodes: () => boolean; pasteNodes: () => void; pasteImage: (file: File) => void;
}): Promise<void> {
  if (await session.ownsPaste() && ports.hasCopiedNodes()) ports.pasteNodes();
  else ports.pasteImage(file);
}

interface CanvasPastePorts {
  selectedUploadNodeId: string | null;
  imageHandled: { current: boolean };
  hasCopiedNodes: () => boolean;
  pasteNodes: () => void;
}

export function handleCanvasPasteShortcut(event: KeyboardEvent, ports: CanvasPastePorts): void {
  if (ports.selectedUploadNodeId) {
    ports.imageHandled.current = false;
    window.setTimeout(() => {
      if (ports.imageHandled.current) { ports.imageHandled.current = false; return; }
      if (ports.hasCopiedNodes()) ports.pasteNodes();
    }, 0);
  } else if (ports.hasCopiedNodes()) {
    event.preventDefault(); ports.pasteNodes();
  }
}

export function resolveClipboardImageFile(event: ClipboardEvent): File | null {
  for (const item of Array.from(event.clipboardData?.items ?? [])) {
    if (!item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (!file) continue;
    if (file.name.trim()) return file;
    const subtype = item.type.split('/')[1]?.split('+')[0] || 'png';
    return new File([file], `pasted-image.${subtype}`, { type: file.type || item.type, lastModified: Date.now() });
  }
  return null;
}

export function handleCanvasImagePaste(event: ClipboardEvent, session: CanvasImageClipboardSession, ports: CanvasPastePorts & {
  pasteImage: (file: File) => void;
}): void {
  ports.imageHandled.current = false;
  if (!ports.selectedUploadNodeId || isCanvasTypingTarget(event.target)) return;
  const image = resolveClipboardImageFile(event);
  if (!image) return;
  event.preventDefault();
  // Claim synchronously before pixel comparison, so the keydown timer cannot duplicate again.
  ports.imageHandled.current = true;
  void routeCanvasImagePaste(image, session, ports);
}
