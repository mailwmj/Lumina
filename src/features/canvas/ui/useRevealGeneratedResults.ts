import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';

import {
  GENERATED_RESULT_REVEAL_DURATION_MS,
  resolveGeneratedResultRevealCenter,
  type FlowRect,
} from '@/features/canvas/application/generatedResultReveal';
import { useCanvasStore } from '@/stores/canvasStore';

/** Pans, keeping the zoom, to results the source just created when they land off-screen. */
export function useRevealGeneratedResults(sourceNodeId: string) {
  const flow = useReactFlow();

  return useCallback((resultNodeIds: readonly string[]) => {
    const pane = document.querySelector(`[data-id="${sourceNodeId}"]`)?.closest('.react-flow');
    if (!pane) {
      return;
    }
    const bounds = pane.getBoundingClientRect();
    const topLeft = flow.screenToFlowPosition({ x: bounds.left, y: bounds.top });
    const bottomRight = flow.screenToFlowPosition({ x: bounds.right, y: bounds.bottom });
    const visible = {
      ...topLeft,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
    const resolveRect = (nodeId: string): FlowRect | null => {
      const internal = flow.getInternalNode(nodeId);
      if (internal?.measured.width && internal.measured.height) {
        return { ...internal.internals.positionAbsolute, ...internal.measured } as FlowRect;
      }
      // Fresh results are not mounted yet; they are top-level nodes with an explicit size.
      const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId);
      return node && typeof node.width === 'number' && typeof node.height === 'number'
        ? { ...node.position, width: node.width, height: node.height }
        : null;
    };
    const resultRects = resultNodeIds.flatMap((nodeId) => resolveRect(nodeId) ?? []);
    const center = resolveGeneratedResultRevealCenter(visible, resultRects, resolveRect(sourceNodeId));
    if (center) {
      void flow.setCenter(center.x, center.y, {
        zoom: flow.getZoom(),
        duration: GENERATED_RESULT_REVEAL_DURATION_MS,
      });
    }
  }, [flow, sourceNodeId]);
}
