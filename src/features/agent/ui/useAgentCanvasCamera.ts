import { useReactFlow } from '@xyflow/react';
import { useCallback } from 'react';

import { useCanvasStore } from '@/stores/canvasStore';

const REVEAL_DELAY_MS = 180;

export function useAgentCanvasCamera() {
  const { setCenter, fitView } = useReactFlow();

  const reveal = useCallback((nodeIds: string[]) => {
    // Give React Flow time to measure freshly created nodes before framing them.
    window.setTimeout(() => {
      void fitView({ nodes: nodeIds.map((id) => ({ id })), duration: 800, padding: 0.3, maxZoom: 0.85 });
    }, REVEAL_DELAY_MS);
  }, [fitView]);

  const locate = useCallback((nodeId: string) => {
    const canvas = useCanvasStore.getState();
    const node = canvas.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    // Select through React Flow changes so the canvas selection state stays consistent.
    canvas.onNodesChange(canvas.nodes.map((item) => ({ id: item.id, type: 'select' as const, selected: item.id === nodeId })));
    canvas.setSelectedNode(nodeId);
    const width = node.measured?.width ?? node.width ?? 300;
    const height = node.measured?.height ?? node.height ?? 300;
    void setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom: 0.9, duration: 700 });
  }, [setCenter]);

  return { reveal, locate };
}
