import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import { pruneHistoryImages, PRUNED_IMAGE_PLACEHOLDER } from './historyImagePruning';

function viewResult(toolCallId: string, ...labels: string[]): ModelMessage {
  return {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId,
      toolName: 'view_images',
      output: {
        type: 'content',
        value: labels.flatMap((label) => [
          { type: 'text' as const, text: label },
          { type: 'file' as const, mediaType: 'image/webp', data: { type: 'data' as const, data: label } },
        ]),
      },
    }],
  } as ModelMessage;
}

function keptImageLabels(messages: ModelMessage[]): string[] {
  return messages.flatMap((message) => (message.role === 'tool' ? message.content : []))
    .flatMap((part) => (part.type === 'tool-result' && part.output.type === 'content' ? part.output.value : []))
    .flatMap((part) => (part.type === 'file' ? [(part.data as { data: string }).data] : []));
}

function placeholderCount(messages: ModelMessage[]): number {
  return JSON.stringify(messages).split(PRUNED_IMAGE_PLACEHOLDER).length - 1;
}

describe('pruneHistoryImages', () => {
  it('keeps only the newest N images and replaces older ones with a placeholder', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'make a cat' },
      viewResult('a', 'img1', 'img2', 'img3'),
      { role: 'user', content: 'again' },
      viewResult('b', 'img4', 'img5', 'img6'),
    ];
    const pruned = pruneHistoryImages(messages, 4);
    expect(keptImageLabels(pruned)).toEqual(['img3', 'img4', 'img5', 'img6']);
    expect(placeholderCount(pruned)).toBe(2);
  });

  it('leaves text and metadata intact and does not mutate the input', () => {
    const messages = [viewResult('a', 'img1', 'img2')];
    const before = JSON.stringify(messages);
    const pruned = pruneHistoryImages(messages, 1);
    expect(JSON.stringify(messages)).toBe(before);
    expect(JSON.stringify(pruned)).toContain('"text":"img1"');
    expect(keptImageLabels(pruned)).toEqual(['img2']);
  });

  it('returns the transcript unchanged when it holds no more than N images', () => {
    const messages = [viewResult('a', 'img1')];
    expect(pruneHistoryImages(messages, 4)).toEqual(messages);
  });
});
