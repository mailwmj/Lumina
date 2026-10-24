import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { readUIMessageStream, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  AgentChatTransport,
  pendingQuestionCallId,
  shouldResumeAfterToolOutput,
  withoutIncompleteToolCalls,
} from './agentChatTransport';
import type { CanvasAgentUIMessage } from './canvasAgent';

const run = vi.hoisted(() => ({ runImageGenerationNodes: vi.fn() }));
vi.mock('@/features/canvas/application/imageGenerationRun', () => run);
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: { getState: () => ({ getCurrentProject: () => ({ id: 'project-1' }) }) },
}));

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function toolCallStep(toolName: string, input: unknown): LanguageModelV4StreamPart[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
  ];
}

function textStep(text: string): LanguageModelV4StreamPart[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: text },
    { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
  ];
}

/** A scripted model: each call to the model streams the next step. */
function scriptedModel(steps: LanguageModelV4StreamPart[][]) {
  const calls: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      calls.push(options);
      const chunks = steps[calls.length - 1] ?? textStep('(script exhausted)');
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
  return { model, calls };
}

function userMessage(text: string, requestedImageCount: number | null = null): CanvasAgentUIMessage {
  return { id: `u-${text}`, role: 'user', metadata: { refs: [], requestedImageCount }, parts: [{ type: 'text', text }] };
}

async function runTurn(transport: AgentChatTransport, messages: CanvasAgentUIMessage[]) {
  const last = messages[messages.length - 1];
  const stream = await transport.sendMessages({
    chatId: 'thread-1',
    messageId: undefined,
    trigger: 'submit-message',
    abortSignal: undefined,
    messages,
  });
  let assistant: CanvasAgentUIMessage | undefined;
  for await (const message of readUIMessageStream<CanvasAgentUIMessage>({
    stream,
    message: last.role === 'assistant' ? last : undefined,
  })) {
    assistant = message;
  }
  return assistant!;
}

function transportFor(model: MockLanguageModelV4) {
  return new AgentChatTransport(
    () => ({ llm: { apiId: 'api', modelId: 'm' }, imageModelId: 'image-model', imageResolution: '4K' }),
    { resolveModel: () => ({ model, providerOptions: {} }) },
  );
}

beforeEach(() => {
  useCanvasStore.getState().setCanvasData([], []);
  run.runImageGenerationNodes.mockImplementation(async (sourceNodeIds: string[]) => ({
    runs: sourceNodeIds.map((sourceNodeId) => ({
      status: 'started',
      sourceNodeId,
      resultNodeIds: [useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.exportImage, { x: 0, y: 0 }, { imageUrl: 'x.png' })],
      submissions: [],
    })),
  }));
});

afterEach(() => {
  run.runImageGenerationNodes.mockReset();
  useCanvasStore.getState().setCanvasData([], []);
});

