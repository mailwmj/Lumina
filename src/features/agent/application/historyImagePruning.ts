import type { ModelMessage } from 'ai';

export const DEFAULT_KEPT_HISTORY_IMAGES = 4;
export const PRUNED_IMAGE_PLACEHOLDER = '[Earlier image omitted to save context. Call view_images again if needed.]';

type ToolResultContentPart = { type: string; [key: string]: unknown };

function isImagePart(part: { type: string }): boolean {
  return part.type === 'file' || part.type === 'image';
}

/**
 * Keeps the newest `keep` image parts (tool-result content and user content) and swaps older
 * ones for a text placeholder, so token use stops growing with every viewed image.
 */
export function pruneHistoryImages(messages: ModelMessage[], keep = DEFAULT_KEPT_HISTORY_IMAGES): ModelMessage[] {
  let remaining = keep;
  const keepOrPrune = <T extends { type: string }>(part: T): T | { type: 'text'; text: string } => {
    if (!isImagePart(part)) return part;
    if (remaining > 0) {
      remaining -= 1;
      return part;
    }
    return { type: 'text', text: PRUNED_IMAGE_PLACEHOLDER };
  };

  // Walk newest-first so the most recent images keep their pixels.
  const pruned = [...messages].reverse().map((message): ModelMessage => {
    if (message.role === 'user' && Array.isArray(message.content)) {
      return { ...message, content: [...message.content].reverse().map(keepOrPrune).reverse() } as ModelMessage;
    }
    if (message.role === 'tool') {
      const content = [...message.content].reverse().map((part) => {
        if (part.type !== 'tool-result' || part.output.type !== 'content') return part;
        const value = [...(part.output.value as ToolResultContentPart[])].reverse().map(keepOrPrune).reverse();
        return { ...part, output: { ...part.output, value } };
      }).reverse();
      return { ...message, content } as ModelMessage;
    }
    return message;
  });
  return pruned.reverse();
}
