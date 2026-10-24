/** A canvas image the user attached to a message; its position in `refs` is its 图片N number. */
export interface AgentRef {
  nodeId: string;
}

/** Metadata stored on user messages. Assistant messages carry none. */
export interface AgentMessageMetadata {
  refs?: AgentRef[];
  /**
   * Image count the user explicitly asked for in this message ("出 4 张"), parsed on send.
   * The model never reports it, so it cannot inflate its own budget.
   */
  requestedImageCount?: number | null;
}

export interface AgentTurnBudget {
  limit: number;
  used: number;
}

export type AgentImageStatus = 'generating' | 'ready' | 'failed' | 'missing';

export interface AgentImageState {
  nodeId: string;
  status: AgentImageStatus;
  error?: string;
}

export const AGENT_MAX_DRAFT_REFS = 6;

/** A chip in the composer. Uploads have no node until the message is sent. */
export interface AgentDraftRef {
  id: string;
  nodeId: string | null;
  name: string;
  thumbnail: string;
  /** Data URL of an upload, imported onto the canvas on send. */
  source?: string;
}

export interface AgentDraft {
  text: string;
  refs: AgentDraftRef[];
}

export interface AgentNodeOrigin {
  threadId: string;
  messageId: string;
}
