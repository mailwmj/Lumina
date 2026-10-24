import { v4 as uuidv4 } from 'uuid';

import type { AgentDraftRef } from '@/features/agent/domain/types';
import { canAddNodeToAgentChat } from '@/features/canvas/application/agentCanvasIndex';
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';

export function nodeThumbnail(node: CanvasNode | undefined): string | null {
  const data = node?.data as { previewImageUrl?: string | null; imageUrl?: string | null } | undefined;
  return data?.previewImageUrl || data?.imageUrl || null;
}

export function draftRefFromNode(node: CanvasNode, name?: string): AgentDraftRef | null {
  const thumbnail = nodeThumbnail(node);
  if (!thumbnail || !canAddNodeToAgentChat(node)) return null;
  return { id: node.id, nodeId: node.id, name: name ?? resolveNodeDisplayName(node.type, node.data), thumbnail };
}

/** Uploads stay in the draft as data URLs and become canvas nodes when the message is sent. */
export function readImageFiles(files: Iterable<File>, fallbackName: string): Promise<AgentDraftRef[]> {
  return Promise.all([...files].filter((file) => file.type.startsWith('image/')).map((file) => new Promise<AgentDraftRef>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const source = String(reader.result);
      resolve({ id: `upload-${uuidv4()}`, nodeId: null, name: file.name || fallbackName, thumbnail: source, source });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  })));
}
