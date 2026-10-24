import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import { probeAgentModel } from './agentModelProbe';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function textResult(text: string): LanguageModelV4GenerateResult {
  return { content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] };
}

function toolCallResult(): LanguageModelV4GenerateResult {
  return {
    content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'ping', input: '{}' }],
    finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
    usage,
    warnings: [],
  };
}

function apiError(statusCode: number) {
  return new APICallError({ message: `HTTP ${statusCode}`, url: 'https://x', requestBodyValues: {}, statusCode });
}

const hasImage = (options: LanguageModelV4CallOptions) => options.prompt.some((message) => (
  message.role === 'user' && message.content.some((part) => part.type === 'file')
));

function model(handlers: {
  tools: (options: LanguageModelV4CallOptions) => LanguageModelV4GenerateResult;
  vision: () => LanguageModelV4GenerateResult;
}) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => (hasImage(options) ? handlers.vision() : handlers.tools(options)),
  });
}

describe('probeAgentModel', () => {
  it('reports tools and vision when the model calls the tool and accepts the image', async () => {
    const mock = model({ tools: toolCallResult, vision: () => textResult('orange') });
    await expect(probeAgentModel(mock)).resolves.toEqual({ tools: true, vision: true });
  });

  it('reports no tool support when the model answers in text instead of calling the tool', async () => {
    const mock = model({ tools: () => textResult('pong'), vision: () => textResult('orange') });
    await expect(probeAgentModel(mock)).resolves.toEqual({ tools: false, vision: true });
  });

  it('retries with tool_choice auto when the gateway rejects required', async () => {
    const mock = model({
      tools: (options) => {
        if (options.toolChoice?.type === 'required') throw apiError(400);
        return toolCallResult();
      },
      vision: () => textResult('orange'),
    });
    await expect(probeAgentModel(mock)).resolves.toEqual({ tools: true, vision: true });
  });

  it('reports no vision when the provider rejects the image request', async () => {
    const mock = model({ tools: toolCallResult, vision: () => { throw apiError(400); } });
    await expect(probeAgentModel(mock)).resolves.toEqual({ tools: true, vision: false });
  });

  it('throws on auth or connection failures instead of returning a cacheable verdict', async () => {
    const mock = model({ tools: () => { throw apiError(401); }, vision: () => textResult('orange') });
    await expect(probeAgentModel(mock)).rejects.toThrow('HTTP 401');
  });
});
