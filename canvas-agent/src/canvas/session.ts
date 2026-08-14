import crypto from 'node:crypto';
import type { ServerResponse } from 'node:http';

import {
  CANVAS_AGENT_PROTOCOL_VERSION,
  CanvasAgentError,
  type CanvasAgentToolName,
  type CanvasChangeSet,
  type CanvasProposalRecord,
  type CanvasProposalStatus,
  type CanvasSnapshot,
} from './protocol.js';

const ACTIVE_CANVAS_TTL_MS = 15_000;
const PROPOSAL_TTL_MS = 10 * 60_000;
const MAX_RETAINED_PROPOSALS = 100;
const MAX_SELECTED_IMAGE_PREVIEWS = 6;
const MAX_PREVIEW_DATA_URL_LENGTH = 1_500_000;

interface CanvasClientState {
  snapshot: CanvasSnapshot;
  updatedAt: number;
}

export class CanvasSession {
  private readonly clients = new Map<string, ServerResponse>();
  private readonly canvasStates = new Map<string, CanvasClientState>();
  private readonly proposals = new Map<string, CanvasProposalRecord>();
  private activeClientId = '';

  health(): { ok: true; protocolVersion: number; hasActiveCanvas: boolean } {
    return {
      ok: true,
      protocolVersion: CANVAS_AGENT_PROTOCOL_VERSION,
      hasActiveCanvas: Boolean(this.resolveActiveState(false)),
    };
  }

  openEvents(clientId: string, response: ServerResponse): void {
    const resolvedClientId = clientId || crypto.randomUUID();
    const previous = this.clients.get(resolvedClientId);
    if (previous && previous !== response) {
      this.markClientProposalsStale(resolvedClientId, 'canvas_disconnected');
      previous.end();
    }
    this.canvasStates.delete(resolvedClientId);
    this.clients.set(resolvedClientId, response);
    this.activeClientId = resolvedClientId;
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    sendEvent(response, 'hello', {
      ok: true,
      protocolVersion: CANVAS_AGENT_PROTOCOL_VERSION,
      clientId: resolvedClientId,
    });
    const timer = setInterval(() => sendEvent(response, 'ping', { time: Date.now() }), 10_000);
    response.on('close', () => {
      clearInterval(timer);
      if (this.clients.get(resolvedClientId) !== response) {
        return;
      }
      this.clients.delete(resolvedClientId);
      this.canvasStates.delete(resolvedClientId);
      this.markClientProposalsStale(resolvedClientId, 'canvas_disconnected');
      if (this.activeClientId === resolvedClientId) {
        this.activeClientId = [...this.clients.keys()][0] ?? '';
      }
    });
  }

  updateState(clientId: string, value: unknown): void {
    if (!clientId || !this.clients.has(clientId)) {
      throw new CanvasAgentError('CANVAS_NOT_CONNECTED', 'The Lumina canvas event stream is not connected.');
    }
    const previous = this.canvasStates.get(clientId)?.snapshot;
    const snapshot = parseCanvasSnapshot(value, previous);
    this.canvasStates.set(clientId, { snapshot, updatedAt: Date.now() });
    this.activeClientId = clientId;
    if (
      previous
      && (previous.projectId !== snapshot.projectId || previous.revision !== snapshot.revision)
    ) {
      this.proposals.forEach((proposal) => {
        if (
          proposal.clientId === clientId
          && proposal.status === 'pending'
          && (
            proposal.changeSet.projectId !== snapshot.projectId
            || proposal.changeSet.baseRevision !== snapshot.revision
          )
        ) {
          this.updateProposalRecord(proposal, 'stale', undefined, 'canvas_changed');
        }
      });
    }
  }

