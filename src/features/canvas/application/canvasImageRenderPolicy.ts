import type { Viewport } from '@xyflow/react';

import {
  CANVAS_NODE_TYPES,
  DEFAULT_NODE_WIDTH,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';

export const CANVAS_IMAGE_QUALITY_SETTLE_DELAY_MS = 150;
const MIN_ORIGINAL_IMAGE_LONG_SIDE_PX = 480;

export interface CanvasImageRenderSourceInput {
  nodeId: string;
  imageUrl: string | null | undefined;
  previewImageUrl: string | null | undefined;
  focusedNodeId: string | null;
  isInteractionActive: boolean;
}

export interface CanvasImageFocusInput {
  nodes: readonly CanvasNode[];
  viewport: Viewport;
  viewportSize: { width: number; height: number };
  selectedNodeId: string | null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getNodeImageUrl(node: CanvasNode): string | null {
  return nonEmptyString((node.data as { imageUrl?: unknown }).imageUrl);
}

function isCanvasImageRenderNode(node: CanvasNode): boolean {
  return node.type === CANVAS_NODE_TYPES.upload
    || node.type === CANVAS_NODE_TYPES.imageEdit
    || node.type === CANVAS_NODE_TYPES.exportImage;
}

function getNodeSize(node: CanvasNode): { width: number; height: number } {
  const styleWidth = typeof node.style?.width === 'number' ? node.style.width : null;
  const styleHeight = typeof node.style?.height === 'number' ? node.style.height : null;
  const declaredWidth = typeof node.width === 'number' ? node.width : null;
  const declaredHeight = typeof node.height === 'number' ? node.height : null;

  return {
    width: node.measured?.width ?? declaredWidth ?? styleWidth ?? DEFAULT_NODE_WIDTH,
    height: node.measured?.height ?? declaredHeight ?? styleHeight ?? 200,
  };
}

function getNodeAbsolutePosition(
  node: CanvasNode,
  nodesById: ReadonlyMap<string, CanvasNode>
): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  const visited = new Set<string>();

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodesById.get(parentId);
    if (!parent) {
      break;
    }
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }

  return { x, y };
}

function isVisibleInViewport(
  node: CanvasNode,
  viewport: Viewport,
  viewportSize: { width: number; height: number },
  nodesById: ReadonlyMap<string, CanvasNode>
): boolean {
  const zoom = Math.max(0.01, viewport.zoom);
  const minX = -viewport.x / zoom;
  const minY = -viewport.y / zoom;
  const maxX = minX + viewportSize.width / zoom;
  const maxY = minY + viewportSize.height / zoom;
  const size = getNodeSize(node);
  const position = getNodeAbsolutePosition(node, nodesById);

  return (
    position.x < maxX
    && position.x + size.width > minX
    && position.y < maxY
    && position.y + size.height > minY
  );
}

function hasInspectionScale(node: CanvasNode, viewport: Viewport): boolean {
  const size = getNodeSize(node);
  return Math.max(size.width, size.height) * viewport.zoom >= MIN_ORIGINAL_IMAGE_LONG_SIDE_PX;
}

export function hasDistinctCanvasImagePreview(
  imageUrl: string | null | undefined,
  previewImageUrl: string | null | undefined
): boolean {
  const original = nonEmptyString(imageUrl);
  const preview = nonEmptyString(previewImageUrl);
  return Boolean(original && preview && original !== preview);
}

export function resolveCanvasImageRenderSource({
  nodeId,
  imageUrl,
  previewImageUrl,
  focusedNodeId,
  isInteractionActive,
}: CanvasImageRenderSourceInput): string | null {
  const original = nonEmptyString(imageUrl);
  const preview = nonEmptyString(previewImageUrl);
  if (!original) {
    return preview;
  }
  if (!preview || preview === original) {
    return original;
  }

  return focusedNodeId === nodeId && !isInteractionActive ? original : preview;
}

export function findCanvasImageFocusCandidate({
  nodes,
  viewport,
  viewportSize,
  selectedNodeId,
}: CanvasImageFocusInput): string | null {
  if (viewportSize.width <= 0 || viewportSize.height <= 0) {
    return null;
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const candidates = nodes.filter((node) => (
    isCanvasImageRenderNode(node)
    && getNodeImageUrl(node)
    && hasDistinctCanvasImagePreview(
      getNodeImageUrl(node),
      (node.data as { previewImageUrl?: unknown }).previewImageUrl as string | null | undefined
    )
    && isVisibleInViewport(node, viewport, viewportSize, nodesById)
    && hasInspectionScale(node, viewport)
  ));
  if (candidates.length === 0) {
    return null;
  }

  const selectedCandidate = selectedNodeId
    ? candidates.find((node) => node.id === selectedNodeId)
    : undefined;
  if (selectedCandidate) {
    return selectedCandidate.id;
  }

  const zoom = Math.max(0.01, viewport.zoom);
  const viewportCenterX = (-viewport.x + viewportSize.width / 2) / zoom;
  const viewportCenterY = (-viewport.y + viewportSize.height / 2) / zoom;

  return candidates.reduce((closest, node) => {
    const closestSize = getNodeSize(closest);
    const nodeSize = getNodeSize(node);
    const closestPosition = getNodeAbsolutePosition(closest, nodesById);
    const nodePosition = getNodeAbsolutePosition(node, nodesById);
    const closestDistance = Math.hypot(
      closestPosition.x + closestSize.width / 2 - viewportCenterX,
      closestPosition.y + closestSize.height / 2 - viewportCenterY
    );
    const nodeDistance = Math.hypot(
      nodePosition.x + nodeSize.width / 2 - viewportCenterX,
      nodePosition.y + nodeSize.height / 2 - viewportCenterY
    );
    return nodeDistance < closestDistance ? node : closest;
  }).id;
}
