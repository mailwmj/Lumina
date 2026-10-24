import { BrainCircuit, Image as ImageIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentThreadRecord } from '@/commands/agentThreads';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/beui/motion/select';
import { agentModelCapabilityKey, useAgentSettingsStore, type AgentModelChoice } from '@/features/agent/stores/agentSettingsStore';
import { listConfiguredTextModels } from '@/features/canvas/application/textModelSelection';
import { listConfiguredImageModels } from '@/features/canvas/models/availableModels';
import { useSettingsStore } from '@/stores/settingsStore';

const TRIGGER_CLASS = 'h-8 w-auto min-w-0 max-w-[160px] rounded-xl border-0 bg-transparent px-2 py-0 text-xs hover:bg-muted focus-visible:ring-2';
const SEPARATOR = '\u0000';

export function threadModelChoice(thread: AgentThreadRecord): AgentModelChoice {
  return {
    llm: thread.llmApiId && thread.llmModelId ? { apiId: thread.llmApiId, modelId: thread.llmModelId } : null,
    imageModelId: thread.imageModelId,
  };
}

export function ModelPickers({ thread, disabled, onChange }: {
  thread: AgentThreadRecord;
  disabled: boolean;
  onChange: (choice: AgentModelChoice) => void;
}) {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<'llm' | 'image' | null>(null);
  const textApis = useSettingsStore((state) => state.textApis);
  const openAiImageApi = useSettingsStore((state) => state.openAiImageApi);
  const chaomoImageApi = useSettingsStore((state) => state.chaomoImageApi);
  const customImageApis = useSettingsStore((state) => state.customImageApis);
  const capabilities = useAgentSettingsStore((state) => state.modelCapabilities);
  const textModels = useMemo(() => listConfiguredTextModels(textApis), [textApis]);
  const imageModels = useMemo(
    () => listConfiguredImageModels({ openAiImageApi, chaomoImageApi, customImageApis }),
    [chaomoImageApi, customImageApis, openAiImageApi],
  );
  const choice = threadModelChoice(thread);
  const llmValue = choice.llm ? `${choice.llm.apiId}${SEPARATOR}${choice.llm.modelId}` : '';
  const llmLabel = textModels.find((model) => model.apiId === choice.llm?.apiId && model.modelId === choice.llm?.modelId);
  const imageLabel = imageModels.find((model) => model.id === choice.imageModelId);

  return (
    <div className="flex min-w-0 items-center">
      <Select
        value={llmValue}
        onValueChange={(value) => {
          const [apiId, modelId] = value.split(SEPARATOR);
          onChange({ ...choice, llm: { apiId, modelId } });
        }}
        disabled={disabled || textModels.length === 0}
        open={openId === 'llm'}
        onOpenChange={(open) => setOpenId(open ? 'llm' : null)}
        className="min-w-0"
      >
        <SelectTrigger className={TRIGGER_CLASS}>
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <BrainCircuit className="size-3.5 shrink-0" />
            <span className="truncate">{llmLabel?.modelId ?? t(textModels.length ? 'agent.models.chooseModel' : 'agent.models.noTextModel')}</span>
          </span>
        </SelectTrigger>
        <SelectContent className="right-auto w-64 shadow-none">
          {textModels.map((model) => {
            const noTools = capabilities[agentModelCapabilityKey(model)]?.tools === false;
            return (
              <SelectItem key={`${model.apiId}${SEPARATOR}${model.modelId}`} value={`${model.apiId}${SEPARATOR}${model.modelId}`} disabled={noTools} className="py-2">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate text-sm text-foreground">{model.modelId}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{noTools ? t('agent.models.noToolSupport') : model.apiName}</span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <Select
        value={choice.imageModelId ?? ''}
        onValueChange={(imageModelId) => onChange({ ...choice, imageModelId })}
        disabled={disabled || imageModels.length === 0}
        open={openId === 'image'}
        onOpenChange={(open) => setOpenId(open ? 'image' : null)}
        className="min-w-0"
      >
        <SelectTrigger className={TRIGGER_CLASS}>
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <ImageIcon className="size-3.5 shrink-0" />
            <span className="truncate">{imageLabel?.displayName ?? t(imageModels.length ? 'agent.models.chooseModel' : 'agent.models.noImageModel')}</span>
          </span>
        </SelectTrigger>
        <SelectContent className="right-auto w-56 shadow-none">
          {imageModels.map((model) => (
            <SelectItem key={model.id} value={model.id} className="py-2">
              <span className="truncate text-sm text-foreground">{model.displayName}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
