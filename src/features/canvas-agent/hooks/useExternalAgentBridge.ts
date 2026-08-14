import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CanvasEdge, CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { logger } from '@/lib/logger';
import {
  buildCanvasAgentSnapshot,
} from '@/features/canvas-agent/application/canvasAgentSnapshot';
import {
  parsePendingCanvasChangeProposal,
} from '@/features/canvas-agent/application/canvasChangeSet';
import {
  buildSelectedImagePreviews,
  type SelectedImagePreviewSource,
} from '@/features/canvas-agent/application/selectedImagePreviews';
import { useStableSelectedImagePreviewSources } from '@/features/canvas-agent/hooks/useStableSelectedImagePreviewSources';
import {
  consumeCanvasAgentEvents,
  postCanvasProposalResult,
  resolveCanvasAgentEndpoint,
  type CanvasAgentEndpoint,
} from '@/features/canvas-agent/infrastructure/canvasAgentBridge';
import { CanvasAgentSnapshotPublisher } from '@/features/canvas-agent/infrastructure/canvasAgentSnapshotPublisher';
import type {
  CanvasAgentConnectionStatus,
  CanvasAgentImagePreview,
  CanvasAgentSnapshot,
  PendingCanvasChangeProposal,
} from '@/features/canvas-agent/domain/types';
import type { Viewport } from '@xyflow/react';

interface UseExternalAgentBridgeInput {
  projectId: string;
  projectName: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeIds: string[];
  viewport: Viewport;
}

const RECONNECT_DELAY_MS = 1_200;
const SNAPSHOT_PUBLISH_DELAY_MS = 100;
const SNAPSHOT_HEARTBEAT_MS = 5_000;
const EMPTY_IMAGE_PREVIEWS: CanvasAgentImagePreview[] = [];

