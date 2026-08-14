import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiModal } from '@/components/ui';
import { getNodeDefinition } from '@/features/canvas/domain/nodeRegistry';
import type {
  CanvasChangeOperation,
  PendingCanvasChangeProposal,
} from '@/features/canvas-agent/domain/types';

interface CanvasChangeApprovalDialogProps {
  proposal: PendingCanvasChangeProposal | null;
  onApprove: () => void;
  onReject: () => void;
}

export function CanvasChangeApprovalDialog({
  proposal,
  onApprove,
  onReject,
}: CanvasChangeApprovalDialogProps) {
  const { t } = useTranslation();
  const operationRows = useMemo(
    () => proposal?.changeSet.operations.map((operation, index) => ({
      key: `${operation.type}-${index}`,
      label: describeOperation(operation, t),
      detail: describeOperationDetail(operation),
    })) ?? [],
    [proposal, t]
  );

  return (
    <UiModal
      isOpen={Boolean(proposal)}
      title={t('externalAgentApproval.title')}
      closeLabel={t('common.close')}
      onClose={onReject}
      widthClassName="w-[min(92vw,560px)]"
      footer={(
        <>
          <UiButton size="sm" onClick={onReject}>
            {t('externalAgentApproval.reject')}
          </UiButton>
          <UiButton size="sm" variant="primary" onClick={onApprove}>
            {t('externalAgentApproval.approve')}
          </UiButton>
        </>
      )}
    >
      <p className="text-sm text-text-dark">{proposal?.changeSet.summary ?? ''}</p>
      <div className="mt-4 max-h-[min(52vh,360px)] overflow-y-auto border-y border-[var(--ui-border-soft)]">
        {operationRows.map((row, index) => (
          <div
            key={row.key}
            className="flex min-h-10 items-start gap-3 border-b border-[var(--ui-border-soft)] px-1 py-2.5 last:border-b-0"
          >
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-[var(--ui-surface-field)] px-1 text-[11px] text-text-muted">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words text-xs leading-5 text-text-dark">{row.label}</p>
              {row.detail && (
                <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--ui-surface-field)] px-2.5 py-2 font-mono text-[11px] leading-4 text-text-muted">
                  {row.detail}
                </pre>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-text-muted">
        {t('externalAgentApproval.undoHint')}
      </p>
    </UiModal>
  );
}

function describeOperation(
  operation: CanvasChangeOperation,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (operation.type === 'create_node') {
    return t('externalAgentApproval.createNode', {
      type: t(getNodeDefinition(operation.nodeType).menuLabelKey),
      id: operation.clientId,
    });
  }
  if (operation.type === 'update_node') {
    return t('externalAgentApproval.updateNode', {
      id: operation.nodeId,
      fields: Object.keys(operation.data).join(', '),
    });
  }
  if (operation.type === 'move_node') {
    return t('externalAgentApproval.moveNode', {
      id: operation.nodeId,
      x: operation.position.x,
      y: operation.position.y,
    });
  }
  return t('externalAgentApproval.connectNodes', {
    source: operation.sourceNodeId,
    target: operation.targetNodeId,
  });
}

function describeOperationDetail(operation: CanvasChangeOperation): string {
  if (operation.type === 'create_node') {
    return JSON.stringify({
      position: operation.position,
      data: operation.data ?? {},
    }, null, 2);
  }
  if (operation.type === 'update_node') {
    return JSON.stringify(operation.data, null, 2);
  }
  if (operation.type === 'move_node') {
    return JSON.stringify({ position: operation.position }, null, 2);
  }
  if (operation.type === 'connect_nodes') {
    return JSON.stringify({
      sourceHandle: operation.sourceHandle ?? 'source',
      targetHandle: operation.targetHandle ?? 'auto',
    }, null, 2);
  }
  return '';
}
