import { GenerationRecordPopover } from './GenerationRecordPopover';
import { memo, useMemo } from 'react';

import {
  selectSelectedNodeIds,
  selectWorkflowNodes,
} from '@/features/canvas/application/canvasNodeSelectors';
import { useCanvasStore } from '@/stores/canvasStore';
import { NodeActionToolbar } from './NodeActionToolbar';
import { MultiSelectionActionToolbar } from './MultiSelectionActionToolbar';
import { canShowNodeActionToolbar } from './nodeToolbarVisibility';

export const SelectedNodeOverlay = memo(() => {
  const workflowNodes = useCanvasStore(selectWorkflowNodes);
  const selectedNodeIds = useCanvasStore(selectSelectedNodeIds);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);

  const workflowNodesById = useMemo(
    () => new Map(workflowNodes.map((node) => [node.id, node] as const)),
    [workflowNodes]
  );
  const selectedNode = selectedNodeId
    ? workflowNodesById.get(selectedNodeId) ?? null
    : null;

  const selectedNodes = useMemo(
    () => selectedNodeIds.flatMap((nodeId) => {
      const node = workflowNodesById.get(nodeId);
      return node ? [node] : [];
    }),
    [selectedNodeIds, workflowNodesById]
  );

  return <>
    <GenerationRecordPopover />
    {selectedNodes.length > 1 ? <MultiSelectionActionToolbar selectedNodes={selectedNodes} />
      : selectedNode && canShowNodeActionToolbar(selectedNode) ? <NodeActionToolbar node={selectedNode} /> : null}
  </>;
});

SelectedNodeOverlay.displayName = 'SelectedNodeOverlay';
