import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRecord } from '@/commands/projectState';
import type { CanvasNode } from './canvasStore';
import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';

const commands = vi.hoisted(() => ({
  upsertProjectRecord: vi.fn(),
  updateProjectViewportRecord: vi.fn(),
  deleteProjectRecord: vi.fn(),
  getProjectRecord: vi.fn(),
  createProjectDirs: vi.fn(),
  listProjectSummaries: vi.fn(),
  renameProjectRecord: vi.fn(),
}));
vi.mock('@/commands/projectState', () => commands);

let useProjectStore: typeof import('./projectStore').useProjectStore;
const records = new Map<string, ProjectRecord>();
const pending: Array<() => void> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function node(imageUrl: string): CanvasNode {
  return {
    ...canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 }, { imageUrl }),
    id: 'image',
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  records.clear();
  vi.stubGlobal('requestIdleCallback', (callback: () => void) => setTimeout(callback, 1200));
  commands.upsertProjectRecord.mockImplementation(async (record: ProjectRecord) => {
    records.set(record.id, record);
  });
  commands.updateProjectViewportRecord.mockImplementation(async (id: string, viewportJson: string) => {
    const record = records.get(id);
    if (record) records.set(id, { ...record, viewportJson });
  });
  commands.deleteProjectRecord.mockImplementation(async (id: string) => { records.delete(id); });
  commands.getProjectRecord.mockImplementation(async (id: string) => records.get(id) ?? null);
  commands.createProjectDirs.mockResolvedValue(undefined);
  ({ useProjectStore } = await import('./projectStore'));
});

