import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { UiSelect } from '@/components/ui';
import { listConfiguredTextModels } from '@/features/canvas/application/textModelSelection';
import { SettingsTextArea } from '@/features/settings/SettingsTextField';
import {
  TEXT_REASONING_EFFORTS,
  type TextReasoningEffort,
} from '@/features/canvas/models/types';
import {
  DEFAULT_IMAGE_POLISH_PROMPT,
  DEFAULT_TEXT_POLISH_PROMPT,
  type PromptPolishConfig,
  type TextApiConfig,
} from '@/stores/settingsStore';

interface PromptPolishSettingsProps {
  textApis: TextApiConfig[];
  imagePolishConfig: PromptPolishConfig;
  textPolishConfig: PromptPolishConfig;
  onImagePolishConfigChange: (config: PromptPolishConfig) => void;
  onTextPolishConfigChange: (config: PromptPolishConfig) => void;
}

interface PolishProfileSectionProps {
  title: string;
  description: string;
  templateTitle: string;
  templateDescription: string;
  defaultPrompt: string;
  textApis: TextApiConfig[];
  config: PromptPolishConfig;
  onChange: (config: PromptPolishConfig) => void;
}

function textModelValue(apiId: string, modelId: string): string {
  return JSON.stringify([apiId, modelId]);
}

function PolishProfileSection({
  title,
  description,
  templateTitle,
  templateDescription,
  defaultPrompt,
  textApis,
  config,
  onChange,
}: PolishProfileSectionProps) {
  const { t } = useTranslation();
  const textModels = useMemo(() => listConfiguredTextModels(textApis), [textApis]);
  const hasExplicitSelection = Boolean(config.textApiId || config.textModelId);
  const selectedValue = config.textApiId && config.textModelId
    ? textModelValue(config.textApiId, config.textModelId)
    : '';
  const hasUnavailableSelection = hasExplicitSelection && !textModels.some((model) =>
    model.apiId === config.textApiId && model.modelId === config.textModelId
  );
  const unavailableLabel = t('node.textModel.unavailable', {
    apiId: config.textApiId || '—',
    modelId: config.textModelId || '—',
  });

  return (
    <section className="border-b border-[var(--ui-border-soft)] py-4">
      <h3 className="text-sm font-medium text-text-dark">{title}</h3>
      <p className="mt-1 text-xs text-text-muted">{description}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-dark">
            {t('settings.promptPolishModel')}
          </span>
          <UiSelect
            value={selectedValue}
            onChange={(event) => {
              const selected = textModels.find((model) =>
                textModelValue(model.apiId, model.modelId) === event.target.value
              );
              if (!selected) return;
              onChange({
                ...config,
                textApiId: selected.apiId,
                textModelId: selected.modelId,
              });
            }}
            disabled={textModels.length === 0}
            className="h-9 w-full text-sm disabled:opacity-50"
          >
            {(!hasExplicitSelection || hasUnavailableSelection) && (
              <option value={selectedValue} disabled>
                {hasUnavailableSelection
                  ? unavailableLabel
                  : t('settings.promptPolishModelEmpty')}
              </option>
            )}
            {textModels.map((model) => (
              <option
                key={textModelValue(model.apiId, model.modelId)}
                value={textModelValue(model.apiId, model.modelId)}
              >
                {model.apiName} / {model.modelId}
              </option>
            ))}
          </UiSelect>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-dark">
            {t('settings.textApiReasoningEffort')}
          </span>
          <UiSelect
            value={config.reasoningEffort ?? ''}
            onChange={(event) => onChange({
              ...config,
              reasoningEffort: event.target.value
                ? event.target.value as TextReasoningEffort
                : null,
            })}
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

      <div className="mb-2 mt-4 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-xs font-medium text-text-dark">{templateTitle}</h4>
          <p className="mt-1 text-xs text-text-muted">{templateDescription}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...config, prompt: defaultPrompt })}
          className="shrink-0 text-xs text-accent hover:underline"
        >
          {t('common.restoreDefault')}
        </button>
      </div>
      <SettingsTextArea
        value={config.prompt}
        onCommit={(prompt) => onChange({ ...config, prompt })}
        rows={7}
      />
    </section>
  );
}

export function PromptPolishSettings({
  textApis,
  imagePolishConfig,
  textPolishConfig,
  onImagePolishConfigChange,
  onTextPolishConfigChange,
}: PromptPolishSettingsProps) {
  const { t } = useTranslation();

  return (
    <>
      <PolishProfileSection
        title={t('settings.imagePolish')}
        description={t('settings.imagePolishDesc')}
        templateTitle={t('settings.imagePolishPromptTemplate')}
        templateDescription={t('settings.imagePolishPromptPlaceholder')}
        defaultPrompt={DEFAULT_IMAGE_POLISH_PROMPT}
        textApis={textApis}
        config={imagePolishConfig}
        onChange={onImagePolishConfigChange}
      />

      <PolishProfileSection
        title={t('settings.textPolish')}
        description={t('settings.textPolishDesc')}
        templateTitle={t('settings.textPolishPromptTemplate')}
        templateDescription={t('settings.textPolishPromptPlaceholder')}
        defaultPrompt={DEFAULT_TEXT_POLISH_PROMPT}
        textApis={textApis}
        config={textPolishConfig}
        onChange={onTextPolishConfigChange}
      />

      <p className="py-4 text-xs text-text-muted">{t('settings.videoPolishMovedHint')}</p>
    </>
  );
}
