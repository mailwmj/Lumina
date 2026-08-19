import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
} from '@/features/canvas/domain/canvasNodes';
import type { Project } from '@/stores/projectStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

const commands = vi.hoisted(() => ({
  startUpscaleJob: vi.fn(),
  getUpscaleJobStatus: vi.fn(),
  cancelUpscaleJob: vi.fn(),
}));

vi.mock('@/commands/upscale', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/commands/upscale')>();
  return {
    ...actual,
    startUpscaleJob: commands.startUpscaleJob,
    getUpscaleJobStatus: commands.getUpscaleJobStatus,
    cancelUpscaleJob: commands.cancelUpscaleJob,
  };
});

import {
  cancelUpscaleRun,
  runUpscaleNode,
} from './upscaleRun';
import { useUpscaleRuntimeStore } from './upscaleRuntimeStore';

function createProject(id: string): Project {
  return {
    id,
    name: 'Upscale test project',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: 0,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] },
  };
}

function imageEdge(source: string, target: string): CanvasEdge {
  return {
    id: `edge-${source}-${target}`,
    source,
    target,
    sourceHandle: 'source',
    targetHandle: 'target',
    data: { valueType: 'image', inputOrder: 0 },
  };
}

function createDeferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {
    promise,
    resolve: (value: T) => resolve(value),
  };
}

