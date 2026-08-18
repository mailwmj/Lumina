import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Loader2, Video, Wand2 } from '@/components/ui/icons';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  type VideoGenNodeData,
  type VideoResolution,
} from '@/features/canvas/domain/canvasNodes';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { resolveNodeSurfaceStateClass } from '@/features/canvas/ui/nodeSurfaceStyles';
import {
  canvasAiGateway,
  graphImageResolver,
} from '@/features/canvas/application/canvasServices';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { showErrorDialog } from '@/features/canvas/application/errorDialog';
import { polishText } from '@/features/canvas/infrastructure/textPolishService';
import { resolveTextModelSelection } from '@/features/canvas/application/textModelSelection';
import { resolveVideoApiConfig } from '@/features/canvas/application/videoApiSelection';
import { isVideoGenerationImageCountValid } from '@/features/canvas/application/videoGenerationInputRules';
import { selectWorkflowNodes } from '@/features/canvas/application/canvasNodeSelectors';
import {
  TEXT_GENERATION_MAX_HEIGHT,
  TEXT_GENERATION_MAX_WIDTH,
  resolveTextGenerationLayout,
} from '@/features/canvas/application/textGenerationLayout';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_FOOTER_CLASS,
  NODE_CONTROL_ICON_BUTTON_CLASS,
  NODE_CONTROL_ICON_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { UiButton, UiTooltip } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { logger } from '@/lib/logger';
import { VideoAdvancedOptionsPopover } from '@/features/canvas/ui/VideoAdvancedOptionsPopover';
import { usePreserveNodeCenterOnAutoResize } from '@/features/canvas/ui/usePreserveNodeCenterOnAutoResize';

type VideoGenNodeProps = NodeProps & {
  id: string;
  data: VideoGenNodeData;
  selected?: boolean;
};

const RESOLUTION_OPTIONS: { value: VideoResolution; label: string }[] = [
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
];

const DURATION_OPTIONS: number[] = [3, 4, 5, 6, 7, 8, 9, 10];

// SD 2.0 模型 ID 前缀
const SD_2_0_MODEL_PREFIXES = ['doubao-seedance-2-0', 'seedance-2-0'];
// SD 2.0 Fast 模型 ID
const SD_2_0_FAST_MODEL = 'doubao-seedance-2-0-fast-260128';
// SD 1.5 Pro 模型 ID
const SD_1_5_PRO_MODEL = 'doubao-seedance-1-5-pro-251215';

/**
 * 判断是否为 SD 2.0 系列模型
 */
function isSD2Model(modelId: string): boolean {
  return SD_2_0_MODEL_PREFIXES.some(prefix => modelId.toLowerCase().includes(prefix));
}

/**
 * 判断是否为 SD 2.0 Fast 模型
 */
function isSD2FastModel(modelId: string): boolean {
  return modelId === SD_2_0_FAST_MODEL;
}

/**
 * 判断是否为 SD 1.5 Pro 模型
 */
function isSD15ProModel(modelId: string): boolean {
  return modelId.toLowerCase().includes(SD_1_5_PRO_MODEL.toLowerCase());
}

/**
 * 获取模型支持的功能
 */
function getModelCapabilities(modelId: string) {
  const is2_0 = isSD2Model(modelId);
  const is2_0Fast = isSD2FastModel(modelId);
  const is1_5pro = isSD15ProModel(modelId);

  return {
    isSD2: is2_0,
    isSD2Fast: is2_0Fast,
    isSD15Pro: is1_5pro,
    supportsGenerateAudio: is2_0 || is1_5pro,
    supportsDraft: is1_5pro,
    supportsServiceTier: false,
    supportsWebSearch: is2_0,
    supportsMultiModalRef: is2_0,
    supportsReferenceVideo: is2_0,
    supportsReferenceAudio: is2_0,
    supports1080p: is2_0 && !is2_0Fast,
    supportsVideoExtending: is2_0,
    supportsVideoEditing: is2_0,
  };
}

