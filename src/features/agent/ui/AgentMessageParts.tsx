import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';

import { AgentActivity } from '@/components/beui/agents/agent-activity';
import type { AgentActivityItem } from '@/components/beui/agents/agent-activity/types';
import { ApprovalCard, type ApprovalCardAnswers } from '@/components/beui/agents/approval-card';
import { ReasoningText } from '@/components/beui/agents/loading-states';
import { StreamingResponse } from '@/components/beui/agents/streaming-response';
import { readAgentImageState } from '@/features/agent/application/agentImageState';
import type { CanvasAgentUIMessage } from '@/features/agent/application/canvasAgent';
import type { AskUserAnswers, AskUserInput, AskUserOutput, GenerateImageOutput } from '@/features/agent/domain/agentTools';
import { useCanvasStore } from '@/stores/canvasStore';
import { AgentImageGrid } from './AgentImageGrid';

type Part = CanvasAgentUIMessage['parts'][number];
type ToolPart = Part & { type: `tool-${string}`; toolCallId: string; state: string; input?: unknown; output?: unknown };

const isToolPart = (part: Part): part is ToolPart => part.type.startsWith('tool-');
const isRunning = (part: ToolPart) => part.state === 'input-streaming' || part.state === 'input-available';
const isUnansweredQuestion = (part: ToolPart) => part.type === 'tool-ask_user' && part.state === 'input-available';

const isAnswers = (output: AskUserOutput | undefined): output is AskUserAnswers => Boolean(output) && !('status' in output!);

/** Counts results that are on the canvas now, so failures and later retries are reflected. */
function useReadyImageCount(parts: ToolPart[]): number {
  const nodeIds = parts.flatMap((part) => {
    const output = part.type === 'tool-generate_image' ? part.output as GenerateImageOutput | undefined : undefined;
    return output?.status === 'completed' ? output.results.map((result) => result.nodeId) : [];
  });
  return useCanvasStore((state) => nodeIds.filter((nodeId) => readAgentImageState(state.nodes, nodeId).status === 'ready').length);
}

function AskUserCard({ part, interactive, stale, onAnswer }: {
  part: ToolPart;
  interactive: boolean;
  /** The conversation moved on without an answer. */
  stale: boolean;
  onAnswer: (toolCallId: string, answers: AskUserAnswers) => void;
}) {
  const { t } = useTranslation();
  const input = part.input as AskUserInput | undefined;
  if (!input?.questions?.length) return null;
  const output = part.output as AskUserOutput | undefined;
  const answers = part.state === 'output-available' && isAnswers(output) ? output : undefined;
  const answered = Boolean(answers);
  const summary = answers
    ? input.questions.flatMap((question) => {
      const answer = answers[question.id];
      const labels = (answer?.selected ?? []).map((value) => question.options?.find((option) => option.value === value)?.label ?? value);
      return [...labels, ...(answer?.custom ? [answer.custom] : [])];
    }).join(' · ')
    : undefined;

  return (
    <ApprovalCard
      title={t('agent.ask.title')}
      // Free text is always offered, whatever the model asked for.
      questions={input.questions.map((question) => ({ ...question, allowCustom: true }))}
      status={answered ? 'answered' : stale ? 'skipped' : 'pending'}
      onSubmit={interactive && !answered ? (answers: ApprovalCardAnswers) => onAnswer(part.toolCallId, answers) : undefined}
      submitLabel={t('agent.ask.submit')}
      result={summary}
      labels={{
        status: {
          pending: t('agent.ask.pending'),
          submitting: t('agent.ask.submitting'),
          answered: t('agent.ask.answered'),
          approved: t('agent.ask.answered'),
          rejected: t('agent.ask.answered'),
          'changes-requested': t('agent.ask.answered'),
          skipped: t('agent.ask.skipped'),
        },
        dismiss: t('agent.ask.dismiss'),
        previousQuestion: t('agent.ask.previous'),
        nextQuestion: t('agent.ask.next'),
        customOption: t('agent.ask.customOption'),
        customPlaceholder: t('agent.ask.customPlaceholder'),
      }}
    />
  );
}

export function AgentMessageParts({ message, streaming, interactive, onAnswer, onLocate, onContinue }: {
  message: CanvasAgentUIMessage;
  /** This message is the one currently being generated. */
  streaming: boolean;
  /** ask_user can still be answered (last message, agent idle). */
  interactive: boolean;
  onAnswer: (toolCallId: string, answers: AskUserAnswers) => void;
  onLocate: (nodeId: string) => void;
  onContinue: (nodeId: string, index: number) => void;
}) {
  const { t } = useTranslation();
  const toolParts = message.parts.filter(isToolPart);
  const working = streaming && toolParts.some(isRunning);
  const awaitingAnswer = interactive && toolParts.some(isUnansweredQuestion);
  const images = useReadyImageCount(toolParts);
  const activityItems: AgentActivityItem[] = toolParts.map((part) => ({
    id: part.toolCallId,
    type: 'step',
    label: t(`agent.activity.${part.type.slice('tool-'.length)}`),
    status: isUnansweredQuestion(part) && !streaming ? 'pending' : isRunning(part) ? 'active' : 'complete',
  }));
  const lastPart = message.parts[message.parts.length - 1];
  const thinking = streaming && (!lastPart || lastPart.type === 'reasoning' || lastPart.type === 'step-start');

  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      {activityItems.length ? (
        <AgentActivity
          items={activityItems}
          status={working ? 'working' : 'complete'}
          collapseOnComplete
          activeLabel={t('agent.activity.working')}
          summary={awaitingAnswer
            ? t('agent.activity.awaitingAnswer')
            : images
            ? t('agent.activity.summaryWithImages', { steps: activityItems.length, images })
            : t('agent.activity.summary', { count: activityItems.length })}
        />
      ) : null}
      {message.parts.map((part, index) => {
        const key = `${message.id}-${index}`;
        if (part.type === 'text' && part.text.trim()) {
          return (
            <StreamingResponse key={key} status={streaming && part.state === 'streaming' ? 'streaming' : 'complete'} contentClassName="text-sm leading-6">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
            </StreamingResponse>
          );
        }
        if (part.type === 'tool-generate_image') {
          return <AgentImageGrid key={key} part={part as never} onLocate={onLocate} onContinue={onContinue} />;
        }
        if (part.type === 'tool-ask_user') {
          return <AskUserCard key={key} part={part as ToolPart} interactive={interactive} stale={!interactive && !streaming} onAnswer={onAnswer} />;
        }
        return null;
      })}
      {thinking ? (
        <ReasoningText
          phrases={[t('agent.activity.thinking1'), t('agent.activity.thinking2'), t('agent.activity.thinking3')]}
          variant="cascade"
          className="text-sm"
        />
      ) : null}
    </div>
  );
}
