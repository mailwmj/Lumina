import { useEffect, type RefObject } from 'react';
import { useReactFlow } from '@xyflow/react';
import { takeContinueFromImageReference } from '../application/continueFromImage';
import { useCanvasStore } from '@/stores/canvasStore';
import type { ImageReferencePromptInputHandle } from './ImageReferencePromptInput';

export function useContinueFromImageFocus(nodeId: string, input: RefObject<ImageReferencePromptInputHandle>) {
  const flow = useReactFlow();
  useEffect(() => {
    const edgeId = takeContinueFromImageReference(nodeId);
    if (!edgeId) return;
    input.current?.insertReference(edgeId, { reuseExisting: true });
    const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId);
    if (!node) return;
    // Preserve zoom, panning only when the newly selected editor extends outside the viewport.
    const frame = requestAnimationFrame(() => {
      const element = document.querySelector(`[data-id="${nodeId}"]`);
      const viewport = element?.closest('.react-flow')?.getBoundingClientRect();
      const bounds = element?.getBoundingClientRect();
      if (bounds && viewport && (bounds.left < viewport.left || bounds.right > viewport.right
        || bounds.top < viewport.top || bounds.bottom > viewport.bottom)) {
        void flow.setCenter(node.position.x + bounds.width / flow.getZoom() / 2,
          node.position.y + bounds.height / flow.getZoom() / 2,
          { zoom: flow.getZoom(), duration: 240 });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [flow, input, nodeId]);
}
