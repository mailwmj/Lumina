import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';

import { AgentActivity } from '@/components/beui/agents/agent-activity';
import type { AgentActivityItem } from '@/components/beui/agents/agent-activity/types';
import { ApprovalCard, type ApprovalCardAnswers } from '@/components/beui/agents/approval-card';
import { ReasoningText } from '@/components/beui/agents/loading-states';
import { StreamingResponse } from '@/components/beui/agents/streaming-response';
import type { CanvasAgentUIMessage } from '@/features/agent/application/canvasAgent';
import type { AskUserInput, AskUserOutput } from '@/features/agent/domain/agentTools';
import { AgentImageGrid } from './AgentImageGrid';

type Part = CanvasAgentUIMessage['parts'][number];
type ToolPart = Part & { type: `tool-${string}`; toolCallId: string; state: string; input?: unknown; output?: unknown };

const isToolPart = (part: Part): part is ToolPart => part.type.startsWith('tool-');
const isRunning = (part: ToolPart) => part.state === 'input-streaming' || part.state === 'input-available';

function grantedImages(parts: ToolPart[]): number {
  return parts.reduce((total, part) => (
    part.type === 'tool-generate_image' && part.state === 'output-available'
      ? total + ((part.output as { grantedCount?: number }).grantedCount ?? 0)
      : total
  ), 0);
}

function AskUserCard({ part, interactive, onAnswer }: {
  part: ToolPart;
  interactive: boolean;
  onAnswer: (toolCallId: string, answers: AskUserOutput) => void;
}) {
  const { t } = useTranslation();
  const input = part.input as AskUserInput | undefined;
  if (!input?.questions?.length) return null;
  const answered = part.state === 'output-available';
  const output = part.output as AskUserOutput | undefined;
  const summary = answered && output
    ? input.questions.flatMap((question) => {
      const answer = output[question.id];
      const labels = (answer?.selected ?? []).map((value) => question.options?.find((option) => option.value === value)?.label ?? value);
      return [...labels, ...(answer?.custom ? [answer.custom] : [])];
    }).join(' · ')
    : undefined;

  return (
    <ApprovalCard
      title={t('agent.ask.title')}
      questions={input.questions.map((question) => ({ ...question, customPlaceholder: t('agent.ask.customPlaceholder') }))}
      status={answered ? 'answered' : 'pending'}
      onSubmit={interactive && !answered ? (answers: ApprovalCardAnswers) => onAnswer(part.toolCallId, answers as AskUserOutput) : undefined}
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
        },
        dismiss: t('agent.ask.dismiss'),
        previousQuestion: t('agent.ask.previous'),
        nextQuestion: t('agent.ask.next'),
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
  onAnswer: (toolCallId: string, answers: AskUserOutput) => void;
  onLocate: (nodeId: string) => void;
  onContinue: (nodeId: string, index: number) => void;
}) {
  const { t } = useTranslation();
  const toolParts = message.parts.filter(isToolPart);
  const working = streaming && toolParts.some(isRunning);
  const images = grantedImages(toolParts);
  const activityItems: AgentActivityItem[] = toolParts.map((part) => ({
    id: part.toolCallId,
    type: 'step',
    label: t(`agent.activity.${part.type.slice('tool-'.length)}`),
    status: isRunning(part) ? 'active' : 'complete',
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
          summary={images
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
          return <AskUserCard key={key} part={part as ToolPart} interactive={interactive} onAnswer={onAnswer} />;
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
