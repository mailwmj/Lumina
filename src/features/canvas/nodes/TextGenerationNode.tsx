import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Handle,
  Position,
  useReactFlow,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiModal } from '@/components/ui';
import { AlertTriangle, Loader2, Sparkles, Square, X } from '@/components/ui/icons';
import {
  resolveTextGenerationInputs,
  type ResolvedTextGenerationInputs,
} from '@/features/canvas/application/textGenerationInputs';
import { textGenerationGateway } from '@/features/canvas/application/canvasServices';
import type { TextProviderRuntimeConfig } from '@/features/canvas/application/ports';
import {
  TextGenerationRunController,
  canStartTextGeneration,
} from '@/features/canvas/application/textGenerationRun';
import {
  TEXT_GENERATION_MAX_HEIGHT,
  TEXT_GENERATION_MAX_WIDTH,
  TEXT_GENERATION_MIN_HEIGHT,
  TEXT_GENERATION_MIN_WIDTH,
  resolveTextGenerationLayout,
} from '@/features/canvas/application/textGenerationLayout';
import { resolveTextModelSelection } from '@/features/canvas/application/textModelSelection';
import type { TextGenerationNodeData } from '@/features/canvas/domain/canvasNodes';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { resolveNodeSurfaceStateClass } from '@/features/canvas/ui/nodeSurfaceStyles';
import { TextModelSelector } from '@/features/canvas/ui/TextModelSelector';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { TextGenerationUpstreamContext } from './TextGenerationUpstreamContext';

type TextGenerationNodeProps = NodeProps & {
  id: string;
  data: TextGenerationNodeData;
  selected?: boolean;
};

interface RunSnapshot {
  prompt: string;
  referenceImages: string[];
  reasoningEffort: TextGenerationNodeData['textReasoningEffort'];
  apiConfig: TextProviderRuntimeConfig;
}

interface NodeError {
  message: string;
  details?: string;
}

function normalizeError(error: unknown, fallback: string): NodeError {
  if (error instanceof Error) {
    const details = typeof (error as Error & { details?: unknown }).details === 'string'
      ? (error as Error & { details?: string }).details
      : undefined;
    return { message: error.message || fallback, details };
  }
  if (typeof error === 'string') {
    return { message: error || fallback, details: error || undefined };
  }
  try {
    const details = JSON.stringify(error, null, 2);
    return { message: fallback, details };
  } catch {
    return { message: fallback };
  }
}

