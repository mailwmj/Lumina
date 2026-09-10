// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useExternalAgentBridge } from './useExternalAgentBridge';
import { CanvasExternalAgentBridge } from './CanvasExternalAgentBridge';

vi.mock('./useExternalAgentBridge', () => ({ useExternalAgentBridge: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
const props = { projectId: 'project', projectName: 'Project', nodes: [], edges: [], selectedNodeIds: [] };
function enable(enabled: boolean) {
  useSettingsStore.getState().setExternalAgentConnection({ enabled, url: 'http://127.0.0.1:17372', token: 'test' });
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  enable(false);
  useCanvasStore.getState().setViewportState({ x: 0, y: 0, zoom: 1 });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  enable(false);
  vi.unstubAllGlobals();
});

it('ignores viewport updates while disabled and reads the latest viewport when enabled', () => {
  act(() => root.render(<CanvasExternalAgentBridge {...props} />));
  vi.mocked(useExternalAgentBridge).mockClear();
  for (let x = 1; x <= 90; x++) act(() => useCanvasStore.getState().setViewportState({ x, y: 10, zoom: 1 }));
  expect(useExternalAgentBridge).not.toHaveBeenCalled();
  act(() => enable(true));
  expect(useExternalAgentBridge).toHaveBeenLastCalledWith(expect.objectContaining({ viewport: { x: 90, y: 10, zoom: 1 } }));
  act(() => useCanvasStore.getState().setViewportState({ x: 100, y: 20, zoom: 2 }));
  expect(useExternalAgentBridge).toHaveBeenLastCalledWith(expect.objectContaining({ viewport: { x: 100, y: 20, zoom: 2 } }));
});
