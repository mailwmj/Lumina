import { memo } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useExternalAgentBridge } from './useExternalAgentBridge';

const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };
type Props = Omit<Parameters<typeof useExternalAgentBridge>[0], 'viewport'>;

/** Isolate live viewport updates from the canvas UI; disabled bridges need no subscription updates. */
export const CanvasExternalAgentBridge = memo((props: Props) => {
  const enabled = useSettingsStore(state => state.externalAgentConnection.enabled);
  const viewport = useCanvasStore(state => enabled ? state.currentViewport : DEFAULT_VIEWPORT);
  useExternalAgentBridge({ ...props, viewport });
  return null;
});
CanvasExternalAgentBridge.displayName = 'CanvasExternalAgentBridge';
