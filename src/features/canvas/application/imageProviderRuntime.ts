import type {
  ChaomoImageApiConfig,
  OpenAiImageApiConfig,
} from '@/stores/settingsStore';
import {
  AI_MEDIA_IMAGE_PROVIDER_ID,
  CHAOMO_IMAGE_PROVIDER_ID,
  OPENAI_IMAGE_PROVIDER_ID,
} from '@/features/canvas/models/providers/openai';

interface ImageProviderSettings {
  openAiImageApi: OpenAiImageApiConfig;
  chaomoImageApi: ChaomoImageApiConfig;
}

export interface ImageProviderRuntime {
  apiKey: string;
  providerConfig: Record<string, string>;
}

export function resolveImageProviderRuntime(
  providerId: string,
  settings: ImageProviderSettings
): ImageProviderRuntime {
  if (providerId === CHAOMO_IMAGE_PROVIDER_ID) {
    return {
      apiKey: settings.chaomoImageApi.apiKey,
      providerConfig: {
        base_url: settings.chaomoImageApi.baseUrl,
      },
    };
  }

  if (providerId === AI_MEDIA_IMAGE_PROVIDER_ID || providerId === OPENAI_IMAGE_PROVIDER_ID) {
    return {
      apiKey: settings.openAiImageApi.apiKey,
      providerConfig: {
        base_url: settings.openAiImageApi.baseUrl,
      },
    };
  }

  return { apiKey: '', providerConfig: {} };
}
