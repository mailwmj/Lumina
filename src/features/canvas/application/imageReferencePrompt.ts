import {
  isImageEditNode,
  isTextGenerationNode,
  type CanvasNode,
} from '../domain/canvasNodes';

/**
 * Persisted inline marker for a reference-image chip. The marker intentionally
 * contains the edge id, never a visual ordinal: input order is mutable while an
 * edge identifies the exact image a user selected.
 */
const IMAGE_REFERENCE_TOKEN_PREFIX = '{{image-ref:';
const IMAGE_REFERENCE_TOKEN_SUFFIX = '}}';
const IMAGE_REFERENCE_TOKEN_PATTERN = /\{\{image-ref:([^{}\s]+)\}\}/g;

export interface ImageReferencePromptInput {
  edgeId: string;
  imageUrl?: string | null;
}

export interface ImageReferencePromptToken {
  token: string;
  edgeId: string;
  start: number;
  end: number;
}

export function createImageReferencePromptToken(edgeId: string): string {
  return `${IMAGE_REFERENCE_TOKEN_PREFIX}${edgeId}${IMAGE_REFERENCE_TOKEN_SUFFIX}`;
}

export function findImageReferencePromptTokens(text: string): ImageReferencePromptToken[] {
  const tokens: ImageReferencePromptToken[] = [];
  for (const match of text.matchAll(IMAGE_REFERENCE_TOKEN_PATTERN)) {
    const token = match[0];
    const edgeId = match[1];
    const start = match.index;
    if (!token || !edgeId || start === undefined) {
      continue;
    }
    tokens.push({
      token,
      edgeId,
      start,
      end: start + token.length,
    });
  }
  return tokens;
}

export function insertImageReferencePromptToken(
  text: string,
  offset: number,
  edgeId: string
): { nextText: string; nextOffset: number } {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const token = createImageReferencePromptToken(edgeId);
  return {
    nextText: `${text.slice(0, safeOffset)}${token}${text.slice(safeOffset)}`,
    nextOffset: safeOffset + token.length,
  };
}

export function removeImageReferencePromptToken(
  text: string,
  start: number,
  end: number
): { nextText: string; nextOffset: number } {
  const safeStart = Math.max(0, Math.min(Math.min(start, end), text.length));
  const safeEnd = Math.max(safeStart, Math.min(Math.max(start, end), text.length));
  return {
    nextText: `${text.slice(0, safeStart)}${text.slice(safeEnd)}`,
    nextOffset: safeStart,
  };
}

export function getImageReferencePromptLabel(index: number): string {
  return `图片 ${index + 1}`;
}

/**
 * Replaces persisted chips with the user-facing name that matches the current
 * ordered image input list. Missing edges are removed rather than becoming an
 * accidental positional reference.
 */
export function materializeImageReferencePrompt(
  text: string,
  imageInputs: ImageReferencePromptInput[]
): string {
  const indexByEdgeId = new Map(imageInputs.map((input, index) => [input.edgeId, index]));
  const materialized = text.replace(IMAGE_REFERENCE_TOKEN_PATTERN, (_token, rawEdgeId: string) => {
    const index = indexByEdgeId.get(rawEdgeId);
    return index === undefined ? '' : getImageReferencePromptLabel(index);
  });
  // Keep saved prompts from the previous @图N implementation readable while
  // new insertions always use an edge-bound token.
  return materialized.replace(/@图(\d+)/g, (_token, rawIndex: string) => {
    const index = Number(rawIndex) - 1;
    return Number.isInteger(index) && index >= 0 && index < imageInputs.length
      ? getImageReferencePromptLabel(index)
      : '';
  });
}

/**
 * Image providers receive a prompt string plus an ordered image array. Make
 * that ordinal contract explicit in the prompt so `图片 N` is unambiguous for
 * providers that do not support named media parts.
 */
export function buildImageReferenceModelPrompt(
  prompt: string,
  imageInputs: ImageReferencePromptInput[]
): string {
  if (imageInputs.length === 0) {
    return prompt;
  }
  const mapping = imageInputs
    .map((_input, index) => `- ${getImageReferencePromptLabel(index)}：第 ${index + 1} 张参考图片`)
    .join('\n');
  return `参考图片按以下编号和顺序提供：\n${mapping}\n\n${prompt}`;
}

export function removeImageReferencePromptTokensForEdges(
  text: string,
  edgeIds: Iterable<string>
): string {
  const removedEdgeIds = new Set(edgeIds);
  if (removedEdgeIds.size === 0 || !text.includes(IMAGE_REFERENCE_TOKEN_PREFIX)) {
    return text;
  }
  return text.replace(IMAGE_REFERENCE_TOKEN_PATTERN, (token, rawEdgeId: string) =>
    removedEdgeIds.has(rawEdgeId) ? '' : token
  );
}

/**
 * Keeps graph mutations atomic: removing an image edge removes every prompt
 * chip that pointed to that exact edge in the same history operation.
 */
export function pruneImageReferencePromptTokensForEdges(
  nodes: CanvasNode[],
  removedEdgeIds: Iterable<string>
): CanvasNode[] {
  const edgeIds = Array.from(new Set(removedEdgeIds));
  if (edgeIds.length === 0) {
    return nodes;
  }

  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (isTextGenerationNode(node)) {
      const nextInputText = removeImageReferencePromptTokensForEdges(node.data.inputText, edgeIds);
      if (nextInputText === node.data.inputText) {
        return node;
      }
      changed = true;
      return {
        ...node,
        data: { ...node.data, inputText: nextInputText },
      };
    }

    if (isImageEditNode(node)) {
      const nextPrompt = removeImageReferencePromptTokensForEdges(node.data.prompt, edgeIds);
      if (nextPrompt === node.data.prompt) {
        return node;
      }
      changed = true;
      return {
        ...node,
        data: { ...node.data, prompt: nextPrompt },
      };
    }

    return node;
  });

  return changed ? nextNodes : nodes;
}