describe('AgentChatTransport', () => {
  it('pauses on ask_user and resumes the same turn once the answer is filled in', async () => {
    const { model, calls } = scriptedModel([
      toolCallStep('ask_user', { questions: [{ id: 'style', title: '风格？', options: [{ value: 'ink', label: '水墨' }] }] }),
      toolCallStep('generate_image', { prompt: '水墨风格的猫' }),
      textStep('好了'),
    ]);
    const transport = transportFor(model);
    const user = userMessage('画一只猫');

    const paused = await runTurn(transport, [user]);
    const askPart = paused.parts.find((part) => part.type === 'tool-ask_user');
    expect(askPart).toMatchObject({ state: 'input-available' });
    expect(calls).toHaveLength(1);
    expect(useCanvasStore.getState().nodes).toHaveLength(0);

    const answered = {
      ...paused,
      parts: paused.parts.map((part) => (part.type === 'tool-ask_user'
        ? { ...part, state: 'output-available' as const, output: { style: { selected: ['ink'] } } }
        : part)),
    } as CanvasAgentUIMessage;
    const finished = await runTurn(transport, [user, answered]);

    expect(JSON.stringify(calls[1].prompt)).toContain('"ink"');
    const imageEdits = useCanvasStore.getState().nodes.filter((node) => node.type === CANVAS_NODE_TYPES.imageEdit);
    expect(imageEdits.map((node) => node.data)).toEqual([expect.objectContaining({ prompt: '水墨风格的猫', size: '4K', outputCount: 1 })]);
    expect(finished.parts.some((part) => part.type === 'text' && part.text === '好了')).toBe(true);
  });

  it('uses the current conversation resolution on each send and defaults legacy conversations to 2K', async () => {
    const { model, calls } = scriptedModel([
      toolCallStep('generate_image', { prompt: 'cat' }), textStep('done'),
      toolCallStep('generate_image', { prompt: 'dog' }), textStep('done'),
    ]);
    let imageResolution: string | null = null;
    const transport = new AgentChatTransport(
      () => ({ llm: { apiId: 'api', modelId: 'm' }, imageModelId: 'image-model', imageResolution }),
      { resolveModel: () => ({ model, providerOptions: {} }) },
    );
    await runTurn(transport, [userMessage('cat')]);
    imageResolution = '1K';
    await runTurn(transport, [userMessage('dog')]);

    const sources = useCanvasStore.getState().nodes.filter((node) => node.type === CANVAS_NODE_TYPES.imageEdit);
    expect(sources.map((node) => (node.data as { size: string }).size)).toEqual(['2K', '1K']);
    expect(JSON.stringify(calls[0].prompt)).toContain('2K');
    expect(JSON.stringify(calls[2].prompt)).toContain('1K');
  });

  it('tells the model what it asked when the user replies with a new message instead', async () => {
    const { model, calls } = scriptedModel([
      toolCallStep('ask_user', { questions: [{ id: 'name', title: '店名是什么？' }] }),
      textStep('好的'),
    ]);
    const transport = transportFor(model);
    const paused = await runTurn(transport, [userMessage('做一张咖啡店海报')]);
    await runTurn(transport, [userMessage('做一张咖啡店海报'), paused, userMessage('店名叫慢岛')]);

    const prompt = JSON.stringify(calls[1].prompt);
    expect(prompt).toContain('店名是什么？');
    expect(prompt).toContain('unanswered');
    expect(prompt.indexOf('unanswered')).toBeLessThan(prompt.indexOf('店名叫慢岛'));
  });

  it('continues the asked task when the user answers in chat, keeping what the turn already used', async () => {
    const { model, calls } = scriptedModel([textStep('好的')]);
    const asked = {
      id: 'a-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-generate_image', toolCallId: 'g', state: 'output-available', input: { prompt: 'x' },
          output: { status: 'completed', grantedCount: 2, sourceNodeIds: [], results: [], budget: { limit: 4, used: 2 } },
        },
        {
          type: 'tool-ask_user', toolCallId: 'q', state: 'output-available',
          input: { questions: [{ id: 'name', title: '店名是什么？' }] }, output: { status: 'answered_in_chat' },
        },
      ],
    } as unknown as CanvasAgentUIMessage;

    await runTurn(transportFor(model), [userMessage('做三张咖啡店海报', 3), asked, userMessage('店名叫慢岛，改成五张', 5)]);

    const prompt = JSON.stringify(calls[0].prompt);
    expect(prompt).toContain('answered_in_chat');
    expect(prompt).toContain('本轮图片额度 5 张，已用 2 张');
    expect(prompt).toContain('count=5');
  });

  it('refuses generation when earlier runs in the same turn already used the budget', async () => {
    const { model } = scriptedModel([toolCallStep('generate_image', { prompt: 'cat' }), textStep('额度用完了')]);
    const transport = transportFor(model);
    const spent = {
      id: 'a-1',
      role: 'assistant',
      parts: [{
        type: 'tool-generate_image',
        toolCallId: 'old',
        state: 'output-available',
        input: { prompt: 'x' },
        output: { status: 'completed', grantedCount: 4, sourceNodeIds: [], results: [], budget: { limit: 4, used: 4 } },
      }],
    } as unknown as CanvasAgentUIMessage;

    const finished = await runTurn(transport, [userMessage('画猫'), spent]);
    const generate = finished.parts.filter((part) => part.type === 'tool-generate_image').pop();
    expect(generate).toMatchObject({ state: 'output-available', output: { status: 'refused' } });
    expect(run.runImageGenerationNodes).not.toHaveBeenCalled();
  });

  it('sends the referenced-image mapping to the model without changing the stored message', async () => {
    const { model, calls } = scriptedModel([textStep('ok')]);
    const user: CanvasAgentUIMessage = {
      id: 'u', role: 'user', metadata: { refs: [{ nodeId: 'upload-9' }] }, parts: [{ type: 'text', text: '改一下' }],
    };
    await runTurn(transportFor(model), [user]);
    expect(JSON.stringify(calls[0].prompt)).toContain('图片1 = upload-9');
    expect(user.parts).toHaveLength(1);
  });
});

