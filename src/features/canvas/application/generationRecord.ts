import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { isExportImageNode } from '../domain/canvasNodes';
import { listConfiguredImageModels } from '../models';
import { findImageGenerationSource } from './imageGenerationRetry';
import { locateReferencedNode, type ReferencedNodeLocator } from './referencedNodeLocation';

export { buildGenerationRecord } from './generationRecordSnapshot';

export type RestoreGenerationRecordResult =
  | { status: 'restored'; sourceNodeId: string; modelRestored: boolean }
  | { status: 'source-missing' | 'record-missing' };

export function restoreGenerationRecord(resultNodeId: string, locator?: ReferencedNodeLocator): RestoreGenerationRecordResult {
  const state = useCanvasStore.getState();
  const result = state.nodes.find((node) => node.id === resultNodeId);
  const record = result && isExportImageNode(result) ? result.data.generationRecord : undefined;
  if (!record) return { status: 'record-missing' };
  const sourceNodeId = findImageGenerationSource(resultNodeId, state.nodes, state.edges);
  if (!sourceNodeId) return { status: 'source-missing' };
  const modelRestored = listConfiguredImageModels(useSettingsStore.getState()).some((model) => model.id === record.modelId);
  state.updateNodeData(sourceNodeId, {
    prompt: record.prompt, ...(modelRestored ? { model: record.modelId } : {}),
    size: record.size, requestAspectRatio: record.requestAspectRatio,
    outputCount: record.outputCount, extraParams: structuredClone(record.extraParams),
  });
  state.onNodesChange(useCanvasStore.getState().nodes.map((node) => ({
    id: node.id, type: 'select', selected: node.id === sourceNodeId,
  })));
  state.setSelectedNode(sourceNodeId);
  if (locator) void locateReferencedNode(sourceNodeId, locator);
  return { status: 'restored', sourceNodeId, modelRestored };
}
