export const NODE_SURFACE_SELECTED_CLASS =
  'border-accent shadow-[var(--node-selected-shadow)]';

export const NODE_SURFACE_IDLE_CLASS =
  'border-[var(--ui-border-strong)] hover:border-accent/35';

export type NodeSurfaceState = 'idle' | 'running' | 'error' | 'attention' | 'success';

const NODE_SURFACE_STATE_CLASSES: Record<NodeSurfaceState, string> = {
  idle: '',
  running: 'border-accent/70 shadow-[0_0_0_1px_rgba(99,102,241,0.18)]',
  error: 'border-red-500/70 bg-[rgba(127,29,29,0.12)]',
  attention: 'border-amber-500/65 bg-[rgba(120,83,13,0.12)]',
  success: 'border-emerald-500/45',
};

export function resolveNodeSurfaceStateClass(
  selected?: boolean,
  state: NodeSurfaceState = 'idle'
): string {
  const base = selected ? NODE_SURFACE_SELECTED_CLASS : NODE_SURFACE_IDLE_CLASS;
  return `${base} ${NODE_SURFACE_STATE_CLASSES[state]}`.trim();
}
