import {
  cancelUpscaleJob,
  getUpscaleJobStatus,
  normalizeUpscaleCommandError,
  startUpscaleJob,
  type UpscaleJobStatus,
} from '@/commands/upscale';
import {
  isExportImageNode,
  isUpscaleNode,
} from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

import { resolveUpscaleInput } from './upscaleInput';
import {
  createIdleUpscaleRuntime,
  isUpscaleRuntimeActive,
  useUpscaleRuntimeStore,
  type UpscaleNodeRuntime,
  type UpscaleRuntimeErrorCode,
} from './upscaleRuntimeStore';

const UPSCALE_POLL_INTERVAL_MS = 900;

interface ActiveUpscaleRun {
  nodeId: string;
  projectId: string;
  resultTitle?: string;
  jobId: string | null;
  cancelled: boolean;
}

export interface RunUpscaleNodeOptions {
  resultTitle?: string;
}

const activeUpscaleRuns = new Map<string, ActiveUpscaleRun>();

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}

function getRuntime(nodeId: string): UpscaleNodeRuntime {
  return useUpscaleRuntimeStore.getState().runtimesByNodeId[nodeId]
    ?? createIdleUpscaleRuntime();
}

function isRunOwned(run: ActiveUpscaleRun): boolean {
  return activeUpscaleRuns.get(run.nodeId) === run;
}

function isRunCurrent(run: ActiveUpscaleRun): boolean {
  if (!isRunOwned(run) || run.cancelled) {
    return false;
  }

  const project = useProjectStore.getState().getCurrentProject();
  if (!project || project.id !== run.projectId) {
    return false;
  }

  const node = useCanvasStore.getState().nodes.find((candidate) => candidate.id === run.nodeId);
  return isUpscaleNode(node);
}

function setRuntime(run: ActiveUpscaleRun, patch: Partial<UpscaleNodeRuntime>): void {
  if (!isRunOwned(run)) {
    return;
  }
  useUpscaleRuntimeStore.getState().setRuntime(run.nodeId, patch);
}

function clearStaleRunRuntime(run: ActiveUpscaleRun): void {
  if (!isRunOwned(run) || run.cancelled) {
    return;
  }
  useUpscaleRuntimeStore.getState().clearRuntime(run.nodeId);
}

function setFailure(
  run: ActiveUpscaleRun,
  errorCode: UpscaleRuntimeErrorCode,
  error: string | null = null
): void {
  setRuntime(run, {
    status: 'failed',
    progress: null,
    phase: 'failed',
    errorCode,
    error,
  });
}

async function cancelBackendJob(jobId: string): Promise<void> {
  try {
    await cancelUpscaleJob(jobId);
  } catch {
    // A cancelled or already-finished backend job needs no further local handling.
  }
}

function findUpscaleResultNodeId(upscaleNodeId: string): string | null {
  const canvas = useCanvasStore.getState();
  for (const edge of canvas.edges) {
    if (edge.source !== upscaleNodeId) {
      continue;
    }
    const targetNode = canvas.nodes.find((node) => node.id === edge.target);
    if (targetNode && isExportImageNode(targetNode) && targetNode.data.resultKind === 'upscaleOutput') {
      return targetNode.id;
    }
  }
  return null;
}

function materializeUpscaleResult(
  run: ActiveUpscaleRun,
  status: UpscaleJobStatus,
  inputAspectRatio: string
): string | null {
  const resultImageUrl = status.resultImageUrl?.trim();
  if (!resultImageUrl) {
    return null;
  }

  const canvas = useCanvasStore.getState();
  const resultNodeId = findUpscaleResultNodeId(run.nodeId);
  const resultData = {
    imageUrl: resultImageUrl,
    previewImageUrl: status.previewImageUrl ?? null,
    aspectRatio: status.aspectRatio ?? inputAspectRatio,
    resultKind: 'upscaleOutput' as const,
  };

  if (resultNodeId) {
    canvas.updateNodeData(resultNodeId, resultData);
    return resultNodeId;
  }

  const createdNodeId = canvas.addDerivedExportNode(
    run.nodeId,
    resultData.imageUrl,
    resultData.aspectRatio,
    resultData.previewImageUrl ?? undefined,
    {
      defaultTitle: run.resultTitle,
      resultKind: resultData.resultKind,
      sizeStrategy: 'generated',
    }
  );
  if (!createdNodeId) {
    return null;
  }

  canvas.addEdge(run.nodeId, createdNodeId);
  return createdNodeId;
}

