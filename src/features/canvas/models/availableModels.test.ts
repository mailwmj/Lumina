import { describe, expect, it } from 'vitest';

import type { ImageModelSettings } from './availableModels';
import {
  listConfiguredImageModels,
  resolveConfiguredImageModel,
} from './availableModels';

function createSettings(): ImageModelSettings {
  return {
    openAiImageApi: {
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      modelCatalog: {
        models: [
          { id: 'ai-media/gpt-image-2' },
          { id: 'ai-media/custom-image-model', label: 'Custom Image' },
        ],
        refreshedAt: 1,
      },
      selectedModelIds: ['ai-media/custom-image-model'],
    },
    chaomoImageApi: {
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      modelCatalog: {
        models: [{ id: 'chaomo/gpt-image2-4K' }],
        refreshedAt: 1,
      },
      selectedModelIds: ['chaomo/gpt-image2-4K'],
    },
    lastImageModelSelection: {
      providerId: 'chaomo',
      modelId: 'chaomo/gpt-image2-4K',
    },
  };
}

describe('available image models', () => {
  it('only exposes models selected in provider settings', () => {
    expect(listConfiguredImageModels(createSettings()).map((model) => model.id)).toEqual([
      'ai-media/custom-image-model',
      'chaomo/gpt-image2-4K',
    ]);
  });

  it('uses the last selection when a new or previously selected model is unavailable', () => {
    const settings = createSettings();

    expect(resolveConfiguredImageModel(settings, undefined)?.id).toBe('chaomo/gpt-image2-4K');
    expect(resolveConfiguredImageModel(settings, 'ai-media/gpt-image-2')?.id).toBe(
      'chaomo/gpt-image2-4K'
    );
  });

  it('falls back to Chaomo when it is the only configured provider', () => {
    const settings = createSettings();
    settings.openAiImageApi = {
      apiKey: '',
      baseUrl: 'https://example.test/v1',
      modelCatalog: null,
      selectedModelIds: [],
    };

    expect(resolveConfiguredImageModel(settings, 'ai-media/gpt-image-2')?.id).toBe(
      'chaomo/gpt-image2-4K'
    );
  });

  it('exposes built-in Chaomo models when only its API key is configured', () => {
    const settings = createSettings();
    settings.openAiImageApi = {
      apiKey: '',
      baseUrl: 'https://example.test/v1',
      modelCatalog: null,
      selectedModelIds: [],
    };
    settings.chaomoImageApi = {
      apiKey: 'chaomo-key',
      baseUrl: 'https://example.test/v1',
      modelCatalog: null,
      selectedModelIds: [],
    };

    const models = listConfiguredImageModels(settings);

    expect(models.length).toBeGreaterThan(0);
    expect(models.every((model) => model.providerId === 'chaomo')).toBe(true);
    expect(models.some((model) => model.id === 'chaomo/gpt-image2-4K')).toBe(true);
    expect(resolveConfiguredImageModel(settings, 'ai-media/gpt-image-2')?.providerId).toBe(
      'chaomo'
    );
  });
});
