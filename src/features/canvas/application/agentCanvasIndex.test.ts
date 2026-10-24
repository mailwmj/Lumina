import { beforeEach, describe, expect, it } from 'vitest';
import { canAddNodeToAgentChat, useAgentCanvasIndex } from './agentCanvasIndex';
import { canvasNodeFactory } from './canvasServices';
import { CANVAS_NODE_TYPES, type CanvasNodeData } from '../domain/canvasNodes';
import { getNodeSourceDataTypes } from '../domain/nodeRegistry';

describe('agent canvas index', () => {
  beforeEach(() => {
    useAgentCanvasIndex.getState().setReferencedNodeIds([]);
    useAgentCanvasIndex.getState().setOriginNodeIds([]);
  });

  it('starts empty and replaces each independent projection from an iterable', () => {
    expect([...useAgentCanvasIndex.getState().referencedNodeIds]).toEqual([]);
    expect([...useAgentCanvasIndex.getState().originNodeIds]).toEqual([]);
    const ids = new Set(['first', 'second']);
    useAgentCanvasIndex.getState().setReferencedNodeIds(ids);
    useAgentCanvasIndex.getState().setOriginNodeIds(['origin', 'origin']);
    ids.add('later');
    expect([...useAgentCanvasIndex.getState().referencedNodeIds]).toEqual(['first', 'second']);
    expect([...useAgentCanvasIndex.getState().originNodeIds]).toEqual(['origin']);
    useAgentCanvasIndex.getState().setReferencedNodeIds(['replacement', 'replacement']);
    expect([...useAgentCanvasIndex.getState().referencedNodeIds]).toEqual(['replacement']);
    useAgentCanvasIndex.getState().setOriginNodeIds(new Set());
    expect([...useAgentCanvasIndex.getState().originNodeIds]).toEqual([]);
    expect([...useAgentCanvasIndex.getState().referencedNodeIds]).toEqual(['replacement']);
  });
});

describe('canAddNodeToAgentChat', () => {
  it.each(Object.values(CANVAS_NODE_TYPES))('uses the registered source data types: %s', (type) => {
    const node = canvasNodeFactory.createNode(type, { x: 0, y: 0 }, { imageUrl: '/image.png' });
    expect(canAddNodeToAgentChat(node)).toBe(getNodeSourceDataTypes(type).includes('image'));
  });

  it.each<{ data: Partial<CanvasNodeData>; expected: boolean }>([
    { data: { imageUrl: '/image.png' }, expected: true },
    { data: { imageUrl: null, previewImageUrl: '/preview.jpg' }, expected: true },
    { data: { imageUrl: null, previewImageUrl: null }, expected: false },
    { data: { imageUrl: '', previewImageUrl: '' }, expected: false },
    { data: { imageUrl: null, referenceImageUrl: '/reference.png' }, expected: false },
    { data: { imageUrl: '/image.png', isGenerating: true }, expected: false },
    { data: { previewImageUrl: '/preview.jpg', isGenerating: true }, expected: false },
    { data: { imageUrl: '/image.png', isGenerating: false }, expected: true },
    { data: { imageUrl: '/image.png', generationError: 'failed' }, expected: true },
  ])('checks image availability and generation state: $data', ({ data, expected }) => {
    const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, { x: 0, y: 0 }, data);
    expect(canAddNodeToAgentChat(node)).toBe(expected);
  });
});