  resolveProposal(
    clientId: string,
    proposalId: string,
    status: Exclude<CanvasProposalStatus, 'pending'>,
    result?: unknown,
    error?: string
  ): CanvasProposalRecord {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.clientId !== clientId) {
      throw new CanvasAgentError('PROPOSAL_NOT_FOUND', 'The canvas change proposal was not found.');
    }
    if (
      proposal.status !== 'pending'
      && !(proposal.status === 'stale' && proposal.error === 'canvas_changed' && status === 'applied')
    ) {
      return proposal;
    }
    this.updateProposalRecord(proposal, status, result, error);
    return proposal;
  }

  callTool(name: CanvasAgentToolName, input: Record<string, unknown>): unknown {
    this.pruneProposals();
    if (name === 'canvas_get_change_status') {
      return this.getProposalStatus(String(input.proposalId ?? ''));
    }

    const { clientId, snapshot } = this.requireActiveState();
    if (name === 'canvas_get_state') {
      return snapshot;
    }
    if (name === 'canvas_get_selection') {
      const selectedIds = new Set(snapshot.selectedNodeIds);
      return {
        projectId: snapshot.projectId,
        revision: snapshot.revision,
        nodes: snapshot.nodes.filter((node) => selectedIds.has(node.id)),
        imagePreviews: snapshot.selectedImagePreviews,
      };
    }
    if (name === 'canvas_get_capabilities') {
      return {
        projectId: snapshot.projectId,
        revision: snapshot.revision,
        capabilities: snapshot.capabilities,
      };
    }

    return this.createProposal(clientId, snapshot, input as unknown as CanvasChangeSet);
  }

  private createProposal(
    clientId: string,
    snapshot: CanvasSnapshot,
    changeSet: CanvasChangeSet
  ): Pick<CanvasProposalRecord, 'proposalId' | 'status' | 'createdAt' | 'updatedAt'> {
    if (changeSet.projectId !== snapshot.projectId) {
      throw new CanvasAgentError('PROJECT_CHANGED', 'The active Lumina project no longer matches the proposal.', {
        activeProjectId: snapshot.projectId,
      });
    }
    if (changeSet.baseRevision !== snapshot.revision) {
      throw new CanvasAgentError('REVISION_STALE', 'The canvas changed after the Agent read it.', {
        activeRevision: snapshot.revision,
      });
    }
    const pendingProposal = [...this.proposals.values()].find(
      (proposal) => proposal.clientId === clientId && proposal.status === 'pending'
    );
    if (pendingProposal) {
      throw new CanvasAgentError('PROPOSAL_PENDING', 'Another canvas change set is still being applied.', {
        proposalId: pendingProposal.proposalId,
      });
    }

    const now = Date.now();
    const proposal: CanvasProposalRecord = {
      proposalId: crypto.randomUUID(),
      clientId,
      changeSet,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    this.proposals.set(proposal.proposalId, proposal);
    const client = this.clients.get(clientId);
    if (!client) {
      this.updateProposalRecord(proposal, 'stale', undefined, 'canvas_disconnected');
      throw new CanvasAgentError('NO_ACTIVE_CANVAS', 'No active Lumina canvas is connected.');
    }
    sendEvent(client, 'change_proposal', {
      proposalId: proposal.proposalId,
      changeSet: proposal.changeSet,
      createdAt: proposal.createdAt,
    });
    return {
      proposalId: proposal.proposalId,
      status: proposal.status,
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
    };
  }

  private getProposalStatus(proposalId: string): Omit<CanvasProposalRecord, 'clientId' | 'changeSet'> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new CanvasAgentError('PROPOSAL_NOT_FOUND', 'The canvas change proposal was not found.');
    }
    return {
      proposalId: proposal.proposalId,
      status: proposal.status,
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
      ...(proposal.result === undefined ? {} : { result: proposal.result }),
      ...(proposal.error ? { error: proposal.error } : {}),
    };
  }

  private requireActiveState(): { clientId: string; snapshot: CanvasSnapshot } {
    const state = this.resolveActiveState(true);
    if (!state) {
      throw new CanvasAgentError('NO_ACTIVE_CANVAS', 'No active Lumina canvas is connected.');
    }
    return state;
  }

  private resolveActiveState(
    throwOnExpired: boolean
  ): { clientId: string; snapshot: CanvasSnapshot } | null {
    const clientId = this.activeClientId;
    const state = this.canvasStates.get(clientId);
    if (!clientId || !this.clients.has(clientId) || !state) {
      return null;
    }
    if (Date.now() - state.updatedAt > ACTIVE_CANVAS_TTL_MS) {
      if (throwOnExpired) {
        throw new CanvasAgentError('NO_ACTIVE_CANVAS', 'The connected Lumina canvas stopped publishing live state.');
      }
      return null;
    }
    return { clientId, snapshot: state.snapshot };
  }

  private markClientProposalsStale(clientId: string, reason: string): void {
    this.proposals.forEach((proposal) => {
      if (proposal.clientId === clientId && proposal.status === 'pending') {
        this.updateProposalRecord(proposal, 'stale', undefined, reason);
      }
    });
  }

  private updateProposalRecord(
    proposal: CanvasProposalRecord,
    status: CanvasProposalStatus,
    result?: unknown,
    error?: string
  ): void {
    proposal.status = status;
    proposal.updatedAt = Date.now();
    proposal.result = result;
    proposal.error = error;
  }

  private pruneProposals(): void {
    const now = Date.now();
    this.proposals.forEach((proposal, proposalId) => {
      if (proposal.status === 'pending' && now - proposal.createdAt > PROPOSAL_TTL_MS) {
        this.updateProposalRecord(proposal, 'stale', undefined, 'proposal_expired');
      }
      if (now - proposal.updatedAt > PROPOSAL_TTL_MS) {
        this.proposals.delete(proposalId);
      }
    });
    while (this.proposals.size > MAX_RETAINED_PROPOSALS) {
      const oldestId = this.proposals.keys().next().value as string | undefined;
      if (!oldestId) {
        break;
      }
      this.proposals.delete(oldestId);
    }
  }
}

