import { memo, useMemo } from 'react';

import { useCanvasStore } from '@/stores/canvasStore';
import { NodeActionToolbar } from './NodeActionToolbar';
import { MultiSelectionActionToolbar } from './MultiSelectionActionToolbar';

export const SelectedNodeOverlay = memo(() => {
  const nodes = useCanvasStore((state) => state.nodes);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) {
      return null;
    }

    return nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [nodes, selectedNodeId]);

  const selectedNodes = useMemo(
    () => nodes.filter((node) => Boolean(node.selected)),
    [nodes]
  );

  if (selectedNodes.length > 1) {
    return <MultiSelectionActionToolbar selectedNodes={selectedNodes} />;
  }

  if (!selectedNode) {
    return null;
  }

  return (
    <>
      <NodeActionToolbar node={selectedNode} />
    </>
  );
});

SelectedNodeOverlay.displayName = 'SelectedNodeOverlay';
