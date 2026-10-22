// @vitest-environment happy-dom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { CANVAS_NODE_TYPES, type ImageEditNodeData } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import { createDefaultChaomoImageApiConfig, useSettingsStore } from '@/stores/settingsStore';
import { ImageEditNode } from './ImageEditNode';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh' } }),
}));

function Harness() {
  const node = useCanvasStore((state) => state.nodes.find((item) => item.id === 'edit'));
  if (!node) {
    return null;
  }
  const props = {
    id: node.id,
    type: node.type,
    data: node.data,
    width: 520,
    height: 320,
    selected: false,
  } as unknown as ComponentProps<typeof ImageEditNode>;
  return <ImageEditNode {...props} />;
}

describe('ImageEditNode model normalization', () => {
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    // Only a Chaomo key is configured, so the registry default model resolves
    // to a different configured model and the node normalizes its data.
    useSettingsStore.setState({
      chaomoImageApi: { ...createDefaultChaomoImageApiConfig(), apiKey: 'key' },
    });
    const node = {
      ...canvasNodeFactory.createNode(CANVAS_NODE_TYPES.imageEdit, { x: 0, y: 0 }),
      id: 'edit',
    };
    useCanvasStore.setState({ nodes: [], edges: [], history: { past: [], future: [] } });
    useCanvasStore.getState().addNode(node.type, node.position, node.data);
    const created = useCanvasStore.getState().nodes[0];
    useCanvasStore.setState({ nodes: [{ ...created, id: 'edit' }] });
    root = createRoot(document.createElement('div'));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it('does not turn model normalization into undo steps that trap undo', () => {
    act(() => root.render(<ReactFlowProvider><Harness /></ReactFlowProvider>));
    const normalizedModel = (useCanvasStore.getState().nodes[0].data as ImageEditNodeData).model;
    expect(useCanvasStore.getState().history.past).toHaveLength(1);

    act(() => useCanvasStore.getState().undo());

    expect(useCanvasStore.getState().nodes).toHaveLength(0);
    expect(useCanvasStore.getState().history.future).toHaveLength(1);
    act(() => useCanvasStore.getState().redo());
    expect((useCanvasStore.getState().nodes[0].data as ImageEditNodeData).model).toBe(normalizedModel);
  });
});