afterEach(async () => {
  pending.splice(0).forEach((resolve) => resolve());
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function createProject() {
  const id = useProjectStore.getState().createProject('Project');
  await vi.advanceTimersByTimeAsync(0);
  return id;
}

describe('project persistence under slow storage', () => {
  it('encodes only images reachable from the persisted history and restores them', async () => {
    const id = await createProject();
    const images = Array.from({ length: 50 }, (_, index) => `data:image/png;base64,${index}-${'a'.repeat(32768)}`);
    const history = { past: images.map((url) => ({ nodes: [node(url)], edges: [] })), future: [] };
    useProjectStore.getState().saveCurrentProject([node(images[49])], [], undefined, history);
    await vi.runAllTimersAsync();
    const record = records.get(id)!;
    const payload = JSON.parse(record.historyJson);
    expect(payload.past).toHaveLength(12);
    expect(payload.imagePool).toHaveLength(12);
    expect(payload.imagePool).not.toContain(images[0]);
    expect(record.historyJson.length).toBeLessThan(450_000);
    expect(useProjectStore.getState().currentProject?.history.past).toHaveLength(50);
    useProjectStore.getState().openProject(id);
    await vi.advanceTimersByTimeAsync(0);
    const restored = useProjectStore.getState().currentProject!;
    expect(restored.nodes[0].data.imageUrl).toBe(images[49]);
    expect(restored.history.past.map((snapshot) => snapshot.nodes[0].data.imageUrl)).toEqual(images.slice(-12));
  });

  it('does not overwrite a newer viewport when a full save waits for idle time', async () => {
    const id = await createProject();
    useProjectStore.getState().saveCurrentProject([node('image.png')], []);
    await vi.advanceTimersByTimeAsync(300);
    const viewport = { x: 400, y: 200, zoom: 1.5 };
    useProjectStore.getState().saveCurrentProjectViewport(viewport);
    await vi.runAllTimersAsync();
    expect(JSON.parse(records.get(id)!.viewportJson)).toEqual(viewport);
    expect(commands.updateProjectViewportRecord).toHaveBeenCalledTimes(1);
  });

  it('waits for an older viewport write before saving a newer complete snapshot', async () => {
    const id = await createProject();
    const write = deferred<void>();
    pending.push(() => write.resolve());
    commands.updateProjectViewportRecord.mockImplementationOnce(async (projectId: string, viewportJson: string) => {
      await write.promise;
      records.set(projectId, { ...records.get(projectId)!, viewportJson });
    });
    useProjectStore.getState().saveCurrentProjectViewport({ x: 10, y: 20, zoom: 1 });
    await vi.advanceTimersByTimeAsync(300);
    const viewport = { x: 40, y: 50, zoom: 2 };
    useProjectStore.getState().saveCurrentProject([node('new.png')], [], viewport);
    await vi.advanceTimersByTimeAsync(2000);
    write.resolve();
    await vi.runAllTimersAsync();
    expect(JSON.parse(records.get(id)!.viewportJson)).toEqual(viewport);
    expect(JSON.parse(records.get(id)!.nodesJson)).toHaveLength(1);
  });

  it('completes deletion after a save takes longer than the old retry window', async () => {
    const write = deferred<void>();
    pending.push(() => write.resolve());
    commands.upsertProjectRecord.mockImplementationOnce(async (record: ProjectRecord) => {
      await write.promise;
      records.set(record.id, record);
    });
    const id = await createProject();
    useProjectStore.getState().deleteProject(id);
    await vi.advanceTimersByTimeAsync(2000);
    write.resolve();
    await vi.runAllTimersAsync();
    expect(commands.deleteProjectRecord).toHaveBeenCalledWith(id);
    expect(records.has(id)).toBe(false);
  });

  it('coalesces repeated edits and keeps viewport-only saves lightweight', async () => {
    const id = await createProject();
    commands.upsertProjectRecord.mockClear();
    for (let index = 0; index < 10; index += 1) {
      useProjectStore.getState().saveCurrentProject([node(`image-${index}.png`)], []);
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.runAllTimersAsync();
    expect(commands.upsertProjectRecord).toHaveBeenCalledTimes(1);
    expect(JSON.parse(records.get(id)!.historyJson).imagePool).toEqual(['image-9.png']);
    for (let index = 1; index <= 10; index += 1) {
      useProjectStore.getState().saveCurrentProjectViewport({ x: index, y: index, zoom: 1 });
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.runAllTimersAsync();
    expect(commands.upsertProjectRecord).toHaveBeenCalledTimes(1);
    expect(commands.updateProjectViewportRecord).toHaveBeenCalledTimes(1);
    expect(JSON.parse(records.get(id)!.viewportJson)).toEqual({ x: 10, y: 10, zoom: 1 });
  });

  it('continues saving the latest snapshot after an earlier write rejects', async () => {
    const id = await createProject();
    const write = deferred<void>();
    pending.push(() => write.resolve());
    commands.upsertProjectRecord.mockImplementationOnce(async () => {
      await write.promise;
      throw new Error('storage temporarily unavailable');
    });
    useProjectStore.getState().saveCurrentProject([node('old.png')], []);
    await vi.runAllTimersAsync();
    useProjectStore.getState().saveCurrentProject([node('latest.png')], []);
    write.resolve();
    await vi.runAllTimersAsync();
    expect(JSON.parse(records.get(id)!.historyJson).imagePool).toEqual(['latest.png']);
  });

  it('does not block saving another project behind a slow project', async () => {
    const write = deferred<void>();
    pending.push(() => write.resolve());
    commands.upsertProjectRecord.mockImplementationOnce(async () => { await write.promise; });
    await createProject();
    const secondId = await createProject();
    expect(records.has(secondId)).toBe(true);
  });

  it('deletes after an active viewport write and discards pending full saves', async () => {
    const id = await createProject();
    const write = deferred<void>();
    pending.push(() => write.resolve());
    commands.updateProjectViewportRecord.mockImplementationOnce(async () => { await write.promise; });
    useProjectStore.getState().saveCurrentProjectViewport({ x: 10, y: 20, zoom: 1 });
    await vi.advanceTimersByTimeAsync(300);
    useProjectStore.getState().saveCurrentProject([node('queued.png')], []);
    useProjectStore.getState().deleteProject(id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(commands.deleteProjectRecord).not.toHaveBeenCalled();
    write.resolve();
    await vi.runAllTimersAsync();
    expect(commands.deleteProjectRecord).toHaveBeenCalledTimes(1);
    expect(commands.upsertProjectRecord).toHaveBeenCalledTimes(1);
    expect(records.has(id)).toBe(false);
  });

  it('skips a save waiting for idle time when the project is deleted', async () => {
    const id = await createProject();
    useProjectStore.getState().saveCurrentProject([node('queued.png')], []);
    await vi.advanceTimersByTimeAsync(300);
    useProjectStore.getState().deleteProject(id);
    await vi.runAllTimersAsync();
    expect(commands.upsertProjectRecord).toHaveBeenCalledTimes(1);
    expect(commands.deleteProjectRecord).toHaveBeenCalledTimes(1);
    expect(records.has(id)).toBe(false);
  });
});

describe('project opening lifecycle', () => {
  it('ignores an old open response after the user creates a new project', async () => {
    const oldId = await createProject();
    const oldRecord = records.get(oldId)!;
    const read = deferred<ProjectRecord>();
    pending.push(() => read.resolve(oldRecord));
    commands.getProjectRecord.mockReturnValueOnce(read.promise);
    useProjectStore.getState().openProject(oldId);
    const newId = await createProject();
    read.resolve(oldRecord);
    await vi.advanceTimersByTimeAsync(0);
    expect(useProjectStore.getState().currentProjectId).toBe(newId);
  });

  it('ignores an old open response after the project is deleted', async () => {
    const id = await createProject();
    const record = records.get(id)!;
    const read = deferred<ProjectRecord>();
    pending.push(() => read.resolve(record));
    commands.getProjectRecord.mockReturnValueOnce(read.promise);
    useProjectStore.getState().openProject(id);
    useProjectStore.getState().deleteProject(id);
    read.resolve(record);
    await vi.advanceTimersByTimeAsync(0);
    expect(useProjectStore.getState().currentProjectId).toBeNull();
    expect(useProjectStore.getState().currentProject).toBeNull();
  });
});
