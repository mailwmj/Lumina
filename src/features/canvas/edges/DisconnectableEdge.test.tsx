// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Position, type EdgeProps } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore, type CanvasEdgeRoutingMode } from '@/stores/settingsStore';
import { DisconnectableEdge } from './DisconnectableEdge';

const { renderEdge } = vi.hoisted(() => ({ renderEdge: vi.fn() }));

vi.mock('@/stores/canvasStore', async () => {
  const { create } = await import('zustand');
  return { useCanvasStore: create(() => ({ nodes: [] as CanvasNode[], deleteEdge: vi.fn() })) };
});
vi.mock('@/stores/settingsStore', async () => {
  const { create } = await import('zustand');
  return {
    useSettingsStore: create(() => ({ canvasEdgeRoutingMode: 'spline' as CanvasEdgeRoutingMode })),
  };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/ui', () => ({
  UiIcon: () => null,
  UiTooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@xyflow/react', async (importOriginal) => {
  const original = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...original,
    BaseEdge: ({ path }: { path: string }) => {
      renderEdge();
      return <path data-testid="edge" d={path} />;
    },
    EdgeLabelRenderer: ({ children }: { children: ReactNode }) => children,
  };
});

const props: EdgeProps = {
  id: 'edge', source: 'source', target: 'target',
  sourceX: 0, sourceY: 0, targetX: 600, targetY: 0,
  sourcePosition: Position.Right, targetPosition: Position.Left,
};

function node(id: string, x: number, y: number): CanvasNode {
  return {
    id, type: CANVAS_NODE_TYPES.imageEdit, position: { x, y },
    measured: { width: 100, height: 100 }, data: {},
  } as CanvasNode;
}

describe('DisconnectableEdge subscriptions', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    useCanvasStore.setState({ nodes: [node('source', -100, 0), node('target', 600, 0)] });
    useSettingsStore.setState({ canvasEdgeRoutingMode: 'spline' });
    renderEdge.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const path = () => container.querySelector('[data-testid="edge"]')!.getAttribute('d');

  it.each(['spline', 'orthogonal'] as const)('ignores node position changes in %s mode', async (mode) => {
    useSettingsStore.setState({ canvasEdgeRoutingMode: mode });
    await act(async () => root.render(<svg><DisconnectableEdge {...props} /></svg>));
    const initialPath = path();
    renderEdge.mockClear();

    await act(async () => useCanvasStore.setState((state) => ({
      nodes: state.nodes.map((item) => ({ ...item, position: { x: item.position.x, y: 200 } })),
    })));

    expect(renderEdge).not.toHaveBeenCalled();
    expect(path()).toBe(initialPath);
  });

  it('subscribes to obstacles only while smart routing is enabled', async () => {
    await act(async () => root.render(<svg><DisconnectableEdge {...props} /></svg>));
    await act(async () => useSettingsStore.setState({ canvasEdgeRoutingMode: 'smartOrthogonal' }));
    const unobstructedPath = path();
    renderEdge.mockClear();

    await act(async () => useCanvasStore.setState((state) => ({
      nodes: [...state.nodes, node('obstacle', 250, -50)],
    })));
    expect(renderEdge).toHaveBeenCalledOnce();
    expect(path()).not.toBe(unobstructedPath);

    await act(async () => useCanvasStore.setState((state) => ({
      nodes: state.nodes.map((item) => item.id === 'obstacle' ? node('obstacle', 250, 300) : item),
    })));
    expect(path()).toBe(unobstructedPath);

    await act(async () => useSettingsStore.setState({ canvasEdgeRoutingMode: 'orthogonal' }));
    renderEdge.mockClear();
    await act(async () => useCanvasStore.setState((state) => ({ nodes: [...state.nodes] })));
    expect(renderEdge).not.toHaveBeenCalled();
  });

  it.each(['spline', 'orthogonal', 'smartOrthogonal'] as const)(
    'keeps selection and generation styling reactive in %s mode', async (mode) => {
      useSettingsStore.setState({ canvasEdgeRoutingMode: mode });
      await act(async () => root.render(<svg><DisconnectableEdge {...props} /></svg>));
      await act(async () => useCanvasStore.setState((state) => ({
        nodes: state.nodes.map((item) => item.id === 'source' ? { ...item, selected: true } : item),
      })));
      expect(container.querySelector('.canvas-selected-edge__flow')).not.toBeNull();

      await act(async () => useCanvasStore.setState((state) => ({
        nodes: state.nodes.map((item) => item.id === 'target'
          ? { ...item, type: CANVAS_NODE_TYPES.exportImage, data: { isGenerating: true } } as CanvasNode
          : item),
      })));
      expect(container.querySelector('.canvas-processing-edge__flow')).not.toBeNull();
      expect(container.querySelector('.canvas-selected-edge__flow')).toBeNull();

      await act(async () => useCanvasStore.setState((state) => ({
        nodes: state.nodes.map((item) => item.id === 'target'
          ? { ...item, data: { isGenerating: false } } as CanvasNode : item),
      })));
      expect(container.querySelector('.canvas-processing-edge__flow')).toBeNull();
      expect(container.querySelector('.canvas-selected-edge__flow')).not.toBeNull();
    }
  );
});
