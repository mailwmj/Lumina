import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Loader2, Video, Wand2, X, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  type VideoGenNodeData,
  type VideoResolution,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  canvasAiGateway,
  graphImageResolver,
} from '@/features/canvas/application/canvasServices';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { showErrorDialog } from '@/features/canvas/application/errorDialog';
import {
  findReferenceTokens,
  resolveReferenceAwareDeleteRange,
  removeTextRange,
  insertReferenceToken,
} from '@/features/canvas/application/referenceTokenEditing';
import { polishText } from '@/features/canvas/infrastructure/textPolishService';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_PARAMS_CHIP_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { UiButton } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { VideoApiConfig } from '@/stores/settingsStore';

type VideoGenNodeProps = NodeProps & {
  id: string;
  data: VideoGenNodeData;
  selected?: boolean;
};

const VIDEO_GEN_NODE_MIN_WIDTH = 380;
const VIDEO_GEN_NODE_MIN_HEIGHT = 320;
const VIDEO_GEN_NODE_MAX_WIDTH = 800;
const VIDEO_GEN_NODE_MAX_HEIGHT = 700;
const VIDEO_GEN_NODE_DEFAULT_WIDTH = 480;
const VIDEO_GEN_NODE_DEFAULT_HEIGHT = 480;

const RESOLUTION_OPTIONS: { value: VideoResolution; label: string }[] = [
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
];

const DURATION_OPTIONS: number[] = [3, 4, 5, 6, 7, 8, 9, 10];

const SHOT_TYPE_OPTIONS = [
  { value: '', label: '镜头-自动' },
  { value: '固定镜头：摄像机位置固定，主体在画面中保持稳定', label: '固定镜头' },
  { value: '手持镜头：模拟手持摄像机的轻微晃动，增加现场感', label: '手持镜头' },
  { value: '围绕主体运镜：摄像机围绕主体旋转移动', label: '围绕主体运镜' },
  { value: '镜头拉远：逐渐扩大视野，拉远与主体的距离', label: '镜头拉远' },
  { value: '镜头推进：逐渐缩小视野，靠近主体', label: '镜头推进' },
  { value: '镜头跟随：摄像机跟随主体移动', label: '镜头跟随' },
  { value: '镜头右摇：摄像机水平向右摇动', label: '镜头右摇' },
  { value: '镜头左摇：摄像机水平向左摇动', label: '镜头左摇' },
  { value: '镜头上摇：摄像机向上摇动', label: '镜头上摇' },
  { value: '镜头下摇：摄像机向下摇动', label: '镜头下摇' },
  { value: '镜头环绕：摄像机环绕主体做圆周运动', label: '镜头环绕' },
];

const SHOT_SIZE_OPTIONS = [
  { value: '', label: '景别-自动' },
  { value: '近景', label: '近景' },
  { value: '中景', label: '中景' },
  { value: '远景', label: '远景' },
  { value: '特写', label: '特写' },
];

const ANGLE_OPTIONS = [
  { value: '', label: '角度-自动' },
  { value: '平视', label: '平视' },
  { value: '仰视', label: '仰视' },
  { value: '俯视', label: '俯视' },
];

const CAMERA_SPEED_OPTIONS = [
  { value: '', label: '速度-自动' },
  { value: '慢速', label: '慢速' },
  { value: '中速', label: '中速' },
  { value: '快速', label: '快速' },
];

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
    // generateAudio: SD 2.0 & 2.0 fast, SD 1.5 pro 支持
    supportsGenerateAudio: is2_0 || is1_5pro,
    // draft: 仅 SD 1.5 pro 支持
    supportsDraft: is1_5pro,
    // serviceTier: 所有模型都不支持
    supportsServiceTier: false,
    // enableWebSearch: 仅 SD 2.0 支持
    supportsWebSearch: is2_0,
    // 多模态参考（多图）: SD 2.0 支持
    supportsMultiModalRef: is2_0,
    // 参考视频: 仅 SD 2.0 支持
    supportsReferenceVideo: is2_0,
    // 参考音频: 仅 SD 2.0 支持
    supportsReferenceAudio: is2_0,
    // 1080p: SD 2.0 支持（但 Fast 不支持）
    supports1080p: is2_0 && !is2_0Fast,
    // 视频延长: 仅 SD 2.0 支持
    supportsVideoExtending: is2_0,
    // 视频编辑: 仅 SD 2.0 支持
    supportsVideoEditing: is2_0,
  };
}

interface PickerAnchor {
  left: number;
  top: number;
}

const PICKER_FALLBACK_ANCHOR: PickerAnchor = { left: 8, top: 8 };
const PICKER_Y_OFFSET_PX = 20;

