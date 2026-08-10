#!/usr/bin/env bash
set -euo pipefail

PWCLI=/Users/mir/.codex/skills/playwright/scripts/playwright_cli.sh

"$PWCLI" run-code 'async page => {
  const node = page.locator(".react-flow__node-textGenerationNode").first();
  const box = await node.boundingBox();
  if (!box) throw new Error("node box missing");

  await page.evaluate(() => {
    window.__luminaDragProfiler = [];
  });

  await page.evaluate(target => {
    const state = {
      dragging: false,
      frames: [],
      mutations: [],
      longTasks: [],
      lastPointerAt: 0,
      active: true,
    };

    const onDown = () => {
      state.dragging = true;
      state.frames = [];
      state.mutations = [];
      state.longTasks = [];
    };
    const onMove = () => {
      if (state.dragging) state.lastPointerAt = performance.now();
    };
    const onUp = () => {
      state.dragging = false;
      state.endedAt = performance.now();
    };

    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);

    const tick = now => {
      if (!state.active) return;
      if (state.dragging) state.frames.push(now);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const mutationObserver = new MutationObserver(() => {
      const now = performance.now();
      if (!state.dragging && (!state.endedAt || now - state.endedAt > 20)) return;
      const transform = target.style.transform;
      const previous = state.mutations[state.mutations.length - 1];
      if (!previous || previous[1] !== transform) {
        state.mutations.push([now, transform, state.lastPointerAt]);
      }
    });
    mutationObserver.observe(target, {
      attributes: true,
      attributeFilter: ["style"],
    });

    const longTaskObserver = new PerformanceObserver(list => {
      if (!state.dragging) return;
      for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
    });
    longTaskObserver.observe({ entryTypes: ["longtask"] });

    state.cleanup = () => {
      state.active = false;
      mutationObserver.disconnect();
      longTaskObserver.disconnect();
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
    };
    window.__dragPerf = state;
  }, await node.elementHandle());

  const client = await page.context().newCDPSession(page);
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const startX = box.x + box.width / 2;
  const startY = box.y + 2;

  try {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: startX,
      y: startY,
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: startX,
      y: startY,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    for (let i = 0; i < 180; i += 1) {
      const progress = i < 90 ? i / 89 : (179 - i) / 89;
      await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: startX + progress * 240,
        y: startY,
        button: "left",
        buttons: 1,
      });
      Atomics.wait(sleeper, 0, 0, 4);
    }
  } finally {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: startX,
      y: startY,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
  }

  Atomics.wait(sleeper, 0, 0, 50);
  await client.detach();

  const result = await page.evaluate(() => {
    const state = window.__dragPerf;
    const summarise = values => {
      const sorted = [...values].sort((a, b) => a - b);
      const pick = q =>
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0;
      return {
        p50: pick(0.5),
        p95: pick(0.95),
        max: sorted[sorted.length - 1] || 0,
      };
    };

    const frameGaps = state.frames
      .slice(1)
      .map((value, index) => value - state.frames[index]);
    const inputToFrame = state.mutations
      .map(value => {
        const nextFrame = state.frames.find(frame => frame >= value[0]);
        return nextFrame === undefined || !value[2] ? null : nextFrame - value[2];
      })
      .filter(value => value !== null);
    const inputToMutation = state.mutations
      .map(value => value[2] ? value[0] - value[2] : null)
      .filter(value => value !== null);
    const profilerSamples = window.__luminaDragProfiler || [];
    const profiler = Object.fromEntries(
      [...new Set(profilerSamples.map(sample => sample.id))].map(id => {
        const samples = profilerSamples.filter(sample => sample.id === id);
        const durations = samples.map(sample => sample.actualDuration);
        return [id, {
          commits: samples.length,
          totalMs: durations.reduce((sum, duration) => sum + duration, 0),
          actualDurationMs: summarise(durations),
        }];
      })
    );
    const output = {
      refreshBudgetMs: summarise(frameGaps).p50,
      inputToMutationMs: summarise(inputToMutation),
      inputToFrameMs: summarise(inputToFrame),
      samples: inputToFrame.length,
      longTasks: state.longTasks,
      profiler,
    };
    delete window.__luminaDragProfiler;
    state.cleanup();
    return output;
  });

  if (result.inputToFrameMs.p95 > result.refreshBudgetMs * 1.25) {
    throw new Error("DRAG_SMOOTHNESS_REGRESSION " + JSON.stringify(result));
  }
  return result;
}'
