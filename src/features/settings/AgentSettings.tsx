import { useTranslation } from 'react-i18next';

import { UiSelect } from '@/components/ui';
import {
  AGENT_MAX_IMAGES_LIMIT,
  useAgentSettingsStore,
} from '@/features/agent/stores/agentSettingsStore';
import { TEXT_REASONING_EFFORTS, type TextReasoningEffort } from '@/features/canvas/models/types';
import { SettingsTextInput } from '@/features/settings/SettingsTextField';

export function AgentSettings() {
  const { t } = useTranslation();
  const maxImagesPerTurn = useAgentSettingsStore((state) => state.maxImagesPerTurn);
  const reasoningEffort = useAgentSettingsStore((state) => state.reasoningEffort);
  const setMaxImagesPerTurn = useAgentSettingsStore((state) => state.setMaxImagesPerTurn);
  const setReasoningEffort = useAgentSettingsStore((state) => state.setReasoningEffort);

  return (
    <div className="grid gap-3 py-4 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-dark">
          {t('settings.agentMaxImagesPerTurn')}
        </span>
        <SettingsTextInput
          type="number"
          min={1}
          max={AGENT_MAX_IMAGES_LIMIT}
          value={String(maxImagesPerTurn)}
          onCommit={(value) => setMaxImagesPerTurn(Number(value))}
          className="h-9 w-full text-sm"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-dark">
          {t('settings.textApiReasoningEffort')}
        </span>
        <UiSelect
          value={reasoningEffort ?? ''}
          onChange={(event) => setReasoningEffort(
            event.target.value ? event.target.value as TextReasoningEffort : null
          )}
          className="h-9 w-full text-sm"
        >
          <option value="">{t('node.textModel.reasoningDefault')}</option>
          {TEXT_REASONING_EFFORTS.map((effort) => (
            <option key={effort} value={effort}>
              {t(`node.textModel.reasoning.${effort}`)}
            </option>
          ))}
        </UiSelect>
      </label>
    </div>
  );
}
