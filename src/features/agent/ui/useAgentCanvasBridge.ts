import { useEffect } from 'react';

import { loadAgentProject } from '@/features/agent/application/agentThreadActions';
import { getAgentDraft, useAgentUiStore } from '@/features/agent/stores/agentUiStore';
import { useAgentCanvasIndex } from '@/features/canvas/application/agentCanvasIndex';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { logger } from '@/lib/logger';
import { useCanvasStore } from '@/stores/canvasStore';
import { disposeAllAgentChats } from './agentChatRegistry';
import { draftRefFromNode } from './agentDraftRefs';

/**
 * Wires the agent to the canvas without the canvas depending on it: loads the project's
 * threads, answers the toolbar's events, and mirrors drafts and origins into the canvas index.
 */
export function useAgentCanvasBridge(projectId: string | null): void {
  useEffect(() => {
    if (!projectId) return;
    void loadAgentProject(projectId).catch((error) => logger.error('failed to load agent threads', error));
    return () => disposeAllAgentChats();
  }, [projectId]);

  useEffect(() => {
    const offAdd = canvasEventBus.subscribe('agent/add-references', ({ nodeIds }) => {
      const { activeThreadId, addDraftRefs, setPanelOpen } = useAgentUiStore.getState();
      if (!activeThreadId) return;
      const nodes = useCanvasStore.getState().nodes;
      const refs = nodeIds.flatMap((nodeId) => {
        const node = nodes.find((candidate) => candidate.id === nodeId);
        return (node && draftRefFromNode(node)) || [];
      });
      addDraftRefs(activeThreadId, refs);
      setPanelOpen(true);
    });
    const offOrigin = canvasEventBus.subscribe('agent/open-origin', ({ nodeId }) => {
      const { nodeOrigins, requestFocus } = useAgentUiStore.getState();
      const origin = nodeOrigins[nodeId];
      if (origin) requestFocus(origin);
    });
    return () => { offAdd(); offOrigin(); };
  }, []);

  useEffect(() => {
    // Only publish real changes: typing in the composer must not re-render canvas toolbars.
    const sameIds = (current: ReadonlySet<string>, next: string[]) => (
      current.size === next.length && next.every((id) => current.has(id))
    );
    const sync = (state: ReturnType<typeof useAgentUiStore.getState>) => {
      const index = useAgentCanvasIndex.getState();
      const referenced = getAgentDraft(state, state.activeThreadId).refs.flatMap((ref) => ref.nodeId ?? []);
      const origins = Object.keys(state.nodeOrigins);
      if (!sameIds(index.referencedNodeIds, referenced)) index.setReferencedNodeIds(referenced);
      if (!sameIds(index.originNodeIds, origins)) index.setOriginNodeIds(origins);
    };
    sync(useAgentUiStore.getState());
    return useAgentUiStore.subscribe(sync);
  }, []);
}
