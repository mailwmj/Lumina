import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  getCanvasAgentRuntime,
  isCanvasAgentManagedByLumina,
  type CanvasAgentRuntimeInfo,
} from '@/commands/canvasAgent';
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
  const managedByLumina = isCanvasAgentManagedByLumina();
  const [managedRuntime, setManagedRuntime] = useState<CanvasAgentRuntimeInfo | null>(null);
  const manualEndpoint = useMemo(
    () => resolveCanvasAgentEndpoint(connectionConfig),
    [connectionConfig]
  );
  const endpoint = useMemo(
    () => {
      if (!connectionConfig.enabled) {
        return null;
      }
      if (!managedByLumina) {
        return manualEndpoint;
      }
      if (!managedRuntime?.running || !managedRuntime.url || !managedRuntime.token) {
        return null;
      }
      return { url: managedRuntime.url, token: managedRuntime.token };
    },
    [connectionConfig.enabled, managedByLumina, managedRuntime, manualEndpoint]
  );
  const clientIdRef = useRef(crypto.randomUUID());
  const [connectionStatus, setConnectionStatus] = useState<CanvasAgentConnectionStatus>(
    connectionConfig.enabled ? 'disconnected' : 'disabled'
  );
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

  const reportProposal = useCallback((
    activeEndpoint: CanvasAgentEndpoint,
    proposalId: string,
    status: 'applied' | 'stale' | 'failed',
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
    if (!managedByLumina) {
      setManagedRuntime(null);
      return;
    }
    let cancelled = false;
    const refreshRuntime = async () => {
      try {
        const runtime = await getCanvasAgentRuntime();
        if (!cancelled) {
          setManagedRuntime((current) => (
            haveSameManagedRuntime(current, runtime) ? current : runtime
          ));
        }
      } catch (error) {
        logger.debug('[ExternalAgent] Failed to read managed Canvas Agent runtime', error);
        if (!cancelled) {
          setManagedRuntime(null);
        }
      }
    };
    void refreshRuntime();
    const timer = window.setInterval(() => {
      void refreshRuntime();
    }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [managedByLumina]);

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
        reconnectTimer = window.setTimeout(() => {
          void connect();
        }, RECONNECT_DELAY_MS);
      }
    };

    const handleProposalEvent = (activeEndpoint: CanvasAgentEndpoint, payload: unknown) => {
      try {
        const proposal = parsePendingCanvasChangeProposal(payload);
        const project = useProjectStore.getState().getCurrentProject();
        const canvas = useCanvasStore.getState();
        if (!project) {
          void reportProposal(activeEndpoint, proposal.proposalId, 'stale', undefined, 'project_closed');
          return;
        }
        const current = buildCanvasAgentSnapshot({
          projectId: project.id,
          projectName: project.name,
          nodes: canvas.nodes,
          edges: canvas.edges,
          selectedNodeIds: canvas.nodes.filter((node) => node.selected).map((node) => node.id),
          viewport: canvas.currentViewport,
        });
        if (
          proposal.changeSet.projectId !== current.projectId
          || proposal.changeSet.baseRevision !== current.revision
        ) {
          void reportProposal(activeEndpoint, proposal.proposalId, 'stale', undefined, 'canvas_changed');
          return;
        }
        try {
          const result = canvas.applyAgentChangeSet(proposal.changeSet);
          void reportProposal(activeEndpoint, proposal.proposalId, 'applied', result);
        } catch (error) {
          void reportProposal(
            activeEndpoint,
            proposal.proposalId,
            'failed',
            undefined,
            error instanceof Error ? error.message : String(error)
          );
        }
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

  return {
    connectionStatus,
  };
}

function readProposalId(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return '';
  }
  const proposalId = (value as Record<string, unknown>).proposalId;
  return typeof proposalId === 'string' ? proposalId : '';
}

function haveSameManagedRuntime(
  current: CanvasAgentRuntimeInfo | null,
  next: CanvasAgentRuntimeInfo | null
): boolean {
  return current?.available === next?.available
    && current?.running === next?.running
    && current?.url === next?.url
    && current?.token === next?.token
    && current?.error === next?.error;
}
