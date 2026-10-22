import { copyImageSourceToClipboard } from '@/commands/image';
import { logger } from '@/lib/logger';
import { isExportImageNode, isImageEditNode, isUploadNode, type CanvasWorkflowNode } from '../domain/canvasNodes';
import { resolveImageCommandSource } from './imageCommandSource';

export type ImageCopyResult = { ok: true } | { ok: false; error: string };
let clipboardRevision = 0;
export function getClipboardRevision() { return clipboardRevision; }

export function getNodeClipboardImage(node: CanvasWorkflowNode): string | null {
  return (isUploadNode(node) || isExportImageNode(node) || isImageEditNode(node)) && node.data.imageUrl
    ? resolveImageCommandSource(node.data.imageUrl) : null;
}

export async function copyImageToSystemClipboard(source: string): Promise<ImageCopyResult> {
  clipboardRevision += 1;
  const resolved = resolveImageCommandSource(source);
  if (!resolved) return { ok: false, error: 'IMAGE_SOURCE_UNAVAILABLE' };
  try { await copyImageSourceToClipboard(resolved); return { ok: true }; }
  catch (error) {
    logger.error('Failed to copy image to system clipboard', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function isCanvasTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest?.('input, textarea, [contenteditable]:not([contenteditable="false"])'));
}

/**
 * Per-canvas ownership of the system clipboard image written by Ctrl/⌘+C.
 * The clipboard can only change behind our back once the window loses focus, so ownership
 * lasts until blur/copy/cut or another in-app image copy.
 */
export class CanvasImageClipboardSession {
  private owner?: { revision: number; copy: Promise<ImageCopyResult> };
  constructor(private readonly ports = { copy: copyImageToSystemClipboard }) {}
  clear = () => { this.owner = undefined; };
  copySelection(nodes: readonly CanvasWorkflowNode[], target: EventTarget | null): Promise<ImageCopyResult> | null {
    this.clear();
    if (nodes.length !== 1 || isCanvasTypingTarget(target)) return null;
    const source = getNodeClipboardImage(nodes[0]);
    if (!source) return null;
    const copy = this.ports.copy(source);
    this.owner = { revision: clipboardRevision, copy };
    return copy;
  }
  async ownsPaste(): Promise<boolean> {
    const owner = this.owner;
    if (!owner || owner.revision !== clipboardRevision || !(await owner.copy).ok) return false;
    return owner === this.owner && owner.revision === clipboardRevision;
  }
}
