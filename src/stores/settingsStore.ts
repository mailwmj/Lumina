import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { writeDebugLog } from '@/commands/system';
import {
  DEFAULT_GRSAI_CREDIT_TIER_ID,
  PRICE_DISPLAY_CURRENCY_MODES,
  type GrsaiCreditTierId,
  type PriceDisplayCurrencyMode,
} from '@/features/canvas/pricing/types';

export type UiRadiusPreset = 'compact' | 'default' | 'large';
export type ThemeTonePreset = 'neutral' | 'warm' | 'cool';
export type CanvasEdgeRoutingMode = 'spline' | 'orthogonal' | 'smartOrthogonal';
export type ProviderApiKeys = Record<string, string>;
export const DEFAULT_GRSAI_NANO_BANANA_PRO_MODEL = 'nano-banana-pro';

export interface TextApiConfig {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  modelId: string;
  enabled: boolean;
}

export interface VideoApiConfig {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  modelId: string;
  enabled: boolean;
  polishPrompt?: string;
  defaultPolishPrompt?: string;
}

export const PRESET_TEXT_APIS: TextApiConfig[] = [
  {
    id: 'volc-coding-plan',
    name: '火山引擎 Coding Plan (Chat)',
    apiKey: '',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    modelId: 'doubao-seed-2.0-pro',
    enabled: false,
  },
  {
    id: 'volc-responses-api',
    name: '火山引擎 Responses API',
    apiKey: '',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelId: 'doubao-seed-2-0-pro-260215',
    enabled: false,
  },
];

export const DEFAULT_TEXT_API_PROMPT = `你是专业的AI绘画提示词润色专家。我将为你提供待优化的原始AI绘画提示词（可能包含参考图片的@引用标记），请按照以下要求进行深度优化：

1. 核心任务：深度理解原始提示词的核心语义和用户期望的视觉目标
2. 视觉增强：从画面构图、风格流派、色彩调性、光影效果、主体元素、质感表现、氛围情绪等维度进行专业增强
3. AI适配：结合AI绘画工具的生成逻辑进行优化补充
4. 输出要求：直接输出润色后的提示词，不需要任何解释或前缀说明

请直接输出优化后的提示词文本。`;

export const DEFAULT_VIDEO_API_PROMPT = `你是专业的 AI 视频生成提示词润色专家，具备丰富的镜头语言、视觉美学和 AI 生成适配经验。我将为你提供参考图片和待优化的原始 AI 视频提示词（可能为空），请严格遵循以下要求，完成深度优化，确保优化后的提示词精准适配 AI 视频生成工具，能直接生成符合预期的视觉效果：
核心前提：深度拆解原始提示词的核心语义、镜头逻辑、动态需求和视觉预期，不偏离用户核心诉求，不添加无关元素，同时弥补原始提示词的细节缺失。
优化核心维度（按需精准融入，不冗余，贴合 AI 生成特性）：
场景：明确环境、具体地点、背景细节（如天气、植被、建筑风格、空间层次），补充环境动态变化（如风吹，光影流动、烟雾飘动）；
时长：根据视频总时长，可拆分关键镜头时长分配；
景别：精准标注每段镜头景别（远景 / 全景 / 中景 / 近景 / 特写），明确景别切换逻辑，贴合内容节奏；
运镜：适配 AI 工具可实现的运镜方式（固定镜头、镜头推进、镜头拉远、镜头跟随、镜头环绕、镜头右摇、镜头左摇、镜头上摇、镜头下摇），标注运镜速度和幅度，避免复杂难实现的运镜；
角色 / 主体：详细描述外观细节、色彩、纹理、状态，明确表情、连贯动作及运动轨迹，突出主体辨识度；
情绪基调：精准定位整体情绪（紧张、压抑、温馨、科幻、惊悚等），并通过光影、色彩、动作强化情绪表达；
光影：明确光源类型（自然光 / 人工光 / 特殊光源）、光线方向、明暗对比，补充光影动态效果（如光斑移动、反光变化），增强画面层次感；
动作：细化主体及环境的连贯动作，标注动作速度、幅度，确保动态流畅自然，符合逻辑；
氛围：强化整体视觉氛围（写实、科幻、复古、梦幻、末日等），通过色彩、光影、环境细节统一氛围基调；
台词 / 旁白（按需）：简洁适配视频时长，贴合内容节奏，语言自然，符合整体情绪；
音效 / 配乐（按需）：明确背景音乐风格、环境音细节、特效音，贴合画面节奏和情绪，增强沉浸感。
AI 适配优化：结合主流 AI 视频生成工具的特性（时长限制、运镜兼容性、动态效果上限、细节渲染能力），优化提示词表述，避免模糊化描述，确保视频生成 AI 能精准解析，减少生成偏差；优先选择视频生成 AI 易实现的动态和光影效果，同时保留核心视觉诉求。
输出规范：仅输出润色后的完整视频提示词，无任何多余解释、前缀或后缀，语言简洁精准、逻辑清晰，镜头和动态描述连贯，可直接复制用于 AI 视频生成。`;