describe('upscale node execution', () => {
  beforeEach(() => {
    commands.startUpscaleJob.mockReset();
    commands.getUpscaleJobStatus.mockReset();
    commands.cancelUpscaleJob.mockReset();
    commands.cancelUpscaleJob.mockResolvedValue(undefined);
  });

  afterEach(() => {
    useCanvasStore.getState().setCanvasData([], []);
    useProjectStore.setState({ currentProjectId: null, currentProject: null });
    useUpscaleRuntimeStore.getState().clearAllRuntimes();
    vi.clearAllMocks();
  });

  it('creates one traceable export result and updates it on the next successful run', async () => {
    const project = createProject('project-upscale');
    useProjectStore.setState({ currentProjectId: project.id, currentProject: project });

    const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 }, {
      displayName: 'Portrait source',
      imageUrl: 'C:\\projects\\project-upscale\\uploads\\portrait.jpg',
      aspectRatio: '4:5',
    });
    const upscale = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upscale, { x: 320, y: 0 }, {
      scale: 4,
    });
    useCanvasStore.getState().setCanvasData([source, upscale], [imageEdge(source.id, upscale.id)]);

    commands.startUpscaleJob.mockResolvedValueOnce({ jobId: 'upscale-job-1' });
    commands.getUpscaleJobStatus.mockResolvedValueOnce({
      jobId: 'upscale-job-1',
      status: 'succeeded',
      progress: 1,
      resultImageUrl: 'C:\\projects\\project-upscale\\outputs\\images\\portrait-x4.png',
      previewImageUrl: null,
      aspectRatio: '4:5',
      error: null,
      errorCode: null,
    });

    await runUpscaleNode(upscale.id, { resultTitle: 'Upscaled portrait' });

    expect(commands.startUpscaleJob).toHaveBeenCalledWith({
      projectId: project.id,
      sourceImageUrl: 'C:\\projects\\project-upscale\\uploads\\portrait.jpg',
      scale: 4,
    });
    const firstResult = useCanvasStore.getState().nodes.find(
      (node) => node.type === CANVAS_NODE_TYPES.exportImage && node.data.resultKind === 'upscaleOutput'
    );
    expect(firstResult).toMatchObject({
      data: {
        displayName: 'Upscaled portrait',
        imageUrl: 'C:\\projects\\project-upscale\\outputs\\images\\portrait-x4.png',
        aspectRatio: '4:5',
        resultKind: 'upscaleOutput',
      },
    });
    expect(useCanvasStore.getState().edges).toContainEqual(expect.objectContaining({
      source: upscale.id,
      target: firstResult?.id,
    }));
    expect(useCanvasStore.getState().nodes.find((node) => node.id === source.id)?.data).toMatchObject({
      imageUrl: 'C:\\projects\\project-upscale\\uploads\\portrait.jpg',
    });

    commands.startUpscaleJob.mockResolvedValueOnce({ jobId: 'upscale-job-2' });
    commands.getUpscaleJobStatus.mockResolvedValueOnce({
      jobId: 'upscale-job-2',
      status: 'succeeded',
      progress: 1,
      resultImageUrl: 'C:\\projects\\project-upscale\\outputs\\images\\portrait-x4-v2.png',
      previewImageUrl: null,
      aspectRatio: '4:5',
      error: null,
      errorCode: null,
    });

    await runUpscaleNode(upscale.id, { resultTitle: 'Unused replacement title' });

    const results = useCanvasStore.getState().nodes.filter(
      (node) => node.type === CANVAS_NODE_TYPES.exportImage && node.data.resultKind === 'upscaleOutput'
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: firstResult?.id,
      data: {
        displayName: 'Upscaled portrait',
        imageUrl: 'C:\\projects\\project-upscale\\outputs\\images\\portrait-x4-v2.png',
      },
    });
    expect(useUpscaleRuntimeStore.getState().runtimesByNodeId[upscale.id]).toMatchObject({
      status: 'succeeded',
      resultNodeId: firstResult?.id,
    });
  });

  it('keeps cancellation out of persisted node data', async () => {
    useUpscaleRuntimeStore.getState().setRuntime('upscale-node', {
      status: 'running',
      jobId: 'upscale-job-cancel',
    });

    await cancelUpscaleRun('upscale-node');

    expect(commands.cancelUpscaleJob).toHaveBeenCalledWith('upscale-job-cancel');
    expect(useUpscaleRuntimeStore.getState().runtimesByNodeId['upscale-node']).toMatchObject({
      status: 'cancelled',
      jobId: 'upscale-job-cancel',
    });
  });

  it('discards a late successful result after its source upscale node is deleted', async () => {
    const project = createProject('project-delete-upscale');
    useProjectStore.setState({ currentProjectId: project.id, currentProject: project });
    const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 }, {
      imageUrl: 'C:\\projects\\project-delete-upscale\\uploads\\portrait.jpg',
      aspectRatio: '4:5',
    });
    const upscale = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upscale, { x: 320, y: 0 });
    useCanvasStore.getState().setCanvasData([source, upscale], [imageEdge(source.id, upscale.id)]);

    const delayedStatus = createDeferred<{
      jobId: string;
      status: 'succeeded';
      progress: number;
      resultImageUrl: string;
      previewImageUrl: null;
      aspectRatio: string;
      error: null;
      errorCode: null;
    }>();
    commands.startUpscaleJob.mockResolvedValueOnce({ jobId: 'delete-upscale-job' });
    commands.getUpscaleJobStatus.mockReturnValueOnce(delayedStatus.promise);

    const run = runUpscaleNode(upscale.id);
    await vi.waitFor(() => expect(commands.getUpscaleJobStatus).toHaveBeenCalledWith('delete-upscale-job'));
    useCanvasStore.getState().deleteNode(upscale.id);
    delayedStatus.resolve({
      jobId: 'delete-upscale-job',
      status: 'succeeded',
      progress: 1,
      resultImageUrl: 'C:\\projects\\project-delete-upscale\\outputs\\images\\portrait-x2.png',
      previewImageUrl: null,
      aspectRatio: '4:5',
      error: null,
      errorCode: null,
    });
    await run;

    expect(commands.cancelUpscaleJob).toHaveBeenCalledWith('delete-upscale-job');
    expect(useCanvasStore.getState().nodes.some((node) => node.data.resultKind === 'upscaleOutput')).toBe(false);
    expect(useUpscaleRuntimeStore.getState().runtimesByNodeId[upscale.id]).toBeUndefined();
  });

  it('discards a late successful result after switching projects', async () => {
    const project = createProject('project-switch-upscale');
    useProjectStore.setState({ currentProjectId: project.id, currentProject: project });
    const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 }, {
      imageUrl: 'C:\\projects\\project-switch-upscale\\uploads\\portrait.jpg',
      aspectRatio: '4:5',
    });
    const upscale = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upscale, { x: 320, y: 0 });
    useCanvasStore.getState().setCanvasData([source, upscale], [imageEdge(source.id, upscale.id)]);

    const delayedStatus = createDeferred<{
      jobId: string;
      status: 'succeeded';
      progress: number;
      resultImageUrl: string;
      previewImageUrl: null;
      aspectRatio: string;
      error: null;
      errorCode: null;
    }>();
    commands.startUpscaleJob.mockResolvedValueOnce({ jobId: 'switch-upscale-job' });
    commands.getUpscaleJobStatus.mockReturnValueOnce(delayedStatus.promise);

    const run = runUpscaleNode(upscale.id);
    await vi.waitFor(() => expect(commands.getUpscaleJobStatus).toHaveBeenCalledWith('switch-upscale-job'));
    const nextProject = createProject('project-after-switch');
    useProjectStore.setState({ currentProjectId: nextProject.id, currentProject: nextProject });
    delayedStatus.resolve({
      jobId: 'switch-upscale-job',
      status: 'succeeded',
      progress: 1,
      resultImageUrl: 'C:\\projects\\project-switch-upscale\\outputs\\images\\portrait-x2.png',
      previewImageUrl: null,
      aspectRatio: '4:5',
      error: null,
      errorCode: null,
    });
    await run;

    expect(commands.cancelUpscaleJob).toHaveBeenCalledWith('switch-upscale-job');
    expect(useCanvasStore.getState().nodes.some((node) => node.data.resultKind === 'upscaleOutput')).toBe(false);
    expect(useUpscaleRuntimeStore.getState().runtimesByNodeId[upscale.id]).toBeUndefined();
  });
});
