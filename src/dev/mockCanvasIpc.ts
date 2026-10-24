// Dev-only: lets the canvas render in a plain browser (no Tauri runtime) for visual review.
// Enabled by `?mockCanvas` in main.tsx; never imported in production builds.
import { mockIPC } from '@tauri-apps/api/mocks';
import { handleMockAgentThreadCommand } from './mockAgentThreadsIpc';

import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasNodeType,
} from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

const PROJECT_ID = 'mock-canvas';
const NOW = Date.now();

function svgImage(from: string, to: string, label: string, width = 800, height = 800): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`
    + `<rect width="100%" height="100%" fill="url(#g)"/>`
    + `<text x="50%" y="50%" fill="rgba(255,255,255,.85)" font-family="sans-serif" font-size="56" `
    + `text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const portrait = svgImage('#f97316', '#be185d', 'Reference');
const landscape = svgImage('#0ea5e9', '#4338ca', 'Result A', 1200, 800);
const square = svgImage('#10b981', '#0f766e', 'Result B');

function node(
  id: string,
  type: CanvasNodeType,
  x: number,
  y: number,
  width: number,
  height: number,
  data: Partial<CanvasNodeData> = {}
): CanvasNode {
  const created = canvasNodeFactory.createNode(type, { x, y }, data);
  return { ...created, id, width, height, style: { width, height } };
}

function edge(source: string, target: string): CanvasEdge {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    sourceHandle: 'source',
    targetHandle: 'target',
    type: 'disconnectableEdge',
  };
}

function buildFixture(): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const image = (url: string) => ({ imageUrl: url, previewImageUrl: url, referenceImageUrl: url });
  const nodes: CanvasNode[] = [
    node('upload', CANVAS_NODE_TYPES.upload, 0, 40, 240, 300, {
      ...image(portrait),
      aspectRatio: '4:5',
      sourceFileName: 'reference.png',
    }),
    node('gen', CANVAS_NODE_TYPES.imageEdit, 340, 0, 520, 347, {
      prompt: 'A cinematic portrait with warm rim light, shallow depth of field',
    }),
    node('result-ok', CANVAS_NODE_TYPES.exportImage, 940, -40, 360, 240, {
      ...image(landscape),
      aspectRatio: '3:2',
    }),
    node('result-wait', CANVAS_NODE_TYPES.exportImage, 940, 280, 280, 280, {
      aspectRatio: '1:1',
    }),
    node('result-error', CANVAS_NODE_TYPES.exportImage, 1260, 280, 280, 280, {
      aspectRatio: '1:1',
      generationError: 'Provider returned 429: rate limit exceeded',
    }),
    node('result-requery', CANVAS_NODE_TYPES.exportImage, 1360, -40, 280, 240, {
      aspectRatio: '1:1',
    }),
    node('text', CANVAS_NODE_TYPES.textGeneration, 0, 520, 520, 470, {
      inputText: 'Write a short product caption for the portrait.',
      generatedText: 'Golden hour, quiet confidence — a portrait lit by the last warm light of the day.',
    }),
    node('video', CANVAS_NODE_TYPES.videoSingle, 600, 620, 680, 347, {
      prompt: 'Slow push-in, subject turns toward camera',
    }),
    node('story-gen', CANVAS_NODE_TYPES.storyboardGen, 1340, 620, 520, 420, {}),
    node('note', CANVAS_NODE_TYPES.textAnnotation, 0, 340, 200, 100, { content: 'Hero shot — iterate' }),
  ];
  nodes.push(node('square', CANVAS_NODE_TYPES.exportImage, 1700, 0, 240, 240, {
    ...image(square),
    aspectRatio: '1:1',
  }));
  const edges = [
    edge('upload', 'gen'),
    edge('gen', 'result-ok'),
    edge('gen', 'result-wait'),
    edge('upload', 'text'),
    edge('result-ok', 'video'),
  ];
  return { nodes, edges };
}

const { nodes, edges } = buildFixture();
const projectRecord = {
  id: PROJECT_ID,
  name: 'Mock canvas',
  createdAt: NOW,
  updatedAt: NOW,
  nodeCount: nodes.length,
  thumbnailUrl: null,
  nodesJson: JSON.stringify(nodes),
  edgesJson: JSON.stringify(edges),
  viewportJson: JSON.stringify({ x: 120, y: 120, zoom: 0.55 }),
  historyJson: '{"past":[],"future":[],"imagePool":[]}',
};

mockIPC((cmd, payload) => {
  const agentResult = handleMockAgentThreadCommand(cmd, payload);
  if (agentResult.handled) return agentResult.value;
  switch (cmd) {
    case 'list_project_summaries': {
      const { historyJson: _h, nodesJson: _n, edgesJson: _e, viewportJson: _v, ...summary } = projectRecord;
      return [summary];
    }
    case 'get_project_record':
      return projectRecord;
    default:
      return null;
  }
});

// Open the fixture project once hydration finishes.
const unsubscribe = useProjectStore.subscribe((state) => {
  if (state.isHydrated) {
    unsubscribe();
    void state.openProject(PROJECT_ID);
  }
});

// Restored projects reset runtime-only generation state, so apply it once the canvas has loaded.
const stopCanvasWatch = useCanvasStore.subscribe((state) => {
  if (!state.nodes.some((item) => item.id === 'result-wait')) {
    return;
  }
  stopCanvasWatch();
  window.setTimeout(() => {
    const { updateNodeDataWithoutHistory } = useCanvasStore.getState();
    updateNodeDataWithoutHistory('result-wait', {
      isGenerating: true,
      generationStartedAt: Date.now() - 20000,
      generationDurationMs: 60000,
    });
    updateNodeDataWithoutHistory('result-requery', {
      isGenerating: true,
      generationRecoveryState: 'attention_required',
      generationRetryError: 'Network timeout while querying task',
    });
  }, 1000);
});
