import {
  AUTO_REQUEST_ASPECT_RATIO,
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  type ImageSize,
  type CanvasNodeData,
  type CanvasNodeType,
  type ExportImageNodeData,
  type ExportVideoNodeData,
  type GroupNodeData,
  type ImageEditNodeData,
  type AudioUploadRefNodeData,
  type VideoUploadRefNodeData,
  type SD2VideoGenNodeData,
  type StoryboardSplitNodeData,
  type StoryboardGenNodeData,
  type TextAnnotationNodeData,
  type UploadImageNodeData,
  type VideoGenNodeData,
} from './canvasNodes';
import { DEFAULT_NODE_DISPLAY_NAME } from './nodeDisplay';
import { DEFAULT_IMAGE_MODEL_ID } from '../models';

export type MenuIconKey = 'upload' | 'sparkles' | 'layout' | 'text' | 'video';

export interface CanvasNodeCapabilities {
  toolbar: boolean;
  promptInput: boolean;
}

export interface CanvasNodeConnectivity {
  sourceHandle: boolean;
  targetHandle: boolean;
  connectMenu: {
    fromSource: boolean;
    fromTarget: boolean;
  };
}

export interface CanvasNodeDefinition<TData extends CanvasNodeData = CanvasNodeData> {
  type: CanvasNodeType;
  menuLabelKey: string;
  menuIcon: MenuIconKey;
  visibleInMenu: boolean;
  capabilities: CanvasNodeCapabilities;
  connectivity: CanvasNodeConnectivity;
  createDefaultData: () => TData;
}

const uploadNodeDefinition: CanvasNodeDefinition<UploadImageNodeData> = {
  type: CANVAS_NODE_TYPES.upload,
  menuLabelKey: 'node.menu.uploadImage',
  menuIcon: 'upload',
  visibleInMenu: true,
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: true,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.upload],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: '1:1',
    isSizeManuallyAdjusted: false,
    sourceFileName: null,
  }),
};

const imageEditNodeDefinition: CanvasNodeDefinition<ImageEditNodeData> = {
  type: CANVAS_NODE_TYPES.imageEdit,
  menuLabelKey: 'node.menu.aiImageGeneration',
  menuIcon: 'sparkles',
  visibleInMenu: true,
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.imageEdit],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    requestAspectRatio: AUTO_REQUEST_ASPECT_RATIO,
    prompt: '',
    model: DEFAULT_IMAGE_MODEL_ID,
    size: '2K' as ImageSize,
    extraParams: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 60000,
  }),
};

const exportImageNodeDefinition: CanvasNodeDefinition<ExportImageNodeData> = {
  type: CANVAS_NODE_TYPES.exportImage,
  menuLabelKey: 'node.menu.uploadImage',
  menuIcon: 'upload',
  visibleInMenu: false,
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.exportImage],
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isSizeManuallyAdjusted: false,
    resultKind: 'generic',
  }),
};

const groupNodeDefinition: CanvasNodeDefinition<GroupNodeData> = {
  type: CANVAS_NODE_TYPES.group,
  menuLabelKey: 'node.menu.storyboard',
  menuIcon: 'layout',
  visibleInMenu: false,
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.group],
    label: '组',
  }),
};

const textAnnotationNodeDefinition: CanvasNodeDefinition<TextAnnotationNodeData> = {
  type: CANVAS_NODE_TYPES.textAnnotation,
  menuLabelKey: 'node.menu.textAnnotation',
  menuIcon: 'text',
  visibleInMenu: true,
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: false,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.textAnnotation],
    content: '',
  }),
};

const storyboardSplitDefinition: CanvasNodeDefinition<StoryboardSplitNodeData> = {
  type: CANVAS_NODE_TYPES.storyboardSplit,
  menuLabelKey: 'node.menu.storyboard',
  menuIcon: 'layout',
  visibleInMenu: false,
  capabilities: {
    toolbar: false,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.storyboardSplit],
    aspectRatio: DEFAULT_ASPECT_RATIO,
    frameAspectRatio: DEFAULT_ASPECT_RATIO,
    gridRows: 2,
    gridCols: 2,
    frames: [],
    exportOptions: {
      showFrameIndex: false,
      showFrameNote: false,
      notePlacement: 'overlay',
      imageFit: 'cover',
      frameIndexPrefix: 'S',
      cellGap: 8,
      outerPadding: 0,
      fontSize: 4,
      backgroundColor: '#0f1115',
      textColor: '#f8fafc',
    },
  }),
};