// Seedance-1.0-pro / pro-fast 提示词润色模板
export const DEFAULT_VIDEO_SD10_POLISH_PROMPT = `一、润色总规则
1. 按官方逻辑：主体 + 动作 + 镜头语言 + 景别视角 + 风格美感 + 多镜头（可选）+ 特效（可选）
2. 动作按时序清晰描述，多动作依次写明
3. 镜头使用官方标准运镜词，不自创术语
4. 多镜头用镜头切换连接，保持主体、风格、场景统一
5. 描述具体、细节充足、无模糊笼统表述

二、固定输出结构
【主体】
【动作】
【镜头语言】
【景别与视角】
【画面风格与美感】
【多镜头叙事（可选）】
【创意特效（可选）】

三、各模块润色标准
【主体】
• 明确人物 / 动物 / 事物
• 可描述外貌、衣着、体型、神态、特征
• 多人 / 多物分别说明，避免模糊指代
【动作】
• 基础动作：主体 + 动作
• 多动作：按发生顺序依次描述
• 单人物多动作、多人物多动作均按时序写清
【镜头语言】
• 支持运镜：推、拉、摇、移、环绕、跟随、升、降、变焦
• 复杂运镜：可组合多个动作，实现长镜头、一镜到底
【景别与视角】
• 景别：远景、全景、中景、近景、特写
• 视角：航拍、高机位俯拍、低机位仰拍、微距摄影、过肩镜头、水下镜头、以 xx 为前景的镜头
【画面风格与美感】
• 风格：2D、3D，体素、像素，毛毡、粘土、插画、黑白线稿
• 视频类型：喜庆土味短视频、欧洲文艺电影、复古香港电影、恐怖片，写实电影
• 氛围：油画感、复古氛围、温馨、治愈、紧张、悬疑、高级质感、柔和
• 画质：1080P 高清、磨皮、美颜滤镜、细节清晰、有质感
【多镜头叙事】
• 用镜头切换连接各镜头
• 切镜后保持主体、风格、场景统一
• 每个镜头写明景别、视角、动作、氛围
【创意特效】
• 描述发光、色彩变化、粒子、环境突变等效果
• 与动作、镜头、氛围匹配

四、禁止项
• 动作时序混乱
• 使用非官方镜头术语
• 多镜头不用 "镜头切换" 连接
• 风格前后不一致
• 描述模糊、笼统、缺失关键信息`;

