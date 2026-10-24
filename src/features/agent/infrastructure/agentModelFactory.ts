import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { isTauri } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { LanguageModel } from 'ai';

import { resolveTextModelSelection } from '@/features/canvas/application/textModelSelection';
import type { TextReasoningEffort } from '@/features/canvas/models/types';
import type { TextApiConfig } from '@/stores/settingsStore';

// Fixed provider name so providerOptions never depend on the user-chosen API name.
const PROVIDER_NAME = 'lumina';

export interface AgentModelSelection {
  apiId: string;
  modelId: string;
}

export interface AgentLanguageModel {
  model: LanguageModel;
  providerOptions: Record<string, Record<string, string>>;
}

type RequestBody = Record<string, unknown>;

interface ProviderQuirk {
  matches: (modelId: string) => boolean;
  transformRequestBody: (body: RequestBody, reasoningEffort: TextReasoningEffort | null) => RequestBody;
}

const PROVIDER_QUIRKS: ProviderQuirk[] = [
  {
    // DeepSeek only returns reasoning_content when thinking mode is switched on in the body.
    matches: (modelId) => /deepseek/i.test(modelId),
    transformRequestBody: (body, reasoningEffort) => (
      reasoningEffort && reasoningEffort !== 'none' ? { ...body, thinking: { type: 'enabled' } } : body
    ),
  },
];

/**
 * Mirrors `resolve_chat_completions_endpoint` in src-tauri/src/commands/ai.rs, minus the
 * trailing `/chat/completions` that the AI SDK appends, so a text API that works for
 * polishing works for the agent too.
 */
export function resolveAgentBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported base URL protocol: ${url.protocol}`);
  }
  const basePath = url.pathname.replace(/\/+$/, '');
  let path: string;
  if (basePath.endsWith('/chat/completions')) {
    path = basePath.slice(0, -'/chat/completions'.length);
  } else if (basePath.endsWith('/api/coding')) {
    path = `${basePath}/v3`;
  } else if (!basePath) {
    path = '/v1';
  } else {
    path = basePath;
  }
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

export function createAgentLanguageModel(
  textApis: TextApiConfig[],
  selection: AgentModelSelection,
  reasoningEffort: TextReasoningEffort | null,
  fetchImpl: typeof fetch = isTauri() ? tauriFetch : window.fetch.bind(window),
): AgentLanguageModel {
  const resolved = resolveTextModelSelection(textApis, selection.apiId, selection.modelId);
  if (!resolved) {
    throw new Error(`Text model ${selection.apiId}/${selection.modelId} is not configured.`);
  }
  const quirks = PROVIDER_QUIRKS.filter((quirk) => quirk.matches(resolved.modelId));
  const provider = createOpenAICompatible({
    name: PROVIDER_NAME,
    baseURL: resolveAgentBaseUrl(resolved.apiConfig.baseUrl),
    apiKey: resolved.apiConfig.apiKey,
    fetch: fetchImpl,
    includeUsage: true,
    supportsMultiPartToolContent: true,
    transformRequestBody: quirks.length
      ? (body) => quirks.reduce((next, quirk) => quirk.transformRequestBody(next, reasoningEffort), body)
      : undefined,
  });

  return {
    model: provider.chatModel(resolved.modelId),
    // Same convention as ai.rs: send reasoning_effort only when one is configured.
    providerOptions: reasoningEffort ? { [PROVIDER_NAME]: { reasoningEffort } } : {},
  };
}
