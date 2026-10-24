import type { UIMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import { deserializeAgentMessage, serializeAgentMessage } from './agentThreadRepository';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const PREVIEW = `data:image/webp;base64,${'A'.repeat(2000)}`;

const viewImagesMessage = {
  id: 'a-1',
  role: 'assistant',
  parts: [{
    type: 'tool-view_images',
    toolCallId: 'c1',
    state: 'output-available',
    input: { nodeIds: ['n1'] },
    output: { images: [{ nodeId: 'n1', displayName: '猫', mimeType: 'image/webp', dataUrl: PREVIEW }] },
  }, {
    type: 'file',
    mediaType: 'image/png',
    url: 'data:image/png;base64,iVBORw0KGgo=',
  }],
} as unknown as UIMessage;

describe('serializeAgentMessage', () => {
  it('stores no base64 image data, only node ids and metadata', () => {
    const record = serializeAgentMessage(viewImagesMessage, 't1', 0, 1);
    expect(record.partsJson).not.toMatch(/base64/);
    expect(record.partsJson).not.toContain('dataUrl');
    expect(record.partsJson).toContain('"nodeId":"n1"');
    expect(record.partsJson).toContain('"displayName":"猫"');
  });

  it('round-trips text, metadata and order fields', () => {
    const message = {
      id: 'u-1',
      role: 'user',
      metadata: { refs: [{ nodeId: 'n1' }], requestedImageCount: 3 },
      parts: [{ type: 'text', text: '出 3 张' }],
    } as UIMessage;
    const record = serializeAgentMessage(message, 't1', 4, 99);
    expect(record).toMatchObject({ id: 'u-1', threadId: 't1', seq: 4, role: 'user', createdAt: 99 });
    expect(deserializeAgentMessage(record)).toEqual(message);
  });
});
