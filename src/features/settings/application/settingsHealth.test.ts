import { describe, expect, it } from 'vitest';

import {
  DEFAULT_IMAGE_POLISH_PROMPT,
  DEFAULT_TEXT_POLISH_PROMPT,
  PRESET_VIDEO_APIS,
  createDefaultChaomoImageApiConfig,
  createDefaultOpenAiImageApiConfig,
  createPromptPolishConfig,
  type TextApiConfig,
} from '@/stores/settingsStore';

import {
  deriveCapabilities,
  imageProviderHealth,
  textProviderHealth,
  videoProviderHealth,
  type SettingsHealthInput,
} from './settingsHealth';

function textApi(overrides: Partial<TextApiConfig> = {}): TextApiConfig {
  return {
    id: 'relay',
    name: 'Relay',
    apiKey: 'key',
    baseUrl: 'https://relay.example/v1',
    modelId: '',
    modelCatalog: null,
    selectedModelIds: ['gpt-5.6-terra'],
    enabled: false,
    ...overrides,
  };
}

function emptySettings(overrides: Partial<SettingsHealthInput> = {}): SettingsHealthInput {
  return {
    openAiImageApi: createDefaultOpenAiImageApiConfig(),
    chaomoImageApi: createDefaultChaomoImageApiConfig(),
    customImageApis: [],
    textApis: [],
    videoApis: PRESET_VIDEO_APIS,
    imagePolishConfig: createPromptPolishConfig(DEFAULT_IMAGE_POLISH_PROMPT),
    textPolishConfig: createPromptPolishConfig(DEFAULT_TEXT_POLISH_PROMPT),
    ...overrides,
  };
}

function capability(input: SettingsHealthInput, key: string) {
  return deriveCapabilities(input).find((item) => item.key === key)!;
}

describe('settingsHealth', () => {
  it('reports every capability as missing on a fresh install', () => {
    expect(deriveCapabilities(emptySettings()).map((item) => [item.key, item.level])).toEqual([
      ['image', 'missing'],
      ['video', 'missing'],
      ['imagePolish', 'missing'],
      ['textPolish', 'missing'],
    ]);
  });

  it('treats a built-in image provider with only a key as ready, because the node falls back to registry models', () => {
    const settings = emptySettings({
      openAiImageApi: { ...createDefaultOpenAiImageApiConfig(), apiKey: 'key' },
    });

    expect(imageProviderHealth('ai-media', settings.openAiImageApi, settings)).toBe('ready');
    expect(capability(settings, 'image').level).toBe('ready');
  });

  it('warns when an image provider has a fetched catalog but nothing is selected', () => {
    const openAiImageApi = {
      ...createDefaultOpenAiImageApiConfig(),
      apiKey: 'key',
      modelCatalog: { models: [{ id: 'ai-media/gpt-image-2' }], refreshedAt: 1 },
      selectedModelIds: [],
    };
    const settings = emptySettings({ openAiImageApi });

    expect(imageProviderHealth('ai-media', openAiImageApi, settings)).toBe('noModels');
    expect(capability(settings, 'image')).toMatchObject({
      level: 'warn',
      target: { kind: 'services', providerKind: 'image' },
    });
  });

  it('only counts enabled Seedance 2.0 video providers with a connection as ready', () => {
    const [preset] = PRESET_VIDEO_APIS;
    expect(videoProviderHealth({ ...preset, apiKey: 'key' })).toBe('ready');
    expect(videoProviderHealth({ ...preset, apiKey: 'key', enabled: false })).toBe('disabled');
    expect(videoProviderHealth({ ...preset, apiKey: '' })).toBe('unconfigured');
    expect(videoProviderHealth({ ...preset, apiKey: 'key', modelId: 'other-model' })).toBe('noModels');
  });

  it('does not count a text provider without a key as usable for polish', () => {
    const settings = emptySettings({ textApis: [textApi({ apiKey: '' })] });

    expect(textProviderHealth(settings.textApis[0])).toBe('unconfigured');
    expect(capability(settings, 'imagePolish')).toMatchObject({
      level: 'missing',
      target: { kind: 'services', providerKind: 'text' },
    });
  });

  it('resolves polish to the fallback text model when no explicit model is chosen', () => {
    const settings = emptySettings({ textApis: [textApi()] });

    expect(capability(settings, 'textPolish')).toMatchObject({
      level: 'ready',
      polishModelLabel: 'Relay / gpt-5.6-terra',
    });
  });

  it('warns when the explicitly chosen polish model is no longer selected on its provider', () => {
    const settings = emptySettings({
      textApis: [textApi()],
      imagePolishConfig: {
        ...createPromptPolishConfig(DEFAULT_IMAGE_POLISH_PROMPT),
        textApiId: 'relay',
        textModelId: 'removed-model',
      },
    });

    expect(capability(settings, 'imagePolish')).toMatchObject({
      level: 'warn',
      target: { kind: 'generation' },
    });
  });
});