// Seedance-1.5-pro 提示词润色模板
export const DEFAULT_VIDEO_SD15_PROMPT = `Seedance-1.5-pro 提示词润色规范（AI 专用）
润色总原则
按固定结构：主体 + 运动 + 环境 + 运镜 / 切镜 + 美学描述 + 声音
描述必要信息，描述清晰信息
提示词与画面、音频形成正确对应
用特征指定主体，指定方式全程一致
精准进行切镜描述
输出结构
【主体】【运动】【环境】【镜头 / 运镜 / 切镜】【美学风格】【声音】
各模块润色标准
主体
用特征指定主体，全程指定方式保持一致
多人场景按位置与顺序明确区分身份
不使用模糊表述
运动
动作幅度自然，节奏感强
精准捕捉动作细节
人物情绪与表情呈现细腻
环境
明确场景地点，光线、氛围与背景元素
与主体、动作、情绪保持统一
镜头 / 运镜 / 切镜
景别：远景、全景、中景、近景、特写、头像，胸像、半身像，全身像
运镜：推、拉、摇、移、跟、升、降、甩、环绕、旋转、变焦、希区柯克、子弹时间
视角：高机位、低机位、俯视、仰视、平视、正扣、正仰、过肩、正面、侧面、背面、鱼眼、望远镜
稳定度：固定、手持呼吸感、稳定无抖动
切镜：明确每个镜头，精准标注切镜时机，切镜之间有明确景别与内容区分
美学风格
全程使用单一主风格
可使用：写实、迪士尼、皮克斯、宫崎骏、小森林日剧、赛博朋克、暗黑奇幻等
保持画面质感与色调统一
声音
人声格式：性别 + 年龄区间 + 声音属性 + 语速 + 情绪基线 + 语言 / 方言 + 台词
支持语言：普通话、四川话、粤语、陕西话、台湾腔、英语、日语、韩语、西班牙语、印尼语及小语种
音效：环境音、动作音、合成音、乐器音，与画面同步触发
BGM：风格、情绪、节奏与画面运动匹配
禁止项
主体特征前后不一致
切镜无标注、逻辑混乱
音画不同步、口型不匹配
使用非规范镜头术语
描述模糊、笼统、冗余
多种风格混搭冲突`;

export const PRESET_VIDEO_APIS: VideoApiConfig[] = [
  {
    id: 'volc-seedance-2-0',
    name: 'Seedance 2.0',
    apiKey: '',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelId: 'doubao-seedance-2-0-260128',
    enabled: true,
    defaultPolishPrompt: DEFAULT_VIDEO_SD10_POLISH_PROMPT,
  },
  {
    id: 'volc-seedance-2-0-fast',
    name: 'Seedance 2.0 Fast',
    apiKey: '',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelId: 'doubao-seedance-2-0-fast-260128',
    enabled: false,
    defaultPolishPrompt: DEFAULT_VIDEO_SD10_POLISH_PROMPT,
  },
  {
    id: 'volc-seedance-1-5-pro',
    name: 'Seedance 1.5 Pro',
    apiKey: '',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelId: 'doubao-seedance-1-5-pro-251215',
    enabled: true,
    defaultPolishPrompt: DEFAULT_VIDEO_SD15_PROMPT,
  },
];

/**
 * 合并视频API配置，确保所有预设模型都存在
 * 保留用户已添加的自定义API，同时添加缺失的预设模型
 */
function mergeVideoApis(existingApis?: VideoApiConfig[]): VideoApiConfig[] {
  // 记录到全局变量供调试
  (window as unknown as { __DEBUG_VIDEO_APIS__?: unknown }).__DEBUG_VIDEO_APIS__ = {
    input: existingApis,
    timestamp: Date.now(),
  };

  if (!existingApis || existingApis.length === 0) {
    return PRESET_VIDEO_APIS;
  }

  // 构建现有API的模型ID映射
  const existingModelIds = new Set(existingApis.map((api) => api.modelId));

  // 找出缺失的预设模型
  const missingPresets = PRESET_VIDEO_APIS.filter(
    (preset) => !existingModelIds.has(preset.modelId)
  );

  // 如果有缺失的预设模型，合并它们
  if (missingPresets.length > 0) {
    return [...existingApis, ...missingPresets];
  }

  return existingApis;
}

