import type { Connection } from '@xyflow/react';

import {
  CANVAS_NODE_TYPES,
  type CanvasDataType,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeType,
} from '../domain/canvasNodes';
import {
  getNodeSourceDataTypes,
  getNodeTargetDataTypes,
  nodeHasSourceHandle,
  nodeHasTargetHandle,
} from '../domain/nodeRegistry';

export interface BatchConnectionPlan {
  connections: Connection[];
  skippedDuplicateCount: number;
  invalidSourceIds: string[];
}

type CanvasConnectionLike = {
  source?: string | null;
  target?: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export function canNodeTypeBeManualConnectionSource(type: CanvasNodeType): boolean {
  return (
    type === CANVAS_NODE_TYPES.upload ||
    type === CANVAS_NODE_TYPES.audioUpload ||
    type === CANVAS_NODE_TYPES.videoUpload ||
    type === CANVAS_NODE_TYPES.audioUploadRef ||
    type === CANVAS_NODE_TYPES.videoUploadRef ||
    type === CANVAS_NODE_TYPES.exportImage ||
    type === CANVAS_NODE_TYPES.textGeneration ||
    type === CANVAS_NODE_TYPES.imageEdit ||
    type === CANVAS_NODE_TYPES.videoFrame ||
    type === CANVAS_NODE_TYPES.videoSingle
  );
}

export function inferCanvasConnectionValueType(sourceNode: CanvasNode): CanvasDataType | null {
  const sourceTypes = getNodeSourceDataTypes(sourceNode.type);
  return sourceTypes.length === 1 ? sourceTypes[0] : null;
}

function wouldCreateDirectedCycle(sourceId: string, targetId: string, edges: CanvasEdge[]): boolean {
  const targetsBySource = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = targetsBySource.get(edge.source) ?? [];
    targets.push(edge.target);
    targetsBySource.set(edge.source, targets);
  }

  const pending = [targetId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    if (current === sourceId) {
      return true;
    }
    visited.add(current);
    pending.push(...(targetsBySource.get(current) ?? []));
  }
  return false;
}

export function canNodeBeManualConnectionSource(
  nodeId: string | null | undefined,
  nodes: CanvasNode[]
): boolean {
  if (!nodeId) {
    return false;
  }
  const node = nodes.find((item) => item.id === nodeId);
  return node ? canNodeTypeBeManualConnectionSource(node.type) : false;
}

function isAudioSource(node: CanvasNode): boolean {
  return (
    node.type === CANVAS_NODE_TYPES.audioUpload ||
    node.type === CANVAS_NODE_TYPES.audioUploadRef
  );
}

function isVideoSource(node: CanvasNode): boolean {
  return (
    node.type === CANVAS_NODE_TYPES.videoUpload ||
    node.type === CANVAS_NODE_TYPES.videoUploadRef
  );
}

function resolveBatchTargetHandle(
  sourceNode: CanvasNode,
  targetNode: CanvasNode,
  explicitTargetHandle?: string
): string | null {
  if (explicitTargetHandle) {
    return explicitTargetHandle;
  }

  if (targetNode.type === CANVAS_NODE_TYPES.videoFrame) {
    return null;
  }

  if (targetNode.type === CANVAS_NODE_TYPES.sd2VideoGen) {
    if (isAudioSource(sourceNode)) {
      return 'target-audios';
    }
    if (isVideoSource(sourceNode)) {
      return 'target-videos';
    }
    return 'target-images';
  }

  return 'target';
}

