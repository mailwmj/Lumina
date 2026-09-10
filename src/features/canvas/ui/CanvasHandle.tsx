import { memo, useMemo } from 'react';
import { Handle, useConnection, useNodeId, type HandleProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useCanvasStore } from '@/stores/canvasStore';
import { isCanvasConnectionValid } from '../application/canvasConnection';

/** Connection origin changes only on start/end, not every pointer move. */
export const CanvasHandle = memo(function CanvasHandle(props: HandleProps) {
  const { t } = useTranslation();
  const nodeId = useNodeId();
  const origin = useConnection(connection => connection.fromHandle);
  const nodes = useCanvasStore(state => origin ? state.nodes : null);
  const edges = useCanvasStore(state => origin ? state.edges : null);
  const candidate = Boolean(origin && origin.type !== props.type && nodeId !== origin.nodeId);
  const valid = useMemo(() => {
    if (!candidate || !origin || !nodeId || !nodes || !edges) return false;
    const connection = props.type === 'target'
      ? { source: origin.nodeId, sourceHandle: origin.id, target: nodeId, targetHandle: props.id }
      : { source: nodeId, sourceHandle: props.id, target: origin.nodeId, targetHandle: origin.id };
    return isCanvasConnectionValid(connection, nodes, edges);
  }, [candidate, origin, nodeId, nodes, edges, props.type, props.id]);
  const feedback = candidate ? (valid ? 'valid' : 'invalid') : undefined;
  const label = t(`node.connection.${feedback ?? (props.type === 'target' ? 'input' : 'output')}`);
  return <Handle {...props} title={label} aria-label={label}
    data-connection-feedback={feedback}
    className={`${props.className ?? ''} ${candidate ? 'canvas-handle-candidate' : ''}`} />;
});
