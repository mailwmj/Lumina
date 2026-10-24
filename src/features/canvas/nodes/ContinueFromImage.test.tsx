// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { canvasNodeFactory } from '../application/canvasServices';
import { continueFromImage } from '../application/continueFromImage';
import { CANVAS_NODE_TYPES, type ImageEditNodeData } from '../domain/canvasNodes';
import { ImageEditNode } from './ImageEditNode';
import { useCanvasStore } from '@/stores/canvasStore';

const flow = { getZoom: () => 1, setCenter: vi.fn() };
vi.mock('@xyflow/react', async (original) => ({
  ...await original<typeof import('@xyflow/react')>(), Handle: () => null,
  useReactFlow: () => flow, useUpdateNodeInternals: () => () => {},
}));
vi.mock('../ui/CanvasHandle', () => ({ CanvasHandle: () => null }));
vi.mock('../ui/NodeResizeHandle', () => ({ NodeResizeHandle: () => null }));
vi.mock('../ui/ModelParamsControls', () => ({ ModelParamsControls: () => null }));

it('focuses the continued prompt reference on mount without adding a second undo step', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await i18n.changeLanguage('zh');
  const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 }, { imageUrl: 'https://example.test/image.png' });
  useCanvasStore.getState().setCanvasData([source], []);
  const result = continueFromImage(source.id)!;
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    const node = useCanvasStore.getState().nodes.find((item) => item.id === result.nodeId)!;
    await act(async () => root.render(<ImageEditNode {...({ id: node.id, data: node.data as ImageEditNodeData, selected: true } as Parameters<typeof ImageEditNode>[0])} />));
    const input = container.querySelector<HTMLElement>('[contenteditable="true"]');
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(input!.querySelectorAll('[data-image-reference-edge-id]')).toHaveLength(1);
    expect(input!.querySelector('[data-image-reference-edge-id]')?.getAttribute('data-image-reference-edge-id')).toBe(result.edgeId);
    expect(useCanvasStore.getState().history.past).toHaveLength(1);
    await act(async () => { useCanvasStore.getState().undo(); });
    expect(useCanvasStore.getState().nodes.map((item) => item.id)).toEqual([source.id]);
    expect(useCanvasStore.getState().edges).toEqual([]);
  } finally {
    await act(async () => root.unmount()); container.remove();
    useCanvasStore.getState().setCanvasData([], []); vi.unstubAllGlobals();
  }
});