export function isCanvasConnectionValid(
  connection: CanvasConnectionLike,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): boolean {
  const sourceId = connection.source;
  const targetId = connection.target;

  if (!sourceId || !targetId || sourceId === targetId) {
    return false;
  }

  if (!canNodeBeManualConnectionSource(sourceId, nodes)) {
    return false;
  }

  const sourceNode = nodes.find((node) => node.id === sourceId);
  const targetNode = nodes.find((node) => node.id === targetId);
  if (
    !sourceNode ||
    !targetNode ||
    !nodeHasSourceHandle(sourceNode.type) ||
    !nodeHasTargetHandle(targetNode.type)
  ) {
    return false;
  }

  if (wouldCreateDirectedCycle(sourceId, targetId, edges)) {
    return false;
  }

  if (edges.some((edge) => edge.source === sourceId && edge.target === targetId)) {
    return false;
  }

  const valueType = inferCanvasConnectionValueType(sourceNode);
  if (!valueType || !getNodeTargetDataTypes(targetNode.type).includes(valueType)) {
    return false;
  }

  if (targetNode.type === CANVAS_NODE_TYPES.textGeneration && valueType === 'image') {
    const imageInputCount = edges.filter((edge) => {
      if (edge.target !== targetId) {
        return false;
      }
      if (edge.data?.valueType) {
        return edge.data.valueType === 'image';
      }
      const existingSource = nodes.find((node) => node.id === edge.source);
      return existingSource ? inferCanvasConnectionValueType(existingSource) === 'image' : false;
    }).length;
    if (imageInputCount >= 10) {
      return false;
    }
  }

  const sourceIsAudioUpload = isAudioSource(sourceNode);
  const sourceIsVideoUpload = isVideoSource(sourceNode);

  if ((sourceIsAudioUpload || sourceIsVideoUpload) && targetNode.type !== CANVAS_NODE_TYPES.sd2VideoGen) {
    return false;
  }

  if (targetNode.type === CANVAS_NODE_TYPES.sd2VideoGen) {
    const mode = ((targetNode.data as { generationMode?: string }).generationMode ?? 'multimodal') as
      'multimodal' | 'edit' | 'extend' | 'websearch';
    const targetHandle = connection.targetHandle ?? 'target-images';
    const limits: Record<
      'multimodal' | 'edit' | 'extend' | 'websearch',
      { images: number; audios: number; videos: number }
    > = {
      multimodal: { images: 9, audios: 3, videos: 3 },
      edit: { images: 9, audios: 0, videos: 1 },
      extend: { images: 0, audios: 0, videos: 3 },
      websearch: { images: 0, audios: 0, videos: 0 },
    };
    const modeLimit = limits[mode];

    if (sourceNode.type === CANVAS_NODE_TYPES.upload) {
      if (targetHandle !== 'target-images' || modeLimit.images <= 0) {
        return false;
      }
      const count = edges.filter(
        (edge) =>
          edge.target === targetId &&
          (edge.targetHandle ?? 'target-images') === 'target-images'
      ).length;
      return count < modeLimit.images;
    }

    if (sourceIsAudioUpload) {
      if (targetHandle !== 'target-audios' || modeLimit.audios <= 0) {
        return false;
      }
      const count = edges.filter(
        (edge) => edge.target === targetId && (edge.targetHandle ?? '') === 'target-audios'
      ).length;
      return count < modeLimit.audios;
    }

    if (sourceIsVideoUpload) {
      if (targetHandle !== 'target-videos' || modeLimit.videos <= 0) {
        return false;
      }
      const count = edges.filter(
        (edge) => edge.target === targetId && (edge.targetHandle ?? '') === 'target-videos'
      ).length;
      return count < modeLimit.videos;
    }

    return false;
  }

  if (targetNode.type === CANVAS_NODE_TYPES.videoFrame) {
    const targetHandle = connection.targetHandle;
    if (targetHandle !== 'target-first' && targetHandle !== 'target-last') {
      return false;
    }
  }

  return true;
}

function connectionAlreadyExists(connection: Connection, edges: CanvasEdge[]): boolean {
  return edges.some(
    (edge) =>
      edge.source === connection.source &&
      edge.target === connection.target &&
      (edge.sourceHandle ?? 'source') === (connection.sourceHandle ?? 'source') &&
      (edge.targetHandle ?? 'target') === (connection.targetHandle ?? 'target')
  );
}

export function buildBatchConnectionPlan(
  sourceNodeIds: string[],
  targetNodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  explicitTargetHandle?: string
): BatchConnectionPlan {
  const targetNode = nodes.find((node) => node.id === targetNodeId);
  if (!targetNode) {
    return {
      connections: [],
      skippedDuplicateCount: 0,
      invalidSourceIds: [...new Set(sourceNodeIds)],
    };
  }

  const uniqueSourceIds = [...new Set(sourceNodeIds)].filter((sourceId) => sourceId !== targetNodeId);
  if (targetNode.type === CANVAS_NODE_TYPES.videoFrame && uniqueSourceIds.length > 1) {
    return {
      connections: [],
      skippedDuplicateCount: 0,
      invalidSourceIds: uniqueSourceIds,
    };
  }

  const connections: Connection[] = [];
  const invalidSourceIds: string[] = [];
  let skippedDuplicateCount = 0;
  let simulatedEdges = [...edges];

  for (const sourceId of uniqueSourceIds) {
    const sourceNode = nodes.find((node) => node.id === sourceId);
    if (!sourceNode) {
      invalidSourceIds.push(sourceId);
      continue;
    }

    const targetHandle = resolveBatchTargetHandle(
      sourceNode,
      targetNode,
      explicitTargetHandle
    );
    if (!targetHandle) {
      invalidSourceIds.push(sourceId);
      continue;
    }

    const connection: Connection = {
      source: sourceId,
      target: targetNodeId,
      sourceHandle: 'source',
      targetHandle,
    };

    if (connectionAlreadyExists(connection, simulatedEdges)) {
      skippedDuplicateCount += 1;
      continue;
    }

    if (!isCanvasConnectionValid(connection, nodes, simulatedEdges)) {
      invalidSourceIds.push(sourceId);
      continue;
    }

    connections.push(connection);
    simulatedEdges = [
      ...simulatedEdges,
      {
        ...connection,
        id: `batch-preview-${sourceId}-${targetNodeId}-${targetHandle}`,
        type: 'disconnectableEdge',
      },
    ];
  }

  return { connections, skippedDuplicateCount, invalidSourceIds };
}
