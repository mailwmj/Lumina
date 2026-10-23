import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { UiTooltip } from '@/components/ui';
import { Eye, EyeOff } from '@/components/ui/icons';
import { videoProviderHealth } from '@/features/settings/application/settingsHealth';
import { ProviderDetailSection } from '@/features/settings/providers/ProviderDetailParts';
import { ProviderListShell } from '@/features/settings/providers/ProviderListShell';
import { SettingsCheckboxCard } from '@/features/settings/SettingsCheckboxCard';
import { SettingsTextArea, SettingsTextInput } from '@/features/settings/SettingsTextField';
import {
  DEFAULT_VIDEO_SD10_POLISH_PROMPT,
  DEFAULT_VIDEO_SD15_PROMPT,
  type VideoApiConfig,
} from '@/stores/settingsStore';

interface VideoApisSettingsProps {
  apis: VideoApiConfig[];
  onChange: (apis: VideoApiConfig[]) => void;
  onDetailChange?: (isOpen: boolean) => void;
}

function createCustomVideoApiConfig(): VideoApiConfig {
  return {
    id: `custom-video-${crypto.randomUUID()}`,
    name: '',
    apiKey: '',
    baseUrl: '',
    modelId: 'custom-video-model',
    enabled: false,
    protocol: 'volcengine-seedance',
    defaultPolishPrompt: DEFAULT_VIDEO_SD10_POLISH_PROMPT,
  };
}

function defaultVideoPolishPrompt(api: VideoApiConfig): string {
  if (api.defaultPolishPrompt) {
    return api.defaultPolishPrompt;
  }
  return api.modelId.includes('1-5-pro')
    ? DEFAULT_VIDEO_SD15_PROMPT
    : DEFAULT_VIDEO_SD10_POLISH_PROMPT;
}

export function VideoApisSettings({ apis, onChange, onDetailChange }: VideoApisSettingsProps) {
  const { t } = useTranslation();
  const [revealedApiIds, setRevealedApiIds] = useState<Set<string>>(() => new Set());

  const updateApi = (id: string, next: VideoApiConfig) => {
    onChange(apis.map((api) => (api.id === id ? next : api)));
  };

  const toggleApiKey = (apiId: string) => {
    setRevealedApiIds((current) => {
      const next = new Set(current);
      if (next.has(apiId)) next.delete(apiId);
      else next.add(apiId);
      return next;
    });
  };

  return (
    <ProviderListShell<VideoApiConfig>
      items={apis}
      getItemId={(api) => api.id}
      getItemTitle={(api) => api.name || t('settings.videoApiName')}
      getItemHealth={videoProviderHealth}
      getItemMeta={(api) => api.modelId || undefined}
      onAdd={() => {
        const config = createCustomVideoApiConfig();
        onChange([...apis, config]);
        return config.id;
      }}
      onRemove={(id) => onChange(apis.filter((api) => api.id !== id))}
      onRestore={(api, index) => {
        const next = [...apis];
        next.splice(index, 0, api);
        onChange(next);
      }}
      onDetailChange={onDetailChange}
      renderDetail={(api) => {
        const isRevealed = revealedApiIds.has(api.id);
        return (
          <div className="space-y-5">
            <ProviderDetailSection title={t('settings.providerSectionConnection')}>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-dark">
                  {t('settings.videoApiName')}
                </span>
                <SettingsTextInput
                  value={api.name}
                  onCommit={(name) => updateApi(api.id, { ...api, name })}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-dark">
                  {t('settings.videoApiBaseUrl')}
                </span>
                <SettingsTextInput
                  value={api.baseUrl}
                  onCommit={(baseUrl) => updateApi(api.id, { ...api, baseUrl })}
                  placeholder="https://ai.yunxinapi.com/hub/volcengine"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-dark">
                  {t('settings.videoApiKey')}
                </span>
                <div className="relative">
                  <SettingsTextInput
                    type={isRevealed ? 'text' : 'password'}
                    value={api.apiKey}
                    onCommit={(apiKey) => updateApi(api.id, { ...api, apiKey })}
                    placeholder={t('settings.enterApiKey')}
                    className="pr-10"
                  />
                  <UiTooltip content={isRevealed ? t('settings.hideApiKey') : t('settings.showApiKey')}>
                    <button
                      type="button"
                      aria-label={isRevealed ? t('settings.hideApiKey') : t('settings.showApiKey')}
                      onClick={() => toggleApiKey(api.id)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-[var(--ui-hover)]"
                    >
                      {isRevealed
                        ? <EyeOff className="h-4 w-4 text-text-muted" />
                        : <Eye className="h-4 w-4 text-text-muted" />}
                    </button>
                  </UiTooltip>
                </div>
              </label>
            </ProviderDetailSection>

            <ProviderDetailSection title={t('settings.providerSectionModels')}>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-dark">
                  {t('settings.videoApiModel')}
                </span>
                <SettingsTextInput
                  value={api.modelId}
                  onCommit={(modelId) => updateApi(api.id, { ...api, modelId })}
                />
              </label>
            </ProviderDetailSection>

            <ProviderDetailSection title={t('settings.providerSectionAdvanced')}>
              <SettingsCheckboxCard
                checked={api.enabled}
                onCheckedChange={(enabled) => updateApi(api.id, { ...api, enabled })}
                title={t('settings.videoApiEnabled')}
                description={t('settings.videoApiEnabledDesc')}
              />

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-medium text-text-dark">
                      {t('settings.videoPolishPromptTemplate')}
                    </h4>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.videoPolishPromptPlaceholder')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateApi(api.id, {
                      ...api,
                      polishPrompt: defaultVideoPolishPrompt(api),
                    })}
                    className="shrink-0 text-xs text-accent hover:underline"
                  >
                    {t('common.restoreDefault')}
                  </button>
                </div>
                <SettingsTextArea
                  value={api.polishPrompt ?? ''}
                  onCommit={(polishPrompt) => updateApi(api.id, { ...api, polishPrompt })}
                  rows={8}
                  placeholder={t('settings.videoPolishPromptPlaceholder')}
                />
              </div>
            </ProviderDetailSection>
          </div>
        );
      }}
      addLabel={t('settings.addVideoApi')}
      removeLabel={t('settings.removeVideoApi')}
      emptyLabel={t('settings.noVideoApisConfigured')}
    />
  );
}