const storyboardGenNodeDefinition: CanvasNodeDefinition<StoryboardGenNodeData> = {
  type: CANVAS_NODE_TYPES.storyboardGen,
  menuLabelKey: 'node.menu.storyboardGen',
  menuIcon: 'sparkles',
  visibleInMenu: true,
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.storyboardGen],
    gridRows: 2,
    gridCols: 2,
    frames: [],
    ratioControlMode: 'cell',
    model: DEFAULT_IMAGE_MODEL_ID,
    size: '2K' as ImageSize,
    requestAspectRatio: AUTO_REQUEST_ASPECT_RATIO,
    globalPrompt: '',
    extraParams: {},
    imageUrl: null,
    previewImageUrl: null,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 60000,
  }),
};

const videoFrameNodeDefinition: CanvasNodeDefinition<VideoGenNodeData> = {
  type: CANVAS_NODE_TYPES.videoFrame,
  menuLabelKey: 'node.menu.videoFrame',
  menuIcon: 'video',
  visibleInMenu: true,
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: true,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.videoFrame],
    videoUrl: null,
    previewImageUrl: null,
    aspectRatio: '16:9',
    prompt: '',
    model: '',
    resolution: '720p',
    duration: 5,
    referenceImagePrompt: false,
    referenceImages: [],
    hasAudio: false,
    returnLastFrame: false,
    seed: undefined,
    extraParams: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 120000,
  }),
};

const videoSingleNodeDefinition: CanvasNodeDefinition<VideoGenNodeData> = {
  type: CANVAS_NODE_TYPES.videoSingle,
  menuLabelKey: 'node.menu.videoSingle',
  menuIcon: 'video',
  visibleInMenu: true,
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: true,
      fromTarget: true,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.videoSingle],
    videoUrl: null,
    previewImageUrl: null,
    aspectRatio: '16:9',
    prompt: '',
    model: '',
    resolution: '720p',
    duration: 5,
    referenceImagePrompt: false,
    referenceImages: [],
    hasAudio: false,
    returnLastFrame: false,
    seed: undefined,
    extraParams: {},
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 120000,
  }),
};

const audioUploadNodeDefinition: CanvasNodeDefinition<AudioUploadRefNodeData> = {
  type: CANVAS_NODE_TYPES.audioUpload,
  menuLabelKey: 'node.menu.audioUploadRef',
  menuIcon: 'upload',
  visibleInMenu: true,
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.audioUpload],
    audioUrl: null,
    sourceFileName: '',
  }),
};

const videoUploadNodeDefinition: CanvasNodeDefinition<VideoUploadRefNodeData> = {
  type: CANVAS_NODE_TYPES.videoUpload,
  menuLabelKey: 'node.menu.videoUploadRef',
  menuIcon: 'upload',
  visibleInMenu: true,
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: false,
    connectMenu: {
      fromSource: true,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.videoUpload],
    videoUrl: null,
    previewVideoUrl: null,
    sourceFileName: '',
  }),
};

const audioUploadRefNodeDefinition: CanvasNodeDefinition<AudioUploadRefNodeData> = {
  ...audioUploadNodeDefinition,
  type: CANVAS_NODE_TYPES.audioUploadRef,
  visibleInMenu: false,
};

const videoUploadRefNodeDefinition: CanvasNodeDefinition<VideoUploadRefNodeData> = {
  ...videoUploadNodeDefinition,
  type: CANVAS_NODE_TYPES.videoUploadRef,
  visibleInMenu: false,
};

