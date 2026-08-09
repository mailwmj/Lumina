import { describe, expect, it } from 'vitest';

import { canvasNodeFactory } from './canvasServices';
import {
  getTextGenerationEffectiveText,
  resolveEffectivePromptForNode,
  resolveTextGenerationInputs,
} from './textGenerationInputs';
import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasNode,
  type TextGenerationNodeData,
} from '../domain/canvasNodes';

function createNode(
  type: CanvasNode['type'],
  id: string,
  data: Partial<TextGenerationNodeData> = {}
): CanvasNode {
  return {
    ...canvasNodeFactory.createNode(type, { x: 0, y: 0 }, data),
    id,
  };
}

function inputEdge(
  id: string,
  source: string,
  target: string,
  valueType: 'text' | 'image',
  inputOrder: number
): CanvasEdge {
  return {
    id,
    source,
    target,
    sourceHandle: 'source',
    targetHandle: 'target',
    data: { valueType, inputOrder },
  };
}

describe('text generation inputs', () => {
  it('uses a generated result as effective text until it is explicitly cleared', () => {
    expect(getTextGenerationEffectiveText({
      inputText: 'new local input',
      generatedText: 'old generated result',
    })).toBe('old generated result');

    expect(getTextGenerationEffectiveText({
      inputText: 'new local input',
      generatedText: null,
    })).toBe('new local input');

    expect(getTextGenerationEffectiveText({
      inputText: 'draft',
      generatedText: '  indented result\n',
    })).toBe('  indented result\n');
  });

  it('composes ordered upstream effective text and local input with blank lines', () => {
    const upstreamA = createNode(CANVAS_NODE_TYPES.textGeneration, 'text-a', {
      inputText: 'ignored draft',
      generatedText: 'generated A',
      displayName: 'A',
    });
    const upstreamB = createNode(CANVAS_NODE_TYPES.textGeneration, 'text-b', {
      inputText: 'local B',
      generatedText: null,
      displayName: 'B',
    });
    const target = createNode(CANVAS_NODE_TYPES.textGeneration, 'target', {
      inputText: 'local target',
      generatedText: null,
    });
    const edges = [
      inputEdge('later', upstreamA.id, target.id, 'text', 8),
      inputEdge('earlier', upstreamB.id, target.id, 'text', 2),
    ];

    const resolved = resolveTextGenerationInputs(target.id, [upstreamA, upstreamB, target], edges);

    expect(resolved.textInputs.map((input) => input.nodeId)).toEqual(['text-b', 'text-a']);
    expect(resolved.effectivePrompt).toBe('local B\n\ngenerated A\n\nlocal target');
  });

  it('keeps an empty connected text source manageable while ignoring it in effective text', () => {
    const emptyUpstream = createNode(CANVAS_NODE_TYPES.textGeneration, 'empty', {
      inputText: '   ',
      generatedText: null,
      displayName: 'Empty source',
    });
    const target = createNode(CANVAS_NODE_TYPES.textGeneration, 'target', {
      inputText: 'local target',
    });

    const resolved = resolveTextGenerationInputs(target.id, [emptyUpstream, target], [
      inputEdge('empty-edge', emptyUpstream.id, target.id, 'text', 0),
    ]);

    expect(resolved.textInputs).toMatchObject([{
      edgeId: 'empty-edge',
      nodeId: 'empty',
      displayName: 'Empty source',
      text: '',
    }]);
    expect(resolved.effectivePrompt).toBe('local target');
  });

  it('builds a rerun prompt from current inputs without feeding back the old result', () => {
    const target = createNode(CANVAS_NODE_TYPES.textGeneration, 'target', {
      inputText: 'current instruction',
      generatedText: 'old generated result',
    });

    const resolved = resolveTextGenerationInputs(target.id, [target], []);

    expect(getTextGenerationEffectiveText(target.data as TextGenerationNodeData))
      .toBe('old generated result');
    expect(resolved.effectivePrompt).toBe('current instruction');
  });

  it('keeps image ordering separate and reports a connected image with no usable result', () => {
    const imageA = createNode(CANVAS_NODE_TYPES.upload, 'image-a') as CanvasNode;
    imageA.data = { ...imageA.data, imageUrl: 'data:image/png;base64,AAA' };
    const imageB = createNode(CANVAS_NODE_TYPES.exportImage, 'image-b') as CanvasNode;
    imageB.data = { ...imageB.data, imageUrl: null };
    const target = createNode(CANVAS_NODE_TYPES.textGeneration, 'target', {
      inputText: 'describe the images',
    });
    const edges = [
      inputEdge('image-later', imageA.id, target.id, 'image', 5),
      inputEdge('image-earlier', imageB.id, target.id, 'image', 1),
    ];

    const resolved = resolveTextGenerationInputs(target.id, [imageA, imageB, target], edges);

    expect(resolved.imageInputs.map((input) => input.nodeId)).toEqual(['image-b', 'image-a']);
    expect(resolved.imageInputs[0].imageUrl).toBeNull();
    expect(resolved.blockingImageNodeIds).toEqual(['image-b']);
    expect(resolved.referenceImages).toEqual(['data:image/png;base64,AAA']);
  });

  it('composes upstream effective text with an image node local prompt', () => {
    const upstream = createNode(CANVAS_NODE_TYPES.textGeneration, 'text', {
      inputText: 'draft',
      generatedText: 'generated upstream',
    });
    const imageTarget = canvasNodeFactory.createNode(
      CANVAS_NODE_TYPES.imageEdit,
      { x: 0, y: 0 },
      { prompt: 'local image prompt' }
    );
    imageTarget.id = 'image-target';
    const edges = [inputEdge('text-edge', upstream.id, imageTarget.id, 'text', 0)];

    expect(resolveEffectivePromptForNode(
      imageTarget.id,
      'local image prompt',
      [upstream, imageTarget],
      edges
    )).toBe('generated upstream\n\nlocal image prompt');
  });
});
