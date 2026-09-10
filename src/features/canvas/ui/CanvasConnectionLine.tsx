import { getBezierPath, type ConnectionLineComponentProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

export function CanvasConnectionLine(props: ConnectionLineComponentProps) {
  const { t } = useTranslation();
  const [path] = getBezierPath({ sourceX: props.fromX, sourceY: props.fromY,
    sourcePosition: props.fromPosition, targetX: props.toX, targetY: props.toY,
    targetPosition: props.toPosition });
  const invalid = props.connectionStatus === 'invalid' && Boolean(props.toHandle);
  const stroke = invalid ? 'var(--canvas-connection-invalid)' : 'var(--accent)';
  return <g aria-label={t(`node.connection.${invalid ? 'invalid' : 'valid'}`)}>
    <path d={path} fill="none" style={{ ...props.connectionLineStyle, stroke }} />
    <circle cx={props.toX} cy={props.toY} r={4} fill={stroke} />
    {invalid && <text x={props.toX + 12} y={props.toY - 12} fill={stroke} fontSize={12}>
      {t('node.connection.invalid')}
    </text>}
  </g>;
}
