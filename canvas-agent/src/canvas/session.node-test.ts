import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { ServerResponse } from 'node:http';

import { CANVAS_AGENT_PROTOCOL_VERSION, type CanvasSnapshot } from './protocol.js';
import { CanvasSession } from './session.js';

class TestResponse extends EventEmitter {
  chunks: string[] = [];

  writeHead(): this {
    return this;
  }

  write(value: string): boolean {
    this.chunks.push(value);
    return true;
  }

  end(): this {
    this.emit('close');
    return this;
  }
}

function snapshot(
  revision = 'revision-1',
  selectedImagePreviews: CanvasSnapshot['selectedImagePreviews'] = []
): CanvasSnapshot {
  return {
    protocolVersion: CANVAS_AGENT_PROTOCOL_VERSION,
    projectId: 'project-1',
    projectName: 'Project',
    revision,
    nodes: [{ id: 'node-1', type: 'textAnnotationNode' }],
    edges: [],
    selectedNodeIds: ['node-1'],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedImagePreviews,
    capabilities: { nodeTypes: [] },
  };
}

test('returns a structured error when no active live canvas exists', () => {
  const session = new CanvasSession();
  assert.throws(
    () => session.callTool('canvas_get_state', {}),
    (error: unknown) => Boolean(
      error
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'NO_ACTIVE_CANVAS'
    )
  );
});

test('creates a pending proposal and marks it stale after a revision change', () => {
  const session = new CanvasSession();
  const response = new TestResponse();
  session.openEvents('client-1', response as unknown as ServerResponse);
  session.updateState('client-1', snapshot());

  const created = session.callTool('canvas_propose_changes', {
    projectId: 'project-1',
    baseRevision: 'revision-1',
    summary: 'Create an annotation',
    operations: [{
      type: 'create_node',
      clientId: 'draft-note',
      nodeType: 'textAnnotationNode',
      position: { x: 20, y: 30 },
      data: { content: 'Draft' },
    }],
  }) as { proposalId: string; status: string };

  assert.equal(created.status, 'pending');
  assert.match(response.chunks.join(''), /change_proposal/);

  session.updateState('client-1', snapshot('revision-2'));
  const status = session.callTool('canvas_get_change_status', {
    proposalId: created.proposalId,
  }) as { status: string; error?: string };
  assert.equal(status.status, 'stale');
  assert.equal(status.error, 'canvas_changed');

  response.end();
});

test('records one applied change-set result for polling', () => {
  const session = new CanvasSession();
  const response = new TestResponse();
  session.openEvents('client-1', response as unknown as ServerResponse);
  session.updateState('client-1', snapshot());
  const created = session.callTool('canvas_propose_changes', {
    projectId: 'project-1',
    baseRevision: 'revision-1',
    summary: 'Move a node',
    operations: [{
      type: 'move_node',
      nodeId: 'node-1',
      position: { x: 120, y: 80 },
    }],
  }) as { proposalId: string };

  session.resolveProposal('client-1', created.proposalId, 'applied', {
    updatedNodeIds: ['node-1'],
  });
  const status = session.callTool('canvas_get_change_status', {
    proposalId: created.proposalId,
  }) as { status: string; result: unknown };
  assert.equal(status.status, 'applied');
  assert.deepEqual(status.result, { updatedNodeIds: ['node-1'] });

  response.end();
});

test('preserves selected previews across lightweight snapshot heartbeats', () => {
  const session = new CanvasSession();
  const response = new TestResponse();
  session.openEvents('client-1', response as unknown as ServerResponse);
  session.updateState('client-1', snapshot('revision-1', [{
    nodeId: 'node-1',
    mimeType: 'image/jpeg',
    dataUrl: 'data:image/jpeg;base64,preview',
  }]));
  const { selectedImagePreviews: _previews, ...lightweightSnapshot } = snapshot('revision-2');
  session.updateState('client-1', lightweightSnapshot);

  const state = session.callTool('canvas_get_state', {}) as CanvasSnapshot;
  assert.deepEqual(state.selectedImagePreviews, [{
    nodeId: 'node-1',
    mimeType: 'image/jpeg',
    dataUrl: 'data:image/jpeg;base64,preview',
  }]);

  response.end();
});

test('records an applied result that arrives after its committed snapshot', () => {
  const session = new CanvasSession();
  const response = new TestResponse();
  session.openEvents('client-1', response as unknown as ServerResponse);
  session.updateState('client-1', snapshot('revision-1'));
  const created = session.callTool('canvas_propose_changes', {
    projectId: 'project-1',
    baseRevision: 'revision-1',
    summary: 'Move a node',
    operations: [{
      type: 'move_node',
      nodeId: 'node-1',
      position: { x: 10, y: 20 },
    }],
  }) as { proposalId: string };

  session.updateState('client-1', snapshot('revision-after-apply'));
  session.resolveProposal('client-1', created.proposalId, 'applied', { movedNodeIds: ['node-1'] });

  const status = session.callTool('canvas_get_change_status', {
    proposalId: created.proposalId,
  }) as { status: string; result?: unknown };
  assert.equal(status.status, 'applied');
  assert.deepEqual(status.result, { movedNodeIds: ['node-1'] });

  response.end();
});
