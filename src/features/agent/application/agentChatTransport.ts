import { DirectChatTransport, type ChatTransport, type LanguageModel, type UIMessageChunk } from 'ai';

import { createAgentLanguageModel, type AgentModelSelection } from '@/features/agent/infrastructure/agentModelFactory';
import { agentModelCapabilityKey, useAgentSettingsStore } from '@/features/agent/stores/agentSettingsStore';
import { ASK_USER_UNANSWERED } from '@/features/agent/domain/agentTools';
import type { AgentMessageMetadata } from '@/features/agent/domain/types';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveImageGenerationResolution } from '@/features/canvas/models/imageGenerationOptions';
import { createCanvasAgent, type CanvasAgentUIMessage } from './canvasAgent';
import { withReferenceContext } from './referenceContext';
import { resolveTurnBudget } from './turnBudget';

/** The thread's own model choice, read at send time so switching pickers applies to the next send. */
export interface AgentThreadModels {
  llm: AgentModelSelection | null;
  imageModelId: string | null;
  imageResolution: string | null;
}

type SendOptions = Parameters<ChatTransport<CanvasAgentUIMessage>['sendMessages']>[0];

const INCOMPLETE_TOOL_STATES = new Set(['input-streaming', 'input-available']);

/**
 * A stopped run or an ask_user the user skipped leaves tool calls without results, which
 * providers reject. A skipped ask_user is closed as unanswered so the model still sees what
 * it asked; other incomplete calls are dropped from the model's copy of the transcript.
 */
export function withoutIncompleteToolCalls<M extends CanvasAgentUIMessage>(messages: readonly M[]): M[] {
  return messages.map((message) => {
    let changed = false;
    const parts = message.parts.flatMap((part) => {
      if (!part.type.startsWith('tool-') || !INCOMPLETE_TOOL_STATES.has((part as { state?: string }).state ?? '')) {
        return [part];
      }
      changed = true;
      if (part.type === 'tool-ask_user' && part.state === 'input-available') {
        return [{ ...part, state: 'output-available', output: ASK_USER_UNANSWERED } as M['parts'][number]];
      }
      return [];
    });
    return changed ? { ...message, parts } : message;
  });
}

/**
 * Resubmit only right after the user answered ask_user. Never after a stopped generation,
 * and never once the model already replied to the answer (that would loop).
 */
export function shouldResumeAfterToolOutput({ messages }: { messages: CanvasAgentUIMessage[] }): boolean {
  const last = messages[messages.length - 1];
  if (last?.role !== 'assistant') return false;
  const lastToolIndex = last.parts.map((part) => part.type.startsWith('tool-')).lastIndexOf(true);
  const lastTool = last.parts[lastToolIndex] as { type: string; state?: string } | undefined;
  const repliedAfter = last.parts.slice(lastToolIndex + 1).some((part) => part.type === 'text');
  return lastTool?.type === 'tool-ask_user' && lastTool.state === 'output-available' && !repliedAfter;
}

export interface AgentChatTransportDeps {
  resolveModel?: (selection: AgentModelSelection) => { model: LanguageModel; providerOptions: Record<string, Record<string, string>> };
}

/**
 * Builds a fresh agent for every run. Each run recomputes the turn budget from the transcript,
 * so the ask_user round-trip (which re-sends) continues the same turn instead of resetting it.
 */
export class AgentChatTransport implements ChatTransport<CanvasAgentUIMessage> {
  constructor(
    private readonly getThreadModels: () => AgentThreadModels,
    private readonly deps: AgentChatTransportDeps = {},
  ) {}

  async sendMessages(options: SendOptions): Promise<ReadableStream<UIMessageChunk>> {
    const { llm, imageModelId, imageResolution } = this.getThreadModels();
    if (!llm) {
      throw new Error('No text model is selected for this conversation.');
    }
    const agentSettings = useAgentSettingsStore.getState();
    const { model, providerOptions } = this.deps.resolveModel?.(llm) ?? createAgentLanguageModel(
      useSettingsStore.getState().textApis,
      llm,
      agentSettings.reasoningEffort,
    );
    const lastUser = [...options.messages].reverse().find((message) => message.role === 'user');
    const requestedImageCount = (lastUser?.metadata as AgentMessageMetadata | undefined)?.requestedImageCount ?? null;

    const agent = createCanvasAgent({
      model,
      providerOptions,
      imageModelId,
      imageResolution: resolveImageGenerationResolution(imageResolution ?? undefined).value,
      budget: resolveTurnBudget(options.messages, agentSettings.maxImagesPerTurn),
      requestedImageCount,
      // Unprobed models are assumed capable; the probe runs when a model is first picked.
      vision: agentSettings.modelCapabilities[agentModelCapabilityKey(llm)]?.vision ?? true,
    });

    return new DirectChatTransport({
      agent,
      // The SDK masks errors for server use; in this local app the user needs the real cause.
      onError: (error) => (error instanceof Error ? error.message : String(error)),
    }).sendMessages({
      ...options,
      messages: withReferenceContext(withoutIncompleteToolCalls(options.messages), useCanvasStore.getState().nodes),
    });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}
