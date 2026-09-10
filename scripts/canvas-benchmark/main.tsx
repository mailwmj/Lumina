import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { Canvas } from '../../src/features/canvas/Canvas';
import { useCanvasStore } from '../../src/stores/canvasStore';
import { getNodeDefinition } from '../../src/features/canvas/domain/nodeRegistry';
import { CANVAS_NODE_TYPES as T } from '../../src/features/canvas/domain/canvasNodes';
import { createNodeInputGraphSelector, createWorkflowNodesSelector } from '../../src/features/canvas/application/canvasNodeSelectors';
import { createTextGenerationInputsResolver } from '../../src/features/canvas/application/textGenerationInputs';
import * as metrics from '../../src/features/canvas/application/canvasPerformance';
import '../../src/i18n';
import '../../src/index.css';

if (!import.meta.env.DEV) throw new Error('Benchmark is development-only');
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#41556e"/><circle cx="200" cy="150" r="70" fill="#eabf81"/></svg>');
const node = (type, id, index, extra = {}) => ({ id, type,
  position: { x: (index % 10) * 480 + 40, y: Math.floor(index / 10) * 440 + 40 },
  data: { ...getNodeDefinition(type).createDefaultData(), ...extra },
});
function makeScene(count) {
  const types = [T.textGeneration, T.imageEdit, T.exportImage, T.upload, T.storyboardSplit,
    T.videoSingle, T.videoFrame, T.seedanceAutoVideo, T.textAnnotation, T.exportVideo];
  const nodes = Array.from({ length: count }, (_, i) => {
    const type = types[i % types.length];
    const extra = [T.upload, T.exportImage].includes(type) ? { imageUrl: image, previewImageUrl: image } : {};
    return node(type, `n${i}`, i, { ...extra, inputText: `Input ${i}`, content: `Note ${i}` });
  });
  const edges = nodes.filter((_, i) => i % 10 === 1).map((n, i) => ({
    id: `e${i}`, source: `n${i * 10}`, target: n.id, sourceHandle: 'source', targetHandle: 'target',
    type: 'disconnectableEdge', data: { valueType: 'text', inputOrder: 0 },
  }));
  return { nodes, edges };
}
function App() {
  const flow = useReactFlow();
  React.useEffect(() => {
    window.canvasBench = {
      metrics,
      seed(count) {
        useCanvasStore.setState({ ...makeScene(count), history: { past: [], future: [] }, selectedNodeId: null });
        return flow.setViewport({ x: 0, y: 0, zoom: 1 });
      },
      zoom: zoom => flow.setViewport({ x: 0, y: 0, zoom }),
      viewport: () => flow.getViewport(),
      pan: (x, y) => flow.setViewport({ ...flow.getViewport(), x, y }),
      data: () => useCanvasStore.getState().nodes,
      edges: () => useCanvasStore.getState().edges,
      reset: () => { metrics.resetCanvasPerformanceSnapshot(); metrics.setCanvasPerformanceEnabled(true); },
      storyboard() {
        useCanvasStore.setState({ nodes: [{ ...node(T.storyboardSplit, 'board', 0, {
          gridCols: 3, gridRows: 100, frameAspectRatio: '4:3',
          frames: Array.from({ length: 300 }, (_, i) => ({ id: `f${i}`, order: i, note: `Frame ${i}`, imageUrl: image, previewImageUrl: image })),
        }), width: 700, height: 600 }], edges: [], history: { past: [], future: [] }, selectedNodeId: null });
        return flow.setViewport({ x: 0, y: 0, zoom: 1 });
      },
      connections() {
        useCanvasStore.setState({ nodes: [node(T.textGeneration, 'text', 0, { inputText: 'Input' }),
          { ...node(T.imageEdit, 'image', 1), position: { x: 800, y: 40 } },
          { ...node(T.videoSingle, 'video', 2), position: { x: 1600, y: 40 } }], edges: [], selectedNodeId: null });
        return flow.setViewport({ x: 0, y: 0, zoom: 0.5 });
      },
      graphBenchmark(count) {
        const state = makeScene(count);
        const targets = state.nodes.filter(n => n.type === T.imageEdit || n.type === T.textGeneration);
        const selectors = targets.map(n => createNodeInputGraphSelector(n.id));
        const resolvers = targets.map(n => createTextGenerationInputsResolver(n.id));
        const selectAll = createWorkflowNodesSelector();
        let prior = selectors.map(fn => fn(state));
        const baselineResolvers = targets.map(n => createTextGenerationInputsResolver(n.id));
        const initial = selectAll(state);
        baselineResolvers.forEach(resolve => resolve(initial, state.edges));
        resolvers.forEach((resolve, i) => resolve(prior[i].workflowNodes, prior[i].edges));
        const baseline = [], optimized = [];
        let invalidations = 0;
        for (let iteration = 0; iteration < 110; iteration++) {
          // An unrelated annotation edit used to invalidate every generation node.
          const next = { ...state, nodes: state.nodes.map((n, i) => i === 8 ? { ...n, data: { ...n.data, content: `Edited ${iteration}` } } : n) };
          let t = performance.now();
          const all = selectAll(next);
          for (const resolve of baselineResolvers) resolve(all, next.edges);
          if (iteration >= 10) baseline.push(performance.now() - t);
          t = performance.now();
          prior = selectors.map((select, i) => {
            const graph = select(next);
            if (graph !== prior[i]) invalidations++;
            resolvers[i](graph.workflowNodes, graph.edges);
            return graph;
          });
          if (iteration >= 10) optimized.push(performance.now() - t);
        }
        return { baseline, optimized, invalidations };
      },
    };
  }, [flow]);
  return <Canvas />;
}
createRoot(document.getElementById('root')!).render(<ReactFlowProvider><App /></ReactFlowProvider>);
