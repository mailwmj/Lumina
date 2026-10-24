import { resolveFittedImageNodeSize } from '@/features/canvas/application/imageNodeSizing';
import {
  IMAGE_RESULT_BATCH_GAP,
  IMAGE_RESULT_ITEM_GAP,
  IMAGE_RESULT_SOURCE_GAP,
} from '@/features/canvas/application/imageResultPlacement';
import { TEXT_GENERATION_DEFAULT_WIDTH } from '@/features/canvas/application/textGenerationLayout';
import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_NODE_WIDTH,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';

export interface GenerationRowRequest {
  outputCount: number;
  aspectRatio?: string;
}

export interface GenerationRowLayoutInput {
  nodes: readonly CanvasNode[];
  /** Nodes this conversation already created; their column is reused and grows downward. */
  threadNodeIds: readonly string[];
  referenceNodeIds: readonly string[];
  rows: readonly GenerationRowRequest[];
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Vertical space between two generation rows of one conversation. */
export const GENERATION_ROW_GAP = 72;
/** Horizontal space between a new conversation column and what is already on the canvas. */
const COLUMN_GAP = 160;
const EMPTY_CANVAS_ORIGIN = { x: 120, y: 120 };
/** An unmeasured generation node: default width, prompt plus reference strip. */
const GENERATION_NODE_ESTIMATE = { width: TEXT_GENERATION_DEFAULT_WIDTH, height: 320 };

function estimateNodeSize(node: CanvasNode): { width: number; height: number } {
  const fallback = node.type === CANVAS_NODE_TYPES.imageEdit
    ? GENERATION_NODE_ESTIMATE
    : { width: DEFAULT_NODE_WIDTH, height: 200 };
  const styleWidth = typeof node.style?.width === 'number' ? node.style.width : undefined;
  const styleHeight = typeof node.style?.height === 'number' ? node.style.height : undefined;
  return {
    width: node.measured?.width ?? node.width ?? styleWidth ?? fallback.width,
    height: node.measured?.height ?? node.height ?? styleHeight ?? fallback.height,
  };
}

function resolveRect(node: CanvasNode, nodesById: ReadonlyMap<string, CanvasNode>): Rect {
  let { x, y } = node.position;
  const visited = new Set<string>();
  let parent = node.parentId ? nodesById.get(node.parentId) : undefined;
  while (parent && !visited.has(parent.id)) {
    visited.add(parent.id);
    x += parent.position.x;
    y += parent.position.y;
    parent = parent.parentId ? nodesById.get(parent.parentId) : undefined;
  }
  return { x, y, ...estimateNodeSize(node) };
}

/** Mirrors the result batch shape: 1 result, a vertical pair, or a 2x2 grid. */
function estimateResultBlock({ outputCount, aspectRatio }: GenerationRowRequest): { width: number; height: number } {
  const ratio = aspectRatio && /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(aspectRatio) ? aspectRatio : DEFAULT_ASPECT_RATIO;
  const item = resolveFittedImageNodeSize(
    ratio,
    { width: EXPORT_RESULT_NODE_DEFAULT_WIDTH, height: EXPORT_RESULT_NODE_LAYOUT_HEIGHT },
    { minWidth: EXPORT_RESULT_NODE_MIN_WIDTH, minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT },
  );
  const columns = outputCount > 2 ? 2 : 1;
  const rows = Math.ceil(Math.max(1, outputCount) / columns);
  return {
    width: columns * item.width + (columns - 1) * IMAGE_RESULT_ITEM_GAP,
    height: rows * item.height + (rows - 1) * IMAGE_RESULT_ITEM_GAP,
  };
}

function rowHeightOf(row: GenerationRowRequest, generationHeight: number): number {
  return Math.max(generationHeight, estimateResultBlock(row).height);
}

function collides(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.width + IMAGE_RESULT_BATCH_GAP
    && left.x + left.width + IMAGE_RESULT_BATCH_GAP > right.x
    && left.y < right.y + right.height + IMAGE_RESULT_BATCH_GAP
    && left.y + left.height + IMAGE_RESULT_BATCH_GAP > right.y
  );
}

