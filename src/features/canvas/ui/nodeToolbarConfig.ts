import { Position } from '@xyflow/react';

export const NODE_TOOLBAR_POSITION = Position.Top;
export const NODE_TOOLBAR_ALIGN = 'center' as const;
export const NODE_TOOLBAR_OFFSET = 16;
// Keep the detail panel above the 48px toolbar with an 8px gap.
export const NODE_TOOLBAR_POPOVER_OFFSET = NODE_TOOLBAR_OFFSET + 56;
export const NODE_TOOLBAR_CLASS = 'pointer-events-auto';
