import { Check, ChevronDown, Copy, CornerDownLeft } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ImageGeneration, type ImageGenerationStatus } from '@/components/beui/agents/image-generation';
import { EASE_OUT, SPRING_PRESS } from '@/components/beui/lib/ease';
import { cn } from '@/components/beui/lib/utils';
import { readAgentImageState } from '@/features/agent/application/agentImageState';
import type { GenerateImageInput, GenerateImageOutput } from '@/features/agent/domain/agentTools';
import type { AgentImageStatus } from '@/features/agent/domain/types';
import { showErrorDialog } from '@/features/canvas/application/errorDialog';
import { ImageGenerationRunError } from '@/features/canvas/application/imageGenerationRun';
import { retryImageGenerationResult } from '@/features/canvas/application/imageGenerationRetry';
import { useCanvasStore } from '@/stores/canvasStore';
import { nodeThumbnail } from './agentDraftRefs';

const CARD_STATUS: Record<AgentImageStatus, ImageGenerationStatus> = {
  generating: 'generating',
  ready: 'complete',
  failed: 'error',
  missing: 'error',
};

const RETRY_ERROR_KEYS: Record<string, string> = {
  MODEL_REQUIRED: 'node.imageEdit.modelRequired',
  API_KEY_REQUIRED: 'node.imageEdit.apiKeyRequired',
  PROMPT_REQUIRED: 'node.imageEdit.promptRequired',
  REFERENCE_IMAGES_UNAVAILABLE: 'node.textGeneration.imageUnavailable',
  SOURCE_NODE_NOT_FOUND: 'node.imageNode.retrySourceMissing',
  ALREADY_RUNNING: 'node.imageNode.sourceBusy',
};

interface GenerateImagePart {
  state: string;
  input?: Partial<GenerateImageInput>;
  output?: GenerateImageOutput;
}

/** Cards read the result nodes' live state, so restarts, retries and manual edits show up here. */
export function AgentImageGrid({ part, onLocate, onContinue }: {
  part: GenerateImagePart;
  onLocate: (nodeId: string) => void;
  onContinue: (nodeId: string, index: number) => void;
}) {
  const { t } = useTranslation();
  const nodes = useCanvasStore((state) => state.nodes);
  const [promptOpen, setPromptOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const output = part.output;
  const prompt = part.input?.prompt ?? '';

  if (output && output.status !== 'completed') {
    return <p className="text-xs text-muted-foreground">{output.status === 'refused' ? t('agent.image.refused') : output.error}</p>;
  }

  const placeholders = Math.max(1, part.input?.count ?? 1);
  const cards = output
    ? output.results.map((result) => readAgentImageState(nodes, result.nodeId))
    : Array.from({ length: placeholders }, (_, index) => ({ nodeId: `pending-${index}`, status: 'generating' as const, error: undefined }));
  const single = cards.length === 1;

  const retry = async (nodeId: string) => {
    try {
      await retryImageGenerationResult(nodeId, { fallbackResultTitle: t('node.imageEdit.resultTitle'), fallbackErrorMessage: t('ai.error') });
    } catch (failure) {
      const code = failure instanceof ImageGenerationRunError ? failure.code : '';
      void showErrorDialog(t(RETRY_ERROR_KEYS[code] ?? 'node.imageNode.retryUnavailable'), t('common.error'));
    }
  };

  return (
    <div className="w-full min-w-0 space-y-2">
      <div className={cn('grid gap-2', single ? 'max-w-[300px] grid-cols-1' : 'grid-cols-2')}>
        {cards.map((card, index) => {
          const thumbnail = card.status === 'ready' ? nodeThumbnail(nodes.find((node) => node.id === card.nodeId)) : null;
          const statusText = card.status === 'failed' ? card.error ?? t('agent.image.failed') : t(`agent.image.${card.status}`);
          return (
            <div key={card.nodeId} className="group relative min-w-0">
              <div
                onClick={() => card.status === 'ready' && onLocate(card.nodeId)}
                className={cn('rounded-xl', card.status === 'ready' && 'cursor-pointer')}
              >
                <ImageGeneration
                  status={CARD_STATUS[card.status]}
                  aspectRatio={(part.input?.aspectRatio ?? '1:1').replace(':', ' / ')}
                  size="fluid"
                  resolution=""
                  statusText={statusText}
                  retryLabel={t('agent.image.retry')}
                  onRetry={card.status === 'failed' ? () => void retry(card.nodeId) : undefined}
                >
                  {thumbnail ? <img src={thumbnail} alt="" className="size-full object-cover" /> : null}
                </ImageGeneration>
              </div>
              {!single ? (
                <span className="pointer-events-none absolute left-2 top-2 z-10 grid size-5 place-items-center rounded-full bg-background/80 text-[11px] font-medium tabular-nums text-foreground">
                  {index + 1}
                </span>
              ) : null}
              {card.status === 'ready' ? (
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.94 }}
                  transition={SPRING_PRESS}
                  onClick={() => onContinue(card.nodeId, index)}
                  className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-sm transition-opacity hover:bg-background focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <CornerDownLeft className="size-3" />
                  {t('agent.image.continue')}
                </motion.button>
              ) : null}
            </div>
          );
        })}
      </div>
      {prompt ? (
        <button
          type="button"
          onClick={() => setPromptOpen((value) => !value)}
          className="flex w-full items-start gap-1 text-left text-xs leading-5 text-muted-foreground hover:text-foreground"
        >
          <span className={cn('min-w-0 flex-1', !promptOpen && 'truncate')}>{prompt}</span>
          <motion.span animate={{ rotate: promptOpen ? 180 : 0 }} transition={SPRING_PRESS} className="mt-0.5 shrink-0">
            <ChevronDown className="size-3.5" />
          </motion.span>
        </button>
      ) : null}
      <AnimatePresence initial={false}>
        {promptOpen ? (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: EASE_OUT }}>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(prompt);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              }}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? t('agent.image.copied') : t('agent.image.copyPrompt')}
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