interface SettingsState {
  isHydrated: boolean;
  apiKeys: ProviderApiKeys;
  grsaiNanoBananaProModel: string;
  hideProviderGuidePopover: boolean;
  downloadPresetPaths: string[];
  useUploadFilenameAsNodeTitle: boolean;
  storyboardGenKeepStyleConsistent: boolean;
  storyboardGenDisableTextInImage: boolean;
  storyboardGenAutoInferEmptyFrame: boolean;
  ignoreAtTagWhenCopyingAndGenerating: boolean;
  enableStoryboardGenGridPreviewShortcut: boolean;
  showStoryboardGenAdvancedRatioControls: boolean;
  showNodePrice: boolean;
  priceDisplayCurrencyMode: PriceDisplayCurrencyMode;
  usdToCnyRate: number;
  preferDiscountedPrice: boolean;
  grsaiCreditTierId: GrsaiCreditTierId;
  uiRadiusPreset: UiRadiusPreset;
  themeTonePreset: ThemeTonePreset;
  accentColor: string;
  canvasEdgeRoutingMode: CanvasEdgeRoutingMode;
  snapToGridEnabled: boolean;
  snapGridSize: number;
  autoCheckAppUpdateOnLaunch: boolean;
  enableUpdateDialog: boolean;
  textApis: TextApiConfig[];
  activeTextApiId: string | null;
  imagePolishPrompt: string;
  videoApis: VideoApiConfig[];
  activeVideoApiId: string | null;
  setProviderApiKey: (providerId: string, key: string) => void;
  setGrsaiNanoBananaProModel: (model: string) => void;
  setHideProviderGuidePopover: (hide: boolean) => void;
  setDownloadPresetPaths: (paths: string[]) => void;
  setUseUploadFilenameAsNodeTitle: (enabled: boolean) => void;
  setStoryboardGenKeepStyleConsistent: (enabled: boolean) => void;
  setStoryboardGenDisableTextInImage: (enabled: boolean) => void;
  setStoryboardGenAutoInferEmptyFrame: (enabled: boolean) => void;
  setIgnoreAtTagWhenCopyingAndGenerating: (enabled: boolean) => void;
  setEnableStoryboardGenGridPreviewShortcut: (enabled: boolean) => void;
  setShowStoryboardGenAdvancedRatioControls: (enabled: boolean) => void;
  setShowNodePrice: (enabled: boolean) => void;
  setPriceDisplayCurrencyMode: (mode: PriceDisplayCurrencyMode) => void;
  setUsdToCnyRate: (rate: number) => void;
  setPreferDiscountedPrice: (enabled: boolean) => void;
  setGrsaiCreditTierId: (tierId: GrsaiCreditTierId) => void;
  setUiRadiusPreset: (preset: UiRadiusPreset) => void;
  setThemeTonePreset: (preset: ThemeTonePreset) => void;
  setAccentColor: (color: string) => void;
  setCanvasEdgeRoutingMode: (mode: CanvasEdgeRoutingMode) => void;
  setSnapToGridEnabled: (enabled: boolean) => void;
  setSnapGridSize: (size: number) => void;
  setAutoCheckAppUpdateOnLaunch: (enabled: boolean) => void;
  setEnableUpdateDialog: (enabled: boolean) => void;
  setTextApis: (apis: TextApiConfig[]) => void;
  setActiveTextApiId: (id: string | null) => void;
  setImagePolishPrompt: (prompt: string) => void;
  setVideoApis: (apis: VideoApiConfig[]) => void;
  setActiveVideoApiId: (id: string | null) => void;
}

const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;

function normalizeHexColor(input: string): string {
  const trimmed = input.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return '#3B82F6';
  }
  return trimmed.startsWith('#') ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
}

function normalizeApiKey(input: string): string {
  return input.trim();
}

function normalizePriceDisplayCurrencyMode(
  input: PriceDisplayCurrencyMode | string | null | undefined
): PriceDisplayCurrencyMode {
  return PRICE_DISPLAY_CURRENCY_MODES.includes(input as PriceDisplayCurrencyMode)
    ? (input as PriceDisplayCurrencyMode)
    : 'auto';
}

function normalizeUsdToCnyRate(input: number | string | null | undefined): number {
  const numeric = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 7.2;
  }

  return Math.min(100, Math.max(0.01, Math.round(numeric * 100) / 100));
}

function normalizeGrsaiCreditTierId(
  input: GrsaiCreditTierId | string | null | undefined
): GrsaiCreditTierId {
  switch (input) {
    case 'tier-10':
    case 'tier-20':
    case 'tier-49':
    case 'tier-99':
    case 'tier-499':
    case 'tier-999':
      return input;
    default:
      return DEFAULT_GRSAI_CREDIT_TIER_ID;
  }
}

function normalizeGrsaiNanoBananaProModel(input: string | null | undefined): string {
  const trimmed = (input ?? '').trim().toLowerCase();
  if (trimmed === DEFAULT_GRSAI_NANO_BANANA_PRO_MODEL || trimmed.startsWith('nano-banana-pro-')) {
    return trimmed;
  }
  return DEFAULT_GRSAI_NANO_BANANA_PRO_MODEL;
}

