import type { Edge, Node, XYPosition } from '@xyflow/react';

export const CANVAS_NODE_TYPES = {
  upload: 'uploadNode',
  imageEdit: 'imageNode',
  exportImage: 'exportImageNode',
  textAnnotation: 'textAnnotationNode',
  group: 'groupNode',
  storyboardSplit: 'storyboardNode',
  storyboardGen: 'storyboardGenNode',
  videoFrame: 'videoFrameNode',
  videoSingle: 'videoSingleNode',
  exportVideo: 'exportVideoNode',
  // SD 2.0 参考节点
  audioUpload: 'audioUploadNode',
  videoUpload: 'videoUploadNode',
  audioUploadRef: 'audioUploadRefNode',
  videoUploadRef: 'videoUploadRefNode',
  sd2VideoGen: 'sd2VideoGenNode',
} as const;

export type CanvasNodeType = (typeof CANVAS_NODE_TYPES)[keyof typeof CANVAS_NODE_TYPES];

export const DEFAULT_ASPECT_RATIO = '1:1';
export const AUTO_REQUEST_ASPECT_RATIO = 'auto';
export const DEFAULT_NODE_WIDTH = 220;
export const EXPORT_RESULT_NODE_DEFAULT_WIDTH = 384;
export const EXPORT_RESULT_NODE_LAYOUT_HEIGHT = 288;
export const EXPORT_RESULT_NODE_MIN_WIDTH = 168;
export const EXPORT_RESULT_NODE_MIN_HEIGHT = 168;

export const IMAGE_SIZES = ['0.5K', '1K', '2K', '4K'] as const;
export const IMAGE_OUTPUT_COUNTS = [1, 2, 4] as const;
export type ImageOutputCount = (typeof IMAGE_OUTPUT_COUNTS)[number];
export const DEFAULT_IMAGE_OUTPUT_COUNT: ImageOutputCount = 1;
export const IMAGE_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '21:9',
] as const;

export type ImageSize = (typeof IMAGE_SIZES)[number];

export interface NodeDisplayData {
  displayName?: string;
  [key: string]: unknown;
}

export interface NodeImageData extends NodeDisplayData {
  imageUrl: string | null;
  previewImageUrl?: string | null;
  aspectRatio: string;
  isSizeManuallyAdjusted?: boolean;
  [key: string]: unknown;
}

export interface UploadImageNodeData extends NodeImageData {
  sourceFileName?: string | null;
}

export type ExportImageNodeResultKind =
  | 'generic'
  | 'storyboardGenOutput'
  | 'storyboardSplitExport'
  | 'storyboardFrameEdit';

export interface ExportImageNodeData extends NodeImageData {
  resultKind?: ExportImageNodeResultKind;
}

export interface GroupNodeData extends NodeDisplayData {
  label: string;
  [key: string]: unknown;
}

export interface TextAnnotationNodeData extends NodeDisplayData {
  content: string;
  [key: string]: unknown;
}

export interface ImageEditNodeData extends NodeImageData {
  prompt: string;
  model: string;
  size: ImageSize;
  outputCount?: ImageOutputCount;
  requestAspectRatio?: string;
  extraParams?: Record<string, unknown>;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
}

export interface StoryboardFrameItem {
  id: string;
  imageUrl: string | null;
  previewImageUrl?: string | null;
  aspectRatio?: string;
  note: string;
  order: number;
}

export interface StoryboardExportOptions {
  showFrameIndex: boolean;
  showFrameNote: boolean;
  notePlacement: 'overlay' | 'bottom';
  imageFit: 'cover' | 'contain';
  frameIndexPrefix: string;
  cellGap: number;
  outerPadding: number;
  fontSize: number;
  backgroundColor: string;
  textColor: string;
}

export interface StoryboardSplitNodeData {
  displayName?: string;
  aspectRatio: string;
  frameAspectRatio?: string;
  gridRows: number;
  gridCols: number;
  frames: StoryboardFrameItem[];
  exportOptions?: StoryboardExportOptions;
  [key: string]: unknown;
}

