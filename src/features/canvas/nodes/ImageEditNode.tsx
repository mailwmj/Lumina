import {
  type KeyboardEvent,
  memo,
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import {
  Handle,
  Position,
  useReactFlow,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react';
import { Loader2, Sparkles, Wand2 } from '@/components/ui/icons';
import { useTranslation } from 'react-i18next';

import {
  AUTO_REQUEST_ASPECT_RATIO,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_IMAGE_OUTPUT_COUNT,
  type ImageEditNodeData,
  type ImageSize,
} from '@/features/canvas/domain/canvasNodes';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { resolveNodeSurfaceStateClass } from '@/features/canvas/ui/nodeSurfaceStyles';
import {
  canvasAiGateway,
} from '@/features/canvas/application/canvasServices';
import {
  resolveEffectivePromptForNode,
  resolveTextGenerationInputs,
} from '@/features/canvas/application/textGenerationInputs';
import {
  buildImageReferenceModelPrompt,
  materializeImageReferencePrompt,
} from '@/features/canvas/application/imageReferencePrompt';
import { showErrorDialog } from '@/features/canvas/application/errorDialog';
import { detectAspectRatio, parseAspectRatio } from '@/features/canvas/application/imageData';
import {
  buildGenerationErrorReport,
  CURRENT_RUNTIME_SESSION_ID,
  createReferenceImagePlaceholders,
  getRuntimeDiagnostics,
  type GenerationDebugContext,
} from '@/features/canvas/application/generationErrorReport';
import {
  beginCompositionInput,
  commitCompositionInputOnBlur,
  completeCompositionInput,
  createCompositionInputState,
  updateCompositionInputDraft,
} from '@/features/canvas/application/compositionInputState';
import {
  TEXT_GENERATION_MAX_HEIGHT,
  TEXT_GENERATION_MAX_WIDTH,
  resolveTextGenerationLayout,
} from '@/features/canvas/application/textGenerationLayout';
import {
  IMAGE_GENERATION_ASPECT_RATIO_OPTIONS,
  IMAGE_GENERATION_RESOLUTION_OPTIONS,
  listConfiguredImageModels,
  pickClosestImageGenerationAspectRatio,
  resolveImageGenerationResolution,
  resolveConfiguredImageModel,
  UNCONFIGURED_IMAGE_MODEL,
} from '@/features/canvas/models';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_FOOTER_CLASS,
  NODE_CONTROL_ICON_BUTTON_CLASS,
  NODE_CONTROL_ICON_CLASS,
  NODE_CONTROL_MODEL_CHIP_CLASS,
  NODE_CONTROL_PARAMS_CHIP_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import {
  createImageOutputBatchNodes,
  markImageOutputNodeFailed,
} from '@/features/canvas/application/imageOutputBatch';
import { ModelParamsControls } from '@/features/canvas/ui/ModelParamsControls';
import { UiButton, UiTooltip } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { polishText } from '@/features/canvas/infrastructure/textPolishService';
import { resolveImageProviderRuntime } from '@/features/canvas/application/imageProviderRuntime';
import { resolveTextModelSelection } from '@/features/canvas/application/textModelSelection';
import { locateReferencedNode } from '@/features/canvas/application/referencedNodeLocation';
import { openSettingsDialog } from '@/features/settings/settingsEvents';
import { TextGenerationUpstreamContext } from './TextGenerationUpstreamContext';
import { usePreserveNodeCenterOnAutoResize } from '@/features/canvas/ui/usePreserveNodeCenterOnAutoResize';
import { ImageReferencePromptInput } from '@/features/canvas/ui/ImageReferencePromptInput';

type ImageEditNodeProps = NodeProps & {
  id: string;
  data: ImageEditNodeData;
  selected?: boolean;
};

interface AspectRatioChoice {
  value: string;
  label: string;
}

function buildAiResultNodeTitle(prompt: string, fallbackTitle: string): string {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    return fallbackTitle;
  }

  return normalizedPrompt;
}

export const ImageEditNode = memo(({ id, data, selected, width, height }: ImageEditNodeProps) => {
  const { t } = useTranslation();
  const reactFlow = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const [error, setError] = useState<string | null>(null);
  const [isPolishing, setIsPolishing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const generationSubmissionLockRef = useRef(false);
  const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? '');
  const promptCompositionStateRef = useRef(createCompositionInputState(data.prompt ?? ''));

  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const deleteEdge = useCanvasStore((state) => state.deleteEdge);
  const reorderNodeInput = useCanvasStore((state) => state.reorderNodeInput);
  const addNodeBatch = useCanvasStore((state) => state.addNodeBatch);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const openAiImageApi = useSettingsStore((state) => state.openAiImageApi);
  const chaomoImageApi = useSettingsStore((state) => state.chaomoImageApi);
  const customImageApis = useSettingsStore((state) => state.customImageApis);
  const lastImageModelSelection = useSettingsStore((state) => state.lastImageModelSelection);
  const setLastImageModelSelection = useSettingsStore((state) => state.setLastImageModelSelection);
  const textApis = useSettingsStore((state) => state.textApis);
  const imagePolishConfig = useSettingsStore((state) => state.imagePolishConfig);
  const selectedPolishModel = useMemo(
    () => resolveTextModelSelection(
      textApis,
      imagePolishConfig.textApiId ?? undefined,
      imagePolishConfig.textModelId ?? undefined
    ),
    [imagePolishConfig.textApiId, imagePolishConfig.textModelId, textApis]
  );

  const workflowInputs = useMemo(
    () => resolveTextGenerationInputs(id, nodes, edges),
    [id, nodes, edges]
  );
  const incomingImages = workflowInputs.referenceImages;

  const imageModels = useMemo(
    () =>
      listConfiguredImageModels({
        openAiImageApi,
        chaomoImageApi,
        customImageApis,
        lastImageModelSelection,
      }),
    [chaomoImageApi, customImageApis, lastImageModelSelection, openAiImageApi]
  );

  const configuredModel = useMemo(
    () =>
      resolveConfiguredImageModel(
        { openAiImageApi, chaomoImageApi, customImageApis, lastImageModelSelection },
        data.model
      ),
    [chaomoImageApi, customImageApis, data.model, lastImageModelSelection, openAiImageApi]
  );
  const hasConfiguredModel = configuredModel !== null;
  const selectedModel = configuredModel ?? UNCONFIGURED_IMAGE_MODEL;
  const providerRuntime = useMemo(
    () => resolveImageProviderRuntime(selectedModel.providerId, {
      openAiImageApi,
      chaomoImageApi,
      customImageApis,
    }),
    [chaomoImageApi, customImageApis, openAiImageApi, selectedModel.providerId]
  );
  const providerApiKey = providerRuntime.apiKey;
  const effectiveExtraParams = useMemo(
    () => ({ ...(data.extraParams ?? {}) }),
    [data.extraParams]
  );
  const resolutionOptions = IMAGE_GENERATION_RESOLUTION_OPTIONS;

  const selectedResolution = useMemo(
    () => resolveImageGenerationResolution(data.size),
    [data.size]
  );
  const outputCount = data.outputCount ?? DEFAULT_IMAGE_OUTPUT_COUNT;

  const aspectRatioOptions = useMemo<AspectRatioChoice[]>(
    () => [{
      value: AUTO_REQUEST_ASPECT_RATIO,
      label: t('modelParams.autoAspectRatio'),
    }, ...IMAGE_GENERATION_ASPECT_RATIO_OPTIONS],
    [t]
  );

  const selectedAspectRatio = useMemo(
    () =>
      aspectRatioOptions.find((item) => item.value === data.requestAspectRatio) ??
      aspectRatioOptions[0],
    [aspectRatioOptions, data.requestAspectRatio]
  );

  const requestResolution = selectedModel.resolveRequest({
    referenceImageCount: incomingImages.length,
  });

  const layout = resolveTextGenerationLayout({
    width,
    height,
    hasTextContext: workflowInputs.textInputs.length > 0,
    hasImageContext: workflowInputs.imageInputs.length > 0,
    hasResult: false,
    isSizeManuallyAdjusted: data.isSizeManuallyAdjusted,
  });
  const resolvedWidth = layout.width;
  const resolvedHeight = layout.height;

  usePreserveNodeCenterOnAutoResize({
    nodeId: id,
    height: resolvedHeight,
    enabled: !data.isSizeManuallyAdjusted,
  });

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    const externalPrompt = data.prompt ?? '';
    if (
      promptCompositionStateRef.current.isComposing ||
      externalPrompt === promptCompositionStateRef.current.committedValue
    ) {
      return;
    }
    const nextState = createCompositionInputState(externalPrompt);
    promptCompositionStateRef.current = nextState;
    setPromptDraft(nextState.draft);
  }, [data.prompt]);

  const commitPromptDraft = useCallback((nextPrompt: string) => {
    if (promptCompositionStateRef.current.isComposing) {
      return;
    }
    updateNodeData(id, { prompt: nextPrompt });
  }, [id, updateNodeData]);

  const applyPromptDraftTransition = useCallback((transition: ReturnType<typeof updateCompositionInputDraft>) => {
    promptCompositionStateRef.current = transition.state;
    setPromptDraft(transition.state.draft);
    if (transition.committedValue !== null) {
      commitPromptDraft(transition.committedValue);
    }
  }, [commitPromptDraft]);

  const beginPromptComposition = useCallback(() => {
    promptCompositionStateRef.current = beginCompositionInput(promptCompositionStateRef.current);
  }, []);

  const handlePromptChange = useCallback((value: string, nativeIsComposing: boolean) => {
    applyPromptDraftTransition(updateCompositionInputDraft(
      promptCompositionStateRef.current,
      value,
      nativeIsComposing
    ));
  }, [applyPromptDraftTransition]);

  const completePromptComposition = useCallback((value: string) => {
    applyPromptDraftTransition(completeCompositionInput(promptCompositionStateRef.current, value));
  }, [applyPromptDraftTransition]);

  const commitPromptOnBlur = useCallback((value: string) => {
    applyPromptDraftTransition(commitCompositionInputOnBlur(promptCompositionStateRef.current, value));
  }, [applyPromptDraftTransition]);

  useEffect(() => {
    if (!hasConfiguredModel) {
      return;
    }
    if (data.model !== selectedModel.id) {
      updateNodeData(id, { model: selectedModel.id });
    }

    if (data.size !== selectedResolution.value) {
      updateNodeData(id, { size: selectedResolution.value as ImageSize });
    }

    if (data.requestAspectRatio !== selectedAspectRatio.value) {
      updateNodeData(id, { requestAspectRatio: selectedAspectRatio.value });
    }
  }, [
    data.model,
    data.requestAspectRatio,
    data.size,
    hasConfiguredModel,
    id,
    selectedAspectRatio.value,
    selectedModel.id,
    selectedResolution.value,
    updateNodeData,
  ]);

  const handlePolish = useCallback(async () => {
    if (!selectedPolishModel) {
      void showErrorDialog(t('node.textModel.required'), t('settings.polishPrompt'));
      return;
    }
    const prompt = materializeImageReferencePrompt(
      promptDraft,
      workflowInputs.imageInputs
    ).trim();
    if (!prompt) {
      void showErrorDialog('请填写提示词后再润色', '润色提示');
      return;
    }
    setIsPolishing(true);
    try {
      const result = await polishText({
        text: prompt,
        customPrompt: imagePolishConfig.prompt,
        promptType: 'image',
        reasoningEffort: imagePolishConfig.reasoningEffort ?? undefined,
      }, selectedPolishModel.apiConfig);
      if (promptCompositionStateRef.current.isComposing) {
        return;
      }
      const nextState = createCompositionInputState(result.polished);
      promptCompositionStateRef.current = nextState;
      setPromptDraft(nextState.draft);
      updateNodeData(id, { prompt: result.polished });
    } catch (err) {
      const message = err instanceof Error ? err.message : '润色失败';
      void showErrorDialog(message, '润色失败');
    } finally {
      setIsPolishing(false);
    }
  }, [id, imagePolishConfig, promptDraft, selectedPolishModel, t, updateNodeData, workflowInputs.imageInputs]);

  const handleGenerate = useCallback(async () => {
    if (!hasConfiguredModel) {
      const errorMessage = t('node.imageEdit.modelRequired');
      setError(errorMessage);
      void showErrorDialog(errorMessage, t('common.error'));
      return;
    }

    if (workflowInputs.blockingImageNodeIds.length > 0) {
      const unavailableNames = workflowInputs.imageInputs
        .flatMap((input, index) => !input.imageUrl
          ? [t('node.imageReference.label', { index: index + 1 })]
          : [])
        .join(', ');
      const errorMessage = unavailableNames
        ? t('node.textGeneration.imageUnavailableSources', { names: unavailableNames })
        : t('node.textGeneration.imageUnavailable');
      setError(errorMessage);
      void showErrorDialog(errorMessage, t('common.error'));
      return;
    }

    // Freeze both prompt labels and image transport order before any async work.
    // A tag resolves by edge id here, so reordering changes its visible ordinal
    // without ever making it point at a different image.
    const referenceImageSnapshot = workflowInputs.imageInputs.flatMap((input) => input.imageUrl
      ? [{ edgeId: input.edgeId, imageUrl: input.imageUrl, previewImageUrl: input.previewImageUrl }]
      : []
    );
    const referenceImages = referenceImageSnapshot.map((input) => input.imageUrl);
    const localPrompt = materializeImageReferencePrompt(
      promptDraft,
      referenceImageSnapshot
    ).trim();
    const userPrompt = resolveEffectivePromptForNode(id, localPrompt, nodes, edges);
    if (!userPrompt) {
      const errorMessage = t('node.imageEdit.promptRequired');
      setError(errorMessage);
      void showErrorDialog(errorMessage, t('common.error'));
      return;
    }
    const prompt = buildImageReferenceModelPrompt(userPrompt, referenceImageSnapshot);

    if (!providerApiKey) {
      const errorMessage = t('node.imageEdit.apiKeyRequired');
      setError(errorMessage);
      void showErrorDialog(errorMessage, t('common.error'));
      return;
    }

    if (generationSubmissionLockRef.current) {
      return;
    }
    generationSubmissionLockRef.current = true;
    setIsSubmitting(true);

    try {
      const generationDurationMs = selectedModel.expectedDurationMs ?? 60000;
      const generationStartedAt = Date.now();
      const resultNodeTitle = buildAiResultNodeTitle(userPrompt, t('node.imageEdit.resultTitle'));
      let resolvedRequestAspectRatio = selectedAspectRatio.value;
      const outputAspectRatio = resolvedRequestAspectRatio === AUTO_REQUEST_ASPECT_RATIO
        ? DEFAULT_ASPECT_RATIO
        : resolvedRequestAspectRatio;
      const runtimeDiagnostics = await getRuntimeDiagnostics();
      setError(null);

      const resultNodes = createImageOutputBatchNodes({
        sourceNodeId: id,
        outputCount,
        aspectRatio: outputAspectRatio,
        resultNodeTitle,
        generationStartedAt,
        generationDurationMs,
        addNodeBatch,
        addEdge,
        findNodePosition,
      });

      if (outputCount > 1) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            void reactFlow.fitView({
              nodes: [{ id }, ...resultNodes.map(({ nodeId }) => ({ id: nodeId }))],
              padding: 0.16,
              duration: 320,
              maxZoom: 1,
            });
          });
        });
      }

      const buildDebugContext = (outputIndex: number): GenerationDebugContext => ({
        sourceType: 'imageEdit',
        providerId: selectedModel.providerId,
        requestModel: requestResolution.requestModel,
        requestSize: selectedResolution.value,
        requestAspectRatio: resolvedRequestAspectRatio,
        prompt,
        extraParams: effectiveExtraParams,
        referenceImageCount: referenceImages.length,
        referenceImagePlaceholders: createReferenceImagePlaceholders(referenceImages.length),
        outputCount,
        outputIndex: outputIndex + 1,
        appVersion: runtimeDiagnostics.appVersion,
        osName: runtimeDiagnostics.osName,
        osVersion: runtimeDiagnostics.osVersion,
        osBuild: runtimeDiagnostics.osBuild,
        userAgent: runtimeDiagnostics.userAgent,
      });

      const markNodeFailed = (
        nodeId: string,
        outputIndex: number,
        generationError: unknown
      ) =>
        markImageOutputNodeFailed({
          nodeId,
          generationError,
          fallbackMessage: t('ai.error'),
          generationDebugContext: buildDebugContext(outputIndex),
          updateNodeData,
        });

      try {
        if (resolvedRequestAspectRatio === AUTO_REQUEST_ASPECT_RATIO) {
          if (referenceImages.length > 0) {
            try {
              const sourceAspectRatio = await detectAspectRatio(referenceImages[0]);
              const sourceAspectRatioValue = parseAspectRatio(sourceAspectRatio);
              resolvedRequestAspectRatio = pickClosestImageGenerationAspectRatio(
                sourceAspectRatioValue
              );
            } catch {
              resolvedRequestAspectRatio = pickClosestImageGenerationAspectRatio(1);
            }
          } else {
            resolvedRequestAspectRatio = pickClosestImageGenerationAspectRatio(1);
          }
        }

        await canvasAiGateway.setApiKey(providerRuntime.backendProviderId, providerApiKey);

        const projectId = useProjectStore.getState().getCurrentProject()?.id;
        const submissionFailures: Array<ReturnType<typeof markNodeFailed>> = [];
        await canvasAiGateway.submitGenerateImageJobs(
          {
            prompt,
            model: requestResolution.requestModel,
            size: selectedResolution.value,
            aspectRatio: resolvedRequestAspectRatio,
            referenceImages,
            extraParams: effectiveExtraParams,
            providerConfig: providerRuntime.providerConfig,
            projectId,
          },
          outputCount,
          (submission, submissionIndex) => {
            const resultNode = resultNodes[submissionIndex];
            if (!resultNode) {
              return;
            }
            const { nodeId, outputIndex } = resultNode;
            if (submission.status === 'fulfilled') {
              updateNodeData(nodeId, {
                generationJobId: submission.jobId,
                generationSourceType: 'imageEdit',
                generationProviderId: selectedModel.providerId,
                generationClientSessionId: CURRENT_RUNTIME_SESSION_ID,
                generationDebugContext: buildDebugContext(outputIndex),
              });
              return;
            }

            const failure = markNodeFailed(nodeId, outputIndex, submission.error);
            submissionFailures.push(failure);
          }
        );

        const firstFailure = submissionFailures[0];
        if (firstFailure) {
          const reportText = buildGenerationErrorReport({
            errorMessage: firstFailure.resolvedError.message,
            errorDetails: firstFailure.resolvedError.details,
            context: firstFailure.generationDebugContext,
          });
          setError(firstFailure.resolvedError.message);
          void showErrorDialog(
            firstFailure.resolvedError.message,
            t('common.error'),
            firstFailure.resolvedError.details,
            reportText
          );
        }
      } catch (generationError) {
        const failures = resultNodes.map(({ nodeId, outputIndex }) =>
          markNodeFailed(nodeId, outputIndex, generationError)
        );
        const firstFailure = failures[0];
        if (!firstFailure) {
          return;
        }
        const reportText = buildGenerationErrorReport({
          errorMessage: firstFailure.resolvedError.message,
          errorDetails: firstFailure.resolvedError.details,
          context: firstFailure.generationDebugContext,
        });
        setError(firstFailure.resolvedError.message);
        void showErrorDialog(
          firstFailure.resolvedError.message,
          t('common.error'),
          firstFailure.resolvedError.details,
          reportText
        );
      }
    } finally {
      generationSubmissionLockRef.current = false;
      setIsSubmitting(false);
    }
  }, [
    addNodeBatch,
    addEdge,
    providerApiKey,
    providerRuntime.providerConfig,
    findNodePosition,
    reactFlow,
    promptDraft,
    effectiveExtraParams,
    hasConfiguredModel,
    id,
    edges,
    nodes,
    outputCount,
    requestResolution.requestModel,
    selectedAspectRatio.value,
    selectedModel.id,
    selectedModel.expectedDurationMs,
    selectedModel.providerId,
    selectedResolution.value,
    t,
    updateNodeData,
    workflowInputs.blockingImageNodeIds.length,
    workflowInputs.imageInputs,
  ]);

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void handleGenerate();
    }
  };

  return (
    <div
      ref={rootRef}
      className={`
        group relative flex h-full flex-col gap-2 overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
        ${resolveNodeSurfaceStateClass(selected)}
      `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <TextGenerationUpstreamContext
        textInputs={workflowInputs.textInputs}
        imageInputs={workflowInputs.imageInputs}
        textContextHeight={layout.upstreamTextHeight}
        referenceImagesHeight={layout.referenceImagesHeight}
        onLocate={(nodeId) => {
          void locateReferencedNode(nodeId, {
            setSelectedNode,
            getInternalNode: reactFlow.getInternalNode,
            getViewport: reactFlow.getViewport,
            setCenter: reactFlow.setCenter,
          });
        }}
        onDisconnect={deleteEdge}
        onReorder={(kind, draggedSourceId, targetSourceId) => {
          reorderNodeInput(id, kind, draggedSourceId, targetSourceId);
        }}
      />
      <section className="min-w-0 shrink-0">
        <div className="mb-1 text-[10px] font-medium text-text-muted">
          {t('node.imageEdit.promptLabel')}
        </div>
        <div
          className="nodrag nowheel relative overflow-visible rounded-lg border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)]"
          style={{ height: layout.promptHeight }}
        >
          <ImageReferencePromptInput
            value={promptDraft}
            imageInputs={workflowInputs.imageInputs}
            placeholder={t('node.imageEdit.promptPlaceholder')}
            ariaLabel={t('node.imageEdit.promptLabel')}
            onKeyDown={handlePromptKeyDown}
            onCompositionStart={beginPromptComposition}
            onCompositionEnd={completePromptComposition}
            onBlur={commitPromptOnBlur}
            onValueChange={handlePromptChange}
          />
        </div>
      </section>

      <div className={`${NODE_CONTROL_FOOTER_CLASS} gap-1`}>
        {hasConfiguredModel ? (
          <ModelParamsControls
            imageModels={imageModels}
            selectedModel={selectedModel}
            resolutionOptions={resolutionOptions}
            selectedResolution={selectedResolution}
            selectedAspectRatio={selectedAspectRatio}
            aspectRatioOptions={aspectRatioOptions}
            onModelChange={(modelId) => {
              const model = imageModels.find((item) => item.id === modelId);
              if (!model) {
                return;
              }
              updateNodeData(id, { model: modelId });
              setLastImageModelSelection({ providerId: model.providerId, modelId });
            }}
            onResolutionChange={(resolution) => {
              updateNodeData(id, { size: resolution as ImageSize });
            }
            }
            onAspectRatioChange={(aspectRatio) => {
              updateNodeData(id, { requestAspectRatio: aspectRatio });
            }
            }
            outputCount={outputCount}
            onOutputCountChange={(nextOutputCount) => {
              updateNodeData(id, { outputCount: nextOutputCount });
            }}
            extraParams={data.extraParams}
            onExtraParamChange={(key, value) =>
              updateNodeData(id, {
                extraParams: {
                  ...(data.extraParams ?? {}),
                  [key]: value,
                },
              })
            }
            triggerSize="sm"
            chipClassName={NODE_CONTROL_CHIP_CLASS}
            modelChipClassName={NODE_CONTROL_MODEL_CHIP_CLASS}
            paramsChipClassName={NODE_CONTROL_PARAMS_CHIP_CLASS}
          />
        ) : (
          <UiButton
            variant="muted"
            size="sm"
            className={`nodrag nowheel shrink-0 ${NODE_CONTROL_CHIP_CLASS}`}
            onClick={(event) => {
              event.stopPropagation();
              openSettingsDialog({ category: 'imageApis' });
            }}
          >
            {t('modelParams.configureImageModel')}
          </UiButton>
        )}

        <UiTooltip content={t('node.imageEdit.polishPrompt')}>
          <UiButton
            aria-label={t('node.imageEdit.polishPrompt')}
            onClick={(event) => {
              event.stopPropagation();
              void handlePolish();
            }}
            variant="muted"
            size="sm"
            className={`nodrag nowheel shrink-0 ${NODE_CONTROL_ICON_BUTTON_CLASS}`}
            disabled={isPolishing}
          >
            {isPolishing ? (
              <Loader2 className={`${NODE_CONTROL_ICON_CLASS} animate-spin`} strokeWidth={2.8} />
            ) : (
              <Wand2 className={NODE_CONTROL_ICON_CLASS} strokeWidth={2.8} />
            )}
          </UiButton>
        </UiTooltip>

        <div className="ml-auto" />

        <UiButton
          onClick={(event) => {
            event.stopPropagation();
            void handleGenerate();
          }}
          variant="primary"
          className={`nodrag nowheel shrink-0 ${NODE_CONTROL_PRIMARY_BUTTON_CLASS}`}
          disabled={!hasConfiguredModel || isSubmitting}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? (
            <Loader2 className={`${NODE_CONTROL_ICON_CLASS} animate-spin`} strokeWidth={2.8} />
          ) : (
            <Sparkles className={NODE_CONTROL_ICON_CLASS} strokeWidth={2.8} />
          )}
          {t('canvas.generate')}
        </UiButton>
      </div>

      {error && <div className="mt-1 shrink-0 text-xs text-red-400">{error}</div>}

      <Handle
        type="target"
        id="target"
        position={Position.Left}
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
      />
      <NodeResizeHandle
        minWidth={layout.minWidth}
        minHeight={layout.minHeight}
        maxWidth={TEXT_GENERATION_MAX_WIDTH}
        maxHeight={TEXT_GENERATION_MAX_HEIGHT}
      />
    </div>
  );
});

ImageEditNode.displayName = 'ImageEditNode';