async function pollUpscaleJob(
  run: ActiveUpscaleRun,
  inputAspectRatio: string
): Promise<void> {
  while (true) {
    if (!isRunCurrent(run)) {
      if (!run.cancelled && run.jobId) {
        await cancelBackendJob(run.jobId);
        clearStaleRunRuntime(run);
      }
      return;
    }

    const jobId = run.jobId;
    if (!jobId) {
      setFailure(run, 'INVALID_RESPONSE');
      return;
    }

    let status: UpscaleJobStatus;
    try {
      status = await getUpscaleJobStatus(jobId);
    } catch (error) {
      if (!isRunCurrent(run)) {
        if (!run.cancelled) {
          await cancelBackendJob(jobId);
          clearStaleRunRuntime(run);
        }
        return;
      }
      const commandError = normalizeUpscaleCommandError(error);
      setFailure(run, commandError.code, commandError.message);
      return;
    }

    if (!isRunCurrent(run)) {
      if (!run.cancelled) {
        await cancelBackendJob(jobId);
        clearStaleRunRuntime(run);
      }
      return;
    }

    if (status.status === 'queued' || status.status === 'running') {
      setRuntime(run, {
        status: status.status,
        progress: status.progress,
        phase: status.phase,
        errorCode: null,
        error: null,
      });
      await sleep(UPSCALE_POLL_INTERVAL_MS);
      continue;
    }

    if (status.status === 'succeeded') {
      const resultNodeId = materializeUpscaleResult(run, status, inputAspectRatio);
      if (!resultNodeId) {
        setFailure(run, 'RESULT_UNAVAILABLE');
        return;
      }
      setRuntime(run, {
        status: 'succeeded',
        progress: status.progress,
        phase: 'completed',
        errorCode: null,
        error: null,
        resultNodeId,
      });
      return;
    }

    if (status.status === 'cancelled') {
      setRuntime(run, {
        status: 'cancelled',
        progress: null,
        phase: 'cancelled',
        errorCode: null,
        error: null,
      });
      return;
    }

    if (status.status === 'not_found') {
      setFailure(run, 'JOB_NOT_FOUND', status.error);
      return;
    }

    setFailure(run, status.errorCode ?? 'UNKNOWN', status.error);
    return;
  }
}

export async function runUpscaleNode(
  nodeId: string,
  options: RunUpscaleNodeOptions = {}
): Promise<void> {
  const currentRuntime = getRuntime(nodeId);
  if (activeUpscaleRuns.has(nodeId) || isUpscaleRuntimeActive(currentRuntime.status)) {
    return;
  }

  const canvas = useCanvasStore.getState();
  const sourceNode = canvas.nodes.find((node) => node.id === nodeId);
  if (!isUpscaleNode(sourceNode)) {
    useUpscaleRuntimeStore.getState().setRuntime(nodeId, {
      status: 'failed',
      phase: 'failed',
      errorCode: 'NODE_NOT_FOUND',
      error: null,
    });
    return;
  }

  const project = useProjectStore.getState().getCurrentProject();
  if (!project) {
    useUpscaleRuntimeStore.getState().setRuntime(nodeId, {
      status: 'failed',
      phase: 'failed',
      errorCode: 'PROJECT_REQUIRED',
      error: null,
    });
    return;
  }

  const input = resolveUpscaleInput(nodeId, canvas.nodes, canvas.edges);
  if (!input.ok) {
    useUpscaleRuntimeStore.getState().setRuntime(nodeId, {
      status: 'failed',
      phase: 'failed',
      errorCode: input.code,
      error: null,
    });
    return;
  }

  const run: ActiveUpscaleRun = {
    nodeId,
    projectId: project.id,
    resultTitle: options.resultTitle,
    jobId: null,
    cancelled: false,
  };
  activeUpscaleRuns.set(nodeId, run);
  setRuntime(run, {
    status: 'starting',
    jobId: null,
    progress: null,
    phase: 'starting',
    errorCode: null,
    error: null,
  });

  try {
    const started = await startUpscaleJob({
      projectId: project.id,
      sourceImageUrl: input.sourceImageUrl,
      scale: sourceNode.data.scale,
    });
    run.jobId = started.jobId;

    if (!isRunCurrent(run)) {
      await cancelBackendJob(started.jobId);
      clearStaleRunRuntime(run);
      return;
    }

    setRuntime(run, {
      status: 'queued',
      jobId: started.jobId,
      progress: null,
      phase: 'queued',
      errorCode: null,
      error: null,
    });
    await pollUpscaleJob(run, input.aspectRatio);
  } catch (error) {
    if (run.cancelled || !isRunOwned(run)) {
      return;
    }
    if (!isRunCurrent(run)) {
      if (run.jobId) {
        await cancelBackendJob(run.jobId);
      }
      clearStaleRunRuntime(run);
      return;
    }
    const commandError = normalizeUpscaleCommandError(error);
    setFailure(run, commandError.code, commandError.message);
  } finally {
    if (isRunOwned(run)) {
      activeUpscaleRuns.delete(nodeId);
    }
  }
}

export async function cancelUpscaleRun(nodeId: string): Promise<void> {
  const run = activeUpscaleRuns.get(nodeId);
  const runtime = getRuntime(nodeId);
  const jobId = run?.jobId ?? runtime.jobId;

  if (!run && !jobId) {
    return;
  }

  if (run) {
    run.cancelled = true;
  }
  useUpscaleRuntimeStore.getState().setRuntime(nodeId, {
    status: 'cancelling',
    phase: 'cancelling',
    errorCode: null,
    error: null,
  });

  if (jobId) {
    try {
      await cancelUpscaleJob(jobId);
    } catch (error) {
      const commandError = normalizeUpscaleCommandError(error);
      useUpscaleRuntimeStore.getState().setRuntime(nodeId, {
        status: 'failed',
        phase: 'failed',
        errorCode: commandError.code,
        error: commandError.message,
      });
      return;
    }
  }

  if (run && activeUpscaleRuns.get(nodeId) === run) {
    activeUpscaleRuns.delete(nodeId);
  }
  useUpscaleRuntimeStore.getState().setRuntime(nodeId, {
    status: 'cancelled',
    progress: null,
    phase: 'cancelled',
    errorCode: null,
    error: null,
  });
}

export async function cancelAllUpscaleRuns(): Promise<void> {
  const nodeIds = [...activeUpscaleRuns.keys()];
  await Promise.all(nodeIds.map((nodeId) => cancelUpscaleRun(nodeId)));
  useUpscaleRuntimeStore.getState().clearAllRuntimes();
}