export interface StoryboardGenFrameItem {
  id: string;
  description: string;
  referenceIndex: number | null;
}

export type StoryboardRatioControlMode = 'overall' | 'cell';

export interface StoryboardGenNodeData {
  displayName?: string;
  gridRows: number;
  gridCols: number;
  frames: StoryboardGenFrameItem[];
  ratioControlMode?: StoryboardRatioControlMode;
  model: string;
  size: ImageSize;
  requestAspectRatio: string;
  /** 全局提示词：分镜描述的整体控制（如画风、情节等） */
  globalPrompt?: string;
  extraParams?: Record<string, unknown>;
  imageUrl: string | null;
  previewImageUrl?: string | null;
  aspectRatio: string;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  [key: string]: unknown;
}

export type VideoResolution = '480p' | '720p' | '1080p';

export interface VideoGenNodeData extends NodeDisplayData {
  videoUrl: string | null;
  previewImageUrl?: string | null;
  aspectRatio: string;
  prompt: string;
  model: string;
  resolution?: VideoResolution;
  duration?: number;
  referenceImagePrompt?: boolean;
  referenceImages?: string[];
  hasAudio?: boolean;
  returnLastFrame?: boolean;
  seed?: number;
  camerafixed?: boolean;  // 相机固定
  watermark?: boolean;    // 水印
  // 视频元信息（用于润色提示词）
  shotType?: string;       // 镜头类型
  shotSize?: string;       // 景别
  angle?: string;         // 角度
  cameraMovement?: string; // 运镜
  cameraSpeed?: string;   // 运镜速度
  // SD 2.0 新参数
  generateAudio?: boolean; // 是否生成音频 (SD 2.0 & 1.5 pro)
  draft?: boolean;         // 样片模式 (SD 1.5 pro only)
  enableWebSearch?: boolean; // 联网搜索 (SD 2.0 only)
  extraParams?: Record<string, unknown>;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  generationJobId?: string | null;
  generationProviderId?: string | null;
  generationError?: string | null;
  /** Draft task ID - when set, generates final video from this draft */
  draftTaskId?: string;
  [key: string]: unknown;
}

export interface ExportVideoNodeData extends NodeDisplayData {
  videoUrl: string | null;
  previewImageUrl?: string | null;
  aspectRatio: string;
  model: string;
  resolution?: VideoResolution;
  duration?: number;
  hasAudio?: boolean;
  returnLastFrame?: boolean;
  seed?: number;
  prompt?: string;
  resultKind?: 'videoGen';
  // SD 2.0 新参数
  generateAudio?: boolean;
  draft?: boolean;
  /** Draft task ID - stored when this node contains a draft video, used to generate final video */
  draftTaskId?: string;
  enableWebSearch?: boolean;
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  generationJobId?: string | null;
  generationProviderId?: string | null;
  generationError?: string | null;
  [key: string]: unknown;
}

// SD 2.0 参考上传节点数据类型

export interface AudioUploadRefNodeData extends NodeDisplayData {
  audioUrl: string | null;
  sourceFileName: string;
}

export interface VideoUploadRefNodeData extends NodeDisplayData {
  videoUrl: string | null;
  sourceFileName: string;
  previewVideoUrl?: string | null;
}

// SD 2.0 视频生成节点模式
export type SD2GenerationMode = 'multimodal' | 'edit' | 'extend';

export interface SD2VideoGenNodeData extends NodeDisplayData {
  prompt: string;
  model: string;
  aspectRatio: string;
  resolution?: VideoResolution;
  duration?: number;
  hasAudio?: boolean;
  watermark?: boolean;
  returnLastFrame?: boolean;
  generationMode?: SD2GenerationMode;
  // 输入引用（存储连接的节点 ID 列表）
  referenceImageIds?: string[];
  referenceAudioIds?: string[];
  referenceVideoIds?: string[];
  isGenerating?: boolean;
  generationJobId?: string | null;
  generationError?: string | null;
}