function getTextareaCaretOffset(
  textarea: HTMLTextAreaElement,
  caretIndex: number
): PickerAnchor {
  const mirror = document.createElement('div');
  const computed = window.getComputedStyle(textarea);
  const mirrorStyle = mirror.style;

  mirrorStyle.position = 'absolute';
  mirrorStyle.visibility = 'hidden';
  mirrorStyle.pointerEvents = 'none';
  mirrorStyle.whiteSpace = 'pre-wrap';
  mirrorStyle.overflowWrap = 'break-word';
  mirrorStyle.wordBreak = 'break-word';
  mirrorStyle.boxSizing = computed.boxSizing;
  mirrorStyle.width = `${textarea.clientWidth}px`;
  mirrorStyle.font = computed.font;
  mirrorStyle.lineHeight = computed.lineHeight;
  mirrorStyle.letterSpacing = computed.letterSpacing;
  mirrorStyle.padding = computed.padding;
  mirrorStyle.border = computed.border;
  mirrorStyle.textTransform = computed.textTransform;
  mirrorStyle.textIndent = computed.textIndent;

  mirror.textContent = textarea.value.slice(0, caretIndex);

  const marker = document.createElement('span');
  marker.textContent = textarea.value.slice(caretIndex, caretIndex + 1) || ' ';
  mirror.appendChild(marker);

  document.body.appendChild(mirror);

  const left = marker.offsetLeft - textarea.scrollLeft;
  const top = marker.offsetTop - textarea.scrollTop;

  document.body.removeChild(mirror);

  return {
    left: Math.max(0, left),
    top: Math.max(0, top),
  };
}

function resolvePickerAnchor(
  container: HTMLDivElement | null,
  textarea: HTMLTextAreaElement,
  caretIndex: number
): PickerAnchor {
  if (!container) {
    return PICKER_FALLBACK_ANCHOR;
  }

  const containerRect = container.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();
  const caretOffset = getTextareaCaretOffset(textarea, caretIndex);

  return {
    left: Math.max(0, textareaRect.left - containerRect.left + caretOffset.left),
    top: Math.max(0, textareaRect.top - containerRect.top + caretOffset.top + PICKER_Y_OFFSET_PX),
  };
}

function renderPromptWithHighlights(
  prompt: string,
  maxImageCount: number,
  imageUrls?: string[]
): ReactNode {
  if (!prompt) {
    return ' ';
  }

  const segments: ReactNode[] = [];
  let lastIndex = 0;
  const referenceTokens = findReferenceTokens(prompt, maxImageCount);
  for (const token of referenceTokens) {
    const matchStart = token.start;
    const matchText = token.token;

    if (matchStart > lastIndex) {
      segments.push(
        <span key={`plain-${lastIndex}`}>{prompt.slice(lastIndex, matchStart)}</span>
      );
    }

    const imageUrl = imageUrls && imageUrls[token.value - 1] ? imageUrls[token.value - 1] : undefined;
    segments.push(
      <span
        key={`ref-${matchStart}`}
        data-highlight-ref="true"
        data-image-url={imageUrl || ''}
        data-index={token.value}
        className="relative z-0 text-white [text-shadow:0.24px_0_currentColor,-0.24px_0_currentColor] before:absolute before:-inset-x-[4px] before:-inset-y-[1px] before:-z-10 before:rounded-[7px] before:bg-accent/55 before:content-['']"
      >
        {matchText}
      </span>
    );

    lastIndex = matchStart + matchText.length;
  }

  if (lastIndex < prompt.length) {
    segments.push(<span key={`plain-${lastIndex}`}>{prompt.slice(lastIndex)}</span>);
  }

  return segments;
}

