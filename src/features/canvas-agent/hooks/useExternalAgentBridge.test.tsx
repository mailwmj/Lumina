// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import { buildCanvasAgentSnapshot } from '@/features/canvas-agent/application/canvasAgentSnapshot';
import type { CanvasAgentEvent } from '@/features/canvas-agent/infrastructure/canvasAgentBridge';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useExternalAgentBridge } from './useExternalAgentBridge';

const bridgeMocks = vi.hoisted(() => ({
  callbacks: null as null | {
    onOpen: () => void;
    onEvent: (event: CanvasAgentEvent) => void;
  },
  postResult: vi.fn(),
}));

vi.mock('@/commands/canvasAgent', () => ({
  isCanvasAgentManagedByLumina: () => false,
  getCanvasAgentRuntime: vi.fn(),
}));

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({
      getCurrentProject: () => ({ id: 'project-1', name: 'Project' }),
    }),
  },
}));

vi.mock('@/features/canvas-agent/infrastructure/canvasAgentBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/canvas-agent/infrastructure/canvasAgentBridge')>();
  return {
    ...actual,
    consumeCanvasAgentEvents: vi.fn((
      _endpoint,
      _clientId,
      signal: AbortSignal,
      callbacks: typeof bridgeMocks.callbacks
    ) => {
      bridgeMocks.callbacks = callbacks;
      callbacks?.onOpen();
      return new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }),
    postCanvasProposalResult: bridgeMocks.postResult,
  };
});

vi.mock('@/features/canvas-agent/infrastructure/canvasAgentSnapshotPublisher', () => ({
  CanvasAgentSnapshotPublisher: class CanvasAgentSnapshotPublisher {
    enqueue() {}
  },
}));

function BridgeHarness() {
  const canvas = useCanvasStore();
  useExternalAgentBridge({
    projectId: 'project-1',
    projectName: 'Project',
    nodes: canvas.nodes,
    edges: canvas.edges,
    selectedNodeIds: [],
    viewport: canvas.currentViewport,
  });
  return null;
}

describe('useExternalAgentBridge direct apply', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    bridgeMocks.callbacks = null;
    bridgeMocks.postResult.mockResolvedValue(undefined);
    useSettingsStore.getState().setExternalAgentConnection({
      enabled: true,
      url: 'http://127.0.0.1:17372',
      token: 'test-token',
    });
    const node = canvasNodeFactory.createNode(
      CANVAS_NODE_TYPES.textAnnotation,
      { x: 0, y: 0 }
    );
    useCanvasStore.getState().setCanvasData([node], []);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useCanvasStore.getState().setCanvasData([], []);
    useSettingsStore.getState().setExternalAgentConnection({
      enabled: false,
      url: 'http://127.0.0.1:17372',
      token: '',
    });
    vi.unstubAllGlobals();
  });

  it('applies a valid event immediately and records one undo checkpoint', async () => {
    await act(async () => {
      root.render(<BridgeHarness />);
    });
    await vi.waitFor(() => expect(bridgeMocks.callbacks).not.toBeNull());

    const canvas = useCanvasStore.getState();
    const node = canvas.nodes[0];
    const snapshot = buildCanvasAgentSnapshot({
      projectId: 'project-1',
      projectName: 'Project',
      nodes: canvas.nodes,
      edges: canvas.edges,
      selectedNodeIds: [],
      viewport: canvas.currentViewport,
    });

    await act(async () => {
      bridgeMocks.callbacks?.onEvent({
        type: 'change_proposal',
        payload: {
          proposalId: 'proposal-1',
          createdAt: Date.now(),
          changeSet: {
            projectId: 'project-1',
            baseRevision: snapshot.revision,
            summary: 'Move the note',
            operations: [{
              type: 'move_node',
              nodeId: node.id,
              position: { x: 240, y: 160 },
            }],
          },
        },
      });
    });

    expect(useCanvasStore.getState().nodes[0]?.position).toEqual({ x: 240, y: 160 });
    expect(useCanvasStore.getState().history.past).toHaveLength(1);
    await vi.waitFor(() => expect(bridgeMocks.postResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ proposalId: 'proposal-1', status: 'applied' })
    ));
  });
});
