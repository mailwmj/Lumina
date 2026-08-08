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

  it('uses the last selection for a new node and leaves an unavailable node unresolved', () => {
    const settings = createSettings();

    expect(resolveConfiguredImageModel(settings, undefined)?.id).toBe('chaomo/gpt-image2-4K');
    expect(resolveConfiguredImageModel(settings, 'ai-media/gpt-image-2')).toBeNull();
  });
});
