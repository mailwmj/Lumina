import {
  CANVAS_NODE_TYPES,
  isExportImageNode,
  isImageEditNode,
  isStoryboardGenNode,
  isStoryboardSplitNode,
  isTextGenerationNode,
  isUploadNode,
  type CanvasDataType,
  type CanvasEdge,
  type CanvasNode,
} from '../domain/canvasNodes';
import { resolveNodeDisplayName } from '../domain/nodeDisplay';
import { getNodeSourceDataTypes } from '../domain/nodeRegistry';

export interface ResolvedTextInput {
  edgeId: string;
  nodeId: string;
  displayName: string;
  text: string;
}

export interface ResolvedImageInput {
  edgeId: string;
  nodeId: string;
  displayName: string;
  imageUrl: string | null;
  previewImageUrl: string | null;
}

export interface ResolvedTextGenerationInputs {
  textInputs: ResolvedTextInput[];
  imageInputs: ResolvedImageInput[];
  effectivePrompt: string;
  referenceImages: string[];
  blockingImageNodeIds: string[];
}

interface TextGenerationDataLike {
  inputText?: unknown;
  generatedText?: unknown;
}

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return value.trim().length > 0 ? value : null;
}

function nonEmptyTrimmedValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function getTextGenerationEffectiveText(data: TextGenerationDataLike): string {
  return nonEmptyText(data.generatedText) ?? nonEmptyText(data.inputText) ?? '';
}

export function resolveEdgeValueType(edge: CanvasEdge, sourceNode: CanvasNode): CanvasDataType | null {
  const storedType = edge.data?.valueType;
  const sourceTypes = getNodeSourceDataTypes(sourceNode.type);
  if (storedType && sourceTypes.includes(storedType)) {
    return storedType;
  }
  return sourceTypes.length === 1 ? sourceTypes[0] : null;
}

function sortInputEdges(edges: CanvasEdge[]): CanvasEdge[] {
  return edges
    .map((edge, index) => ({ edge, index }))
    .sort((left, right) => {
      const leftOrder = Number.isFinite(left.edge.data?.inputOrder)
        ? Number(left.edge.data?.inputOrder)
        : left.index;
      const rightOrder = Number.isFinite(right.edge.data?.inputOrder)
        ? Number(right.edge.data?.inputOrder)
        : right.index;
      return leftOrder - rightOrder || left.index - right.index;
    })
    .map(({ edge }) => edge);
}

function resolveNodeText(
  node: CanvasNode,
  nodesById: Map<string, CanvasNode>,
  edges: CanvasEdge[],
  visiting: Set<string>
): string {
  if (!isTextGenerationNode(node)) {
    return '';
  }

  const generatedText = nonEmptyText(node.data.generatedText);
  if (generatedText) {
    return generatedText;
  }
  if (visiting.has(node.id)) {
    return '';
  }

  visiting.add(node.id);
  const upstreamTexts = sortInputEdges(edges.filter((edge) => edge.target === node.id))
    .map((edge) => {
      const sourceNode = nodesById.get(edge.source);
      if (!sourceNode || resolveEdgeValueType(edge, sourceNode) !== 'text') {
        return '';
      }
      return resolveNodeText(sourceNode, nodesById, edges, visiting);
    })
    .filter(Boolean);
  visiting.delete(node.id);

  const localInput = nonEmptyText(node.data.inputText);
  return [...upstreamTexts, ...(localInput ? [localInput] : [])].join('\n\n');
}

function extractImageSource(node: CanvasNode): Pick<ResolvedImageInput, 'imageUrl' | 'previewImageUrl'> {
  if (isUploadNode(node) || isImageEditNode(node) || isExportImageNode(node) || isStoryboardGenNode(node)) {
    return {
      imageUrl: nonEmptyTrimmedValue(node.data.imageUrl),
      previewImageUrl: nonEmptyTrimmedValue(node.data.previewImageUrl),
    };
  }

  if (isStoryboardSplitNode(node)) {
    const firstFrame = [...node.data.frames]
      .sort((left, right) => left.order - right.order)
      .find((frame) => nonEmptyTrimmedValue(frame.imageUrl));
    return {
      imageUrl: firstFrame ? nonEmptyTrimmedValue(firstFrame.imageUrl) : null,
      previewImageUrl: firstFrame ? nonEmptyTrimmedValue(firstFrame.previewImageUrl) : null,
    };
  }

  return { imageUrl: null, previewImageUrl: null };
}

export function resolveTextGenerationInputs(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): ResolvedTextGenerationInputs {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const targetNode = nodesById.get(nodeId);
  const incomingEdges = edges.filter((edge) => edge.target === nodeId);
  const textEdges: CanvasEdge[] = [];
  const imageEdges: CanvasEdge[] = [];

  for (const edge of incomingEdges) {
    const sourceNode = nodesById.get(edge.source);
    if (!sourceNode) {
      continue;
    }
    const valueType = resolveEdgeValueType(edge, sourceNode);
    if (valueType === 'text') {
      textEdges.push(edge);
    } else if (valueType === 'image') {
      imageEdges.push(edge);
    }
  }

  const textInputs = sortInputEdges(textEdges).flatMap((edge): ResolvedTextInput[] => {
    const sourceNode = nodesById.get(edge.source);
    if (!sourceNode) {
      return [];
    }
    const text = resolveNodeText(sourceNode, nodesById, edges, new Set([nodeId]));
    return [{
      edgeId: edge.id,
      nodeId: sourceNode.id,
      displayName: resolveNodeDisplayName(sourceNode.type, sourceNode.data),
      text,
    }];
  });

  const imageInputs = sortInputEdges(imageEdges).flatMap((edge): ResolvedImageInput[] => {
    const sourceNode = nodesById.get(edge.source);
    if (!sourceNode) {
      return [];
    }
    return [{
      edgeId: edge.id,
      nodeId: sourceNode.id,
      displayName: resolveNodeDisplayName(sourceNode.type, sourceNode.data),
      ...extractImageSource(sourceNode),
    }];
  });

  const localInput = targetNode?.type === CANVAS_NODE_TYPES.textGeneration
    ? nonEmptyText(targetNode.data.inputText)
    : null;
  const effectivePrompt = [
    ...textInputs.map((input) => input.text).filter(Boolean),
    ...(localInput ? [localInput] : []),
  ].join('\n\n');

  return {
    textInputs,
    imageInputs,
    effectivePrompt,
    referenceImages: imageInputs.flatMap((input) => input.imageUrl ? [input.imageUrl] : []),
    blockingImageNodeIds: imageInputs.flatMap((input) => input.imageUrl ? [] : [input.nodeId]),
  };
}

export function resolveEffectivePromptForNode(
  nodeId: string,
  localInput: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): string {
  const { textInputs } = resolveTextGenerationInputs(nodeId, nodes, edges);
  const normalizedLocalInput = nonEmptyText(localInput);
  return [
    ...textInputs.map((input) => input.text).filter(Boolean),
    ...(normalizedLocalInput ? [normalizedLocalInput] : []),
  ].join('\n\n');
}
