import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Instrument the real snapshot builder in the test server only.
const server = await createServer({
  plugins: [{
    name: 'count-drag-snapshots', enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/application/canvasAgentSnapshot.ts')) {
        assert(code.includes('  const selectedIds = new Set(selectedNodeIds);'), 'snapshot instrumentation must match the real builder');
        return code.replace('  const selectedIds = new Set(selectedNodeIds);',
          '  globalThis.__dragSnapshotBuilds = (globalThis.__dragSnapshotBuilds ?? 0) + 1;\n  const selectedIds = new Set(selectedNodeIds);');
      }
    },
  }],
  server: { host: '127.0.0.1', port: 1438, strictPort: true, open: false },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const report = { browser: browser.version(), mode: 'Vite development, headless Chromium, synthetic images', scenes: [], checks: {} };
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const position = id => page.evaluate(id => window.canvasBench.data().find(n => n.id === id).position, id);
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)] };
};
async function startDrag(id) {
  const box = await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  assert(box, `node ${id} must be visible`);
  const pointer = { x: box.x + 50, y: box.y + 40 };
  await page.mouse.move(pointer.x, pointer.y);
  await page.mouse.down();
  // React Flow establishes the drag origin when its movement threshold is crossed.
  await page.mouse.move(pointer.x + 4, pointer.y + 4);
  await settle();
  return { x: pointer.x + 4, y: pointer.y + 4 };
}
try {
  await page.goto('http://127.0.0.1:1438/scripts/canvas-benchmark/index.html');
  await page.waitForFunction(() => Boolean(window.canvasBench));
  await page.evaluate(async () => {
    const { useCanvasStore } = await import('/src/stores/canvasStore.ts');
    const { useSettingsStore } = await import('/src/stores/settingsStore.ts');
    window.dragCheck = { canvas: useCanvasStore, settings: useSettingsStore };
    useSettingsStore.getState().setExternalAgentConnection({ enabled: false, url: '', token: '' });
    useSettingsStore.getState().setSnapToGridEnabled(false);
  });
  for (const count of [50, 100, 300]) {
    await page.evaluate(n => window.canvasBench.seed(n), count);
    await page.waitForTimeout(500);
    const pointer = await startDrag('n2');
    await page.mouse.move(pointer.x + 20, pointer.y + 20);
    await settle();
    const initial = await position('n2');
    await page.evaluate(() => {
      window.__dragSnapshotBuilds = 0;
      window.canvasBench.reset();
      window.dragFrames = [];
      window.dragSampling = true;
      let previous;
      function sample(t) {
        if (previous) window.dragFrames.push(t - previous);
        previous = t;
        if (window.dragSampling) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    for (let i = 1; i <= 60; i++) {
      await page.mouse.move(pointer.x + 20 + i * 2, pointer.y + 20 + i);
      const current = await position('n2');
      assert(Math.abs(current.x - initial.x - i * 2) < 1, `horizontal drag must follow pointer: count=${count}, sample=${i}, initial=${JSON.stringify(initial)}, current=${JSON.stringify(current)}`);
      assert(Math.abs(current.y - initial.y - i) < 1, `vertical drag must follow pointer: count=${count}, sample=${i}, initial=${JSON.stringify(initial)}, current=${JSON.stringify(current)}`);
    }
    const result = await page.evaluate(() => {
      window.dragSampling = false;
      return { frames: window.dragFrames, builds: window.__dragSnapshotBuilds,
        metrics: window.canvasBench.metrics.getCanvasPerformanceSnapshot() };
    });
    await page.mouse.up();
    assert.equal(result.builds, 0, 'disabled Agent must do no snapshot work during drag');
    const otherNodes = Object.keys(result.metrics).filter(key => key.startsWith('node:') && key !== 'node:n2');
    assert.deepEqual(otherNodes, [], 'unrelated node content must not rerender during drag');
    report.scenes.push({ count, pointerSamples: 60, snapshotBuilds: result.builds, unrelatedNodeRenders: otherNodes.length, dragFrameMs: stats(result.frames) });
  }

  async function seedPair({ distant = false, grid = false, multi = false } = {}) {
    await page.evaluate(async ({ distant, grid, multi }) => {
      const { canvasNodeFactory } = await import('/src/features/canvas/application/canvasServices.ts');
      const { CANVAS_NODE_TYPES } = await import('/src/features/canvas/domain/canvasNodes.ts');
      const nodes = ['moving', 'target'].map((id, i) => ({
        ...canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, { x: i ? 450 : 100, y: i && distant ? 100000 : 100 }),
        id, selected: multi,
      }));
      window.dragCheck.settings.getState().setSnapToGridEnabled(grid);
      window.dragCheck.settings.getState().setSnapGridSize(20);
      window.dragCheck.canvas.getState().setCanvasData(nodes, []);
      await window.canvasBench.zoom(1);
    }, { distant, grid, multi });
    await page.waitForTimeout(300);
  }

  await seedPair();
  let pointer = await startDrag('moving');
  await page.mouse.move(pointer.x + 346, pointer.y, { steps: 30 });
  assert.equal((await position('moving')).x, 446, 'nearby alignment must not resist an active drag');
  const historyBeforeDrop = await page.evaluate(() => window.dragCheck.canvas.getState().history.past.length);
  await page.mouse.up(); await settle();
  assert.equal((await position('moving')).x, 450, 'drop should gently align to nearby node');
  assert.equal(await page.evaluate(() => window.dragCheck.canvas.getState().history.past.length), historyBeforeDrop + 1);
  await page.evaluate(() => window.dragCheck.canvas.getState().undo());
  assert.equal((await position('moving')).x, 100, 'one undo restores the pre-drag position');
  await page.evaluate(() => window.dragCheck.canvas.getState().redo());
  assert.equal((await position('moving')).x, 450, 'redo restores the aligned final position');
  report.checks.dropAlignmentAndUndo = true;

  await seedPair({ distant: true });
  pointer = await startDrag('moving');
  await page.mouse.move(pointer.x + 346, pointer.y, { steps: 30 });
  await page.mouse.up(); await settle();
  assert.equal((await position('moving')).x, 446, 'distant offscreen nodes must not attract a drop');
  report.checks.distantNodesIgnored = true;

  await seedPair({ grid: true });
  pointer = await startDrag('moving');
  await page.mouse.move(pointer.x + 346, pointer.y, { steps: 30 });
  await page.mouse.up(); await settle();
  assert.equal((await position('moving')).x % 20, 0, 'node alignment must not override the grid');
  report.checks.gridPreserved = true;

  await seedPair({ multi: true });
  pointer = await startDrag('moving');
  await page.mouse.move(pointer.x + 24, pointer.y + 4, { steps: 10 });
  await page.mouse.up(); await settle();
  const a = await position('moving'), b = await position('target');
  assert.equal(a.x, 124);
  assert.equal(b.x - a.x, 350);
  assert.equal(b.y - a.y, 0);
  report.checks.multiSelectionPreserved = true;
  assert.deepEqual(errors, []);
  report.checks.browserErrors = errors;
  const output = new URL('../docs/performance/canvas-drag-check.json', import.meta.url);
  await mkdir(new URL('.', output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