function normalizeCanvasEdgeRoutingMode(
  input: CanvasEdgeRoutingMode | string | null | undefined
): CanvasEdgeRoutingMode {
  if (input === 'orthogonal' || input === 'smartOrthogonal' || input === 'spline') {
    return input;
  }
  return 'spline';
}

function normalizeApiKeys(input: ProviderApiKeys | null | undefined): ProviderApiKeys {
  if (!input) {
    return {};
  }

  return Object.entries(input).reduce<ProviderApiKeys>((acc, [providerId, key]) => {
    const normalizedProviderId = providerId.trim();
    if (!normalizedProviderId) {
      return acc;
    }

    acc[normalizedProviderId] = normalizeApiKey(key);
    return acc;
  }, {});
}

export function hasConfiguredApiKey(apiKeys: ProviderApiKeys): boolean {
  return getConfiguredApiKeyCount(apiKeys) > 0;
}

export function getConfiguredApiKeyCount(
  apiKeys: ProviderApiKeys,
  providerIds?: readonly string[]
): number {
  const keysToCount = providerIds
    ? providerIds.map((providerId) => apiKeys[providerId] ?? '')
    : Object.values(apiKeys);

  return keysToCount.reduce((count, key) => {
    return normalizeApiKey(key).length > 0 ? count + 1 : count;
  }, 0);
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      isHydrated: false,
      apiKeys: {},
      grsaiNanoBananaProModel: DEFAULT_GRSAI_NANO_BANANA_PRO_MODEL,
      hideProviderGuidePopover: false,
      downloadPresetPaths: [],
      useUploadFilenameAsNodeTitle: true,
      storyboardGenKeepStyleConsistent: true,
      storyboardGenDisableTextInImage: true,
      storyboardGenAutoInferEmptyFrame: true,
      ignoreAtTagWhenCopyingAndGenerating: true,
      enableStoryboardGenGridPreviewShortcut: false,
      showStoryboardGenAdvancedRatioControls: false,
      showNodePrice: true,
      priceDisplayCurrencyMode: 'auto',
      usdToCnyRate: 7.2,
      preferDiscountedPrice: false,
      grsaiCreditTierId: DEFAULT_GRSAI_CREDIT_TIER_ID,
      uiRadiusPreset: 'default',
      themeTonePreset: 'neutral',
      accentColor: '#3B82F6',
      canvasEdgeRoutingMode: 'spline',
      snapToGridEnabled: false,
      snapGridSize: 20,
      autoCheckAppUpdateOnLaunch: true,
      enableUpdateDialog: true,
      setProviderApiKey: (providerId, key) =>
        set((state) => ({
          apiKeys: {
            ...state.apiKeys,
            [providerId]: normalizeApiKey(key),
          },
        })),
      setGrsaiNanoBananaProModel: (model) =>
        set({
          grsaiNanoBananaProModel: normalizeGrsaiNanoBananaProModel(model),
        }),
      setHideProviderGuidePopover: (hide) => set({ hideProviderGuidePopover: hide }),
      setDownloadPresetPaths: (paths) => {
        const uniquePaths = Array.from(
          new Set(paths.map((path) => path.trim()).filter((path) => path.length > 0))
        ).slice(0, 8);
        set({ downloadPresetPaths: uniquePaths });
      },
      setUseUploadFilenameAsNodeTitle: (enabled) => set({ useUploadFilenameAsNodeTitle: enabled }),
      setStoryboardGenKeepStyleConsistent: (enabled) =>
        set({ storyboardGenKeepStyleConsistent: enabled }),
      setStoryboardGenDisableTextInImage: (enabled) =>
        set({ storyboardGenDisableTextInImage: enabled }),
      setStoryboardGenAutoInferEmptyFrame: (enabled) =>
        set({ storyboardGenAutoInferEmptyFrame: enabled }),
      setIgnoreAtTagWhenCopyingAndGenerating: (enabled) =>
        set({ ignoreAtTagWhenCopyingAndGenerating: enabled }),
      setEnableStoryboardGenGridPreviewShortcut: (enabled) =>
        set({ enableStoryboardGenGridPreviewShortcut: enabled }),
      setShowStoryboardGenAdvancedRatioControls: (enabled) =>
        set({ showStoryboardGenAdvancedRatioControls: enabled }),
      setShowNodePrice: (enabled) => set({ showNodePrice: enabled }),
      setPriceDisplayCurrencyMode: (priceDisplayCurrencyMode) =>
        set({
          priceDisplayCurrencyMode:
            normalizePriceDisplayCurrencyMode(priceDisplayCurrencyMode),
        }),
      setUsdToCnyRate: (usdToCnyRate) =>
        set({ usdToCnyRate: normalizeUsdToCnyRate(usdToCnyRate) }),
      setPreferDiscountedPrice: (enabled) => set({ preferDiscountedPrice: enabled }),
      setGrsaiCreditTierId: (grsaiCreditTierId) =>
        set({ grsaiCreditTierId: normalizeGrsaiCreditTierId(grsaiCreditTierId) }),
      setUiRadiusPreset: (uiRadiusPreset) => set({ uiRadiusPreset }),
      setThemeTonePreset: (themeTonePreset) => set({ themeTonePreset }),
      setAccentColor: (color) => set({ accentColor: normalizeHexColor(color) }),
      setCanvasEdgeRoutingMode: (canvasEdgeRoutingMode) =>
        set({ canvasEdgeRoutingMode: normalizeCanvasEdgeRoutingMode(canvasEdgeRoutingMode) }),
      setSnapToGridEnabled: (enabled: boolean) => set({ snapToGridEnabled: enabled }),
      setSnapGridSize: (size: number) => set({ snapGridSize: Math.max(5, Math.min(100, size)) }),
      setAutoCheckAppUpdateOnLaunch: (enabled: boolean) => set({ autoCheckAppUpdateOnLaunch: enabled }),
      setEnableUpdateDialog: (enabled) => set({ enableUpdateDialog: enabled }),
      textApis: PRESET_TEXT_APIS,
      activeTextApiId: null,
      setTextApis: (apis) => set({ textApis: apis }),
      setActiveTextApiId: (id) => set({ activeTextApiId: id }),
      imagePolishPrompt: DEFAULT_TEXT_API_PROMPT,
      setImagePolishPrompt: (prompt: string) => set({ imagePolishPrompt: prompt }),
      videoApis: PRESET_VIDEO_APIS,
      activeVideoApiId: null,
      setVideoApis: (apis) => {
        writeDebugLog(`[settingsStore] setVideoApis called with: ${JSON.stringify(apis?.map(a => a.modelId))}`);
        set({ videoApis: apis });
      },
      setActiveVideoApiId: (id) => set({ activeVideoApiId: id }),
    }),
    {
      name: 'settings-storage',
      version: 13,
      onRehydrateStorage: () => {
        return (_state, error) => {
          if (error) {
            console.error('failed to hydrate settings storage', error);
          }
          useSettingsStore.setState({ isHydrated: true });
        };
      },
      migrate: (persistedState: unknown) => {
        const state = (persistedState ?? {}) as {
          apiKey?: string;
          apiKeys?: ProviderApiKeys;
          ignoreAtTagWhenCopyingAndGenerating?: boolean;
          grsaiNanoBananaProModel?: string;
          hideProviderGuidePopover?: boolean;
          canvasEdgeRoutingMode?: CanvasEdgeRoutingMode | string;
          autoCheckAppUpdateOnLaunch?: boolean;
          enableUpdateDialog?: boolean;
          enableStoryboardGenGridPreviewShortcut?: boolean;
          showStoryboardGenAdvancedRatioControls?: boolean;
          storyboardGenAutoInferEmptyFrame?: boolean;
          showNodePrice?: boolean;
          priceDisplayCurrencyMode?: PriceDisplayCurrencyMode | string;
          usdToCnyRate?: number | string;
          preferDiscountedPrice?: boolean;
          grsaiCreditTierId?: GrsaiCreditTierId | string;
          textApis?: TextApiConfig[];
          activeTextApiId?: string | null;
          imagePolishPrompt?: string;
          videoApis?: VideoApiConfig[];
          activeVideoApiId?: string | null;
        };

        const migratedApiKeys = normalizeApiKeys(state.apiKeys);
        const ignoreAtTagWhenCopyingAndGenerating =
          state.ignoreAtTagWhenCopyingAndGenerating ?? true;
        if (Object.keys(migratedApiKeys).length > 0) {
          return {
            ...(persistedState as object),
            isHydrated: true,
            apiKeys: migratedApiKeys,
            ignoreAtTagWhenCopyingAndGenerating,
            grsaiNanoBananaProModel: normalizeGrsaiNanoBananaProModel(
              state.grsaiNanoBananaProModel
            ),
            hideProviderGuidePopover: state.hideProviderGuidePopover ?? false,
            canvasEdgeRoutingMode: normalizeCanvasEdgeRoutingMode(state.canvasEdgeRoutingMode),
            autoCheckAppUpdateOnLaunch: state.autoCheckAppUpdateOnLaunch ?? true,
            enableUpdateDialog: state.enableUpdateDialog ?? true,
            enableStoryboardGenGridPreviewShortcut:
              state.enableStoryboardGenGridPreviewShortcut ?? false,
            showStoryboardGenAdvancedRatioControls:
              state.showStoryboardGenAdvancedRatioControls ?? false,
            storyboardGenAutoInferEmptyFrame: state.storyboardGenAutoInferEmptyFrame ?? true,
            showNodePrice: state.showNodePrice ?? true,
            priceDisplayCurrencyMode: normalizePriceDisplayCurrencyMode(
              state.priceDisplayCurrencyMode
            ),
            usdToCnyRate: normalizeUsdToCnyRate(state.usdToCnyRate),
            preferDiscountedPrice: state.preferDiscountedPrice ?? false,
            grsaiCreditTierId: normalizeGrsaiCreditTierId(state.grsaiCreditTierId),
            textApis: state.textApis ?? PRESET_TEXT_APIS,
            activeTextApiId: state.activeTextApiId ?? null,
            imagePolishPrompt: state.imagePolishPrompt ?? DEFAULT_TEXT_API_PROMPT,
            videoApis: mergeVideoApis(state.videoApis),
            activeVideoApiId: state.activeVideoApiId ?? null,
          };
        }

        return {
          ...(persistedState as object),
          isHydrated: true,
          apiKeys: state.apiKey ? { ppio: normalizeApiKey(state.apiKey) } : {},
          ignoreAtTagWhenCopyingAndGenerating,
          grsaiNanoBananaProModel: normalizeGrsaiNanoBananaProModel(
            state.grsaiNanoBananaProModel
          ),
          hideProviderGuidePopover: state.hideProviderGuidePopover ?? false,
          canvasEdgeRoutingMode: normalizeCanvasEdgeRoutingMode(state.canvasEdgeRoutingMode),
          autoCheckAppUpdateOnLaunch: state.autoCheckAppUpdateOnLaunch ?? true,
          enableUpdateDialog: state.enableUpdateDialog ?? true,
          enableStoryboardGenGridPreviewShortcut:
            state.enableStoryboardGenGridPreviewShortcut ?? false,
          showStoryboardGenAdvancedRatioControls:
            state.showStoryboardGenAdvancedRatioControls ?? false,
          storyboardGenAutoInferEmptyFrame: state.storyboardGenAutoInferEmptyFrame ?? true,
          showNodePrice: state.showNodePrice ?? true,
          priceDisplayCurrencyMode: normalizePriceDisplayCurrencyMode(
            state.priceDisplayCurrencyMode
          ),
          usdToCnyRate: normalizeUsdToCnyRate(state.usdToCnyRate),
          preferDiscountedPrice: state.preferDiscountedPrice ?? false,
          grsaiCreditTierId: normalizeGrsaiCreditTierId(state.grsaiCreditTierId),
          textApis: state.textApis ?? PRESET_TEXT_APIS,
          activeTextApiId: state.activeTextApiId ?? null,
          imagePolishPrompt: state.imagePolishPrompt ?? DEFAULT_TEXT_API_PROMPT,
          videoApis: mergeVideoApis(state.videoApis),
          activeVideoApiId: state.activeVideoApiId ?? null,
        };
      },
    }
  )
);
