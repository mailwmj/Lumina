import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from './canvasStore';
import { sanitizeProjectNodesForPersistence, useProjectStore } from './projectStore';

describe('text generation project persistence', () => {
  it('keeps durable text data and removes runtime run state', () => {
    const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.textGeneration, { x: 0, y: 0 }, {
      inputText: 'input',
      generatedText: 'result',
      textApiId: 'provider-a',
      textModelId: 'model-a',
      isGenerating: true,
      generationError: 'temporary error',
      generationErrorDetails: 'temporary details',
    });

    const [sanitized] = sanitizeProjectNodesForPersistence([node]);

    expect(sanitized.data).toMatchObject({
      inputText: 'input',
      generatedText: 'result',
      textApiId: 'provider-a',
      textModelId: 'model-a',
    });
    expect(sanitized.data).not.toHaveProperty('isGenerating');
    expect(sanitized.data).not.toHaveProperty('generationError');
    expect(sanitized.data).not.toHaveProperty('generationErrorDetails');
  });
});

const persistence = vi.hoisted(() => ({ upsert: vi.fn(), viewport: vi.fn() }));
vi.mock('@/commands/projectState', () => ({
  upsertProjectRecord: persistence.upsert,
  updateProjectViewportRecord: persistence.viewport,
  createProjectDirs: vi.fn().mockResolvedValue(undefined),
}));

describe('project save failure visibility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    persistence.upsert.mockReset().mockResolvedValue(undefined);
    persistence.viewport.mockReset().mockResolvedValue(undefined);
    useProjectStore.setState({ currentProjectId: null, currentProject: null, persistError: null, projects: [] });
  });
  afterEach(async () => {
    await vi.runAllTimersAsync();
    vi.useRealTimers();
  });

  it('records a failed full save and clears it after an immediate retry succeeds', async () => {
    persistence.upsert.mockRejectedValueOnce(new Error('disk full'));
    const projectId = useProjectStore.getState().createProject('A');
    await vi.advanceTimersByTimeAsync(0);
    expect(useProjectStore.getState().persistError).toEqual({ projectId, message: 'disk full' });
    useProjectStore.getState().retryCurrentProjectPersist();
    expect(persistence.upsert).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(useProjectStore.getState().persistError).toBeNull();
  });

  it('retries the latest canvas snapshot immediately even with a debounced save pending', async () => {
    useProjectStore.getState().createProject('A');
    await vi.advanceTimersByTimeAsync(0);
    const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.imageEdit, { x: 10, y: 20 }, { prompt: 'Latest change' });
    useCanvasStore.getState().setCanvasData([node], []);
    useProjectStore.getState().saveCurrentProject([node], []);
    expect(persistence.upsert).toHaveBeenCalledTimes(1);
    useProjectStore.getState().retryCurrentProjectPersist();
    expect(persistence.upsert).toHaveBeenCalledTimes(2);
    const record = persistence.upsert.mock.calls[1][0];
    expect(JSON.parse(record.nodesJson)[0].data.prompt).toBe('Latest change');
    await vi.advanceTimersByTimeAsync(0);
    useCanvasStore.getState().setCanvasData([], []);
  });

  it('does not show a previous project failure after switching projects', async () => {
    persistence.upsert.mockRejectedValueOnce(new Error('A failed'));
    useProjectStore.getState().createProject('A');
    await vi.advanceTimersByTimeAsync(0);
    expect(useProjectStore.getState().persistError).not.toBeNull();
    useProjectStore.getState().createProject('B');
    expect(useProjectStore.getState().persistError).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(useProjectStore.getState().persistError).toBeNull();
  });

  it('ignores late failures from another project and does not clear its current failure on another project success', async () => {
    let rejectA!: (error: Error) => void;
    persistence.upsert.mockImplementationOnce(() => new Promise((_, reject) => { rejectA = reject; }));
    useProjectStore.getState().createProject('A');
    persistence.upsert.mockRejectedValueOnce(new Error('B failed'));
    const projectB = useProjectStore.getState().createProject('B');
    await vi.advanceTimersByTimeAsync(0);
    rejectA(new Error('A late failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect(useProjectStore.getState().persistError).toEqual({ projectId: projectB, message: 'B failed' });

    let resolveC!: () => void;
    persistence.upsert.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveC = resolve; }));
    useProjectStore.getState().createProject('C');
    persistence.upsert.mockRejectedValueOnce(new Error('D failed'));
    const projectD = useProjectStore.getState().createProject('D');
    await vi.advanceTimersByTimeAsync(0);
    resolveC();
    await vi.advanceTimersByTimeAsync(0);
    expect(useProjectStore.getState().persistError).toEqual({ projectId: projectD, message: 'D failed' });
  });

  it('clears failure on close and ignores the closing save failure', async () => {
    persistence.upsert.mockRejectedValue(new Error('disk full'));
    useProjectStore.getState().createProject('A');
    await vi.advanceTimersByTimeAsync(0);
    useProjectStore.getState().closeProject();
    expect(useProjectStore.getState().persistError).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(useProjectStore.getState().persistError).toBeNull();
  });

  it('persists a raw thumbnail and updates the summary immediately on save and close', async () => {
    const id = useProjectStore.getState().createProject('Thumbnail project');
    await vi.advanceTimersByTimeAsync(0);
    const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, { x: 0, y: 0 }, {
      imageUrl: '/original.png', previewImageUrl: '/preview.jpg',
    });
    useCanvasStore.getState().setCanvasData([node], []);
    useProjectStore.getState().saveCurrentProject([node], []);
    expect(useProjectStore.getState().projects.find((project) => project.id === id)?.thumbnailUrl).toBe('/preview.jpg');
    await vi.runAllTimersAsync();
    const record = persistence.upsert.mock.calls[persistence.upsert.mock.calls.length - 1][0];
    expect(record.thumbnailUrl).toBe('/preview.jpg');
    expect(JSON.parse(record.nodesJson)[0].data.previewImageUrl).toMatch(/^__img_ref__:/);
    const uploaded = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 }, { imageUrl: '/closing.png' });
    useCanvasStore.getState().setCanvasData([uploaded], []);
    useProjectStore.getState().closeProject();
    expect(useProjectStore.getState().projects.find((project) => project.id === id)?.thumbnailUrl).toBe('/closing.png');
    await vi.runAllTimersAsync();
    expect(persistence.upsert.mock.calls[persistence.upsert.mock.calls.length - 1][0].thumbnailUrl).toBe('/closing.png');
    useCanvasStore.getState().setCanvasData([], []);
  });

  it('keeps viewport failures silent', async () => {
    useProjectStore.getState().createProject('A');
    await vi.advanceTimersByTimeAsync(0);
    persistence.viewport.mockRejectedValueOnce(new Error('viewport failed'));
    useProjectStore.getState().saveCurrentProjectViewport({ x: 20, y: 30, zoom: 1 });
    await vi.runAllTimersAsync();
    expect(persistence.viewport).toHaveBeenCalledOnce();
    expect(useProjectStore.getState().persistError).toBeNull();
  });
});