const exportVideoNodeDefinition: CanvasNodeDefinition<ExportVideoNodeData> = {
  type: CANVAS_NODE_TYPES.exportVideo,
  menuLabelKey: 'node.menu.videoFrame',
  menuIcon: 'video',
  visibleInMenu: false,
  capabilities: {
    toolbar: true,
    promptInput: false,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
  createDefaultData: () => ({
    displayName: '视频结果',
    videoUrl: null,
    previewImageUrl: null,
    aspectRatio: '16:9',
    model: '',
    resolution: '720p',
    duration: 5,
    hasAudio: false,
    returnLastFrame: false,
    seed: undefined,
    isGenerating: false,
    generationStartedAt: null,
    generationDurationMs: 120000,
    resultKind: 'videoGen',
  }),
};

// SD 2.0 视频生成节点 - 占位符，后续实现
const sd2VideoGenNodeDefinition: CanvasNodeDefinition<SD2VideoGenNodeData> = {
  type: CANVAS_NODE_TYPES.sd2VideoGen,
  menuLabelKey: 'node.menu.sd2VideoGen',
  menuIcon: 'video',
  visibleInMenu: true,
  capabilities: {
    toolbar: true,
    promptInput: true,
  },
  connectivity: {
    sourceHandle: true,
    targetHandle: true,
    connectMenu: {
      fromSource: false,
      fromTarget: true,
    },
  },
  createDefaultData: () => ({
    displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.sd2VideoGen],
    prompt: '',
    model: 'doubao-seedance-2-0-260128',
    aspectRatio: '16:9',
    resolution: '1080p',
    duration: 5,
    hasAudio: true,
    returnLastFrame: false,
    watermark: false,
    generationMode: 'multimodal',
    referenceImageIds: [],
    referenceAudioIds: [],
    referenceVideoIds: [],
    isGenerating: false,
    generationJobId: null,
    generationError: null,
  }),
};

export const canvasNodeDefinitions: Record<CanvasNodeType, CanvasNodeDefinition> = {
  [CANVAS_NODE_TYPES.upload]: uploadNodeDefinition,
  [CANVAS_NODE_TYPES.imageEdit]: imageEditNodeDefinition,
  [CANVAS_NODE_TYPES.exportImage]: exportImageNodeDefinition,
  [CANVAS_NODE_TYPES.textAnnotation]: textAnnotationNodeDefinition,
  [CANVAS_NODE_TYPES.group]: groupNodeDefinition,
  [CANVAS_NODE_TYPES.storyboardSplit]: storyboardSplitDefinition,
  [CANVAS_NODE_TYPES.storyboardGen]: storyboardGenNodeDefinition,
  [CANVAS_NODE_TYPES.videoFrame]: videoFrameNodeDefinition,
  [CANVAS_NODE_TYPES.videoSingle]: videoSingleNodeDefinition,
  [CANVAS_NODE_TYPES.exportVideo]: exportVideoNodeDefinition,
  [CANVAS_NODE_TYPES.audioUpload]: audioUploadNodeDefinition,
  [CANVAS_NODE_TYPES.videoUpload]: videoUploadNodeDefinition,
  [CANVAS_NODE_TYPES.audioUploadRef]: audioUploadRefNodeDefinition,
  [CANVAS_NODE_TYPES.videoUploadRef]: videoUploadRefNodeDefinition,
  [CANVAS_NODE_TYPES.sd2VideoGen]: sd2VideoGenNodeDefinition,
};

export function getNodeDefinition(type: CanvasNodeType): CanvasNodeDefinition {
  return canvasNodeDefinitions[type];
}

export function getMenuNodeDefinitions(): CanvasNodeDefinition[] {
  return Object.values(canvasNodeDefinitions).filter((definition) => definition.visibleInMenu);
}

export function nodeHasSourceHandle(type: CanvasNodeType): boolean {
  return canvasNodeDefinitions[type].connectivity.sourceHandle;
}

export function nodeHasTargetHandle(type: CanvasNodeType): boolean {
  return canvasNodeDefinitions[type].connectivity.targetHandle;
}

export function getConnectMenuNodeTypes(handleType: 'source' | 'target'): CanvasNodeType[] {
  const fromSource = handleType === 'source';
  return Object.values(canvasNodeDefinitions)
    .filter((definition) => (fromSource
      ? definition.connectivity.connectMenu.fromSource
      : definition.connectivity.connectMenu.fromTarget))
    .filter((definition) => (fromSource
      ? definition.connectivity.targetHandle
      : definition.connectivity.sourceHandle))
    .map((definition) => definition.type);
}