function parseCanvasSnapshot(
  value: unknown,
  previous?: CanvasSnapshot
): CanvasSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CanvasAgentError('INVALID_SNAPSHOT', 'The canvas snapshot is invalid.');
  }
  const snapshot = value as Partial<CanvasSnapshot>;
  if (
    snapshot.protocolVersion !== CANVAS_AGENT_PROTOCOL_VERSION
    || typeof snapshot.projectId !== 'string'
    || !snapshot.projectId
    || typeof snapshot.projectName !== 'string'
    || typeof snapshot.revision !== 'string'
    || !snapshot.revision
    || !Array.isArray(snapshot.nodes)
    || !Array.isArray(snapshot.edges)
    || !Array.isArray(snapshot.selectedNodeIds)
    || !snapshot.viewport
    || snapshot.capabilities === undefined
  ) {
    throw new CanvasAgentError('INVALID_SNAPSHOT', 'The canvas snapshot is missing required fields.');
  }
  if (
    !snapshot.selectedNodeIds.every((nodeId) => typeof nodeId === 'string')
    || typeof snapshot.viewport.x !== 'number'
    || !Number.isFinite(snapshot.viewport.x)
    || typeof snapshot.viewport.y !== 'number'
    || !Number.isFinite(snapshot.viewport.y)
    || typeof snapshot.viewport.zoom !== 'number'
    || !Number.isFinite(snapshot.viewport.zoom)
  ) {
    throw new CanvasAgentError('INVALID_SNAPSHOT', 'The canvas snapshot contains invalid live state.');
  }

  const sameProject = previous?.projectId === snapshot.projectId;
  const rawPreviews = snapshot.selectedImagePreviews;
  const selectedNodeIds = new Set(snapshot.selectedNodeIds);
  const selectedImagePreviews = rawPreviews === undefined
    ? (sameProject ? previous?.selectedImagePreviews ?? [] : [])
    : parseSelectedImagePreviews(rawPreviews);

  return {
    ...(snapshot as CanvasSnapshot),
    selectedImagePreviews: selectedImagePreviews.filter((preview) => (
      selectedNodeIds.has(preview.nodeId)
    )),
  };
}

function parseSelectedImagePreviews(value: unknown): CanvasSnapshot['selectedImagePreviews'] {
  if (!Array.isArray(value) || value.length > MAX_SELECTED_IMAGE_PREVIEWS) {
    throw new CanvasAgentError('INVALID_SNAPSHOT', 'The selected image preview list is invalid.');
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new CanvasAgentError('INVALID_SNAPSHOT', 'A selected image preview is invalid.');
    }
    const preview = item as Record<string, unknown>;
    if (
      typeof preview.nodeId !== 'string'
      || !preview.nodeId
      || typeof preview.mimeType !== 'string'
      || !preview.mimeType.startsWith('image/')
      || typeof preview.dataUrl !== 'string'
      || !preview.dataUrl.startsWith('data:image/')
      || preview.dataUrl.length > MAX_PREVIEW_DATA_URL_LENGTH
    ) {
      throw new CanvasAgentError('INVALID_SNAPSHOT', 'A selected image preview is invalid.');
    }
    return {
      nodeId: preview.nodeId,
      mimeType: preview.mimeType,
      dataUrl: preview.dataUrl,
    };
  });
}

function sendEvent(response: ServerResponse, type: string, payload: unknown): void {
  response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}
