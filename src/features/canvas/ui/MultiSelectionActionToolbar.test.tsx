// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { canAddNodeToAgentChat, useAgentCanvasIndex } from '../application/agentCanvasIndex';
import { canvasEventBus, canvasNodeFactory } from '../application/canvasServices';
import { CANVAS_NODE_TYPES, type CanvasNode, type CanvasNodeData, type CanvasNodeType } from '../domain/canvasNodes';
import { MultiSelectionActionToolbar } from './MultiSelectionActionToolbar';

vi.mock('@xyflow/react', async (original) => ({
  ...await original<typeof import('@xyflow/react')>(),
  NodeToolbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const makeNode = (type: CanvasNodeType, data: Partial<CanvasNodeData> = {}) =>
  canvasNodeFactory.createNode(type, { x: 0, y: 0 }, data);

describe('MultiSelectionActionToolbar agent references', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    await i18n.changeLanguage('zh');
    useAgentCanvasIndex.getState().setReferencedNodeIds([]);
    useAgentCanvasIndex.getState().setOriginNodeIds([]);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const render = async (nodes: CanvasNode[]) => {
    await act(async () => root.render(<MultiSelectionActionToolbar selectedNodes={nodes} />));
  };
  const buttonWithText = (label: string) => Array.from(container.querySelectorAll('button'))
    .find((button) => button.textContent === label);
  const addButton = (count: number) => buttonWithText(i18n.t('agent.toolbar.addToChatCount', { count }));
  const addedButton = () => buttonWithText(i18n.t('agent.toolbar.addedToChat'));

  it.each(['zh', 'en'])('counts only eligible images and publishes them in selection order in %s', async (language) => {
    await i18n.changeLanguage(language);
    const publish = vi.spyOn(canvasEventBus, 'publish');
    const first = makeNode(CANVAS_NODE_TYPES.exportImage, { imageUrl: '/first.png' });
    const second = makeNode(CANVAS_NODE_TYPES.upload, { previewImageUrl: '/second.jpg' });
    useAgentCanvasIndex.getState().setReferencedNodeIds([first.id]);
    await render([
      second,
      makeNode(CANVAS_NODE_TYPES.exportImage, { imageUrl: '/pending.png', isGenerating: true }),
      makeNode(CANVAS_NODE_TYPES.upload),
      makeNode(CANVAS_NODE_TYPES.exportVideo, { imageUrl: '/poster.png' }),
      first,
    ]);
    const button = addButton(2);
    expect(button?.textContent).toBe(language === 'zh' ? '加入对话 · 2' : 'Add to chat · 2');
    expect(button?.disabled).toBe(false);
    await act(async () => button!.click());
    expect(publish).toHaveBeenCalledWith('agent/add-references', { nodeIds: [second.id, first.id] });
    expect([...useAgentCanvasIndex.getState().referencedNodeIds]).toEqual([first.id]);
  });

  it('disables the action when all eligible nodes are referenced, ignoring ineligible nodes', async () => {
    const publish = vi.spyOn(canvasEventBus, 'publish');
    const node = makeNode(CANVAS_NODE_TYPES.upload, { imageUrl: '/image.png' });
    await render([node, makeNode(CANVAS_NODE_TYPES.upload)]);
    expect(addButton(1)?.disabled).toBe(false);
    await act(async () => useAgentCanvasIndex.getState().setReferencedNodeIds([node.id]));
    const button = addedButton();
    expect(button?.disabled).toBe(true);
    expect(addButton(1)).toBeUndefined();
    await act(async () => button!.click());
    expect(publish).not.toHaveBeenCalled();
    await act(async () => useAgentCanvasIndex.getState().setReferencedNodeIds([]));
    expect(addButton(1)?.disabled).toBe(false);
  });

  it('does not show agent actions when none of the selected nodes are eligible', async () => {
    await render([
      makeNode(CANVAS_NODE_TYPES.exportImage, { imageUrl: '/pending.png', isGenerating: true }),
      makeNode(CANVAS_NODE_TYPES.upload),
      makeNode(CANVAS_NODE_TYPES.exportVideo, { imageUrl: '/poster.png' }),
    ]);
    expect(addButton(0)).toBeUndefined();
    expect(addedButton()).toBeUndefined();
    expect(container.querySelector('button')).toBeNull();
  });

  it('shows the action even when the eligible image node cannot be batch downloaded', async () => {
    const publish = vi.spyOn(canvasEventBus, 'publish');
    const node = makeNode(CANVAS_NODE_TYPES.imageEdit, { previewImageUrl: '/preview.jpg' });
    expect(canAddNodeToAgentChat(node)).toBe(true);
    await render([node, makeNode(CANVAS_NODE_TYPES.textAnnotation)]);
    const button = addButton(1);
    expect(button?.textContent).toBe('加入对话 · 1');
    expect(container.querySelectorAll('button')).toHaveLength(1);
    await act(async () => button!.click());
    expect(publish).toHaveBeenCalledWith('agent/add-references', { nodeIds: [node.id] });
  });

  it('keeps the multi-selection toolbar hidden for a single node', async () => {
    await render([makeNode(CANVAS_NODE_TYPES.upload, { imageUrl: '/image.png' })]);
    expect(container.querySelector('button')).toBeNull();
  });
});
