import {
  type KeyboardEvent,
  memo,
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
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
import { showErrorDialog } from '@/features/canvas/application/errorDialog';
import {
  detectAspectRatio,
  parseAspectRatio,
  resolveImageDisplayUrl,
} from '@/features/canvas/application/imageData';
import {
  buildGenerationErrorReport,
  CURRENT_RUNTIME_SESSION_ID,
  createReferenceImagePlaceholders,
  getRuntimeDiagnostics,
  type GenerationDebugContext,
} from '@/features/canvas/application/generationErrorReport';
import {
  insertReferenceToken,
  removeTextRange,
  resolveReferenceAwareDeleteRange,
} from '@/features/canvas/application/referenceTokenEditing';
import {
  beginCompositionInput,
  commitCompositionInputOnBlur,
  completeCompositionInput,
  createCompositionInputState,
  shouldSuppressKeyboardCommand,
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
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { UiButton, UiTooltip } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { polishText } from '@/features/canvas/infrastructure/textPolishService';
import { resolveImageProviderRuntime } from '@/features/canvas/application/imageProviderRuntime';
import { resolveTextModelSelection } from '@/features/canvas/application/textModelSelection';
import { locateReferencedNode } from '@/features/canvas/application/referencedNodeLocation';
import { openSettingsDialog } from '@/features/settings/settingsEvents';
import {
  PICKER_FALLBACK_ANCHOR,
  renderPromptWithHighlights,
  resolvePickerAnchor,
  type PickerAnchor,
} from '@/features/canvas/ui/imageEditPromptOverlay';
import { TextGenerationUpstreamContext } from './TextGenerationUpstreamContext';

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
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptHighlightRef = useRef<HTMLDivElement>(null);
  const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? '');
  const promptDraftRef = useRef(promptDraft);
  const promptCompositionStateRef = useRef(createCompositionInputState(data.prompt ?? ''));
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [pickerCursor, setPickerCursor] = useState<number | null>(null);
  const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(PICKER_FALLBACK_ANCHOR);
  const [referenceHover, setReferenceHover] = useState<{
    index: number;
    imageUrl: string;
    anchorRect: DOMRect;
  } | null>(null);
  const highlightMouseLeaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const incomingImageItems = useMemo(
    () =>
      incomingImages.map((imageUrl, index) => ({
        imageUrl,
        displayUrl: resolveImageDisplayUrl(imageUrl),
        label: `图${index + 1}`,
      })),
    [incomingImages]
  );
  const incomingImageViewerList = useMemo(
    () => incomingImageItems.map((item) => resolveImageDisplayUrl(item.imageUrl)),
    [incomingImageItems]
  );

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
    promptDraftRef.current = nextState.draft;
    setPromptDraft(nextState.draft);
  }, [data.prompt]);

  const commitPromptDraft = useCallback((nextPrompt: string) => {
    if (promptCompositionStateRef.current.isComposing) {
      return;
    }
    promptDraftRef.current = nextPrompt;
    updateNodeData(id, { prompt: nextPrompt });
  }, [id, updateNodeData]);

  const applyPromptDraftTransition = useCallback((transition: ReturnType<typeof updateCompositionInputDraft>) => {
    promptCompositionStateRef.current = transition.state;
    promptDraftRef.current = transition.state.draft;
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

  useEffect(() => {
    if (incomingImages.length === 0) {
      setShowImagePicker(false);
      setPickerCursor(null);
      setPickerActiveIndex(0);
      return;
    }

    setPickerActiveIndex((previous) => Math.min(previous, incomingImages.length - 1));
  }, [incomingImages.length]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as globalThis.Node)) {
        return;
      }

      setShowImagePicker(false);
      setPickerCursor(null);
    };

    document.addEventListener('mousedown', handleOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
    };
  }, []);

  // Handle @图x hover preview by checking if mouse is over a highlight span
  useEffect(() => {
    const checkHighlightUnderMouse = (event: MouseEvent) => {
      const highlightSpans = rootRef.current?.querySelectorAll('[data-highlight-ref]');
      if (!highlightSpans || highlightSpans.length === 0) return;

      for (const span of highlightSpans) {
        const spanRect = span.getBoundingClientRect();
        const isOverSpan =
          event.clientX >= spanRect.left &&
          event.clientX <= spanRect.right &&
          event.clientY >= spanRect.top &&
          event.clientY <= spanRect.bottom;

        if (isOverSpan) {
          const imageUrl = (span as HTMLElement).dataset.imageUrl;
          const index = (span as HTMLElement).dataset.index;
          if (imageUrl && index) {
            if (highlightMouseLeaveTimeoutRef.current) {
              clearTimeout(highlightMouseLeaveTimeoutRef.current);
              highlightMouseLeaveTimeoutRef.current = null;
            }
            setReferenceHover({
              index: parseInt(index, 10),
              imageUrl,
              anchorRect: spanRect,
            });
          }
          return;
        }
      }

      if (!highlightMouseLeaveTimeoutRef.current) {
        highlightMouseLeaveTimeoutRef.current = setTimeout(() => {
          setReferenceHover(null);
          highlightMouseLeaveTimeoutRef.current = null;
        }, 100);
      }
    };

    document.addEventListener('mousemove', checkHighlightUnderMouse, true);
    return () => {
      document.removeEventListener('mousemove', checkHighlightUnderMouse, true);
      if (highlightMouseLeaveTimeoutRef.current) {
        clearTimeout(highlightMouseLeaveTimeoutRef.current);
      }
    };
  }, []);

  const handlePolish = useCallback(async () => {
    if (!selectedPolishModel) {
      void showErrorDialog(t('node.textModel.required'), t('settings.polishPrompt'));
      return;
    }
    const prompt = promptDraft.trim();
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
      promptCompositionStateRef.current = {
        ...promptCompositionStateRef.current,
        draft: result.polished,
      };
      promptDraftRef.current = result.polished;
      setPromptDraft(result.polished);
    } catch (err) {
      const message = err instanceof Error ? err.message : '润色失败';
      void showErrorDialog(message, '润色失败');
    } finally {
      setIsPolishing(false);
    }
  }, [imagePolishConfig, promptDraft, selectedPolishModel, t]);

  const handleGenerate = useCallback(async () => {
    if (!hasConfiguredModel) {
      const errorMessage = t('node.imageEdit.modelRequired');
      setError(errorMessage);
      void showErrorDialog(errorMessage, t('common.error'));
      return;
    }

    if (workflowInputs.blockingImageNodeIds.length > 0) {
      const unavailableNames = workflowInputs.imageInputs
        .filter((input) => !input.imageUrl)
        .map((input) => input.displayName)
        .join(', ');
      const errorMessage = unavailableNames
        ? t('node.textGeneration.imageUnavailableSources', { names: unavailableNames })
        : t('node.textGeneration.imageUnavailable');
      setError(errorMessage);
      void showErrorDialog(errorMessage, t('common.error'));
      return;
    }

    const localPrompt = promptDraft.replace(/@(?=图\d+)/g, '').trim();
    const prompt = resolveEffectivePromptForNode(id, localPrompt, nodes, edges);
    if (!prompt) {
      const errorMessage = t('node.imageEdit.promptRequired');
      setError(errorMessage);
      void showErrorDialog(errorMessage, t('common.error'));
      return;
    }

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
      const resultNodeTitle = buildAiResultNodeTitle(prompt, t('node.imageEdit.resultTitle'));
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
        referenceImageCount: incomingImages.length,
        referenceImagePlaceholders: createReferenceImagePlaceholders(incomingImages.length),
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
          if (incomingImages.length > 0) {
            try {
              const sourceAspectRatio = await detectAspectRatio(incomingImages[0]);
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
            referenceImages: incomingImages,
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
    incomingImages,
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
  ]);

  const syncPromptHighlightScroll = () => {
    if (!promptRef.current || !promptHighlightRef.current) {
      return;
    }

    promptHighlightRef.current.scrollTop = promptRef.current.scrollTop;
    promptHighlightRef.current.scrollLeft = promptRef.current.scrollLeft;
  };

  const insertImageReference = useCallback((imageIndex: number) => {
    if (promptCompositionStateRef.current.isComposing) {
      return;
    }
    const marker = `@图${imageIndex + 1}`;
    const currentPrompt = promptDraftRef.current;
    const cursor = pickerCursor ?? currentPrompt.length;
    const { nextText: nextPrompt, nextCursor } = insertReferenceToken(currentPrompt, cursor, marker);

    applyPromptDraftTransition(updateCompositionInputDraft(
      promptCompositionStateRef.current,
      nextPrompt
    ));
    setShowImagePicker(false);
    setPickerCursor(null);
    setPickerActiveIndex(0);

    requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(nextCursor, nextCursor);
      syncPromptHighlightScroll();
    });
  }, [applyPromptDraftTransition, pickerCursor]);

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (shouldSuppressKeyboardCommand(event.nativeEvent)) {
      return;
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      const currentPrompt = promptDraftRef.current;
      const selectionStart = event.currentTarget.selectionStart ?? currentPrompt.length;
      const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
      const deletionDirection = event.key === 'Backspace' ? 'backward' : 'forward';
      const deleteRange = resolveReferenceAwareDeleteRange(
        currentPrompt,
        selectionStart,
        selectionEnd,
        deletionDirection,
        incomingImages.length
      );
      if (deleteRange) {
        event.preventDefault();
        const { nextText, nextCursor } = removeTextRange(currentPrompt, deleteRange);
        applyPromptDraftTransition(updateCompositionInputDraft(
          promptCompositionStateRef.current,
          nextText
        ));
        requestAnimationFrame(() => {
          promptRef.current?.focus();
          promptRef.current?.setSelectionRange(nextCursor, nextCursor);
          syncPromptHighlightScroll();
        });
        return;
      }
    }

    if (showImagePicker && incomingImages.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setPickerActiveIndex((previous) => (previous + 1) % incomingImages.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setPickerActiveIndex((previous) =>
          previous === 0 ? incomingImages.length - 1 : previous - 1
        );
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        insertImageReference(pickerActiveIndex);
        return;
      }
    }

    if (event.key === '@' && incomingImages.length > 0) {
      event.preventDefault();
      const cursor = event.currentTarget.selectionStart ?? promptDraftRef.current.length;
      setPickerAnchor(resolvePickerAnchor(rootRef.current, event.currentTarget, cursor));
      setPickerCursor(cursor);
      setShowImagePicker(true);
      setPickerActiveIndex(0);
      return;
    }

    if (event.key === 'Escape' && showImagePicker) {
      event.preventDefault();
      setShowImagePicker(false);
      setPickerCursor(null);
      setPickerActiveIndex(0);
      return;
    }

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
          className="nodrag nowheel relative rounded-lg border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)]"
          style={{ height: layout.promptHeight }}
        >
          <div className="relative h-full min-h-0 p-2">
          <div
            ref={promptHighlightRef}
            aria-hidden="true"
            className="ui-scrollbar absolute inset-2 overflow-y-auto overflow-x-hidden text-sm leading-6 text-text-dark"
            style={{ scrollbarGutter: 'stable', pointerEvents: 'none' }}
          >
            <div className="min-h-full whitespace-pre-wrap break-words px-1 py-0.5">
              {renderPromptWithHighlights(
                promptDraft,
                incomingImages.length,
                incomingImages
              )}
            </div>
          </div>

          <textarea
            ref={promptRef}
            value={promptDraft}
            onChange={(event) => {
              const nextValue = event.target.value;
              handlePromptChange(
                nextValue,
                (event.nativeEvent as InputEvent).isComposing === true
              );
            }}
            onKeyDown={handlePromptKeyDown}
            onCompositionStart={beginPromptComposition}
            onCompositionEnd={(event) => completePromptComposition(event.currentTarget.value)}
            onBlur={(event) => commitPromptOnBlur(event.currentTarget.value)}
            onScroll={syncPromptHighlightScroll}
            onMouseDown={(event) => event.stopPropagation()}
            placeholder={t('node.imageEdit.promptPlaceholder')}
            className="ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none overflow-y-auto overflow-x-hidden border-none bg-transparent px-1 py-0.5 text-sm leading-6 text-transparent caret-text-dark outline-none selection:text-transparent placeholder:text-text-muted/80 focus:border-transparent whitespace-pre-wrap break-words"
            style={{ scrollbarGutter: 'stable' }}
          />
        </div>

        {showImagePicker && incomingImageItems.length > 0 && (
          <div
            className="nowheel absolute z-30 w-[120px] overflow-hidden rounded-[10px] border border-[var(--ui-border-soft)] bg-[var(--ui-surface-elevated)] shadow-[var(--ui-shadow-panel)]"
            style={{ left: pickerAnchor.left, top: pickerAnchor.top }}
            onMouseDown={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
          >
            <div
              className="ui-scrollbar nowheel max-h-[180px] overflow-y-auto"
              onWheelCapture={(event) => event.stopPropagation()}
            >
              {incomingImageItems.map((item, index) => (
                <button
                  key={`${item.imageUrl}-${index}`}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    insertImageReference(index);
                  }}
                  onMouseEnter={() => setPickerActiveIndex(index)}
                  className={`flex w-full items-center gap-2 border border-transparent bg-transparent px-2 py-2 text-left text-sm text-text-dark transition-colors hover:bg-[var(--ui-hover)] ${pickerActiveIndex === index
                      ? 'border-accent/45 bg-accent/10'
                      : ''
                    }`}
                >
                  <CanvasNodeImage
                    src={item.displayUrl}
                    alt={item.label}
                    viewerSourceUrl={resolveImageDisplayUrl(item.imageUrl)}
                    viewerImageList={incomingImageViewerList}
                    className="h-8 w-8 rounded object-cover"
                    draggable={false}
                    showResolutionPreview={false}
                  />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {referenceHover && typeof document !== 'undefined' && createPortal(
          <div
            className="pointer-events-none fixed z-[9999] overflow-hidden rounded-lg border border-[var(--ui-border-soft)] bg-[var(--ui-surface-elevated)] shadow-[var(--ui-shadow-tooltip)]"
            style={{
              left: Math.max(10, referenceHover.anchorRect.left + referenceHover.anchorRect.width / 2 - 75),
              top: referenceHover.anchorRect.bottom + 10,
              width: 150,
              height: 150,
            }}
          >
            <img
              src={resolveImageDisplayUrl(referenceHover.imageUrl)}
              alt={`图${referenceHover.index}`}
              className="h-full w-full object-contain"
              draggable={false}
            />
          </div>,
          document.body
        )}
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