export const TextGenerationNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: TextGenerationNodeProps) => {
  const { t } = useTranslation();
  const reactFlow = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const deleteEdge = useCanvasStore((state) => state.deleteEdge);
  const reorderNodeInput = useCanvasStore((state) => state.reorderNodeInput);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const updateNodeDataCoalesced = useCanvasStore((state) => state.updateNodeDataCoalesced);
  const textApis = useSettingsStore((state) => state.textApis);
  const setLastTextGenerationModelSelection = useSettingsStore(
    (state) => state.setLastTextGenerationModelSelection
  );
  const controllerRef = useRef(new TextGenerationRunController<RunSnapshot>());
  const resultTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [nodeError, setNodeError] = useState<NodeError | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [resultScrollResetVersion, setResultScrollResetVersion] = useState(0);

  const generatedText = typeof data.generatedText === 'string' && data.generatedText.trim()
    ? data.generatedText
    : null;
  const inputs = useMemo<ResolvedTextGenerationInputs>(
    () => resolveTextGenerationInputs(id, nodes, edges),
    [edges, id, nodes]
  );
  const selectedModel = useMemo(
    () => resolveTextModelSelection(textApis, data.textApiId, data.textModelId),
    [data.textApiId, data.textModelId, textApis]
  );
  const hasContext = inputs.textInputs.length > 0 || inputs.imageInputs.length > 0;
  const layout = resolveTextGenerationLayout({
    width,
    height,
    hasContext,
    hasResult: Boolean(generatedText),
  });
  const unavailableImageNames = inputs.imageInputs
    .filter((input) => !input.imageUrl)
    .map((input) => input.displayName)
    .join(', ');
  const canGenerate = canStartTextGeneration({
    effectivePrompt: inputs.effectivePrompt,
    referenceImageCount: inputs.referenceImages.length,
    blockingImageCount: inputs.blockingImageNodeIds.length,
    hasResolvedModel: Boolean(selectedModel),
  });

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, layout.height, layout.width, updateNodeInternals]);

  useLayoutEffect(() => {
    if (resultScrollResetVersion > 0 && resultTextareaRef.current) {
      resultTextareaRef.current.scrollTop = 0;
    }
  }, [resultScrollResetVersion]);

  useEffect(() => () => {
    controllerRef.current.stop();
  }, []);

  const locateNode = useCallback((nodeId: string) => {
    setSelectedNode(nodeId);
    void reactFlow.fitView({ nodes: [{ id: nodeId }], padding: 0.65, duration: 240 });
  }, [reactFlow, setSelectedNode]);

  const stopRun = useCallback(() => {
    if (controllerRef.current.stop()) {
      setIsRunning(false);
      setNodeError(null);
    }
  }, []);

  const startRun = useCallback(async () => {
    if (controllerRef.current.isRunning()) {
      return;
    }
    if (inputs.blockingImageNodeIds.length > 0) {
      setNodeError({
        message: unavailableImageNames
          ? t('node.textGeneration.imageUnavailableSources', { names: unavailableImageNames })
          : t('node.textGeneration.imageUnavailable'),
      });
      return;
    }
    if (!inputs.effectivePrompt && inputs.referenceImages.length === 0) {
      setNodeError({ message: t('node.textGeneration.inputRequired') });
      return;
    }
    if (!selectedModel) {
      setNodeError({ message: t('node.textModel.required') });
      return;
    }

    const snapshot: RunSnapshot = {
      prompt: inputs.effectivePrompt,
      referenceImages: [...inputs.referenceImages],
      reasoningEffort: data.textReasoningEffort,
      apiConfig: { ...selectedModel.apiConfig, modelId: selectedModel.modelId },
    };
    setNodeError(null);
    setIsRunning(true);
    const outcome = await controllerRef.current.run(snapshot, async (captured) =>
      await textGenerationGateway.generate({
        text: captured.prompt,
        referenceImages: captured.referenceImages,
        reasoningEffort: captured.reasoningEffort,
      }, captured.apiConfig)
    );

    setIsRunning(controllerRef.current.isRunning());
    if (outcome.status === 'committed') {
      updateNodeData(id, { generatedText: outcome.text });
      setResultScrollResetVersion((version) => version + 1);
    } else if (outcome.status === 'empty') {
      setNodeError({ message: t('node.textGeneration.emptyResponse') });
    } else if (outcome.status === 'failed') {
      setNodeError(normalizeError(outcome.error, t('node.textGeneration.generationFailed')));
    }
  }, [
    data.textReasoningEffort,
    id,
    inputs,
    selectedModel,
    t,
    unavailableImageNames,
    updateNodeData,
  ]);

  const handleGenerateShortcut = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !isRunning) {
      event.preventDefault();
      void startRun();
    }
  }, [isRunning, startRun]);

  return (
    <div
      className={`group relative flex h-full w-full flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/95 transition-colors duration-150 ${resolveNodeSurfaceStateClass(selected)}`}
      style={{ width: layout.width, height: layout.height }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeResizeHandle
        minWidth={TEXT_GENERATION_MIN_WIDTH}
        minHeight={TEXT_GENERATION_MIN_HEIGHT}
        maxWidth={TEXT_GENERATION_MAX_WIDTH}
        maxHeight={TEXT_GENERATION_MAX_HEIGHT}
      />

      <TextGenerationUpstreamContext
        textInputs={inputs.textInputs}
        imageInputs={inputs.imageInputs}
        maxHeight={layout.contextMaxHeight}
        onLocate={locateNode}
        onDisconnect={deleteEdge}
        onReorder={(kind, draggedSourceId, targetSourceId) => {
          reorderNodeInput(id, kind, draggedSourceId, targetSourceId);
        }}
      />

      <main
        className="grid min-h-0 flex-1"
        style={{ gridTemplateRows: layout.bodyGridTemplateRows }}
      >
        <section className="relative min-h-0 overflow-hidden border-b border-[var(--ui-border-soft)]">
          <label className="pointer-events-none absolute left-3 top-2 z-10 text-[10px] font-medium text-text-muted">
            {t('node.textGeneration.localInput')}
          </label>
          <textarea
            value={data.inputText ?? ''}
            placeholder={t('node.textGeneration.inputPlaceholder')}
            onKeyDown={handleGenerateShortcut}
            onChange={(event) => updateNodeDataCoalesced(
              id,
              { inputText: event.target.value },
              'text-generation-local-input'
            )}
            className="nodrag nowheel h-full w-full resize-none border-0 bg-transparent px-3 pb-2 pt-7 text-sm leading-5 text-text-dark outline-none placeholder:text-text-muted/65"
          />
        </section>

        {generatedText && (
          <section className="relative min-h-0 overflow-hidden">
            <label className="pointer-events-none absolute left-3 top-2 z-10 text-[10px] font-medium text-text-muted">
              {t('node.textGeneration.generatedResult')}
            </label>
            <button
              type="button"
              disabled={isRunning}
              aria-label={t('node.textGeneration.clearResult')}
              title={t('node.textGeneration.clearResult')}
              onClick={() => updateNodeData(id, { generatedText: null })}
              className="nodrag absolute right-2 top-1.5 z-10 rounded p-1 text-text-muted hover:bg-[var(--ui-hover)] hover:text-text-dark disabled:cursor-not-allowed disabled:opacity-40"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <textarea
              ref={resultTextareaRef}
              value={generatedText}
              readOnly={isRunning}
              onKeyDown={handleGenerateShortcut}
              onChange={(event) => updateNodeDataCoalesced(
                id,
                { generatedText: event.target.value.trim() ? event.target.value : null },
                'text-generation-result'
              )}
              className="nodrag nowheel h-full w-full resize-none border-0 bg-[var(--ui-surface-field)]/35 px-3 pb-2 pt-7 text-sm leading-5 text-text-dark outline-none read-only:cursor-default"
            />
          </section>
        )}
      </main>

      <footer className="nodrag flex h-10 shrink-0 items-center justify-between gap-2 border-t border-[var(--ui-border-soft)] px-2">
        <TextModelSelector
          textApis={textApis}
          textApiId={data.textApiId}
          textModelId={data.textModelId}
          reasoningEffort={data.textReasoningEffort}
          onChange={({ textApiId, textModelId }) => {
            updateNodeData(id, { textApiId, textModelId });
            setLastTextGenerationModelSelection({ apiId: textApiId, modelId: textModelId });
          }}
          onReasoningEffortChange={(textReasoningEffort) =>
            updateNodeData(id, { textReasoningEffort })
          }
        />
        <UiButton
          type="button"
          variant={isRunning ? 'muted' : 'primary'}
          size="sm"
          className={`shrink-0 ${NODE_CONTROL_PRIMARY_BUTTON_CLASS}`}
          disabled={!isRunning && !canGenerate}
          onClick={() => isRunning ? stopRun() : void startRun()}
        >
          {isRunning ? <Square className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
          {isRunning ? t('node.textGeneration.stop') : t('node.textGeneration.generate')}
        </UiButton>
      </footer>

      {isRunning && (
        <div className="pointer-events-none absolute right-2 top-2 z-20 flex items-center gap-1 rounded-md border border-[var(--ui-border-soft)] bg-[var(--ui-surface-elevated)]/95 px-2 py-1 text-[10px] text-text-muted shadow-sm">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('node.textGeneration.generating')}
        </div>
      )}
      {nodeError && !isRunning && (
        <button
          type="button"
          onClick={() => setShowErrorDetails(true)}
          className="nodrag absolute right-2 top-2 z-20 flex max-w-[65%] items-center gap-1 rounded-md border border-red-400/40 bg-red-950/85 px-2 py-1 text-left text-[10px] text-red-200 shadow-sm"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate">{nodeError.message}</span>
        </button>
      )}

      <Handle type="target" id="target" position={Position.Left} />
      <Handle type="source" id="source" position={Position.Right} />

      {typeof document !== 'undefined' && createPortal(
        <UiModal
          isOpen={showErrorDetails}
          title={t('node.textGeneration.errorDetails')}
          closeLabel={t('common.close')}
          onClose={() => setShowErrorDetails(false)}
          footer={(
            <UiButton size="sm" onClick={() => setShowErrorDetails(false)}>
              {t('common.close')}
            </UiButton>
          )}
        >
          <div className="space-y-2 text-sm text-text-dark">
            <p>{nodeError?.message}</p>
            {nodeError?.details && (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--ui-surface-field)] p-3 text-xs text-text-muted">
                {nodeError.details}
              </pre>
            )}
          </div>
        </UiModal>,
        document.body
      )}
    </div>
  );
});

TextGenerationNode.displayName = 'TextGenerationNode';
