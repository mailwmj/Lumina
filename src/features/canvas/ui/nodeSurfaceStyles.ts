export const NODE_SURFACE_SELECTED_CLASS =
  'border-accent shadow-[var(--node-selected-shadow)]';

export const NODE_SURFACE_IDLE_CLASS =
  'border-[var(--ui-border-strong)] hover:border-accent/35';

export type NodeStatusTone = 'danger' | 'warning';

const NODE_STATUS_SELECTED_CLASS: Record<NodeStatusTone, string> = {
  danger: 'border-danger shadow-[0_0_0_1px_rgb(var(--danger-rgb)/0.42)]',
  warning: 'border-warning shadow-[0_0_0_1px_rgb(var(--warning-rgb)/0.38)]',
};

const NODE_STATUS_IDLE_CLASS: Record<NodeStatusTone, string> = {
  danger: 'border-danger/70 bg-danger/10 hover:border-danger',
  warning: 'border-warning/65 bg-warning/10 hover:border-warning',
};

export function resolveNodeSurfaceStateClass(selected?: boolean): string {
  return selected ? NODE_SURFACE_SELECTED_CLASS : NODE_SURFACE_IDLE_CLASS;
}

export function resolveNodeStatusSurfaceClass(tone: NodeStatusTone, selected?: boolean): string {
  return selected ? NODE_STATUS_SELECTED_CLASS[tone] : NODE_STATUS_IDLE_CLASS[tone];
}
