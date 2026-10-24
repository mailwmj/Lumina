import { describe, expect, it } from 'vitest';

import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { CANVAS_NODE_TYPES, type CanvasNode, type CanvasNodeData } from '@/features/canvas/domain/canvasNodes';
import { withReferenceContext } from './referenceContext';

function node(type: CanvasNode['type'], id: string, data: Partial<CanvasNodeData>): CanvasNode {
  return { ...canvasNodeFactory.createNode(type, { x: 0, y: 0 }, data), id };
}

function contextText(message: { parts: Array<{ type: string; text?: string }> }): string {
  return message.parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}

const transcript = [
  { role: 'user', metadata: { refs: [{ nodeId: 'upload-1' }] }, parts: [{ type: 'text', text: '把它变成水彩' }] },
  {
    role: 'assistant',
    parts: [{
      type: 'tool-generate_image',
      state: 'output-available',
      output: { sourceNodeIds: ['gen-1'], results: [{ nodeId: 'result-1', status: 'ready' }] },
    }],
  },
  { role: 'user', metadata: { refs: [] }, parts: [{ type: 'text', text: '再暖一点' }] },
];

describe('withReferenceContext', () => {
  it('maps referenced images to 图片N with node id and name', () => {
    const nodes = [node(CANVAS_NODE_TYPES.upload, 'upload-1', { imageUrl: 'a.png', displayName: '猫' })];
    const [first] = withReferenceContext(transcript, nodes);
    expect(contextText(first)).toContain('图片1 = upload-1 (猫)');
  });

  it('reports the live state of agent-made nodes after the user edited the canvas by hand', () => {
    const nodes = [
      node(CANVAS_NODE_TYPES.upload, 'upload-1', { imageUrl: 'a.png' }),
      node(CANVAS_NODE_TYPES.imageEdit, 'gen-1', { prompt: '用户手改后的提示词', model: 'm1' }),
      node(CANVAS_NODE_TYPES.exportImage, 'result-1', { isGenerating: true }),
    ];
    const last = withReferenceContext(transcript, nodes)[2];
    expect(contextText(last)).toContain('gen-1');
    expect(contextText(last)).toContain('用户手改后的提示词');
    expect(contextText(last)).toContain('result-1');
    expect(contextText(last)).toMatch(/result-1 \([^)]*\): generating/);
  });

  it('tells the model when the user deleted an agent-made node', () => {
    const last = withReferenceContext(transcript, [])[2];
    expect(contextText(last)).toContain('result-1: deleted by the user');
  });

  it('adds the canvas state only to the newest user message and leaves the input untouched', () => {
    const before = JSON.stringify(transcript);
    const [first] = withReferenceContext(transcript, []);
    expect(contextText(first)).not.toContain('[Current canvas state]');
    expect(JSON.stringify(transcript)).toBe(before);
  });
});