describe('error reporting', () => {
  it('surfaces the provider error text instead of a generic message', async () => {
    const model = new MockLanguageModelV4({ doStream: async () => { throw new Error('401 invalid api key'); } });
    const stream = await transportFor(model).sendMessages({
      chatId: 'thread-1', messageId: undefined, trigger: 'submit-message', abortSignal: undefined, messages: [userMessage('hi')],
    });
    const chunks: Array<{ type: string; errorText?: string }> = [];
    const reader = stream.getReader();
    for (let next = await reader.read(); !next.done; next = await reader.read()) chunks.push(next.value as never);
    expect(chunks.find((chunk) => chunk.type === 'error')?.errorText).toContain('401 invalid api key');
  });
});

describe('resume and replay guards', () => {
  const ask = (state: string) => ({ type: 'tool-ask_user', toolCallId: 'q', state, input: {}, output: {} });
  const generate = (state: string) => ({ type: 'tool-generate_image', toolCallId: 'g', state, input: {}, output: {} });
  const assistantWith = (...parts: unknown[]) => [
    userMessage('x'),
    { id: 'a', role: 'assistant', parts } as unknown as CanvasAgentUIMessage,
  ];

  it('resumes only right after an answered ask_user', () => {
    expect(shouldResumeAfterToolOutput({ messages: assistantWith(ask('output-available')) })).toBe(true);
    expect(shouldResumeAfterToolOutput({ messages: assistantWith(ask('input-available')) })).toBe(false);
  });

  it('does not resume when the question was cancelled or answered in chat', () => {
    for (const status of ['cancelled', 'answered_in_chat']) {
      const closed = { ...ask('output-available'), output: { status } };
      expect(shouldResumeAfterToolOutput({ messages: assistantWith(closed) })).toBe(false);
    }
  });

  it('finds the question still waiting at the end of the conversation', () => {
    expect(pendingQuestionCallId(assistantWith(ask('input-available')))).toBe('q');
    expect(pendingQuestionCallId(assistantWith(ask('output-available')))).toBeNull();
    expect(pendingQuestionCallId([...assistantWith(ask('input-available')), userMessage('y')])).toBeNull();
  });

  it('does not resume after a stopped generation or once the model replied to the answer', () => {
    expect(shouldResumeAfterToolOutput({ messages: assistantWith(generate('output-available')) })).toBe(false);
    expect(shouldResumeAfterToolOutput({
      messages: assistantWith(ask('output-available'), { type: 'step-start' }, { type: 'text', text: '好的' }),
    })).toBe(false);
  });

  it('drops stopped tool calls but keeps a skipped question visible as unanswered', () => {
    const [, assistant] = withoutIncompleteToolCalls(assistantWith(generate('input-available'), ask('input-available')));
    expect(assistant.parts).toEqual([expect.objectContaining({
      type: 'tool-ask_user', state: 'output-available', output: { status: 'unanswered' },
    })]);
  });
});
