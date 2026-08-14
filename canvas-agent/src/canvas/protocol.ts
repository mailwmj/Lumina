import { z } from 'zod';

export const CANVAS_AGENT_PROTOCOL_VERSION = 1;

export const canvasAgentToolNames = [
  'canvas_get_state',
  'canvas_get_selection',
  'canvas_get_capabilities',
  'canvas_propose_changes',
  'canvas_get_change_status',
] as const;

export type CanvasAgentToolName = (typeof canvasAgentToolNames)[number];

const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
}).strict();

const nodeDataSchema = z.record(z.unknown());

export const canvasChangeOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_node'),
    clientId: z.string().trim().min(1).max(80),
    nodeType: z.string().trim().min(1).max(80),
    position: positionSchema,
    data: nodeDataSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal('update_node'),
    nodeId: z.string().trim().min(1).max(160),
    data: nodeDataSchema,
  }).strict(),
  z.object({
    type: z.literal('move_node'),
    nodeId: z.string().trim().min(1).max(160),
    position: positionSchema,
  }).strict(),
  z.object({
    type: z.literal('connect_nodes'),
    sourceNodeId: z.string().trim().min(1).max(160),
    targetNodeId: z.string().trim().min(1).max(160),
    sourceHandle: z.string().trim().min(1).max(80).optional(),
    targetHandle: z.string().trim().min(1).max(80).optional(),
  }).strict(),
]);

export const canvasChangeSetSchema = z.object({
  projectId: z.string().trim().min(1).max(160),
  baseRevision: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(500),
  operations: z.array(canvasChangeOperationSchema).min(1).max(100),
}).strict();

export type CanvasChangeSet = z.infer<typeof canvasChangeSetSchema>;

export const canvasAgentToolSchemas = {
  canvas_get_state: z.object({}).strict(),
  canvas_get_selection: z.object({}).strict(),
  canvas_get_capabilities: z.object({}).strict(),
  canvas_propose_changes: canvasChangeSetSchema,
  canvas_get_change_status: z.object({
    proposalId: z.string().uuid(),
  }).strict(),
} satisfies Record<CanvasAgentToolName, z.AnyZodObject>;

export const canvasAgentToolDescriptions: Record<CanvasAgentToolName, string> = {
  canvas_get_state: 'Read the live state of the project currently open in Lumina, including nodes, edges, selection, viewport, revision, and selected image previews.',
  canvas_get_selection: 'Read the currently selected Lumina canvas nodes and any explicitly selected compressed image previews.',
  canvas_get_capabilities: 'Read the node types, editable fields, and connection capabilities allowed for external Agents.',
  canvas_propose_changes: 'Submit one bounded CanvasChangeSet for review in Lumina. This never mutates the canvas until the user approves the whole proposal.',
  canvas_get_change_status: 'Poll the status of a previously submitted canvas change proposal.',
};

export interface CanvasSnapshot {
  protocolVersion: number;
  projectId: string;
  projectName: string;
  revision: string;
  nodes: Array<Record<string, unknown> & { id: string }>;
  edges: Array<Record<string, unknown> & { id: string }>;
  selectedNodeIds: string[];
  viewport: { x: number; y: number; zoom: number };
  selectedImagePreviews: Array<{
    nodeId: string;
    mimeType: string;
    dataUrl: string;
  }>;
  capabilities: unknown;
}

export type CanvasProposalStatus = 'pending' | 'applied' | 'rejected' | 'stale' | 'failed';

export interface CanvasProposalRecord {
  proposalId: string;
  clientId: string;
  changeSet: CanvasChangeSet;
  status: CanvasProposalStatus;
  createdAt: number;
  updatedAt: number;
  result?: unknown;
  error?: string;
}

export interface CanvasAgentErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export class CanvasAgentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'CanvasAgentError';
  }

  toPayload(): CanvasAgentErrorPayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export function isCanvasAgentToolName(value: unknown): value is CanvasAgentToolName {
  return typeof value === 'string'
    && (canvasAgentToolNames as readonly string[]).includes(value);
}