export const VideoGenNode = memo(({ id, data, selected, width, height }: VideoGenNodeProps) => {
  const { t } = useTranslation();
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const videoApis = useSettingsStore((state) => state.videoApis);
  const textApis = useSettingsStore((state) => state.textApis);

  const [promptDraft, setPromptDraft] = useState(data.prompt || '');
  const [isGenerating] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promptDraftRef = useRef(promptDraft);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptHighlightRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const highlightMouseLeaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showImagePicker, setShowImagePicker] = useState(false);
  const [pickerCursor, setPickerCursor] = useState<number | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(PICKER_FALLBACK_ANCHOR);
  const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
  const [referenceHover, setReferenceHover] = useState<{
    index: number;
    imageUrl: string;
    anchorRect: DOMRect;
  } | null>(null);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);

  /**
   * Append a metadata value to the prompt draft
   * @param value The specific metadata value to append
   */
  const appendMetadataToPrompt = useCallback((value: string) => {
    if (!value) return;
    const current = promptDraft.trim();
    if (current) {
      setPromptDraft(`${value}，${current}`);
    } else {
      setPromptDraft(value);
    }
  }, [promptDraft]);

  // Determine if this is a videoFrame node (max 2 images) or videoSingle node (max 1 image)
  const nodeType = nodes.find((n) => n.id === id)?.type;
  const isVideoFrame = nodeType === CANVAS_NODE_TYPES.videoFrame;
  const maxImages = isVideoFrame ? 2 : 1;

  // Compute model capabilities based on selected model
  const modelCapabilities = useMemo(() => getModelCapabilities(data.model || ''), [data.model]);

  // Debug: log all edges connected to this node
  const connectedEdges = useMemo(() => edges.filter((e) => e.target === id), [edges, id]);
  console.info('[VideoGenNode] nodeId:', id, 'type:', nodeType, 'isVideoFrame:', isVideoFrame);
  console.info('[VideoGenNode] connected edges count:', connectedEdges.length);
  connectedEdges.forEach((edge, idx) => {
    console.info('[VideoGenNode] edge[' + idx + ']: source=' + edge.source + ', targetHandle=' + edge.targetHandle);
  });

  const incomingImages = useMemo(
    () => {
      const images = graphImageResolver.collectInputImages(id, nodes, edges);
      console.info('[VideoGenNode] incomingImages count:', images.length);
      return images;
    },
    [id, nodes, edges]
  );

  const incomingImageItems = useMemo(
    () =>
      incomingImages.map((imageUrl, index) => ({
        imageUrl,
        displayUrl: resolveImageDisplayUrl(imageUrl),
        label: `图${index + 1}`,
      })),
    [incomingImages]
  );

  // Check if enough images are connected for generation
  const canGenerate = incomingImages.length >= maxImages;

  // Validate model and API key for generating
  const selectedModel = data.model;
  const hasConfiguredApi = videoApis.some(
    (api: VideoApiConfig) => api.enabled && api.apiKey && api.apiKey.length > 0
  );

  // Compute why generation is disabled (for button tooltip)
  const getGenerationDisabledReason = (): string | undefined => {
    if (incomingImages.length < maxImages) {
      return `需要连接${maxImages}张图片才能生成`;
    }
    if (!selectedModel) {
      return '请先选择视频模型';
    }
    if (!hasConfiguredApi) {
      return '请先在设置中配置视频API密钥';
    }
    return undefined;
  };
  const generationDisabledReason = getGenerationDisabledReason();
  const isGenerationDisabled = !canGenerate || !selectedModel || !hasConfiguredApi;

  // For display, limit to maxImages
  const displayImages = useMemo(
    () => incomingImages.slice(0, maxImages).map((url) => resolveImageDisplayUrl(url)),
    [incomingImages, maxImages]
  );

  const resolvedWidth = Math.max(VIDEO_GEN_NODE_MIN_WIDTH, Math.round(width ?? VIDEO_GEN_NODE_DEFAULT_WIDTH));
  const resolvedHeight = Math.max(VIDEO_GEN_NODE_MIN_HEIGHT, Math.round(height ?? VIDEO_GEN_NODE_DEFAULT_HEIGHT));

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

  const syncPromptHighlightScroll = () => {
    if (!promptRef.current || !promptHighlightRef.current) {
      return;
    }
    promptHighlightRef.current.scrollTop = promptRef.current.scrollTop;
    promptHighlightRef.current.scrollLeft = promptRef.current.scrollLeft;
  };

  // Handle clicking outside to close image picker
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

  // Handle @图x hover preview
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

  const insertImageReference = useCallback((imageIndex: number) => {
    const marker = `@图${imageIndex + 1}`;
    const currentPrompt = promptDraftRef.current;
    const cursor = pickerCursor ?? currentPrompt.length;
    const { nextText: nextPrompt, nextCursor } = insertReferenceToken(currentPrompt, cursor, marker);

    setPromptDraft(nextPrompt);
    commitPromptDraft(nextPrompt);
    setShowImagePicker(false);
    setPickerCursor(null);
    setPickerActiveIndex(0);

    requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(nextCursor, nextCursor);
      syncPromptHighlightScroll();
    });
  }, [commitPromptDraft, pickerCursor]);

  const handlePolish = useCallback(async () => {
    console.info('[VideoGen Polish] === START ===', {
      incomingImagesCount: incomingImages.length,
      incomingImages: incomingImages.map((url, i) => `${i}: ${url.substring(0, 120)}`),
      isVideoFrame,
      maxImages,
      nodeId: id,
    });

    const enabledApi = textApis.find((api) => api.enabled);
    if (!enabledApi) {
      void showErrorDialog('请先在设置中启用一个文本API', '润色提示');
      return;
    }

    // Require at least one image for video polish
    if (incomingImages.length === 0) {
      void showErrorDialog('请先连接图片后再润色', '润色提示');
      return;
    }

    // Limit to maxImages based on node type
    const imagesToUse = incomingImages.slice(0, maxImages);
    const prompt = promptDraft.trim();

    // Build image reference description (just labels, images passed separately)
    let imageRefText = '';
    if (isVideoFrame && imagesToUse.length >= 2) {
      imageRefText = '图1（首帧）、图2（尾帧）';
    } else if (!isVideoFrame && imagesToUse.length >= 1) {
      imageRefText = '参考图片';
    }

    console.info('[VideoGen Polish] images to use:', {
      count: imagesToUse.length,
      urls: imagesToUse.map((url, i) => `${i}: ${url.substring(0, 120)}`),
      imageRefText,
    });

    // Build the text to polish
    let textToPolish: string;
    if (prompt) {
      // User provided prompt - prepend image references
      textToPolish = `${imageRefText}\n\n请根据以上图片优化这个视频提示词：${prompt}`;
    } else {
      // No prompt - ask AI to generate prompt from images
      if (isVideoFrame) {
        textToPolish = `请根据以下首帧和尾帧图片生成一个适合AI视频的提示词：\n${imageRefText}`;
      } else {
        textToPolish = `请根据以下参考图片生成一个适合AI视频的提示词：\n${imageRefText}`;
      }
    }

    console.info('[VideoGen Polish] text to polish:', textToPolish);
    console.info('[VideoGen Polish] images count:', imagesToUse.length);
    console.info('[VideoGen Polish] image URLs:', imagesToUse.map((url, i) => `${i}: ${url.substring(0, 100)}`));

    setIsPolishing(true);
    try {
      // Find the video API config that matches the selected model
      const selectedModel = data.model as string;
      console.info('[VideoGen Polish] selectedModel:', selectedModel);
      console.info('[VideoGen Polish] available videoApis:', videoApis.map(api => ({ modelId: api.modelId, name: api.name, hasPolishPrompt: !!api.polishPrompt, hasDefaultPolishPrompt: !!api.defaultPolishPrompt })));
      const videoApiConfig = videoApis.find((api: VideoApiConfig) => api.modelId === selectedModel);
      console.info('[VideoGen Polish] matched config:', videoApiConfig);
      // Use per-model polish prompt if set, otherwise fall back to default
      const effectivePolishPrompt = videoApiConfig?.polishPrompt || videoApiConfig?.defaultPolishPrompt;
      console.info('[VideoGen Polish] effectivePolishPrompt:', effectivePolishPrompt ? effectivePolishPrompt.substring(0, 100) + '...' : null);

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
        isVideoFrame: isVideoFrame,
        customPrompt: effectivePolishPrompt,
        promptType: 'video',
      }, enabledApi);
      setPromptDraft(result.polished);
      updateNodeData(id, { prompt: result.polished });
    } catch (err) {
      console.error('[VideoGen Polish] failed with error:', err);
      let message = '润色失败';
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
      console.error('[VideoGen Polish] error message:', message);
      void showErrorDialog(message, '润色失败');
    } finally {
      setIsPolishing(false);
    }
  }, [textApis, videoApis, promptDraft, incomingImages, isVideoFrame, maxImages, id, updateNodeData, data]);

  const handleGenerate = useCallback(async () => {
    console.info('[VideoGen] handleGenerate called', { prompt: promptDraft, model: data.model, hasImages: incomingImages.length });
    const prompt = promptDraft.replace(/@(?=图\d+)/g, '').trim();
    if (!prompt) {
      console.warn('[VideoGen] No prompt, showing dialog');
      showErrorDialog(t('node.imageEdit.promptRequired'), 'prompt');
      return;
    }

    if (!data.model) {
      console.warn('[VideoGen] No model selected, showing dialog');
      setError('请先选择视频模型');
      showErrorDialog('请先选择视频模型', 'model');
      return;
    }

    // 首尾帧模式必须恰好有2张有效图片，单图模式至少需要1张
    if (isVideoFrame) {
      if (incomingImages.length !== 2) {
        console.warn('[VideoGen] 首尾帧模式需要2张图片，当前只有', incomingImages.length, '张');
        setError(`首尾帧模式需要2张参考图片，当前只有${incomingImages.length}张。请确保首帧和尾帧都已连接有效的图片节点。`);
        return;
      }
    } else {
      if (incomingImages.length < 1) {
        console.warn('[VideoGen] 单图模式需要至少1张图片');
        setError(`请先连接至少1张参考图片。`);
        return;
      }
      if (incomingImages.length > 1) {
        console.warn('[VideoGen] 单图模式将使用第一张图片');
      }
    }

    console.info('[VideoGen] Starting generation process');

    // Get API key from videoApis based on selected model
    const modelStr = (data.model as string) || '';

    // Find the API config that matches the selected model (ignore enabled flag - user can select any model in dropdown)
    // First try exact model match with any API that has a key
    const matchingApi = videoApis.find(
      (api: VideoApiConfig) => api.modelId === modelStr && api.apiKey && api.apiKey.length > 0
    );
    // Fall back to any API with a key
    const configuredVideoApi = matchingApi ?? videoApis.find(
      (api: VideoApiConfig) => api.apiKey && api.apiKey.length > 0
    );
    const providerApiKey = configuredVideoApi?.apiKey ?? '';

    // Debug log
    console.info('[VideoGen] API key lookup:', {
      modelStr,
      videoApisCount: videoApis.length,
      hasModelMatch: !!matchingApi,
      configuredVideoApi: configuredVideoApi ? { modelId: configuredVideoApi.modelId, id: configuredVideoApi.id, hasKey: !!configuredVideoApi.apiKey } : null,
      providerApiKeyLength: providerApiKey.length,
    });

    if (!providerApiKey) {
      const errorMsg = `视频API密钥未配置：请在设置→视频API中配置 ${modelStr} 的API密钥`;
      console.error('[VideoGen] API key not configured!');
      setError(errorMsg);
      // Don't create node if no API key
      return;
    }

    const generationStartedAt = Date.now();
    const generationDurationMs = 120000;
    setError(null);

    // Calculate position for the new result node using findNodePosition to avoid overlap
    const newNodePosition = findNodePosition(
      id,
      EXPORT_RESULT_NODE_DEFAULT_WIDTH,
      EXPORT_RESULT_NODE_LAYOUT_HEIGHT
    );

    // Create export video node
    const newNodeId = addNode(
      CANVAS_NODE_TYPES.exportVideo,
      newNodePosition,
      {
        isGenerating: true,
        generationStartedAt,
        generationDurationMs,
        displayName: t('node.videoGen.title'),
        aspectRatio: data.aspectRatio || '16:9',
        model: data.model,
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
    console.info('[VideoGen] Export node created:', newNodeId);

    try {
      const extraParams: Record<string, unknown> = {};
      if (data.duration) extraParams.duration = data.duration;
      if (data.seed !== undefined) extraParams.seed = data.seed;
      // 始终设置 hasaudio，默认为 false（旧节点 hasAudio 可能是 undefined）
      extraParams.hasaudio = data.hasAudio ?? false;
      extraParams.camerafixed = data.camerafixed ?? false;
      extraParams.watermark = data.watermark ?? false;

      // SD 2.0 新参数
      if (data.draft !== undefined) extraParams.draft = data.draft;
      if (data.enableWebSearch !== undefined) extraParams.enable_web_search = data.enableWebSearch;

      // Provider ID is always 'volcvideo' for video generation
      const providerId = 'volcvideo';

      // Set API key before submitting job
      console.info('[VideoGen] Setting API key and submitting job...', { providerId, providerApiKeyLength: providerApiKey.length });
      try {
        await canvasAiGateway.setApiKey(providerId, providerApiKey);
        console.info('[VideoGen] API key set successfully');
      } catch (e) {
        console.error('[VideoGen] setApiKey failed:', e);
        throw e;
      }

      console.info('[VideoGen] Submitting job...', {
        model: data.model,
        promptLength: prompt.length,
        isVideoFrame,
        maxImages,
        incomingImagesCount: incomingImages.length,
        incomingImages: incomingImages.map((url, i) => `图${i + 1}: ${url.substring(0, 80)}...`),
      });
      try {
        const projectId = useProjectStore.getState().getCurrentProject()?.id;
        const jobId = await canvasAiGateway.submitGenerateImageJob({
          prompt,
          model: data.model,
          size: data.resolution || '720p',
          aspectRatio: data.aspectRatio || '16:9',
          referenceImages: incomingImages,
          extraParams,
          draftTaskId: data.draftTaskId,
          projectId,
        });

        console.info('[VideoGen] Job submitted successfully', { jobId, model: data.model });

        // Update the export node with job info
        updateNodeData(newNodeId, {
          generationJobId: jobId,
          generationProviderId: providerId,
        });
      } catch (e) {
        console.error('[VideoGen] submitGenerateImageJob failed:', e);
        throw e;
      }
    } catch (err) {
      console.error('[VideoGen] Generation error caught:', err);
      const errorDetail = err instanceof Error ? err.message : String(err);
      // Provide specific guidance based on error type
      let guidance = '';
      if (errorDetail.includes('VolcVOD')) {
        // VOD upload related errors
        guidance = `图片上传失败：${errorDetail}`;
      } else if (errorDetail.includes('missing task_id')) {
        guidance = '模型ID不存在或API地址错误';
      } else if (errorDetail.includes('InvalidSignature') || errorDetail.includes('401')) {
        guidance = 'API密钥无效，请检查火山引擎密钥配置';
      } else if (errorDetail.includes('403')) {
        guidance = 'API密钥权限不足';
      } else if (errorDetail.includes('429')) {
        guidance = '请求过于频繁，请稍后重试';
      } else if (errorDetail.includes('500') || errorDetail.includes('502') || errorDetail.includes('503')) {
        guidance = '火山引擎服务器错误';
      } else if (errorDetail.includes('Failed to fetch') || errorDetail.includes('network')) {
        guidance = '网络连接失败';
      } else {
        guidance = errorDetail;
      }
      const message = guidance;
      console.error('[VideoGen] Updating node with error:', message);
      updateNodeData(newNodeId, {
        isGenerating: false,
        generationStartedAt: null,
        generationJobId: null,
        generationError: message,
      });
      setError(message);
    }
  }, [promptDraft, data, id, updateNodeData, t, incomingImages, findNodePosition, addNode, addEdge, videoApis]);

  const handlePromptKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
        displayImages.length
      );
      if (deleteRange) {
        event.preventDefault();
        const { nextText, nextCursor } = removeTextRange(currentPrompt, deleteRange);
        setPromptDraft(nextText);
        commitPromptDraft(nextText);
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
  }, [commitPromptDraft, displayImages.length, showImagePicker, incomingImages.length, insertImageReference, pickerActiveIndex]);

  const handleResolutionChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateNodeData(id, { resolution: e.target.value as VideoResolution });
  }, [id, updateNodeData]);

  const handleModelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    // 切换模型时清除旧模型特有的参数，避免干扰
    const caps = getModelCapabilities(newModel);
    const updates: Partial<VideoGenNodeData> = { model: newModel };
    if (!caps.supportsDraft) {
      updates.draft = undefined;
    }
    if (!caps.supportsWebSearch) {
      updates.enableWebSearch = undefined;
    }
    updateNodeData(id, updates);
  }, [id, updateNodeData]);

  const handleDurationChange = useCallback((value: number) => {
    updateNodeData(id, { duration: value });
  }, [id, updateNodeData]);

  const handleHasAudioChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateNodeData(id, { hasAudio: e.target.checked });
  }, [id, updateNodeData]);

  const handleSeedChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const seedValue = e.target.value;
    if (seedValue === '') {
      updateNodeData(id, { seed: undefined });
    } else {
      const numValue = parseInt(seedValue, 10);
      if (!isNaN(numValue)) {
        updateNodeData(id, { seed: numValue });
      }
    }
  }, [id, updateNodeData]);

  const handleCameraFixedChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateNodeData(id, { camerafixed: e.target.checked });
  }, [id, updateNodeData]);

  const handleWatermarkChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateNodeData(id, { watermark: e.target.checked });
  }, [id, updateNodeData]);

  const handleRemoveVideo = useCallback(() => {
    updateNodeData(id, { videoUrl: null, previewImageUrl: null });
  }, [id, updateNodeData]);

  const displayName = useMemo(() => {
    const type = nodes.find(n => n.id === id)?.type;
    if (type === CANVAS_NODE_TYPES.videoFrame) {
      return resolveNodeDisplayName(CANVAS_NODE_TYPES.videoFrame, data);
    } else if (type === CANVAS_NODE_TYPES.videoSingle) {
      return resolveNodeDisplayName(CANVAS_NODE_TYPES.videoSingle, data);
    }
    return resolveNodeDisplayName(CANVAS_NODE_TYPES.videoFrame, data);
  }, [id, nodes, data]);

  const videoModelOptions = useMemo(() => {
    // 显示所有已配置的 API（包括未启用但有有效配置的）
    const configuredApis = videoApis.filter(
      (api: VideoApiConfig) => api.apiKey && api.apiKey.length > 0
    );
    if (configuredApis.length > 0) {
      return configuredApis.map((api: VideoApiConfig) => ({
        value: api.modelId,
        label: api.name,
      }));
    }
    // 如果没有已配置的，回退到预设列表
    return videoApis.map((api: VideoApiConfig) => ({
      value: api.modelId,
      label: api.name,
    }));
  }, [videoApis]);

  return (
    <div
      ref={rootRef}
      className={`group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150 ${
        selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'
      }`}
      style={{
        width: `${resolvedWidth}px`,
        height: `${resolvedHeight}px`,
      }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Video className="h-4 w-4" />}
        titleText={displayName}
        editable
        onTitleChange={(title) => updateNodeData(id, { displayName: title })}
      />

      {/* 所有视频节点统一使用单个输入Handle */}
      {/* 首尾帧模式需要2个输入Handle（首帧35%，尾帧65%），单图使用单个Handle */}
      {isVideoFrame ? (
        <>
          <Handle type="target" id="target-first" position={Position.Left} className="!h-2 !w-2 !border-surface-dark !bg-accent" style={{ top: '35%' }} />
          <Handle type="target" id="target-last" position={Position.Left} className="!h-2 !w-2 !border-surface-dark !bg-accent" style={{ top: '65%' }} />
        </>
      ) : (
        <Handle type="target" id="target" position={Position.Left} className="!h-2 !w-2 !border-surface-dark !bg-accent" />
      )}

      <div className="flex h-full flex-col gap-2 overflow-y-auto">
        {/* Video Preview */}
        {data.videoUrl ? (
          <div className="relative h-32 w-full flex-shrink-0 overflow-hidden rounded-[var(--node-radius)] bg-bg-dark">
            <video
              src={data.videoUrl}
              controls
              className="h-full w-full object-contain"
              playsInline
            />
            <button
              className="absolute right-1 top-1 rounded bg-black/50 p-1 text-white hover:bg-black/70"
              onClick={handleRemoveVideo}
              title={t('common.delete')}
            >
              <X size={14} />
            </button>
          </div>
        ) : isGenerating ? (
          <div className="flex h-32 w-full flex-shrink-0 items-center justify-center rounded-[var(--node-radius)] bg-bg-dark">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="animate-spin" size={32} />
              <span className="text-sm text-muted-foreground">{t('node.videoGen.generating')}</span>
            </div>
          </div>
        ) : null}

        {/* Connected Reference Images */}
        {displayImages.length > 0 && (
          <div className="flex justify-center gap-2 overflow-x-auto py-1">
            {displayImages.map((imgUrl, idx) => (
              <div key={idx} className="relative flex flex-col items-center gap-1">
                <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg border border-border">
                  <img
                    src={imgUrl}
                    alt={`图${idx + 1}`}
                    className="h-full w-full object-cover"
                  />
                </div>
                <span className="text-center text-xs text-text-muted dark:text-white/60">
                  {isVideoFrame ? (idx === 0 ? '首帧' : '尾帧') : `图${idx + 1}`}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Prompt Input */}
        <div className="relative min-h-0 flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-2">
          <div className="relative h-full min-h-0">
            <div
              ref={promptHighlightRef}
              aria-hidden="true"
              className="ui-scrollbar absolute inset-0 overflow-y-auto overflow-x-hidden text-sm leading-6 text-text-dark pointer-events-none"
              style={{ scrollbarGutter: 'stable' }}
            >
              <div className="min-h-full whitespace-pre-wrap break-words px-1 py-0.5">
                {renderPromptWithHighlights(
                  promptDraft,
                  displayImages.length,
                  displayImages
                )}
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
              className="ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none overflow-y-auto overflow-x-hidden border-none bg-transparent px-1 py-0.5 text-sm leading-6 text-transparent caret-text-dark outline-none placeholder:text-text-muted/80 focus:border-transparent whitespace-pre-wrap break-words"
              style={{ scrollbarGutter: 'stable' }}
            />
            {/* Polish Button */}
            <button
              className="absolute bottom-2 right-2 z-20 rounded p-1 text-muted-foreground hover:bg-accent/20 hover:text-accent disabled:opacity-50"
              onClick={(e) => {
                e.stopPropagation();
                void handlePolish();
              }}
              disabled={isPolishing}
              title={t('node.imageEdit.polishPrompt')}
            >
              {isPolishing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
            </button>
          </div>

          {showImagePicker && incomingImageItems.length > 0 && (
            <div
              className="nowheel absolute z-30 w-[120px] overflow-hidden rounded-xl border border-[rgba(255,255,255,0.16)] bg-surface-dark shadow-xl"
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
                    className={`flex w-full items-center gap-2 border border-transparent bg-bg-dark/70 px-2 py-2 text-left text-sm text-text-dark transition-colors hover:border-[rgba(255,255,255,0.18)] ${pickerActiveIndex === index
                        ? 'border-[rgba(255,255,255,0.24)] bg-bg-dark'
                        : ''
                      }`}
                  >
                    <img
                      src={item.displayUrl}
                      alt={item.label}
                      className="h-8 w-8 rounded object-cover"
                      draggable={false}
                    />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {referenceHover && typeof document !== 'undefined' && createPortal(
            <div
              className="pointer-events-none fixed z-[9999] overflow-hidden rounded-lg border border-[rgba(255,255,255,0.16)] bg-surface-dark shadow-xl"
              style={{
                left: Math.max(10, referenceHover.anchorRect.left + referenceHover.anchorRect.width / 2 - 75),
                top: referenceHover.anchorRect.bottom + 10,
                width: 150,
                height: 150,
              }}
            >
              <img
                src={referenceHover.imageUrl}
                alt={`图${referenceHover.index}`}
                className="h-full w-full object-contain"
                draggable={false}
              />
            </div>,
            document.body
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <select
              className={`${NODE_CONTROL_CHIP_CLASS} bg-bg-dark border-border text-text dark:bg-black/30 dark:border-white/20 dark:text-white`}
              value={data.model}
              onChange={handleModelChange}
            >
              <option value="">{t('modelParams.model')}</option>
              {videoModelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <select
              className={`${NODE_CONTROL_CHIP_CLASS} bg-bg-dark border-border text-text dark:bg-black/30 dark:border-white/20 dark:text-white`}
              value={data.resolution}
              onChange={handleResolutionChange}
            >
              {RESOLUTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <select
              className={`${NODE_CONTROL_CHIP_CLASS} bg-bg-dark border-border text-text dark:bg-black/30 dark:border-white/20 dark:text-white`}
              value={data.duration}
              onChange={(e) => handleDurationChange(parseInt(e.target.value, 10))}
            >
              {DURATION_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}s
                </option>
              ))}
            </select>
          </div>

          {/* 视频元信息：镜头、景别、角度、速度 - 可折叠选项 */}
          <div className="rounded border border-border-dark bg-surface-dark/50 dark:border-white/10">
            <button
              type="button"
              className="flex w-full items-center justify-between px-2 py-1.5 text-xs text-text-muted dark:text-white/50"
              onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
            >
              <span>{t('node.videoGen.advancedOptions') || '视频参数预设'}</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvancedOptions ? 'rotate-180' : ''}`} />
            </button>
            {showAdvancedOptions && (
              <div className="flex flex-wrap gap-3 border-t border-border-dark px-2 py-2 dark:border-white/10">
                {/* 镜头类型 */}
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-xs text-text-muted dark:text-white/50 mr-1">镜头:</span>
                  {SHOT_TYPE_OPTIONS.filter(o => o.value).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        const newValue = data.shotType === opt.value ? '' : opt.value;
                        updateNodeData(id, { shotType: newValue });
                        if (newValue) {
                          appendMetadataToPrompt(newValue);
                        }
                      }}
                      className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                        data.shotType === opt.value
                          ? 'bg-accent text-white border-accent'
                          : 'bg-bg-dark text-text border-border-dark dark:bg-black/30 dark:border-white/20 dark:text-white hover:border-accent'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* 景别 */}
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-xs text-text-muted dark:text-white/50 mr-1">景别:</span>
                  {SHOT_SIZE_OPTIONS.filter(o => o.value).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        const newValue = data.shotSize === opt.value ? '' : opt.value;
                        updateNodeData(id, { shotSize: newValue });
                        if (newValue) {
                          appendMetadataToPrompt(newValue);
                        }
                      }}
                      className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                        data.shotSize === opt.value
                          ? 'bg-accent text-white border-accent'
                          : 'bg-bg-dark text-text border-border-dark dark:bg-black/30 dark:border-white/20 dark:text-white hover:border-accent'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* 角度 */}
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-xs text-text-muted dark:text-white/50 mr-1">角度:</span>
                  {ANGLE_OPTIONS.filter(o => o.value).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        const newValue = data.angle === opt.value ? '' : opt.value;
                        updateNodeData(id, { angle: newValue });
                        if (newValue) {
                          appendMetadataToPrompt(newValue);
                        }
                      }}
                      className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                        data.angle === opt.value
                          ? 'bg-accent text-white border-accent'
                          : 'bg-bg-dark text-text border-border-dark dark:bg-black/30 dark:border-white/20 dark:text-white hover:border-accent'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* 运镜速度 */}
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-xs text-text-muted dark:text-white/50 mr-1">速度:</span>
                  {CAMERA_SPEED_OPTIONS.filter(o => o.value).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        const newValue = data.cameraSpeed === opt.value ? '' : opt.value;
                        updateNodeData(id, { cameraSpeed: newValue });
                        if (newValue) {
                          appendMetadataToPrompt(newValue);
                        }
                      }}
                      className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                        data.cameraSpeed === opt.value
                          ? 'bg-accent text-white border-accent'
                          : 'bg-bg-dark text-text border-border-dark dark:bg-black/30 dark:border-white/20 dark:text-white hover:border-accent'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {/* hasAudio - 支持 SD 2.0, SD 1.5 pro */}
            <label className={`${NODE_CONTROL_PARAMS_CHIP_CLASS} text-text dark:text-white/80 ${!modelCapabilities.supportsGenerateAudio ? 'opacity-50' : ''}`}>
              <input
                type="checkbox"
                checked={data.hasAudio ?? true}
                onChange={handleHasAudioChange}
                disabled={!modelCapabilities.supportsGenerateAudio}
                title={!modelCapabilities.supportsGenerateAudio ? '当前模型不支持此功能' : ''}
              />
              <span>{t('node.videoGen.hasAudio')}</span>
            </label>
            {/* camerafixed - SD 1.5 pro 和早期模型支持，SD 2.0 暂不支持 */}
            <label className={`${NODE_CONTROL_PARAMS_CHIP_CLASS} text-text dark:text-white/80 ${modelCapabilities.isSD2 ? 'opacity-50' : ''}`}>
              <input
                type="checkbox"
                checked={data.camerafixed ?? false}
                onChange={handleCameraFixedChange}
                disabled={modelCapabilities.isSD2}
                title={modelCapabilities.isSD2 ? 'SD 2.0 暂不支持固定镜头' : ''}
              />
              <span>{t('node.videoGen.camerafixed')}</span>
            </label>
            <label className={`${NODE_CONTROL_PARAMS_CHIP_CLASS} text-text dark:text-white/80`}>
              <input
                type="checkbox"
                checked={data.watermark ?? false}
                onChange={handleWatermarkChange}
              />
              <span>{t('node.videoGen.watermark')}</span>
            </label>
            {/* draft - 仅 SD 1.5 pro 支持 */}
            {modelCapabilities.supportsDraft && (
              <label className={`${NODE_CONTROL_PARAMS_CHIP_CLASS} text-text dark:text-white/80`}>
                <input
                  type="checkbox"
                  checked={data.draft ?? false}
                  onChange={(e) => updateNodeData(id, { draft: e.target.checked })}
                />
                <span>样片模式</span>
              </label>
            )}
            {/* 联网搜索 - 仅 SD 2.0 支持 */}
            {modelCapabilities.supportsWebSearch && (
              <label className={`${NODE_CONTROL_PARAMS_CHIP_CLASS} text-text dark:text-white/80`}>
                <input
                  type="checkbox"
                  checked={data.enableWebSearch ?? false}
                  onChange={(e) => updateNodeData(id, { enableWebSearch: e.target.checked })}
                />
                <span>联网搜索</span>
              </label>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted dark:text-white/50">{t('node.videoGen.seed')}:</span>
            <input
              type="number"
              className="w-24 rounded border border-border bg-bg-dark/50 px-2 py-1 text-xs text-text placeholder:text-text-muted/50 focus:border-accent focus:outline-none dark:bg-black/30 dark:border-white/20 dark:text-white dark:placeholder:text-white/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              value={data.seed ?? ''}
              onChange={handleSeedChange}
              placeholder="Auto"
            />
          </div>

          {error && (
            <div className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {error}
            </div>
          )}

          <UiButton
            className={NODE_CONTROL_PRIMARY_BUTTON_CLASS}
            onClick={handleGenerate}
            disabled={isGenerating || isGenerationDisabled}
            title={generationDisabledReason}
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('ai.generating')}
              </>
            ) : (
              <>
                <Video className="h-4 w-4" />
                {t('canvas.generate')}
              </>
            )}
          </UiButton>
        </div>
      </div>

      <Handle type="source" id="source" position={Position.Right} className="!h-2 !w-2 !border-surface-dark !bg-accent" />

      <NodeResizeHandle
        minWidth={VIDEO_GEN_NODE_MIN_WIDTH}
        minHeight={VIDEO_GEN_NODE_MIN_HEIGHT}
        maxWidth={VIDEO_GEN_NODE_MAX_WIDTH}
        maxHeight={VIDEO_GEN_NODE_MAX_HEIGHT}
      />
    </div>
  );
});

VideoGenNode.displayName = 'VideoGenNode';
