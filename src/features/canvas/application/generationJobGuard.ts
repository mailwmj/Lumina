import { useCanvasStore } from '@/stores/canvasStore';

/** True while the node still owns `jobId`; false once it was cancelled, restarted or removed. */
export function isGenerationJobCurrent(nodeId: string, jobId: string): boolean {
  const node = useCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId);
  const data = node?.data as Record<string, unknown> | undefined;
  return data?.generationJobId === jobId && data.isGenerating === true;
}
