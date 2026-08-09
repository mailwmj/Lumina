import { describe, expect, it } from 'vitest';

import {
  buildImageReferenceModelPrompt,
  createImageReferencePromptToken,
  findImageReferencePromptTokens,
  insertImageReferencePromptToken,
  materializeImageReferencePrompt,
  pruneImageReferencePromptTokensForEdges,
  removeImageReferencePromptToken,
} from './imageReferencePrompt';
import { canvasNodeFactory } from './canvasServices';
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes';

function createNode(type: CanvasNode['type'], id: string): CanvasNode {
  return {
    ...canvasNodeFactory.createNode(type, { x: 0, y: 0 }),
    id,
  };
}

describe('image reference prompt', () => {
  it('keeps a selected image identity while its visible ordinal changes after reorder', () => {
    const redEdgeId = 'red-edge';
    const yellowEdgeId = 'yellow-edge';
    const prompt = [
      '衣服参考',
      createImageReferencePromptToken(redEdgeId),
      '；帽子参考',
      createImageReferencePromptToken(yellowEdgeId),
      '。',
    ].join('');

    expect(materializeImageReferencePrompt(prompt, [
      { edgeId: redEdgeId },
      { edgeId: yellowEdgeId },
    ])).toBe('衣服参考图片 1；帽子参考图片 2。');

    expect(materializeImageReferencePrompt(prompt, [
      { edgeId: yellowEdgeId },
      { edgeId: redEdgeId },
    ])).toBe('衣服参考图片 2；帽子参考图片 1。');
  });

  it('inserts and removes one atomic reference token without affecting another occurrence', () => {
    const first = insertImageReferencePromptToken('衣服参考。', 4, 'red-edge');
    const second = insertImageReferencePromptToken(first.nextText, first.nextOffset, 'red-edge');
    const tokens = findImageReferencePromptTokens(second.nextText);

    expect(tokens).toHaveLength(2);
    const removed = removeImageReferencePromptToken(second.nextText, tokens[0].start, tokens[0].end);
    expect(findImageReferencePromptTokens(removed.nextText)).toHaveLength(1);
    expect(materializeImageReferencePrompt(removed.nextText, [{ edgeId: 'red-edge' }]))
      .toBe('衣服参考图片 1。');
  });

  it('silently prunes only tags that point to removed image edges across supported nodes', () => {
    const text = createNode(CANVAS_NODE_TYPES.textGeneration, 'text');
    text.data = {
      ...text.data,
      inputText: `衣服${createImageReferencePromptToken('red')}帽子${createImageReferencePromptToken('yellow')}`,
    };
    const image = createNode(CANVAS_NODE_TYPES.imageEdit, 'image');
    image.data = {
      ...image.data,
      prompt: `参考${createImageReferencePromptToken('red')}`,
    };

    const nextNodes = pruneImageReferencePromptTokensForEdges([text, image], ['red']);

    expect(nextNodes[0]?.data).toMatchObject({
      inputText: `衣服帽子${createImageReferencePromptToken('yellow')}`,
    });
    expect(nextNodes[1]?.data).toMatchObject({ prompt: '参考' });
  });

  it('adds an explicit ordered mapping before an image-generation prompt', () => {
    expect(buildImageReferenceModelPrompt('衣服参考图片 1；帽子参考图片 2。', [
      { edgeId: 'red' },
      { edgeId: 'yellow' },
    ])).toBe([
      '参考图片按以下编号和顺序提供：',
      '- 图片 1：第 1 张参考图片',
      '- 图片 2：第 2 张参考图片',
      '',
      '衣服参考图片 1；帽子参考图片 2。',
    ].join('\n'));
  });
});
