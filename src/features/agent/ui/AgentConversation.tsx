import type { Chat } from '@ai-sdk/react';
import { useChat } from '@ai-sdk/react';
import { Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentThreadRecord } from '@/commands/agentThreads';
import { Message, MessageContent, MessageGroup } from '@/components/beui/agents/message';
import { MessageBubble, MessageBubbleContent } from '@/components/beui/agents/message-bubble';
import { MessageScroller } from '@/components/beui/agents/message-scroller';
import { EASE_OUT, SPRING_LAYOUT } from '@/components/beui/lib/ease';
import { cn } from '@/components/beui/lib/utils';
import { ensureAgentModelCapabilities } from '@/features/agent/application/agentModelCapabilities';
import { prepareAgentMessage, updateAgentThreadModels } from '@/features/agent/application/agentThreadActions';
import type { CanvasAgentUIMessage } from '@/features/agent/application/canvasAgent';
import { collectAgentNodeIds } from '@/features/agent/application/referenceContext';
import type { AgentDraftRef } from '@/features/agent/domain/types';
import { agentModelCapabilityKey, useAgentSettingsStore } from '@/features/agent/stores/agentSettingsStore';
import { useAgentUiStore } from '@/features/agent/stores/agentUiStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { draftRefFromNode } from './agentDraftRefs';
import { AgentComposer } from './AgentComposer';
import { AgentMessageParts } from './AgentMessageParts';
import { MessageRefChips } from './AgentRefChips';
import { threadModelChoice } from './ModelPickers';
import { useAgentCanvasCamera } from './useAgentCanvasCamera';

function useMessageFocus(threadId: string): string | null {
  const focusRequest = useAgentUiStore((state) => state.focusRequest);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusRequest || focusRequest.threadId !== threadId) return;
    const scrollTimer = window.setTimeout(() => {
      document.getElementById(focusRequest.messageId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightId(focusRequest.messageId);
    }, 320);
    const clearTimer = window.setTimeout(() => setHighlightId(null), 2000);
    return () => { window.clearTimeout(scrollTimer); window.clearTimeout(clearTimer); };
  }, [focusRequest, threadId]);
  return highlightId;
}

/** Frames result nodes on the canvas as they appear during this session (not on reload). */
function useRevealNewResults(messages: CanvasAgentUIMessage[], reveal: (nodeIds: string[]) => void) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = collectAgentNodeIds(messages);
    if (!seen.current) {
      seen.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !seen.current!.has(id));
    fresh.forEach((id) => seen.current!.add(id));
    if (fresh.length) reveal(fresh);
  }, [messages, reveal]);
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useTranslation();
  const prompts = [t('agent.empty.prompt1'), t('agent.empty.prompt2'), t('agent.empty.prompt3')];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.8, rotate: -12 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={SPRING_LAYOUT}
        className="flex size-11 items-center justify-center rounded-2xl bg-foreground text-background"
      >
        <Sparkles className="size-5" />
      </motion.div>
      <div className="flex w-full flex-col gap-2">
        {prompts.map((prompt, index) => (
          <motion.button
            key={prompt}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + index * 0.06, duration: 0.3, ease: EASE_OUT }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onPick(prompt)}
            className="rounded-xl border border-border px-3.5 py-2.5 text-left text-sm text-foreground hover:bg-muted"
          >
            {prompt}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

export function AgentConversation({ chat, thread }: { chat: Chat<CanvasAgentUIMessage>; thread: AgentThreadRecord }) {
  const { t } = useTranslation();
  const { messages, status, error, stop, addToolOutput } = useChat({ chat });
  const { reveal, locate } = useAgentCanvasCamera();
  const highlightId = useMessageFocus(thread.id);
  const [sendError, setSendError] = useState<string | null>(null);
  const choice = threadModelChoice(thread);
  const vision = useAgentSettingsStore((state) => (choice.llm ? state.modelCapabilities[agentModelCapabilityKey(choice.llm)]?.vision : undefined));
  const busy = status === 'submitted' || status === 'streaming';
  useRevealNewResults(messages, reveal);

  // Probe a model the first time it is used; cached verdicts return immediately.
  const llmApiId = choice.llm?.apiId;
  const llmModelId = choice.llm?.modelId;
  useEffect(() => {
    if (!llmApiId || !llmModelId) return;
    ensureAgentModelCapabilities({ apiId: llmApiId, modelId: llmModelId })
      .catch((failure: unknown) => setSendError(t('agent.models.probeFailed', { message: failure instanceof Error ? failure.message : String(failure) })));
  }, [llmApiId, llmModelId, t]);

  const send = async (text: string, refs: AgentDraftRef[]): Promise<boolean> => {
    setSendError(null);
    try {
      const prepared = await prepareAgentMessage(thread.id, text, refs);
      // Not awaited: sendMessage resolves when the reply ends, the draft should clear now.
      void chat.sendMessage({ text: prepared.text, metadata: prepared.metadata });
      return true;
    } catch (failure) {
      setSendError(t('agent.composer.sendFailed', { message: failure instanceof Error ? failure.message : String(failure) }));
      return false;
    }
  };

  const continueFrom = (nodeId: string, index: number) => {
    const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId);
    const ref = node ? draftRefFromNode(node, t('agent.image.resultName', { index: index + 1 })) : null;
    if (ref) useAgentUiStore.getState().addDraftRefs(thread.id, [ref]);
  };

  const lastMessage = messages[messages.length - 1];
  const notice = sendError ?? (error ? t('agent.panel.error', { message: error.message }) : null)
    ?? (vision === false ? t('agent.models.visionUnsupported') : null);

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        {messages.length === 0 ? (
          <EmptyState onPick={(text) => void send(text, [])} />
        ) : (
          <MessageScroller label={t('agent.panel.transcript')} className="h-full" viewportClassName="ui-scrollbar-y px-4 py-4" busy={busy}>
            <MessageGroup spacing="default">
              {messages.map((message) => (message.role === 'user' ? (
                <Message key={message.id} id={message.id} from="user" animateIn>
                  <MessageContent className="items-end gap-1.5">
                    {message.metadata?.refs?.length ? <MessageRefChips refs={message.metadata.refs} /> : null}
                    <MessageBubble variant="solid">
                      <MessageBubbleContent>
                        {message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')}
                      </MessageBubbleContent>
                    </MessageBubble>
                  </MessageContent>
                </Message>
              ) : (
                <Message
                  key={message.id}
                  id={message.id}
                  from="assistant"
                  className={cn('-mx-2 rounded-xl px-2 py-1 transition-colors duration-700', highlightId === message.id && 'bg-muted')}
                >
                  <MessageContent className="w-full gap-3">
                    <AgentMessageParts
                      message={message}
                      streaming={busy && message === lastMessage}
                      interactive={!busy && message === lastMessage}
                      onAnswer={(toolCallId, output) => void addToolOutput({ tool: 'ask_user', toolCallId, output })}
                      onLocate={locate}
                      onContinue={continueFrom}
                    />
                  </MessageContent>
                </Message>
              )))}
            </MessageGroup>
          </MessageScroller>
        )}
      </div>
      {notice ? <p className="shrink-0 px-4 pb-1 text-xs text-muted-foreground">{notice}</p> : null}
      <AgentComposer
        thread={thread}
        busy={busy}
        onSend={send}
        onStop={() => void stop()}
        onModelChange={(next) => void updateAgentThreadModels(thread.id, next)}
      />
    </div>
  );
}
