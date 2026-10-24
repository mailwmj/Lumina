// @vitest-environment happy-dom
import { clearMocks, mockConvertFileSrc } from '@tauri-apps/api/mocks';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentDraftRef } from '@/features/agent/domain/types';
import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import i18n from '@/i18n';
import { useCanvasStore } from '@/stores/canvasStore';
import { AgentImageGrid } from './AgentImageGrid';
import { DraftRefChips, MessageRefChips } from './AgentRefChips';
import { CanvasImagePicker } from './CanvasImagePicker';
import { draftRefFromNode } from './agentDraftRefs';

describe('agent image previews', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('isTauri', true);
    mockConvertFileSrc('linux');
    await i18n.changeLanguage('zh');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useCanvasStore.getState().setCanvasData([], []);
    clearMocks();
    vi.unstubAllGlobals();
  });

  function imageSources() {
    return Array.from(container.querySelectorAll('img'), (image) => image.getAttribute('src'));
  }

  it('renders local generated results, draft refs, sent refs and the canvas picker as asset URLs', async () => {
    const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, { x: 0, y: 0 }, {
      imageUrl: '/project/outputs/images/cat.png',
      previewImageUrl: '/project/outputs/images/cat preview.jpg',
    });
    useCanvasStore.getState().setCanvasData([node], []);

    await act(async () => root.render(<>
      <AgentImageGrid
        part={{
          state: 'output-available',
          output: {
            status: 'completed', grantedCount: 1, sourceNodeIds: [],
            results: [{ nodeId: node.id, status: 'ready' }], budget: { limit: 1, used: 1 },
          },
        }}
        onLocate={() => {}}
        onContinue={() => {}}
      />
      <DraftRefChips refs={[draftRefFromNode(node)!]} onRemove={() => {}} />
      <MessageRefChips refs={[{ nodeId: node.id }]} />
      <CanvasImagePicker excludedNodeIds={new Set()} onPick={() => {}} />
    </>));

    expect(imageSources()).toEqual(Array(4).fill('asset://localhost/%2Fproject%2Foutputs%2Fimages%2Fcat%20preview.jpg'));

    // Existing messages follow canvas edits, including nodes without a separate preview.
    await act(async () => useCanvasStore.getState().updateNodeData(node.id, {
      imageUrl: '/project/outputs/images/edited.png', previewImageUrl: null,
    }));
    const edited = 'asset://localhost/%2Fproject%2Foutputs%2Fimages%2Fedited.png';
    expect(imageSources()).toEqual([edited, expect.any(String), edited, edited]);

    await act(async () => useCanvasStore.getState().setCanvasData([], []));
    expect(container.querySelector('[data-slot="image-generation"]')?.getAttribute('data-state')).toBe('error');
    expect(imageSources()).toHaveLength(1); // The unsent draft retains its thumbnail.
  });

  it.each([
    'data:image/png;base64,aGVsbG8=',
    'https://example.test/image.jpg',
    'blob:http://localhost/upload',
  ])('keeps browser image URLs usable in attached references: %s', async (source) => {
    const ref: AgentDraftRef = { id: 'upload', nodeId: null, name: 'image', thumbnail: source, source };
    await act(async () => root.render(<DraftRefChips refs={[ref]} onRemove={() => {}} />));
    expect(imageSources()).toEqual([source]);
  });
});
