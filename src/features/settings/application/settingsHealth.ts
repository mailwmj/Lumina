import { isSeedance20Model } from '@/features/canvas/application/seedanceVideoRequestPlan';
import { resolveTextModelSelection } from '@/features/canvas/application/textModelSelection';
import {
  listConfiguredImageModels,
  type ImageModelSettings,
} from '@/features/canvas/models/availableModels';
import type {
  ImageProviderApiConfig,
  PromptPolishConfig,
  TextApiConfig,
  VideoApiConfig,
} from '@/stores/settingsStore';

/** Persisted readiness of one provider entry; connection tests are transient and not part of it. */
export type ProviderHealth = 'ready' | 'unconfigured' | 'noModels' | 'disabled';

export type SettingsProviderKind = 'image' | 'text' | 'video';

export type CapabilityKey = 'image' | 'video' | 'imagePolish' | 'textPolish';
export type CapabilityLevel = 'ready' | 'warn' | 'missing';

export interface Capability {
  key: CapabilityKey;
  level: CapabilityLevel;
  /** Where the user should go to act on this capability. */
  target: { kind: 'services'; providerKind: SettingsProviderKind } | { kind: 'generation' };
  /** Number of usable providers (media) or the resolved polish model (polish). */
  providerCount: number;
  modelCount: number;
  polishModelLabel?: string;
}

export interface SettingsHealthInput extends ImageModelSettings {
  textApis: TextApiConfig[];
  videoApis: VideoApiConfig[];
  imagePolishConfig: PromptPolishConfig;
  textPolishConfig: PromptPolishConfig;
}

function hasConnection(config: { apiKey: string; baseUrl: string }): boolean {
  return config.apiKey.trim().length > 0 && config.baseUrl.trim().length > 0;
}

export function imageProviderHealth(
  providerId: string,
  config: ImageProviderApiConfig,
  settings: ImageModelSettings
): ProviderHealth {
  if (!hasConnection(config)) {
    return 'unconfigured';
  }
  const modelCount = listConfiguredImageModels(settings)
    .filter((model) => model.providerId === providerId).length;
  return modelCount > 0 ? 'ready' : 'noModels';
}

export function textProviderHealth(api: TextApiConfig): ProviderHealth {
  if (!hasConnection(api)) {
    return 'unconfigured';
  }
  return api.selectedModelIds.length > 0 || api.modelId.trim() ? 'ready' : 'noModels';
}

export function videoProviderHealth(api: VideoApiConfig): ProviderHealth {
  if (!api.enabled) {
    return 'disabled';
  }
  if (!hasConnection(api)) {
    return 'unconfigured';
  }
  return api.modelId.trim() && isSeedance20Model(api.modelId) ? 'ready' : 'noModels';
}

function mediaLevel(healths: ProviderHealth[]): CapabilityLevel {
  if (healths.includes('ready')) {
    return 'ready';
  }
  return healths.includes('noModels') ? 'warn' : 'missing';
}

function polishCapability(
  key: 'imagePolish' | 'textPolish',
  config: PromptPolishConfig,
  textApis: TextApiConfig[]
): Capability {
  const target = { kind: 'generation' } as const;
  const usableApis = textApis.filter((api) => textProviderHealth(api) === 'ready');
  if (usableApis.length === 0) {
    return {
      key,
      level: 'missing',
      target: { kind: 'services', providerKind: 'text' },
      providerCount: 0,
      modelCount: 0,
    };
  }

  const resolved = resolveTextModelSelection(
    usableApis,
    config.textApiId ?? undefined,
    config.textModelId ?? undefined
  );
  if (!resolved) {
    return { key, level: 'warn', target, providerCount: usableApis.length, modelCount: 0 };
  }
  return {
    key,
    level: 'ready',
    target,
    providerCount: 1,
    modelCount: 1,
    polishModelLabel: `${resolved.apiName} / ${resolved.modelId}`,
  };
}

export function deriveCapabilities(input: SettingsHealthInput): Capability[] {
  const imageModels = listConfiguredImageModels(input);
  const imageHealths: ProviderHealth[] = [
    imageProviderHealth('ai-media', input.openAiImageApi, input),
    imageProviderHealth('chaomo', input.chaomoImageApi, input),
    ...input.customImageApis.map((config) => imageProviderHealth(config.id, config, input)),
  ];
  const videoHealths = input.videoApis.map(videoProviderHealth);

  return [
    {
      key: 'image',
      level: mediaLevel(imageHealths),
      target: { kind: 'services', providerKind: 'image' },
      providerCount: imageHealths.filter((health) => health === 'ready').length,
      modelCount: imageModels.length,
    },
    {
      key: 'video',
      level: mediaLevel(videoHealths),
      target: { kind: 'services', providerKind: 'video' },
      providerCount: videoHealths.filter((health) => health === 'ready').length,
      modelCount: videoHealths.filter((health) => health === 'ready').length,
    },
    polishCapability('imagePolish', input.imagePolishConfig, input.textApis),
    polishCapability('textPolish', input.textPolishConfig, input.textApis),
  ];
}
