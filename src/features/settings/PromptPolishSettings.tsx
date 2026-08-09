import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  listConfiguredTextModels,
  resolveEnabledTextModelSelection,
} from '@/features/canvas/application/textModelSelection';
import {
  TEXT_REASONING_EFFORTS,
  type TextReasoningEffort,
} from '@/features/canvas/models/types';
import {
  DEFAULT_TEXT_API_PROMPT,
  DEFAULT_VIDEO_SD10_POLISH_PROMPT,
  DEFAULT_VIDEO_SD15_PROMPT,
  type TextApiConfig,
  type VideoApiConfig,
} from '@/stores/settingsStore';

interface PromptPolishSettingsProps {
  textApis: TextApiConfig[];
  reasoningEffort: TextReasoningEffort | null;
  imagePrompt: string;
  videoApis: VideoApiConfig[];
  onTextApisChange: (apis: TextApiConfig[]) => void;
  onReasoningEffortChange: (effort: TextReasoningEffort | null) => void;
  onImagePromptChange: (prompt: string) => void;
  onVideoApisChange: (apis: VideoApiConfig[]) => void;
}

function textModelValue(apiId: string, modelId: string): string {
  return JSON.stringify([apiId, modelId]);
}

function defaultVideoPolishPrompt(api: VideoApiConfig): string {
  if (api.defaultPolishPrompt) {
    return api.defaultPolishPrompt;
  }
  return api.modelId.includes('1-5-pro')
    ? DEFAULT_VIDEO_SD15_PROMPT
    : DEFAULT_VIDEO_SD10_POLISH_PROMPT;
}

export function PromptPolishSettings({
  textApis,
  reasoningEffort,
  imagePrompt,
  videoApis,
  onTextApisChange,
  onReasoningEffortChange,
  onImagePromptChange,
  onVideoApisChange,
}: PromptPolishSettingsProps) {
  const { t } = useTranslation();
  const textModels = useMemo(() => listConfiguredTextModels(textApis), [textApis]);
  const selectedTextModel = useMemo(
    () => resolveEnabledTextModelSelection(textApis),
    [textApis]
  );
  const [selectedVideoApiId, setSelectedVideoApiId] = useState(videoApis[0]?.id ?? '');

  useEffect(() => {
    if (!videoApis.some((api) => api.id === selectedVideoApiId)) {
      setSelectedVideoApiId(videoApis[0]?.id ?? '');
    }
  }, [selectedVideoApiId, videoApis]);

  const selectedVideoApi = videoApis.find((api) => api.id === selectedVideoApiId) ?? null;
  const selectedTextModelValue = selectedTextModel
    ? textModelValue(selectedTextModel.apiId, selectedTextModel.modelId)
    : '';

  const updateVideoApi = (next: VideoApiConfig) => {
    onVideoApisChange(videoApis.map((api) => api.id === next.id ? next : api));
  };

  return (
    <>
      <section className="border-b border-[var(--ui-border-soft)] py-4">
        <h3 className="text-sm font-medium text-text-dark">
          {t('settings.promptPolishRuntime')}
        </h3>
        <p className="mt-1 text-xs text-text-muted">
          {t('settings.promptPolishRuntimeDesc')}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-dark">
              {t('settings.promptPolishModel')}
            </span>
            <select
              value={selectedTextModelValue}
              onChange={(event) => {
                const selected = textModels.find((model) =>
                  textModelValue(model.apiId, model.modelId) === event.target.value
                );
                if (!selected) return;
                onTextApisChange(textApis.map((api) => ({
                  ...api,
                  enabled: api.id === selected.apiId,
                  ...(api.id === selected.apiId ? { modelId: selected.modelId } : {}),
                })));
              }}
              disabled={textModels.length === 0}
              className="h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark disabled:opacity-50"
            >
              {!selectedTextModel && (
                <option value="">{t('settings.promptPolishModelEmpty')}</option>
              )}
              {textModels.map((model) => (
                <option
                  key={textModelValue(model.apiId, model.modelId)}
                  value={textModelValue(model.apiId, model.modelId)}
                >
                  {model.apiName} / {model.modelId}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-dark">
              {t('settings.textApiReasoningEffort')}
            </span>
            <select
              value={reasoningEffort ?? ''}
              onChange={(event) => onReasoningEffortChange(
                event.target.value ? event.target.value as TextReasoningEffort : null
              )}
              className="h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark"
            >
              <option value="">{t('node.textModel.reasoningDefault')}</option>
              {TEXT_REASONING_EFFORTS.map((effort) => (
                <option key={effort} value={effort}>
                  {t(`node.textModel.reasoning.${effort}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="border-b border-[var(--ui-border-soft)] py-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-text-dark">
              {t('settings.imagePolishPromptTemplate')}
            </h3>
            <p className="mt-1 text-xs text-text-muted">
              {t('settings.imagePolishPromptPlaceholder')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onImagePromptChange(DEFAULT_TEXT_API_PROMPT)}
            className="shrink-0 text-xs text-accent hover:underline"
          >
            {t('common.restoreDefault')}
          </button>
        </div>
        <textarea
          value={imagePrompt}
          onChange={(event) => onImagePromptChange(event.target.value)}
          rows={8}
          className="w-full resize-y rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark"
        />
      </section>

      <section className="py-4">
        <div className="mb-3 flex items-end justify-between gap-3">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-sm font-medium text-text-dark">
              {t('settings.videoPolishPromptTemplate')}
            </span>
            <select
              value={selectedVideoApiId}
              onChange={(event) => setSelectedVideoApiId(event.target.value)}
              disabled={videoApis.length === 0}
              className="h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark disabled:opacity-50"
            >
              {videoApis.length === 0 && <option value="">-</option>}
              {videoApis.map((api) => (
                <option key={api.id} value={api.id}>{api.name} / {api.modelId}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!selectedVideoApi}
            onClick={() => selectedVideoApi && updateVideoApi({
              ...selectedVideoApi,
              polishPrompt: defaultVideoPolishPrompt(selectedVideoApi),
            })}
            className="mb-2 shrink-0 text-xs text-accent hover:underline disabled:opacity-50"
          >
            {t('common.restoreDefault')}
          </button>
        </div>
        {selectedVideoApi ? (
          <textarea
            value={selectedVideoApi.polishPrompt ?? ''}
            onChange={(event) => updateVideoApi({
              ...selectedVideoApi,
              polishPrompt: event.target.value,
            })}
            rows={8}
            placeholder={t('settings.videoPolishPromptPlaceholder')}
            className="w-full resize-y rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark placeholder:text-text-muted"
          />
        ) : (
          <p className="text-xs text-text-muted">{t('settings.noVideoApisConfigured')}</p>
        )}
      </section>
    </>
  );
}
