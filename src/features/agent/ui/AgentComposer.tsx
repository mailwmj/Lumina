import { AtSign, ImagePlus } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { type ClipboardEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentThreadRecord } from '@/commands/agentThreads';
import { PromptInput } from '@/components/beui/agents/prompt-input';
import { cn } from '@/components/beui/lib/utils';
import { AGENT_MAX_DRAFT_REFS, type AgentDraftRef } from '@/features/agent/domain/types';
import type { AgentModelChoice } from '@/features/agent/stores/agentSettingsStore';
import { getAgentDraft, useAgentUiStore } from '@/features/agent/stores/agentUiStore';
import { readImageFiles } from './agentDraftRefs';
import { DraftRefChips } from './AgentRefChips';
import { CanvasImagePicker } from './CanvasImagePicker';
import { ModelPickers } from './ModelPickers';

export function AgentComposer({ thread, busy, onSend, onStop, onModelChange }: {
  thread: AgentThreadRecord;
  busy: boolean;
  /** Resolves true once sent; the draft is kept when sending fails. */
  onSend: (text: string, refs: AgentDraftRef[]) => Promise<boolean>;
  onStop: () => void;
  onModelChange: (choice: AgentModelChoice) => void;
}) {
  const { t } = useTranslation();
  const draft = useAgentUiStore((state) => getAgentDraft(state, thread.id));
  const { setDraftText, addDraftRefs, removeDraftRef, clearDraft } = useAgentUiStore.getState();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickerDismissed, setPickerDismissed] = useState(false);
  const pickerOpen = draft.text.endsWith('@') && !pickerDismissed;
  const full = draft.refs.length >= AGENT_MAX_DRAFT_REFS;

  const addFiles = async (files: Iterable<File>) => {
    addDraftRefs(thread.id, await readImageFiles(files, t('agent.composer.pastedImage')));
  };
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    void addFiles(files);
  };

  return (
    <div className={cn('relative shrink-0 space-y-2 px-3 pb-3', draft.refs.length ? 'pt-1' : 'pt-0')}>
      <DraftRefChips refs={draft.refs} onRemove={(id) => removeDraftRef(thread.id, id)} />
      <div className="relative">
        <AnimatePresence>
          {pickerOpen ? (
            <CanvasImagePicker
              excludedNodeIds={new Set(draft.refs.flatMap((ref) => ref.nodeId ?? []))}
              onPick={(ref) => {
                addDraftRefs(thread.id, [ref]);
                setDraftText(thread.id, draft.text.slice(0, -1));
              }}
            />
          ) : null}
        </AnimatePresence>
        <PromptInput
          placeholder={t('agent.composer.placeholder')}
          labels={{
            addToPrompt: t('agent.composer.addToPrompt'),
            chooseModel: t('agent.models.chooseModel'),
            send: t('agent.composer.send'),
            stop: t('agent.composer.stop'),
          }}
          aria-label={t('agent.composer.placeholder')}
          value={draft.text}
          onValueChange={(text) => { setDraftText(thread.id, text); setPickerDismissed(false); }}
          loading={busy}
          onSubmit={async (text) => {
            if (await onSend(text, draft.refs)) clearDraft(thread.id);
          }}
          onStop={onStop}
          onPaste={handlePaste}
          onKeyDown={(event) => {
            if (pickerOpen && event.key === 'Escape') {
              event.preventDefault();
              setPickerDismissed(true);
            }
          }}
          actions={[
            { value: 'upload', label: t('agent.composer.upload'), icon: <ImagePlus />, disabled: full },
            { value: 'canvas', label: t('agent.composer.pickFromCanvas'), icon: <AtSign />, disabled: full },
          ]}
          onAction={(action) => {
            if (action === 'upload') fileInputRef.current?.click();
            if (action === 'canvas') {
              setDraftText(thread.id, `${draft.text}@`);
              setPickerDismissed(false);
            }
          }}
          leadingAction={<ModelPickers thread={thread} disabled={busy} onChange={onModelChange} />}
          minRows={1}
          maxRows={6}
        />
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) void addFiles(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
