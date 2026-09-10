import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import assert from 'node:assert/strict';

const output = new URL('../docs/performance/', import.meta.url);
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 1437, strictPort: true, open: false } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const stats = values => {
  const a = [...values].sort((a, b) => a - b);
  return { count: a.length, median: a[Math.floor(a.length / 2)], p95: a[Math.floor(a.length * .95)], max: a.at(-1) };
};
const report = { date: new Date().toISOString(), environment: { platform: platform(), arch: arch(), cpu: cpus()[0].model, browser: browser.version(), viewport: '1440x1000', mode: 'Vite development, React Profiler, headless Chromium' }, scenes: [], checks: {} };
try {
  await page.goto('http://127.0.0.1:1437/scripts/canvas-benchmark/index.html');
  await page.waitForFunction(() => Boolean(window.canvasBench), undefined, { timeout: 60000 });
  for (const count of (process.argv.includes('--qa-only') ? [] : [50, 100, 300])) {
    const start = Date.now();
    await page.evaluate(n => window.canvasBench.seed(n), count);
    await page.waitForFunction(n => window.canvasBench.data().length === n && document.querySelectorAll('.react-flow__node').length > 0, count);
    await page.waitForTimeout(700);
    const readyMsIncludingSettle = Date.now() - start;
    const movedNode = page.locator('.react-flow__node[data-id="n2"]');
    const box = await movedNode.boundingBox();
    const initialPosition = await page.evaluate(() => window.canvasBench.data().find(n => n.id === 'n2').position);
    await page.mouse.move(box.x + 40, box.y + 40); await page.mouse.down();
    await page.mouse.move(box.x + 75, box.y + 65, { steps: 10 }); await page.mouse.up();
    const movedPosition = await page.evaluate(() => window.canvasBench.data().find(n => n.id === 'n2').position);
    assert(movedPosition.x > initialPosition.x, 'real node drag must update canvas position');
    await page.evaluate(() => window.canvasBench.reset());
    const graph = await page.evaluate(n => window.canvasBench.graphBenchmark(n), count);
    assert.equal(graph.invalidations, 0, 'unrelated edits must not invalidate semantic inputs');
    await page.evaluate(() => window.canvasBench.reset());
    const frameTimes = await page.evaluate(async () => {
      const times = [];
      let previous = performance.now();
      for (let i = 0; i < 90; i++) {
        await new Promise(requestAnimationFrame);
        const now = performance.now(); times.push(now - previous); previous = now;
        await window.canvasBench.pan(-i * 12, -i * 6);
      }
      return times.slice(5);
    });
    await page.evaluate(() => window.canvasBench.zoom(.3));
    await settle();
    const overview = await page.evaluate(() => ({
      nodes: document.querySelectorAll('.react-flow__node').length,
      loadedImages: document.querySelectorAll('.react-flow__node img[src]').length,
      metrics: Object.fromEntries(Object.entries(window.canvasBench.metrics.getCanvasPerformanceSnapshot()).filter(([key]) => !key.startsWith('node:'))),
      profiledNodes: Object.keys(window.canvasBench.metrics.getCanvasPerformanceSnapshot()).filter(key => key.startsWith('node:')).length,
    }));
    const scene = { count, readyMsIncludingSettle, nodeDragVerified: true, panFrameMs: stats(frameTimes), graphBaselineMs: stats(graph.baseline), graphOptimizedMs: stats(graph.optimized), unrelatedInvalidations: graph.invalidations, overview };
    report.scenes.push(scene);
    console.log(JSON.stringify(scene));
  }
  // Viewport image unloading uses the actual canvas DOM and browser observer.
  await page.evaluate(() => window.canvasBench.seed(50));
  await page.waitForTimeout(500);
  const beforeImages = await page.locator('.react-flow__node img[src]').count();
  await page.evaluate(() => window.canvasBench.pan(-100000, -100000));
  await page.waitForTimeout(500);
  const afterImages = await page.locator('.react-flow__node img[src]').count();
  assert(beforeImages > 0 && afterImages === 0, 'offscreen canvas images must release src');
  report.checks.viewportImages = { beforeImages, afterImages };

  await page.evaluate(() => window.canvasBench.storyboard());
  const scroll = page.locator('[data-storyboard-scroll]');
  await scroll.waitFor();
  await page.waitForTimeout(300);
  const mountedFrames = await page.locator('[data-frame-index]').count();
  assert(mountedFrames < 30, '300 frames must be windowed');
  const firstNote = page.locator('[data-frame-index="0"] textarea');
  await firstNote.fill('Persist through virtualization 中文');
  await scroll.evaluate(el => { el.scrollTop = 12000; });
  await page.waitForTimeout(200);
  assert(await firstNote.count() === 1, 'focused editor stays mounted');
  await page.mouse.click(1300, 900);
  await page.waitForTimeout(100);
  assert.equal(await firstNote.count(), 0, 'offscreen blurred editor unmounts');
  await scroll.evaluate(el => { el.scrollTop = 0; });
  await page.waitForTimeout(100);
  assert.equal(await firstNote.inputValue(), 'Persist through virtualization 中文');
  const frame0 = page.locator('[data-frame-index="0"] .group\\/frame');
  const frame1 = page.locator('[data-frame-index="1"] .group\\/frame');
  const a = await frame0.boundingBox(), b = await frame1.boundingBox();
  await page.mouse.move(a.x + 30, a.y + 30); await page.mouse.down();
  await page.mouse.move(b.x + 30, b.y + 30, { steps: 5 });
  const beforeDrop = await page.evaluate(() => window.canvasBench.data()[0].data.frames.find(f => f.id === 'f0').order);
  assert.equal(beforeDrop, 0, 'hover must not persist reorder');
  await page.mouse.up(); await settle();
  const afterDrop = await page.evaluate(() => window.canvasBench.data()[0].data.frames.find(f => f.id === 'f0').order);
  assert.equal(afterDrop, 1, 'drop must commit reorder');
  const scrollHeight = await scroll.evaluate(el => el.scrollHeight);
  await page.evaluate(() => window.canvasBench.zoom(.6));
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-frame-index="299"]').count(), 1);
  const afterZoom = await scroll.evaluate(el => ({ scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, width: el.getBoundingClientRect().width }));
  assert(Math.abs(afterZoom.scrollHeight - scrollHeight) < 5, 'zoom must preserve logical scroll height');
  await scroll.evaluate(el => { el.scrollTop = 0; });
  await page.evaluate(() => window.canvasBench.zoom(1));
  await page.waitForTimeout(100);
  const cancelSource = await frame0.boundingBox(), cancelTarget = await frame1.boundingBox();
  await page.mouse.move(cancelSource.x + 30, cancelSource.y + 30); await page.mouse.down();
  await page.mouse.move(cancelTarget.x + 30, cancelTarget.y + 30, { steps: 5 });
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel')));
  await page.mouse.up(); await settle();
  assert.equal(await page.evaluate(() => window.canvasBench.data()[0].data.frames.find(f => f.id === 'f0').order), 1);
  report.checks.storyboard = { totalFrames: 300, mountedFrames, editSurvivesUnmount: true, hoverDoesNotWrite: true, dropCommits: true, cancellationPreservesOrder: true, zoomPreservesGeometry: true };
  await page.screenshot({ path: new URL('canvas-storyboard.png', output).pathname });
  await page.evaluate(() => window.canvasBench.connections());
  await page.waitForTimeout(300);
  const source = page.locator('[data-nodeid="text"][data-handleid="source"]');
  const target = page.locator('[data-nodeid="image"][data-handleid="target"]');
  await page.locator('.react-flow__node[data-id="text"]').hover();
  const s = await source.boundingBox();
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down();
  const t = await target.boundingBox();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 8 });
  assert.equal(await target.getAttribute('data-connection-feedback'), 'valid');
  await page.mouse.up(); await settle();
  assert.equal((await page.evaluate(() => window.canvasBench.edges())).length, 1);
  // Duplicate connection must be visibly rejected without appending a second edge.
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 8 });
  assert.equal(await target.getAttribute('data-connection-feedback'), 'invalid');
  await page.mouse.up(); await settle();
  assert.equal((await page.evaluate(() => window.canvasBench.edges())).length, 1);
  report.checks.connections = { validConnect: true, duplicateRejected: true };
  await page.screenshot({ path: new URL('canvas-connections.png', output).pathname });
  assert.deepEqual(errors, [], 'no browser runtime errors');
  report.checks.browserErrors = errors;
  await writeFile(new URL(process.argv.includes('--qa-only') ? 'canvas-qa.json' : 'canvas-benchmark.json', output), JSON.stringify(report, null, 2) + '\n');
  console.log('Canvas browser checks passed; JSON report written to docs/performance/.');
} catch (error) {
  await page.screenshot({ path: new URL('canvas-failure.png', output).pathname });
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
  await server.close();
}
