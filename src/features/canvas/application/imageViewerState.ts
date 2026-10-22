import { isExportImageNode, type CanvasNode } from '../domain/canvasNodes';

export interface ImageViewerItem { url: string; nodeId?: string }
export interface ImageViewerState {
  isOpen: boolean;
  currentImageUrl: string | null;
  currentNodeId: string | null;
  imageList: string[];
  items: ImageViewerItem[];
  currentIndex: number;
}
export function closedImageViewer(): ImageViewerState {
  return { isOpen: false, currentImageUrl: null, currentNodeId: null, imageList: [], items: [], currentIndex: 0 };
}
export function normalizeViewerItems(list: ReadonlyArray<string | ImageViewerItem | null | undefined>, current: ImageViewerItem): ImageViewerItem[] {
  const items: ImageViewerItem[] = [];
  for (const raw of list) {
    const item = typeof raw === 'string' ? { url: raw.trim() } : raw;
    if (!item?.url || items.some((existing) => existing.url === item.url && existing.nodeId === item.nodeId)) continue;
    items.push(item);
  }
  if (!items.some((item) => item.url === current.url && (!current.nodeId || item.nodeId === current.nodeId))) items.unshift(current);
  return items;
}
export function openedImageViewer(url: string, list: ReadonlyArray<string | ImageViewerItem>, nodeId?: string): ImageViewerState {
  const items = normalizeViewerItems(list, { url, ...(nodeId ? { nodeId } : {}) });
  const index = items.findIndex((item) => item.url === url && (!nodeId || item.nodeId === nodeId));
  return { isOpen: true, currentImageUrl: url, currentNodeId: items[index]?.nodeId ?? null,
    items, imageList: items.map((item) => item.url), currentIndex: index };
}
export function navigatedImageViewer(state: ImageViewerState, direction: 'prev' | 'next'): ImageViewerState {
  const index = state.currentIndex + (direction === 'prev' ? -1 : 1);
  if (index < 0 || index >= state.items.length) return state;
  return { ...state, currentIndex: index, currentImageUrl: state.items[index].url, currentNodeId: state.items[index].nodeId ?? null };
}
export function buildGenerationBatchViewerItems(nodeId: string, nodes: readonly CanvasNode[]): ImageViewerItem[] {
  const source = nodes.find((node) => node.id === nodeId);
  if (!source || !isExportImageNode(source) || !source.data.imageUrl || source.data.isGenerating || source.data.generationError) return [];
  const batchId = source.data.generationBatchId;
  if (!batchId) return [{ url: source.data.imageUrl, nodeId }];
  return nodes.filter(isExportImageNode)
    .filter((node) => node.data.generationBatchId === batchId && node.data.imageUrl && !node.data.isGenerating && !node.data.generationError)
    .sort((a, b) => (a.data.generationBatchIndex ?? 0) - (b.data.generationBatchIndex ?? 0))
    .map((node) => ({ url: node.data.imageUrl!, nodeId: node.id }));
}
