import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow, useStore, ViewportPortal, type ReactFlowState } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { UiTooltip } from '@/components/ui';

import { haveSameSelectionGeometry, resolveMultiSelectionGeometry } from './multiSelectionGeometry';

interface Point {
  x: number;
  y: number;
}

interface SourceAnchor extends Point {
  nodeId: string;
}

interface DragPreview {
  end: Point;
  sourceAnchors: SourceAnchor[];
}

interface MultiSelectionConnectorProps {
  enabled: boolean;
  selectedNodeIds: string[];
  sourceNodeIds: string[];
  onConnectEnd: (
    sourceNodeIds: string[],
    clientPosition: Point,
    explicitTargetHandle?: string
  ) => void;
}

function createPreviewPath(start: Point, end: Point): string {
  const deltaX = end.x - start.x;
  const curveStrength = Math.max(36, Math.min(160, Math.abs(deltaX) * 0.42));
  const direction = deltaX >= 0 ? 1 : -1;
  return `M ${start.x} ${start.y} C ${start.x + direction * curveStrength} ${start.y}, ${end.x - direction * curveStrength} ${end.y}, ${end.x} ${end.y}`;
}

export const MultiSelectionConnector = memo(({
  enabled,
  selectedNodeIds,
  sourceNodeIds,
  onConnectEnd,
}: MultiSelectionConnectorProps) => {
  const { t } = useTranslation();
  const { screenToFlowPosition } = useReactFlow();
  const zoom = useStore(state => state.transform[2]);
  const selectGeometry = useCallback((state: ReactFlowState) => enabled
    ? resolveMultiSelectionGeometry(state.nodeLookup, selectedNodeIds, sourceNodeIds)
    : null, [enabled, selectedNodeIds, sourceNodeIds]);
  const geometry = useStore(selectGeometry, haveSameSelectionGeometry);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    sourceNodeIds: string[];
    sourceAnchors: SourceAnchor[];
  } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPreview(null);
      dragRef.current = null;
    }
  }, [enabled]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      setPreview({
        sourceAnchors: drag.sourceAnchors,
        end: screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false }),
      });
    };

    const completeDrag = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      dragRef.current = null;
      setPreview(null);

      const targetHandle = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('.react-flow__handle.target')
        ?.dataset.handleid;
      onConnectEnd(
        drag.sourceNodeIds,
        { x: event.clientX, y: event.clientY },
        targetHandle
      );
    };

    const cancelDrag = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      dragRef.current = null;
      setPreview(null);
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', completeDrag, true);
    window.addEventListener('pointercancel', cancelDrag, true);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', completeDrag, true);
      window.removeEventListener('pointercancel', cancelDrag, true);
    };
  }, [onConnectEnd, screenToFlowPosition]);

  const paths = useMemo(
    () => preview?.sourceAnchors.map((source) => ({
      nodeId: source.nodeId,
      d: createPreviewPath(source, preview.end),
    })) ?? [],
    [preview]
  );

  if (!enabled || !geometry) {
    return null;
  }

  return (
    <ViewportPortal>
      {preview && (
        <svg className="pointer-events-none absolute left-0 top-0 z-40 h-px w-px overflow-visible">
          {paths.map((path) => (
            <path
              key={path.nodeId}
              d={path.d}
              fill="none"
              stroke="var(--canvas-selection-accent)"
              strokeWidth={3 / zoom}
              strokeDasharray={`${10 / zoom} ${7 / zoom}`}
              strokeLinecap="round"
            />
          ))}
        </svg>
      )}

      <UiTooltip content={t('canvas.multiConnect.dragHandle')}>
        <button
          type="button"
          className="nodrag nopan pointer-events-auto absolute z-50 flex h-8 w-8 origin-center cursor-crosshair items-center justify-center rounded-full bg-transparent"
          style={{
            left: geometry.connector.x,
            top: geometry.connector.y,
            transform: `translate(-50%, -50%) scale(${1 / zoom})`,
          }}
          aria-label={t('canvas.multiConnect.dragHandle')}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            dragRef.current = {
              pointerId: event.pointerId,
              sourceNodeIds: [...sourceNodeIds],
              sourceAnchors: geometry.sourceAnchors,
            };
            setPreview({
              sourceAnchors: geometry.sourceAnchors,
              end: screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false }),
            });
          }}
        >
          <span className="canvas-connection-handle rounded-full" />
        </button>
      </UiTooltip>
    </ViewportPortal>
  );
});

MultiSelectionConnector.displayName = 'MultiSelectionConnector';
