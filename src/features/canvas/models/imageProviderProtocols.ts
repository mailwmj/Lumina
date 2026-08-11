import { OPENAI_IMAGE_PROVIDER_ID } from './providers/openai';

export const CUSTOM_IMAGE_PROTOCOLS = ['openai-images', 'gemini-native'] as const;
export type CustomImageProtocol = (typeof CUSTOM_IMAGE_PROTOCOLS)[number];

export const DEFAULT_CUSTOM_IMAGE_PROTOCOL: CustomImageProtocol = 'openai-images';
export const GEMINI_NATIVE_IMAGE_PROVIDER_ID = 'gemini';

export interface CustomImageProtocolDefinition {
  id: CustomImageProtocol;
  backendProviderId: string;
  labelKey: string;
  summaryKey: string;
  baseUrlPlaceholder: string;
  modelIdPlaceholder: string;
}

const CUSTOM_IMAGE_PROTOCOL_DEFINITIONS: Record<
  CustomImageProtocol,
  CustomImageProtocolDefinition
> = {
  'openai-images': {
    id: 'openai-images',
    backendProviderId: OPENAI_IMAGE_PROVIDER_ID,
    labelKey: 'settings.customImageProtocolOpenAiImages',
    summaryKey: 'settings.customImageProtocolOpenAiImagesSummary',
    baseUrlPlaceholder: 'https://api.example.com/v1',
    modelIdPlaceholder: 'gpt-image-1',
  },
  'gemini-native': {
    id: 'gemini-native',
    backendProviderId: GEMINI_NATIVE_IMAGE_PROVIDER_ID,
    labelKey: 'settings.customImageProtocolGeminiNative',
    summaryKey: 'settings.customImageProtocolGeminiNativeSummary',
    baseUrlPlaceholder: 'https://api.example.com/v1beta',
    modelIdPlaceholder: 'gemini-3-pro-image-preview',
  },
};

export function isCustomImageProtocol(value: unknown): value is CustomImageProtocol {
  return typeof value === 'string' && CUSTOM_IMAGE_PROTOCOLS.includes(value as CustomImageProtocol);
}

export function normalizeCustomImageProtocol(value: unknown): CustomImageProtocol {
  return isCustomImageProtocol(value) ? value : DEFAULT_CUSTOM_IMAGE_PROTOCOL;
}

export function getCustomImageProtocolDefinition(
  protocol: CustomImageProtocol
): CustomImageProtocolDefinition {
  return CUSTOM_IMAGE_PROTOCOL_DEFINITIONS[protocol];
}

export function normalizeCustomImageRemoteModelId(
  protocol: CustomImageProtocol,
  modelId: string
): string {
  let normalized = modelId.trim();
  if (protocol !== 'gemini-native') {
    return normalized;
  }

  while (normalized.startsWith('models/') || normalized.startsWith('gemini/')) {
    normalized = normalized.startsWith('models/')
      ? normalized.slice('models/'.length)
      : normalized.slice('gemini/'.length);
  }
  return normalized;
}

export function toCustomImageRequestModel(
  protocol: CustomImageProtocol,
  remoteModelId: string
): string {
  const normalized = normalizeCustomImageRemoteModelId(protocol, remoteModelId);
  return `${getCustomImageProtocolDefinition(protocol).backendProviderId}/${normalized}`;
}
