import { generateText } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import type { TextApiConfig } from '@/stores/settingsStore';
import { createAgentLanguageModel, resolveAgentBaseUrl } from './agentModelFactory';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

function textApi(overrides: Partial<TextApiConfig> = {}): TextApiConfig {
  return {
    id: 'api-1',
    name: 'Gateway',
    apiKey: 'secret-key',
    baseUrl: 'https://gateway.example',
    modelId: 'deepseek-flash',
    modelCatalog: null,
    selectedModelIds: ['deepseek-flash', 'gpt-x'],
    enabled: true,
    ...overrides,
  };
}

function captureFetch() {
  const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify({
      id: 'r1',
      object: 'chat.completion',
      created: 0,
      model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    }), { headers: { 'content-type': 'application/json' } });
  });
  return { requests, fetchImpl: fetchImpl as unknown as typeof fetch };
}

async function sendOnce(modelId: string, reasoningEffort: Parameters<typeof createAgentLanguageModel>[2]) {
  const { requests, fetchImpl } = captureFetch();
  const { model, providerOptions } = createAgentLanguageModel(
    [textApi()],
    { apiId: 'api-1', modelId },
    reasoningEffort,
    fetchImpl,
  );
  await generateText({ model, providerOptions, prompt: 'hi' });
  return requests[0];
}

describe('resolveAgentBaseUrl', () => {
  it('matches the Rust chat completions endpoint rules', () => {
    expect(resolveAgentBaseUrl('https://gateway.example')).toBe('https://gateway.example/v1');
    expect(resolveAgentBaseUrl('https://gateway.example/v1/')).toBe('https://gateway.example/v1');
    expect(resolveAgentBaseUrl('https://gateway.example/openai/v4')).toBe('https://gateway.example/openai/v4');
    expect(resolveAgentBaseUrl('https://gateway.example/v1/chat/completions')).toBe('https://gateway.example/v1');
    expect(resolveAgentBaseUrl('https://ark.example/api/coding')).toBe('https://ark.example/api/coding/v3');
    expect(resolveAgentBaseUrl('http://192.168.1.5:11434')).toBe('http://192.168.1.5:11434/v1');
  });

  it('rejects non-HTTP base URLs', () => {
    expect(() => resolveAgentBaseUrl('ftp://gateway.example')).toThrow();
  });
});

describe('createAgentLanguageModel', () => {
  it('uses the configured API connection and the default chat completions endpoint', async () => {
    const request = await sendOnce('gpt-x', 'max');
    expect(request.url).toBe('https://gateway.example/v1/chat/completions');
    expect(request.headers.get('authorization')).toBe('Bearer secret-key');
    expect(request.body.model).toBe('gpt-x');
  });

  it('sends reasoning_effort only when one is configured', async () => {
    expect((await sendOnce('gpt-x', 'max')).body.reasoning_effort).toBe('max');
    expect((await sendOnce('gpt-x', null)).body).not.toHaveProperty('reasoning_effort');
  });

  it('switches on DeepSeek thinking mode only for DeepSeek models with reasoning enabled', async () => {
    expect((await sendOnce('deepseek-flash', 'max')).body.thinking).toEqual({ type: 'enabled' });
    expect((await sendOnce('gpt-x', 'max')).body).not.toHaveProperty('thinking');
    expect((await sendOnce('deepseek-flash', null)).body).not.toHaveProperty('thinking');
    expect((await sendOnce('deepseek-flash', 'none')).body).not.toHaveProperty('thinking');
  });

  it('refuses a model that is not configured on the selected API', () => {
    expect(() => createAgentLanguageModel([textApi()], { apiId: 'api-1', modelId: 'other' }, null, vi.fn()))
      .toThrow(/not configured/);
  });
});
