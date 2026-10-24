import type { AgentImageResult } from '@/features/agent/domain/agentTools';
import type { AgentImageState } from '@/features/agent/domain/types';
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';

const DEFAULT_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

/** The canvas node is the single source of truth for an agent image card. */
export function readAgentImageState(nodes: readonly CanvasNode[], nodeId: string): AgentImageState {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return { nodeId, status: 'missing' };
  }
  const data = node.data as Record<string, unknown>;
  // A regenerating node still holds its previous image, so check the running flag first.
  if (data.isGenerating === true) {
    return { nodeId, status: 'generating' };
  }
  if (typeof data.generationError === 'string' && data.generationError) {
    return { nodeId, status: 'failed', error: data.generationError };
  }
  if (typeof data.imageUrl === 'string' && data.imageUrl) {
    return { nodeId, status: 'ready' };
  }
  return { nodeId, status: 'generating' };
}

/**
 * Resolves once no result is generating. Stopping or timing out only ends the wait:
 * the generation jobs belong to the nodes and keep running.
 */
export function waitForImageResults(
  nodeIds: readonly string[],
  abortSignal?: AbortSignal,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
): Promise<AgentImageResult[]> {
  const read = () => nodeIds.map((nodeId) => readAgentImageState(useCanvasStore.getState().nodes, nodeId));
  const settled = (states: AgentImageState[]) => states.every((state) => state.status !== 'generating');
  const markPending = (states: AgentImageState[], status: 'stopped_waiting' | 'timeout'): AgentImageResult[] => (
    states.map((state) => (state.status === 'generating' ? { ...state, status } : state))
  );

  const initial = read();
  if (settled(initial)) {
    return Promise.resolve(initial);
  }
  if (abortSignal?.aborted) {
    return Promise.resolve(markPending(initial, 'stopped_waiting'));
  }

  return new Promise((resolve) => {
    const finish = (results: AgentImageResult[]) => {
      unsubscribe();
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);
      resolve(results);
    };
    const onAbort = () => finish(markPending(read(), 'stopped_waiting'));
    const unsubscribe = useCanvasStore.subscribe(() => {
      const states = read();
      if (settled(states)) finish(states);
    });
    const timer = setTimeout(() => finish(markPending(read(), 'timeout')), timeoutMs);
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}