/** Bottom of a generation row, counting result slots whose nodes may not exist yet. */
function reservedBottom(node: CanvasNode, rect: Rect): number {
  if (node.type !== CANVAS_NODE_TYPES.imageEdit) {
    return rect.y + rect.height;
  }
  const data = node.data as { outputCount?: number; requestAspectRatio?: string };
  const height = rowHeightOf({ outputCount: data.outputCount ?? 1, aspectRatio: data.requestAspectRatio }, rect.height);
  return rect.y + rect.height / 2 + height / 2;
}

/**
 * Places each generation call as one row: the generation node on the left, its results to its
 * right. A conversation keeps one column and every new row goes below its previous rows, so a
 * long conversation grows downward instead of stretching the canvas sideways. The first row of a
 * conversation sits right of its reference image, or right of the whole canvas without one.
 */
export function resolveGenerationRowPositions({
  nodes,
  threadNodeIds,
  referenceNodeIds,
  rows,
}: GenerationRowLayoutInput): Array<{ x: number; y: number }> {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const rects = new Map(nodes.map((node) => [node.id, resolveRect(node, nodesById)] as const));
  const threadNodes = threadNodeIds.flatMap((id) => nodesById.get(id) ?? []);
  const firstRowHeight = rows.length > 0 ? rowHeightOf(rows[0], GENERATION_NODE_ESTIMATE.height) : 0;

  let columnX: number;
  let rowTop: number;
  const reference = referenceNodeIds.flatMap((id) => rects.get(id) ?? [])[0];
  if (threadNodes.length > 0) {
    const threadRects = threadNodes.map((node) => rects.get(node.id)!);
    const generationRects = threadNodes
      .filter((node) => node.type === CANVAS_NODE_TYPES.imageEdit)
      .map((node) => rects.get(node.id)!);
    columnX = Math.min(...(generationRects.length > 0 ? generationRects : threadRects).map((rect) => rect.x));
    rowTop = Math.max(...threadNodes.map((node) => reservedBottom(node, rects.get(node.id)!))) + GENERATION_ROW_GAP;
  } else if (reference) {
    columnX = reference.x + reference.width + COLUMN_GAP;
    rowTop = reference.y + reference.height / 2 - firstRowHeight / 2;
  } else if (rects.size > 0) {
    const all = [...rects.values()];
    columnX = Math.max(...all.map((rect) => rect.x + rect.width)) + COLUMN_GAP;
    rowTop = Math.min(...all.map((rect) => rect.y));
  } else {
    columnX = EMPTY_CANVAS_ORIGIN.x;
    rowTop = EMPTY_CANVAS_ORIGIN.y;
  }

  const obstacles = [...rects.values()];
  return rows.map((row) => {
    const block = estimateResultBlock(row);
    const height = rowHeightOf(row, GENERATION_NODE_ESTIMATE.height);
    const width = GENERATION_NODE_ESTIMATE.width + IMAGE_RESULT_SOURCE_GAP + block.width;
    // Slide down past anything in the way; the column itself never moves.
    for (;;) {
      const candidate = { x: columnX, y: rowTop, width, height };
      const blocking = obstacles.filter((obstacle) => collides(candidate, obstacle));
      if (blocking.length === 0) break;
      rowTop = Math.max(...blocking.map((obstacle) => obstacle.y + obstacle.height)) + GENERATION_ROW_GAP;
    }
    obstacles.push({ x: columnX, y: rowTop, width, height });
    const position = {
      x: Math.round(columnX),
      y: Math.round(rowTop + (height - GENERATION_NODE_ESTIMATE.height) / 2),
    };
    rowTop += height + GENERATION_ROW_GAP;
    return position;
  });
}
