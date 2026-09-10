import { createServer } from 'vite';
import { checkMultiConnector } from './canvas-pan-qa.mjs';
import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const engine = process.argv.includes('--webkit') ? 'webkit' : 'chromium';
const label = 'verified';
const server = await createServer({
  plugins: [{
    name: 'diagnose-pan',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/features/canvas/Canvas.tsx')) return code.replace('export function Canvas() {', 'export function Canvas() {\n if (globalThis.__panCounters) globalThis.__panCounters.canvasRenders++;');
    }
  }],
  server: {
    host: '127.0.0.1',
    port: 1439,
    strictPort: true,
    open: false
  }
});
await server.listen();
const browser = await {
  chromium,
  webkit
}[engine].launch({
  headless: true
});
const page = await browser.newPage({
  viewport: {
    width: 1440,
    height: 1000
  },
  deviceScaleFactor: 2
});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const stats = a => {
  a = [...a].sort((a, b) => a - b);
  return {
    count: a.length,
    median: a[Math.floor(a.length * .5)],
    p95: a[Math.floor(a.length * .95)],
    max: a.at(-1)
  };
};
const report = {
  engine,
  label,
  version: browser.version(),
  scenes: [],
  errors
};
try {
  await page.goto('http://127.0.0.1:1439/scripts/canvas-benchmark/index.html');
  await page.waitForFunction(() => !!window.canvasBench);
  await page.evaluate(async () => {
    const {
      useCanvasStore
    } = await import('/src/stores/canvasStore.ts');
    const {
      useSettingsStore
    } = await import('/src/stores/settingsStore.ts');
    const {
      useCanvasImageQualityStore
    } = await import('/src/features/canvas/application/canvasImageQualityStore.ts');
    window.panStores = {
      canvas: useCanvasStore,
      settings: useSettingsStore,
      quality: useCanvasImageQualityStore
    };
    useCanvasStore.subscribe((s, p) => {
      if (window.__panCounters) {
        if (s.currentViewport !== p.currentViewport) window.__panCounters.viewportWrites++;
        if (s.nodes !== p.nodes) window.__panCounters.nodeWrites++;
        if (s.history !== p.history) window.__panCounters.historyWrites++;
      }
    });
    useCanvasImageQualityStore.subscribe(() => {
      if (window.__panCounters) window.__panCounters.qualityWrites++;
    });
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (window.__panCounters) window.__panCounters.rectReads++;
      return rect.call(this);
    };
    new MutationObserver(changes => {
      if (window.__panCounters) for (const c of changes) {
        if (c.type === 'attributes' && c.attributeName === 'src') window.__panCounters.imageSources++;
        if (c.type === 'childList') for (const n of c.addedNodes) {
          if (n instanceof Element) window.__panCounters.imageMounts += (n.tagName === 'IMG' ? 1 : 0) + n.querySelectorAll('img').length;
        }
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src']
    });
  });
  for (const scene of [{
    kind: 'mixed',
    count: 50,
    zoom: 1
  }, {
    kind: 'mixed',
    count: 300,
    zoom: 1
  }, {
    kind: 'images',
    count: 80,
    zoom: .4,
    multi: 20
  }, {
    kind: 'images',
    count: 80,
    zoom: .4,
    multi: 40
  }]) {
    await page.evaluate(async scene => {
      window.__panCounters = null;
      const {
        getNodeDefinition
      } = await import('/src/features/canvas/domain/nodeRegistry.ts');
      if (scene.kind === 'mixed') await window.canvasBench.seed(scene.count);else {
        if (!window.panAssets) {
          const c = document.createElement('canvas');
          c.width = 4096;
          c.height = 3072;
          const ctx = c.getContext('2d');
          const g = ctx.createLinearGradient(0, 0, 4096, 3072);
          g.addColorStop(0, '#e5a4b6');
          g.addColorStop(.5, '#419ea3');
          g.addColorStop(1, '#342d57');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, c.width, c.height);
          for (let i = 0; i < 400; i++) {
            ctx.fillStyle = `hsla(${i * 17},50%,60%,.4)`;
            ctx.fillRect(i * 11 % 4096, i * 31 % 3072, 300, 200);
          }
          const original = c.toDataURL('image/jpeg', .9);
          const p = document.createElement('canvas');
          p.width = 512;
          p.height = 384;
          p.getContext('2d').drawImage(c, 0, 0, 512, 384);
          window.panAssets = {
            original,
            preview: p.toDataURL('image/jpeg', .8)
          };
        }
        const nodes = Array.from({
          length: scene.count
        }, (_, i) => ({
          id: `img${i}`,
          type: 'exportImageNode',
          position: {
            x: 40 + i % 10 * 420,
            y: 40 + Math.floor(i / 10) * 380
          },
          width: 360,
          height: 270,
          selected: !!scene.multi && i < Number(scene.multi),
          data: {
            ...getNodeDefinition('exportImageNode').createDefaultData(),
            imageUrl: window.panAssets.original,
            referenceImageUrl: window.panAssets.original,
            previewImageUrl: window.panAssets.preview
          }
        }));
        window.panStores.canvas.getState().setCanvasData(nodes, []);
      }
      window.panStores.settings.getState().setSnapToGridEnabled(!!scene.grid);
      await window.canvasBench.zoom(scene.zoom);
    }, scene);
    await page.waitForTimeout(1000);
    await page.keyboard.press(scene.multi ? 'v' : 'h');
    if (scene.multi) await page.keyboard.down('Space');
    const initial = await page.evaluate(() => window.canvasBench.viewport());
    const startY = scene.zoom === .4 ? 140 : 20;
    await page.mouse.move(1200, startY);
    await page.mouse.down({
      button: 'middle'
    });
    await page.mouse.move(1190, startY + 10);
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      window.__panCounters = {
        canvasRenders: 0,
        viewportWrites: 0,
        nodeWrites: 0,
        historyWrites: 0,
        qualityWrites: 0,
        rectReads: 0,
        imageSources: 0,
        imageMounts: 0
      };
      window.panFrames = [];
      window.panSampling = true;
      let prev;
      function tick(t) {
        if (prev) window.panFrames.push(t - prev);
        prev = t;
        if (window.panSampling) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
      window.canvasBench.reset();
    });
    for (let i = 0; i < 90; i++) {
      await page.mouse.move(1190 - i * 5, startY + 10 + i * 2);
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    const result = await page.evaluate(() => {
      window.panSampling = false;
      return {
        counters: window.__panCounters,
        frames: window.panFrames,
        viewport: window.canvasBench.viewport(),
        nodeMetrics: window.canvasBench.metrics.getCanvasPerformanceSnapshot(),
        images: document.querySelectorAll('.react-flow__node img[src]').length,
        nodes: document.querySelectorAll('.react-flow__node').length,
        selected: window.panStores.canvas.getState().nodes.filter(n => n.selected).length,
        multiActive: !!document.querySelector('.canvas-multi-select-active')
      };
    });
    await page.mouse.up({
      button: 'middle'
    });
    if (scene.multi) await page.keyboard.up('Space');
    await page.waitForTimeout(400);
    assert.equal(result.counters.canvasRenders, 0, 'panning must not rerender the canvas controller');
    assert(result.counters.rectReads < 500, 'layout reads must not scale with selected node count');
    assert.equal(result.counters.historyWrites, 0, 'panning must not create history entries');
    if (scene.multi) assert.equal(result.selected, scene.multi, 'selection must survive panning');
    delete result.nodeMetrics;
    const frames = result.frames;
    delete result.frames;
    report.scenes.push({
      ...scene,
      ...result,
      frames: stats(frames),
      initial
    });
    console.log(JSON.stringify(report.scenes.at(-1)));
  }
  // Reuse the same source node types with a 20–30MB PNG original. Selecting
  // nodes and scrolling them out/in must never assign that original to an Image.
  await page.evaluate(async () => {
    window.__panCounters = null;
    const c = document.createElement('canvas');
    c.width = 3000;
    c.height = 2500;
    const ctx = c.getContext('2d'),
      data = ctx.createImageData(c.width, c.height);
    let seed = 123456;
    for (let i = 0; i < data.data.length; i += 4) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      data.data[i] = seed & 255;
      data.data[i + 1] = seed >>> 8 & 255;
      data.data[i + 2] = seed >>> 16 & 255;
      data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    const blob = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
    window.largeOriginal = URL.createObjectURL(blob);
    window.largeOriginalBytes = blob.size;
    const small = document.createElement('canvas');
    small.width = 512;
    small.height = 426;
    small.getContext('2d').drawImage(c, 0, 0, 512, 426);
    const preview = small.toDataURL('image/jpeg', .8);
    window.originalImageAssignments = 0;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...descriptor,
      set(value) {
        if (value === window.largeOriginal) window.originalImageAssignments++;
        descriptor.set.call(this, value);
      }
    });
    const {
      getNodeDefinition
    } = await import('/src/features/canvas/domain/nodeRegistry.ts');
    window.panStores.canvas.getState().setCanvasData(Array.from({
      length: 20
    }, (_, i) => ({
      id: `large${i}`,
      type: 'exportImageNode',
      position: {
        x: 40 + i % 5 * 420,
        y: 40 + Math.floor(i / 5) * 380
      },
      width: 360,
      height: 270,
      selected: true,
      data: {
        ...getNodeDefinition('exportImageNode').createDefaultData(),
        imageUrl: window.largeOriginal,
        previewImageUrl: preview,
        referenceImageUrl: preview
      }
    })), []);
    await window.canvasBench.zoom(.4);
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.canvasBench.pan(-100000, -100000));
  await page.waitForTimeout(100);
  await page.evaluate(() => window.canvasBench.pan(0, 0));
  await page.waitForTimeout(300);
  report.largeImage = await page.evaluate(() => ({
    originalBytes: window.largeOriginalBytes,
    selected: window.panStores.canvas.getState().nodes.filter(n => n.selected).length,
    originalImageAssignments: window.originalImageAssignments
  }));
  assert(report.largeImage.originalBytes > 20_000_000 && report.largeImage.originalBytes < 32_000_000, 'fixture must represent a 20–30MB image');
  assert.equal(report.largeImage.originalImageAssignments, 0, 'selection metadata must never load the full original');
  report.multiConnector = await checkMultiConnector(page);
  assert.deepEqual(errors, []);
  await mkdir(new URL('../docs/performance/', import.meta.url), {
    recursive: true
  });
  await writeFile(new URL(`../docs/performance/canvas-pan-${engine}.json`, import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    largeImage: report.largeImage,
    errors
  }));
} finally {
  await browser.close();
  await server.close();
}
