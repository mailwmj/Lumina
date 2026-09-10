import assert from 'node:assert/strict';

/** Exercise the moved viewport overlay through actual pointer input. */
export async function checkMultiConnector(page) {
  await page.evaluate(async () => {
    window.__panCounters = null;
    const { getNodeDefinition } = await import('/src/features/canvas/domain/nodeRegistry.ts');
    const source = (id, y) => ({
      id, type: 'exportImageNode', position: { x: 40, y }, width: 360, height: 270, selected: true,
      data: { ...getNodeDefinition('exportImageNode').createDefaultData(),
        imageUrl: window.panAssets.preview, previewImageUrl: window.panAssets.preview },
    });
    window.panStores.canvas.getState().setCanvasData([
      source('source-a', 40), source('source-b', 420),
      { id: 'target', type: 'imageNode', position: { x: 900, y: 180 },
        data: getNodeDefinition('imageNode').createDefaultData() },
      { id: 'invalid', type: 'textAnnotationNode', position: { x: 900, y: 700 },
        data: getNodeDefinition('textAnnotationNode').createDefaultData() },
    ], []);
    await window.canvasBench.zoom(0.7);
  });
  await page.keyboard.press('v');
  const connector = page.locator('.react-flow__viewport-portal button[aria-label]');
  await connector.waitFor({ state: 'visible' });
  const positions = [];
  for (const zoom of [0.4, 1]) {
    await page.evaluate(async zoom => {
      await window.canvasBench.zoom(zoom);
      await window.canvasBench.pan(60, 35);
    }, zoom);
    await page.waitForTimeout(150);
    const button = await connector.boundingBox();
    const a = await page.locator('[data-id="source-a"]').boundingBox();
    const b = await page.locator('[data-id="source-b"]').boundingBox();
    assert(button && a && b);
    assert(Math.abs(button.width - 32) < 1, 'connector keeps a 32px hit area at every zoom');
    assert(Math.abs(button.x + button.width / 2 - Math.max(a.x + a.width, b.x + b.width)) < 1,
      'connector follows the selection right edge after pan and zoom');
    assert(Math.abs(button.y + button.height / 2 - (a.y + b.y + b.height) / 2) < 1,
      'connector remains vertically centered on the selection');
    positions.push({ zoom, button });
  }
  await page.evaluate(() => window.canvasBench.zoom(0.7));
  await page.waitForTimeout(150);
  const begin = async () => {
    const box = await connector.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 70, box.y + 40, { steps: 4 });
  };
  const paths = page.locator('.react-flow__viewport-portal svg path');
  await begin();
  assert.equal(await paths.count(), 2, 'each selected source gets a preview path');
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
  await page.mouse.up();
  assert.equal(await paths.count(), 0, 'pointer cancellation clears the preview');
  assert.equal(await page.evaluate(() => window.canvasBench.edges().length), 0);

  // Annotation nodes cannot receive image inputs. Browser dialogs use the
  // existing benchmark mock; the state must remain unchanged on rejection.
  await begin();
  const invalid = await page.locator('[data-id="invalid"]').boundingBox();
  await page.mouse.move(invalid.x + 40, invalid.y + 40, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.canvasBench.edges().length), 0,
    'invalid targets must not create partial connections');

  await begin();
  const target = await page.locator('[data-id="target"] .react-flow__handle.target').boundingBox();
  assert(target, 'target input handle is visible');
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const edges = await page.evaluate(() => window.canvasBench.edges().map(({ source, target, targetHandle }) => ({ source, target, targetHandle })));
  assert.deepEqual(edges.map(edge => edge.source).sort(), ['source-a', 'source-b']);
  assert(edges.every(edge => edge.target === 'target' && edge.targetHandle === 'target'));
  assert.equal(await paths.count(), 0);
  return { positions, cancellation: true, invalidTarget: true, edges };
}