export function useExternalAgentBridge({
  projectId,
  projectName,
  nodes,
  edges,
  selectedNodeIds,
  viewport,
}: UseExternalAgentBridgeInput) {
  const connectionConfig = useSettingsStore((state) => state.externalAgentConnection);
  const endpoint = useMemo(
    () => resolveCanvasAgentEndpoint(connectionConfig),
    [connectionConfig]
  );
  const clientIdRef = useRef(crypto.randomUUID());
  const [connectionStatus, setConnectionStatus] = useState<CanvasAgentConnectionStatus>(
    connectionConfig.enabled ? 'disconnected' : 'disabled'
  );
  const [pendingProposal, setPendingProposal] =
    useState<PendingCanvasChangeProposal | null>(null);
  const pendingProposalRef = useRef<PendingCanvasChangeProposal | null>(null);
  const selectedImagePreviewSources = useStableSelectedImagePreviewSources(
    nodes,
    selectedNodeIds
  );
  const [imagePreviewState, setImagePreviewState] = useState<{
    sources: SelectedImagePreviewSource[];
    previews: CanvasAgentImagePreview[];
  }>(() => ({ sources: [], previews: [] }));
  const selectedImagePreviews = imagePreviewState.sources === selectedImagePreviewSources
    ? imagePreviewState.previews
    : EMPTY_IMAGE_PREVIEWS;
  const baseSnapshot = useMemo(
    () => buildCanvasAgentSnapshot({
      projectId,
      projectName,
      nodes,
      edges,
      selectedNodeIds,
      viewport,
      selectedImagePreviews,
    }),
    [edges, nodes, projectId, projectName, selectedImagePreviews, selectedNodeIds, viewport]
  );
  const snapshotRef = useRef<CanvasAgentSnapshot>(baseSnapshot);
  snapshotRef.current = baseSnapshot;
  const previewMarker = useMemo(() => ({
    selection: selectedImagePreviewSources,
    previews: selectedImagePreviews,
  }), [selectedImagePreviewSources, selectedImagePreviews]);
  const previewMarkerRef = useRef(previewMarker);
  previewMarkerRef.current = previewMarker;
  const snapshotPublisherRef = useRef<CanvasAgentSnapshotPublisher | null>(null);
  if (!snapshotPublisherRef.current) {
    snapshotPublisherRef.current = new CanvasAgentSnapshotPublisher((error) => {
      logger.debug('[ExternalAgent] Failed to publish canvas snapshot', error);
    });
  }

  const updatePendingProposal = useCallback((proposal: PendingCanvasChangeProposal | null) => {
    pendingProposalRef.current = proposal;
    setPendingProposal(proposal);
  }, []);
  const reportProposal = useCallback((
    activeEndpoint: CanvasAgentEndpoint,
    proposalId: string,
    status: 'applied' | 'rejected' | 'stale' | 'failed',
    result?: unknown,
    error?: string
  ) => postCanvasProposalResult(activeEndpoint, clientIdRef.current, {
    proposalId,
    status,
    ...(result === undefined ? {} : { result }),
    ...(error ? { error } : {}),
  }).catch((requestError) => {
    logger.debug('[ExternalAgent] Failed to report proposal result', requestError);
  }), []);

  useEffect(() => {
    let cancelled = false;
    if (selectedImagePreviewSources.length === 0) {
      setImagePreviewState((current) => (
        current.sources === selectedImagePreviewSources && current.previews.length === 0
          ? current
          : { sources: selectedImagePreviewSources, previews: [] }
      ));
      return () => {
        cancelled = true;
      };
    }
    void buildSelectedImagePreviews(selectedImagePreviewSources).then((previews) => {
      if (cancelled) {
        return;
      }
      setImagePreviewState({ sources: selectedImagePreviewSources, previews });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedImagePreviewSources]);

  const queueSnapshotPublish = useCallback((
    activeEndpoint: CanvasAgentEndpoint,
    forcePreviews = false
  ) => {
    snapshotPublisherRef.current?.enqueue({
      endpoint: activeEndpoint,
      clientId: clientIdRef.current,
      snapshot: snapshotRef.current,
      previewMarker: previewMarkerRef.current,
      forcePreviews,
    });
  }, []);

  useEffect(() => {
    if (!connectionConfig.enabled) {
      setConnectionStatus('disabled');
      updatePendingProposal(null);
      return;
    }
    if (!endpoint) {
      setConnectionStatus('disconnected');
      return;
    }

    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof window.setTimeout> | null = null;
    const connect = async () => {
      if (controller.signal.aborted) {
        return;
      }
      setConnectionStatus('connecting');
      try {
        await consumeCanvasAgentEvents(
          endpoint,
          clientIdRef.current,
          controller.signal,
          {
            onOpen: () => {
              setConnectionStatus('connected');
              queueSnapshotPublish(endpoint, true);
            },
            onEvent: (event) => {
              if (event.type !== 'change_proposal') {
                return;
              }
              handleProposalEvent(endpoint, event.payload);
            },
          }
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          logger.debug('[ExternalAgent] Canvas Agent connection unavailable', error);
        }
      }
      if (!controller.signal.aborted) {
        setConnectionStatus('disconnected');
        const proposal = pendingProposalRef.current;
        if (proposal) {
          void reportProposal(
            endpoint,
            proposal.proposalId,
            'stale',
            undefined,
            'canvas_disconnected'
          );
          updatePendingProposal(null);
        }
        reconnectTimer = window.setTimeout(() => {
          void connect();
        }, RECONNECT_DELAY_MS);
      }
    };

    const handleProposalEvent = (activeEndpoint: CanvasAgentEndpoint, payload: unknown) => {
      try {
        const proposal = parsePendingCanvasChangeProposal(payload);
        const current = snapshotRef.current;
        if (
          proposal.changeSet.projectId !== current.projectId
          || proposal.changeSet.baseRevision !== current.revision
        ) {
          void reportProposal(activeEndpoint, proposal.proposalId, 'stale', undefined, 'canvas_changed');
          return;
        }
        if (pendingProposalRef.current) {
          void reportProposal(activeEndpoint, proposal.proposalId, 'failed', undefined, 'proposal_already_open');
          return;
        }
        updatePendingProposal(proposal);
      } catch (error) {
        const proposalId = readProposalId(payload);
        if (proposalId) {
          void reportProposal(
            activeEndpoint,
            proposalId,
            'failed',
            undefined,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    };

    void connect();
    return () => {
      const proposal = pendingProposalRef.current;
      if (proposal) {
        void reportProposal(
          endpoint,
          proposal.proposalId,
          'stale',
          undefined,
          'canvas_disconnected'
        );
        updatePendingProposal(null);
      }
      controller.abort();
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
    };
  }, [
    connectionConfig.enabled,
    endpoint,
    queueSnapshotPublish,
    reportProposal,
    updatePendingProposal,
  ]);

  useEffect(() => {
    if (!endpoint || connectionStatus !== 'connected') {
      return;
    }
    const timer = window.setTimeout(() => {
      queueSnapshotPublish(endpoint);
    }, SNAPSHOT_PUBLISH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [baseSnapshot, connectionStatus, endpoint, queueSnapshotPublish]);

  useEffect(() => {
    if (!endpoint || connectionStatus !== 'connected') {
      return;
    }
    const timer = window.setInterval(() => {
      queueSnapshotPublish(endpoint);
    }, SNAPSHOT_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [connectionStatus, endpoint, queueSnapshotPublish]);

  useEffect(() => {
    const proposal = pendingProposalRef.current;
    if (
      !proposal
      || (
        proposal.changeSet.projectId === baseSnapshot.projectId
        && proposal.changeSet.baseRevision === baseSnapshot.revision
      )
    ) {
      return;
    }
    if (endpoint) {
      void reportProposal(endpoint, proposal.proposalId, 'stale', undefined, 'canvas_changed');
    }
    updatePendingProposal(null);
  }, [
    baseSnapshot.projectId,
    baseSnapshot.revision,
    endpoint,
    reportProposal,
    updatePendingProposal,
  ]);

  const approveProposal = useCallback(() => {
    const proposal = pendingProposalRef.current;
    if (!proposal || !endpoint) {
      return;
    }
    const project = useProjectStore.getState().getCurrentProject();
    const canvas = useCanvasStore.getState();
    if (!project) {
      void reportProposal(endpoint, proposal.proposalId, 'stale', undefined, 'project_closed');
      updatePendingProposal(null);
      return;
    }
    const liveSnapshot = buildCanvasAgentSnapshot({
      projectId: project.id,
      projectName: project.name,
      nodes: canvas.nodes,
      edges: canvas.edges,
      selectedNodeIds: canvas.nodes.filter((node) => node.selected).map((node) => node.id),
      viewport: canvas.currentViewport,
    });
    if (
      proposal.changeSet.projectId !== liveSnapshot.projectId
      || proposal.changeSet.baseRevision !== liveSnapshot.revision
    ) {
      void reportProposal(endpoint, proposal.proposalId, 'stale', undefined, 'canvas_changed');
      updatePendingProposal(null);
      return;
    }
    try {
      const result = canvas.applyAgentChangeSet(proposal.changeSet);
      void reportProposal(endpoint, proposal.proposalId, 'applied', result);
    } catch (error) {
      void reportProposal(
        endpoint,
        proposal.proposalId,
        'failed',
        undefined,
        error instanceof Error ? error.message : String(error)
      );
    }
    updatePendingProposal(null);
  }, [endpoint, reportProposal, updatePendingProposal]);

  const rejectProposal = useCallback(() => {
    const proposal = pendingProposalRef.current;
    if (!proposal) {
      return;
    }
    if (endpoint) {
      void reportProposal(endpoint, proposal.proposalId, 'rejected');
    }
    updatePendingProposal(null);
  }, [endpoint, reportProposal, updatePendingProposal]);

  return {
    connectionStatus,
    pendingProposal,
    approveProposal,
    rejectProposal,
  };
}

function readProposalId(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return '';
  }
  const proposalId = (value as Record<string, unknown>).proposalId;
  return typeof proposalId === 'string' ? proposalId : '';
}