export const VideoGenNode = memo(({ id, data, selected, width, height }: VideoGenNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const workflowNodes = useCanvasStore(selectWorkflowNodes);
  const edges = useCanvasStore((state) => state.edges);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const videoApis = useSettingsStore((state) => state.videoApis);
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
  const videoApiOptions = useMemo(
    () => videoApis.filter((api) => api.modelId.trim().length > 0),
    [videoApis]
  );
  const selectedVideoApi = useMemo(
    () => resolveVideoApiConfig(videoApis, data.videoApiId, data.model),
    [data.model, data.videoApiId, videoApis]
  );
  const selectedModel = selectedVideoApi?.modelId ?? data.model;

  const [promptDraft, setPromptDraft] = useState(data.prompt || '');
  const [isPolishing, setIsPolishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promptDraftRef = useRef(promptDraft);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptHighlightRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Determine if this is a videoFrame node (max 2 images) or videoSingle node (max 1 image)
  const nodeType = workflowNodes.find((node) => node.id === id)?.type;
  const isVideoFrame = nodeType === CANVAS_NODE_TYPES.videoFrame;
  const maxImages = isVideoFrame ? 2 : 1;

  // Compute model capabilities based on selected model
  const modelCapabilities = useMemo(
    () => getModelCapabilities(selectedModel || ''),
    [selectedModel]
  );

  const incomingImages = useMemo(
    () => graphImageResolver.collectInputImages(id, workflowNodes, edges),
    [id, workflowNodes, edges]
  );

  // Seedance supports text-to-video. The first/last-frame node is the only mode
  // that requires a fixed image count.
  const canGenerate = isVideoGenerationImageCountValid(nodeType, incomingImages.length);

  // Validate model and API key for generating
  const hasSelectedApiKey = Boolean(selectedVideoApi?.apiKey.trim());
  const hasSelectedApiBaseUrl = Boolean(selectedVideoApi?.baseUrl.trim());

  // Compute why generation is disabled (for button tooltip)
  const getGenerationDisabledReason = (): string | undefined => {
    if (isVideoFrame && incomingImages.length !== 2) {
      return t('node.videoGen.imageRequired', { count: maxImages });
    }
    if (!isVideoFrame && incomingImages.length > 1) {
      return t('node.videoGen.singleModeImageLimit', { count: incomingImages.length });
    }
    if (!selectedVideoApi) {
      return t('node.videoGen.apiRequired');
    }
    if (!selectedVideoApi.enabled) {
      return t('node.videoGen.apiDisabled');
    }
    if (!hasSelectedApiKey) {
      return t('node.videoGen.apiKeyRequired');
    }
    if (!hasSelectedApiBaseUrl) {
      return t('node.videoGen.apiBaseUrlRequired');
    }
    return undefined;
  };
  const generationDisabledReason = getGenerationDisabledReason();
  const isGenerationDisabled = !canGenerate
    || !selectedVideoApi
    || !selectedVideoApi.enabled
    || !hasSelectedApiKey
    || !hasSelectedApiBaseUrl;

  // For display, limit to maxImages
  const displayImages = useMemo(
    () => incomingImages.slice(0, maxImages).map((url) => resolveImageDisplayUrl(url)),
    [incomingImages, maxImages]
  );

  const layout = resolveTextGenerationLayout({
    width,
    height,
    hasImageContext: displayImages.length > 0,
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

  // Update promptDraft when data.prompt changes externally
  useEffect(() => {
    setPromptDraft(data.prompt || '');
  }, [data.prompt]);

  useEffect(() => {
    promptDraftRef.current = promptDraft;
  }, [promptDraft]);

  const commitPromptDraft = useCallback((nextPrompt: string) => {
    promptDraftRef.current = nextPrompt;
    updateNodeData(id, { prompt: nextPrompt });
  }, [id, updateNodeData]);

  const syncPromptHighlightScroll = useCallback(() => {
    if (!promptRef.current || !promptHighlightRef.current) {
      return;
    }
    promptHighlightRef.current.scrollTop = promptRef.current.scrollTop;
    promptHighlightRef.current.scrollLeft = promptRef.current.scrollLeft;
  }, []);

  const appendMetadataToPrompt = useCallback((value: string) => {
    if (!value) return;
    const current = promptDraftRef.current.trim();
    const next = current ? `${value}，${current}` : value;
    setPromptDraft(next);
    commitPromptDraft(next);
  }, [commitPromptDraft]);

  const handlePolish = useCallback(async () => {
    if (!selectedPolishModel) {
      void showErrorDialog(t('node.textModel.required'), t('settings.polishPrompt'));
      return;
    }

    if (incomingImages.length === 0) {
      void showErrorDialog(t('node.videoGen.polishImageRequired'), t('node.videoGen.polishTitle'));
      return;
    }

    const imagesToUse = incomingImages.slice(0, maxImages);
    const prompt = promptDraft.trim();

    let imageRefText = '';
    if (isVideoFrame && imagesToUse.length >= 2) {
      imageRefText = '图1（首帧）、图2（尾帧）';
    } else if (!isVideoFrame && imagesToUse.length >= 1) {
      imageRefText = '参考图片';
    }

    let textToPolish: string;
    if (prompt) {
      textToPolish = `${imageRefText}\n\n请根据以上图片优化这个视频提示词：${prompt}`;
    } else if (isVideoFrame) {
      textToPolish = `请根据以下首帧和尾帧图片生成一个适合AI视频的提示词：\n${imageRefText}`;
    } else {
      textToPolish = `请根据以下参考图片生成一个适合AI视频的提示词：\n${imageRefText}`;
    }

    setIsPolishing(true);
    try {
      const effectivePolishPrompt = selectedVideoApi?.polishPrompt
        || selectedVideoApi?.defaultPolishPrompt;

      const result = await polishText({
        text: textToPolish,
        referenceImages: imagesToUse,
        videoDuration: data.duration?.toString(),
        videoResolution: data.resolution,
        videoAspectRatio: data.aspectRatio,
        videoShotType: data.shotType,
        videoShotSize: data.shotSize,
        videoAngle: data.angle,
        videoCameraMovement: data.cameraMovement,
        videoCameraSpeed: data.cameraSpeed,
        isVideoFrame,
        customPrompt: effectivePolishPrompt,
        promptType: 'video',
        reasoningEffort: imagePolishConfig.reasoningEffort ?? undefined,
      }, selectedPolishModel.apiConfig);
      setPromptDraft(result.polished);
      updateNodeData(id, { prompt: result.polished });
    } catch (err) {
      let message = t('node.videoGen.polishFailed');
      if (err instanceof Error) {
        message = err.message;
      } else if (typeof err === 'string') {
        message = err;
      } else if (err && typeof err === 'object') {
        const errObj = err as Record<string, unknown>;
        if (errObj.message) {
          message = String(errObj.message);
        } else {
          message = JSON.stringify(err);
        }
      }
      void showErrorDialog(message, t('node.videoGen.polishFailed'));
    } finally {
      setIsPolishing(false);
    }
  }, [promptDraft, incomingImages, isVideoFrame, maxImages, id, updateNodeData, data, selectedVideoApi, selectedPolishModel, t, imagePolishConfig.reasoningEffort]);

  const handleGenerate = useCallback(async () => {
    const prompt = promptDraft.replace(/@(?=图\d+)/g, '').trim();
    if (!prompt) {
      void showErrorDialog(t('node.imageEdit.promptRequired'), t('common.error'));
      return;
    }

    if (!selectedVideoApi) {
      const msg = t('node.videoGen.apiRequired');
      setError(msg);
      void showErrorDialog(msg, t('common.error'));
      return;
    }

    if (isVideoFrame) {
      if (incomingImages.length !== 2) {
        const msg = t('node.videoGen.frameModeImageCount', { count: incomingImages.length });
        setError(msg);
        return;
      }
    } else if (incomingImages.length > 1) {
      const msg = t('node.videoGen.singleModeImageLimit', { count: incomingImages.length });
      setError(msg);
      return;
    }

    if (!selectedVideoApi.enabled) {
      const errorMsg = t('node.videoGen.apiDisabled');
      setError(errorMsg);
      return;
    }

    const providerApiKey = selectedVideoApi.apiKey.trim();

    if (!providerApiKey) {
      const errorMsg = t('node.videoGen.apiKeyRequired');
      setError(errorMsg);
      return;
    }
    if (!selectedVideoApi.baseUrl.trim()) {
      const errorMsg = t('node.videoGen.apiBaseUrlRequired');
      setError(errorMsg);
      return;
    }

    if (data.videoApiId !== selectedVideoApi.id || data.model !== selectedModel) {
      updateNodeData(id, {
        videoApiId: selectedVideoApi.id,
        model: selectedModel,
      });
    }

    const generationStartedAt = Date.now();
    const generationDurationMs = 120000;
    setError(null);

    const newNodePosition = findNodePosition(
      id,
      EXPORT_RESULT_NODE_DEFAULT_WIDTH,
      EXPORT_RESULT_NODE_LAYOUT_HEIGHT
    );

    const newNodeId = addNode(
      CANVAS_NODE_TYPES.exportVideo,
      newNodePosition,
      {
        isGenerating: true,
        generationStartedAt,
        generationDurationMs,
        displayName: t('node.videoGen.title'),
        aspectRatio: data.aspectRatio || '16:9',
        model: selectedModel,
        videoApiId: selectedVideoApi.id,
        resolution: data.resolution || '720p',
        duration: data.duration || 5,
        hasAudio: data.hasAudio ?? true,
        seed: data.seed ?? -1,
        camerafixed: data.camerafixed ?? false,
        watermark: data.watermark ?? false,
        prompt: promptDraft,
        draft: data.draft,
      }
    );
    addEdge(id, newNodeId);

    try {
      const extraParams: Record<string, unknown> = {};
      if (data.duration) extraParams.duration = data.duration;
      if (data.seed !== undefined) extraParams.seed = data.seed;
      extraParams.hasaudio = data.hasAudio ?? false;
      extraParams.camerafixed = data.camerafixed ?? false;
      extraParams.watermark = data.watermark ?? false;

      if (data.draft !== undefined) extraParams.draft = data.draft;
      if (data.enableWebSearch !== undefined) extraParams.enable_web_search = data.enableWebSearch;

      const providerId = 'volcvideo';

      const projectId = useProjectStore.getState().getCurrentProject()?.id;
      const jobId = await canvasAiGateway.submitGenerateImageJob({
        prompt,
        model: selectedModel,
        providerId,
        size: data.resolution || '720p',
        aspectRatio: data.aspectRatio || '16:9',
        referenceImages: incomingImages.slice(0, maxImages),
        extraParams,
        providerConfig: {
          api_key: providerApiKey,
          base_url: selectedVideoApi.baseUrl.trim(),
          config_id: selectedVideoApi.id,
          protocol: selectedVideoApi.protocol ?? 'volcengine-seedance',
        },
        draftTaskId: data.draftTaskId,
        projectId,
      });

      updateNodeData(newNodeId, {
        generationJobId: jobId,
        generationProviderId: providerId,
      });
    } catch (err) {
      logger.error('[VideoGen] Generation error caught:', err);
      const errorDetail = err instanceof Error ? err.message : String(err);
      let guidance = errorDetail;
      if (errorDetail.includes('VolcVOD')) {
        guidance = errorDetail;
      } else if (errorDetail.includes('missing task_id')) {
        guidance = errorDetail;
      }
      updateNodeData(newNodeId, {
        isGenerating: false,
        generationStartedAt: null,
        generationJobId: null,
        generationError: guidance,
      });
      setError(guidance);
    }
  }, [promptDraft, data, id, updateNodeData, t, incomingImages, findNodePosition, addNode, addEdge, isVideoFrame, maxImages, selectedModel, selectedVideoApi]);

  const handlePromptKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void handleGenerate();
    }
  }, [handleGenerate]);

  const handleResolutionChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateNodeData(id, { resolution: e.target.value as VideoResolution });
  }, [id, updateNodeData]);

  const handleVideoApiChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const api = videoApis.find((candidate) => candidate.id === e.target.value);
    const newModel = api?.modelId ?? '';
    const caps = getModelCapabilities(newModel);
    const updates: Partial<VideoGenNodeData> = {
      model: newModel,
      videoApiId: api?.id ?? null,
    };
    if (!caps.supportsDraft) {
      updates.draft = undefined;
    }
    if (!caps.supportsWebSearch) {
      updates.enableWebSearch = undefined;
    }
    updateNodeData(id, updates);
  }, [id, updateNodeData, videoApis]);

  const handleDurationChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateNodeData(id, { duration: parseInt(e.target.value, 10) });
  }, [id, updateNodeData]);

  const handleAdvancedChange = useCallback((partial: Partial<VideoGenNodeData>) => {
    updateNodeData(id, partial);
  }, [id, updateNodeData]);

  return (
    <div
      ref={rootRef}
      className={`group relative flex h-full flex-col gap-2 overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150 ${resolveNodeSurfaceStateClass(selected)}`}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      {isVideoFrame ? (
        <>
          <Handle type="target" id="target-first" position={Position.Left} style={{ top: '35%' }} />
          <Handle type="target" id="target-last" position={Position.Left} style={{ top: '65%' }} />
        </>
      ) : (
        <Handle type="target" id="target" position={Position.Left} />
      )}

      {/* Connected Reference Images (labeled section, shrink-0) */}
      {displayImages.length > 0 && (
        <section className="min-w-0 shrink-0" aria-label={t('node.videoGen.referenceImages')}>
          <div className="mb-1 text-[10px] font-medium text-text-muted">
            {t('node.videoGen.referenceImages')}
          </div>
          <div
            className="no-scrollbar nowheel flex min-w-0 gap-1.5 overflow-x-auto overflow-y-hidden rounded-lg border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)]/70 p-2"
            style={{ height: layout.referenceImagesHeight }}
          >
            {displayImages.map((imgUrl, idx) => {
              const label = isVideoFrame
                ? (idx === 0 ? t('node.videoGen.firstFrame') : t('node.videoGen.lastFrame'))
                : t('node.imageReference.label', { index: idx + 1 });
              return (
                <div
                  key={idx}
                  className="nodrag nowheel relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-[var(--ui-border-soft)] bg-bg-dark"
                  title={label}
                >
                  <img
                    src={imgUrl}
                    alt={label}
                    className="h-full w-full rounded-[inherit] object-cover"
                    draggable={false}
                  />
                  {isVideoFrame && (
                    <span className="pointer-events-none absolute bottom-0.5 right-0.5 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border border-white/25 bg-black/70 px-1 text-[10px] font-semibold leading-none text-white shadow-md backdrop-blur-sm">
                      {label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Prompt Input (labeled section, flex-1, only region that scrolls) */}
      <section className="min-w-0 flex-1">
        <div className="mb-1 text-[10px] font-medium text-text-muted">
          {t('node.videoGen.promptLabel')}
        </div>
        <div
          className="nodrag nowheel relative overflow-visible rounded-lg border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)]"
          style={{ height: layout.promptHeight }}
        >
          <div className="relative h-full min-h-0">
            <div
              ref={promptHighlightRef}
              aria-hidden="true"
              className="ui-scrollbar absolute inset-0 overflow-y-auto overflow-x-hidden text-sm leading-6 text-text-dark pointer-events-none"
              style={{ scrollbarGutter: 'stable' }}
            >
              <div className="min-h-full whitespace-pre-wrap break-words px-1 py-0.5">
                {promptDraft || ' '}
              </div>
            </div>
            <textarea
              ref={promptRef}
              value={promptDraft}
              onChange={(e) => {
                const nextValue = e.target.value;
                setPromptDraft(nextValue);
                commitPromptDraft(nextValue);
              }}
              onKeyDown={handlePromptKeyDown}
              onScroll={syncPromptHighlightScroll}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder={t('node.videoGen.promptPlaceholder')}
              className="ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none overflow-y-auto overflow-x-hidden border-none bg-transparent px-1 py-0.5 text-sm leading-6 text-text-dark outline-none placeholder:text-text-muted/80 focus:border-transparent whitespace-pre-wrap break-words"
              style={{ scrollbarGutter: 'stable' }}
            />
            {/* Polish Button */}
            <UiTooltip content={t('node.imageEdit.polishPrompt')}>
              <button
                type="button"
                aria-label={t('node.imageEdit.polishPrompt')}
                className="absolute bottom-2 right-2 z-20 rounded p-1 text-text-muted hover:bg-accent/20 hover:text-accent disabled:opacity-50"
                onClick={(e) => {
                  e.stopPropagation();
                  void handlePolish();
                }}
                disabled={isPolishing}
              >
                {isPolishing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
              </button>
            </UiTooltip>
          </div>
        </div>
      </section>

      {/* Error */}
      {error && (
        <div className="shrink-0 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Footer (32px) */}
      <div className={`${NODE_CONTROL_FOOTER_CLASS} gap-1`}>
        <select
          className={`nodrag nowheel shrink-0 ${NODE_CONTROL_CHIP_CLASS} border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)] font-mono text-text-dark`}
          value={selectedVideoApi?.id ?? ''}
          onChange={handleVideoApiChange}
          title={t('node.videoGen.model')}
        >
          <option value="">{t('node.videoGen.model')}</option>
          {videoApiOptions.map((api) => (
            <option key={api.id} value={api.id}>
              {api.name ? `${api.name} (${api.modelId})` : api.modelId}
            </option>
          ))}
        </select>

        <select
          className={`nodrag nowheel shrink-0 ${NODE_CONTROL_CHIP_CLASS} border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)] font-mono text-text-dark`}
          value={data.resolution}
          onChange={handleResolutionChange}
          title={t('node.videoGen.resolution')}
        >
          {RESOLUTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          className={`nodrag nowheel shrink-0 ${NODE_CONTROL_CHIP_CLASS} border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)] font-mono text-text-dark`}
          value={data.duration}
          onChange={handleDurationChange}
          title={t('node.videoGen.duration')}
        >
          {DURATION_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}{t('node.videoGen.durationUnit')}
            </option>
          ))}
        </select>

        <VideoAdvancedOptionsPopover
          value={{
            shotType: data.shotType,
            shotSize: data.shotSize,
            angle: data.angle,
            cameraMovement: data.cameraMovement,
            cameraSpeed: data.cameraSpeed,
            hasAudio: data.hasAudio,
            camerafixed: data.camerafixed,
            watermark: data.watermark,
            draft: data.draft,
            enableWebSearch: data.enableWebSearch,
            seed: data.seed,
          }}
          capabilities={{
            supportsGenerateAudio: modelCapabilities.supportsGenerateAudio,
            supportsDraft: modelCapabilities.supportsDraft,
            supportsWebSearch: modelCapabilities.supportsWebSearch,
            isSD2: modelCapabilities.isSD2,
          }}
          showShotPresets
          onChange={handleAdvancedChange}
          onAppendToPrompt={appendMetadataToPrompt}
          chipClassName={NODE_CONTROL_CHIP_CLASS}
          triggerClassName="shrink-0"
        />

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
          disabled={isGenerationDisabled}
          title={generationDisabledReason}
        >
          <Video className={NODE_CONTROL_ICON_CLASS} strokeWidth={2.8} />
          {t('node.videoGen.generateVideo')}
        </UiButton>
      </div>

      <Handle type="source" id="source" position={Position.Right} />

      <NodeResizeHandle
        minWidth={layout.minWidth}
        minHeight={layout.minHeight}
        maxWidth={TEXT_GENERATION_MAX_WIDTH}
        maxHeight={TEXT_GENERATION_MAX_HEIGHT}
      />
    </div>
  );
});

VideoGenNode.displayName = 'VideoGenNode';
