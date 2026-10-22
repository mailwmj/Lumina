import { isExportImageNode, isUploadNode, type CanvasNode } from '@/features/canvas/domain/canvasNodes';

function persistedImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  return url && !/^data:/i.test(url) && !url.startsWith('__img_ref__:') ? url : null;
}

export function selectProjectThumbnail(nodes: readonly CanvasNode[]): string | null {
  // Nodes append in creation order; prefer the last completed result, then the last upload.
  // Always call on raw nodes before imagePool encoding, and never persist inline image data.
  for (const predicate of [isExportImageNode, isUploadNode]) {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      if (!predicate(node) || node.data.isGenerating || node.data.generationError) continue;
      const url = persistedImageUrl(node.data.previewImageUrl) ?? persistedImageUrl(node.data.imageUrl);
      if (url) return url;
    }
  }
  return null;
}
