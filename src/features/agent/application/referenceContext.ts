import { readAgentImageState } from '@/features/agent/application/agentImageState';
import type { AgentMessageMetadata } from '@/features/agent/domain/types';
import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';

interface ContextMessagePart {
  type: string;
  state?: string;
  output?: unknown;
}

interface ContextMessage {
  role: string;
  metadata?: unknown;
  parts: ContextMessagePart[];
}

/** Generation nodes and result nodes this thread's agent created, from its generate_image outputs. */
export function collectAgentNodeIds(messages: readonly ContextMessage[]): string[] {
  const ids = messages.flatMap((message) => message.parts).flatMap((part) => {
    if (part.type !== 'tool-generate_image' || part.state !== 'output-available') return [];
    const output = part.output as { sourceNodeIds?: string[]; results?: Array<{ nodeId: string }> };
    return [...(output.sourceNodeIds ?? []), ...(output.results ?? []).map((result) => result.nodeId)];
  });
  return [...new Set(ids)];
}

function describeNode(nodes: readonly CanvasNode[], nodeId: string): string {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return `${nodeId}: deleted by the user`;
  }
  const name = resolveNodeDisplayName(node.type, node.data);
  if (node.type === CANVAS_NODE_TYPES.imageEdit) {
    const data = node.data as { prompt?: string; model?: string };
    return `${nodeId} (${name}): generation node, model ${data.model ?? '-'}, prompt ${JSON.stringify(data.prompt ?? '')}`;
  }
  const state = readAgentImageState(nodes, nodeId);
  return `${nodeId} (${name}): ${state.status}${state.error ? ` (${state.error})` : ''}`;
}

function referenceLines(nodes: readonly CanvasNode[], metadata: AgentMessageMetadata): string[] {
  return (metadata.refs ?? []).map((ref, index) => {
    const node = nodes.find((candidate) => candidate.id === ref.nodeId);
    const name = node ? resolveNodeDisplayName(node.type, node.data) : 'deleted';
    return `图片${index + 1} = ${ref.nodeId} (${name})`;
  });
}

/**
 * Returns a copy for the model only (never persisted): every user message gets its 图片N
 * mapping, and the newest one also gets the live state of referenced and agent-made nodes,
 * so manual canvas edits since the last turn reach the model.
 */
export function withReferenceContext<M extends ContextMessage>(messages: readonly M[], nodes: readonly CanvasNode[]): M[] {
  const lastUserIndex = messages.map((message) => message.role).lastIndexOf('user');
  const agentNodeIds = collectAgentNodeIds(messages);

  return messages.map((message, index) => {
    if (message.role !== 'user') return message;
    const metadata = (message.metadata ?? {}) as AgentMessageMetadata;
    const sections: string[] = [];
    const refs = referenceLines(nodes, metadata);
    if (refs.length) {
      sections.push(`[Referenced images]\n${refs.join('\n')}`);
    }
    if (index === lastUserIndex) {
      const watched = [...new Set([...(metadata.refs ?? []).map((ref) => ref.nodeId), ...agentNodeIds])];
      if (watched.length) {
        sections.push(`[Current canvas state]\n${watched.map((nodeId) => describeNode(nodes, nodeId)).join('\n')}`);
      }
    }
    if (!sections.length) return message;
    return { ...message, parts: [...message.parts, { type: 'text', text: sections.join('\n\n') }] };
  });
}