export type CanvasNodeData =
  | UploadImageNodeData
  | ExportImageNodeData
  | TextAnnotationNodeData
  | GroupNodeData
  | ImageEditNodeData
  | StoryboardSplitNodeData
  | StoryboardGenNodeData
  | VideoGenNodeData
  | ExportVideoNodeData
  | AudioUploadRefNodeData
  | VideoUploadRefNodeData
  | SD2VideoGenNodeData;

export type CanvasNode = Node<CanvasNodeData, CanvasNodeType>;
export type CanvasEdge = Edge;

export interface NodeCreationDto {
  type: CanvasNodeType;
  position: XYPosition;
  data?: Partial<CanvasNodeData>;
}

export interface StoryboardNodeCreationDto {
  position: XYPosition;
  rows: number;
  cols: number;
  frames: StoryboardFrameItem[];
}

export const NODE_TOOL_TYPES = {
  crop: 'crop',
  annotate: 'annotate',
  splitStoryboard: 'split-storyboard',
} as const;

export type NodeToolType = (typeof NODE_TOOL_TYPES)[keyof typeof NODE_TOOL_TYPES];

export interface ActiveToolDialog {
  nodeId: string;
  toolType: NodeToolType;
}

export function isUploadNode(
  node: CanvasNode | null | undefined
): node is Node<UploadImageNodeData, typeof CANVAS_NODE_TYPES.upload> {
  return node?.type === CANVAS_NODE_TYPES.upload;
}

export function isImageEditNode(
  node: CanvasNode | null | undefined
): node is Node<ImageEditNodeData, typeof CANVAS_NODE_TYPES.imageEdit> {
  return node?.type === CANVAS_NODE_TYPES.imageEdit;
}

export function isExportImageNode(
  node: CanvasNode | null | undefined
): node is Node<ExportImageNodeData, typeof CANVAS_NODE_TYPES.exportImage> {
  return node?.type === CANVAS_NODE_TYPES.exportImage;
}

export function isGroupNode(
  node: CanvasNode | null | undefined
): node is Node<GroupNodeData, typeof CANVAS_NODE_TYPES.group> {
  return node?.type === CANVAS_NODE_TYPES.group;
}

export function isTextAnnotationNode(
  node: CanvasNode | null | undefined
): node is Node<TextAnnotationNodeData, typeof CANVAS_NODE_TYPES.textAnnotation> {
  return node?.type === CANVAS_NODE_TYPES.textAnnotation;
}

export function isStoryboardSplitNode(
  node: CanvasNode | null | undefined
): node is Node<StoryboardSplitNodeData, typeof CANVAS_NODE_TYPES.storyboardSplit> {
  return node?.type === CANVAS_NODE_TYPES.storyboardSplit;
}

export function isStoryboardGenNode(
  node: CanvasNode | null | undefined
): node is Node<StoryboardGenNodeData, typeof CANVAS_NODE_TYPES.storyboardGen> {
  return node?.type === CANVAS_NODE_TYPES.storyboardGen;
}

export function isVideoGenNode(
  node: CanvasNode | null | undefined
): node is Node<VideoGenNodeData, typeof CANVAS_NODE_TYPES.videoFrame | typeof CANVAS_NODE_TYPES.videoSingle> {
  return node?.type === CANVAS_NODE_TYPES.videoFrame || node?.type === CANVAS_NODE_TYPES.videoSingle;
}

export function isExportVideoNode(
  node: CanvasNode | null | undefined
): node is Node<ExportVideoNodeData, typeof CANVAS_NODE_TYPES.exportVideo> {
  return node?.type === CANVAS_NODE_TYPES.exportVideo;
}

export function nodeHasImage(node: CanvasNode | null | undefined): boolean {
  if (!node) {
    return false;
  }

  if (isUploadNode(node) || isImageEditNode(node) || isExportImageNode(node)) {
    return Boolean(node.data.imageUrl);
  }

  if (isStoryboardSplitNode(node)) {
    return node.data.frames.some((frame) => Boolean(frame.imageUrl));
  }

  if (isStoryboardGenNode(node)) {
    return Boolean(node.data.imageUrl);
  }

  if (isVideoGenNode(node) || isExportVideoNode(node)) {
    return Boolean(node.data.videoUrl);
  }

  return false;
}
