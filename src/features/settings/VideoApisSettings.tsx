import { useTranslation } from 'react-i18next';

import { ProviderListShell } from '@/features/settings/providers/ProviderListShell';
import {
  DEFAULT_VIDEO_SD10_POLISH_PROMPT,
  type VideoApiConfig,
} from '@/stores/settingsStore';

interface VideoApisSettingsProps {
  apis: VideoApiConfig[];
  onChange: (apis: VideoApiConfig[]) => void;
}

function createCustomVideoApiConfig(): VideoApiConfig {
  return {
    id: `custom-video-${Date.now()}`,
    name: '',
    apiKey: '',
    baseUrl: '',
    modelId: 'custom-video-model',
    enabled: false,
    defaultPolishPrompt: DEFAULT_VIDEO_SD10_POLISH_PROMPT,
  };
}

export function VideoApisSettings({ apis, onChange }: VideoApisSettingsProps) {
  const { t } = useTranslation();

  const updateApi = (id: string, next: VideoApiConfig) => {
    onChange(apis.map((api) => (api.id === id ? next : api)));
  };

  return (
    <ProviderListShell<VideoApiConfig>
      items={apis}
      getItemId={(api) => api.id}
      getItemTitle={(api) => api.name || t('settings.videoApiName')}
      getItemSubtitle={(api) => api.baseUrl || '—'}
      getItemMeta={(api) => api.modelId || undefined}
      onAdd={() => {
        const config = createCustomVideoApiConfig();
        onChange([...apis, config]);
        return config.id;
      }}
      onRemove={(id) => onChange(apis.filter((api) => api.id !== id))}
      renderDetail={(api) => (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-dark">
              {t('settings.videoApiName')}
            </span>
            <input
              type="text"
              value={api.name}
              onChange={(event) => updateApi(api.id, { ...api, name: event.target.value })}
              className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-dark">
              {t('settings.videoApiKey')}
            </span>
            <input
              type="password"
              value={api.apiKey}
              onChange={(event) => updateApi(api.id, { ...api, apiKey: event.target.value })}
              placeholder={t('settings.enterApiKey')}
              className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-dark">
              {t('settings.videoApiBaseUrl')}
            </span>
            <input
              type="text"
              value={api.baseUrl}
              onChange={(event) => updateApi(api.id, { ...api, baseUrl: event.target.value })}
              className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-dark">
              {t('settings.videoApiModel')}
            </span>
            <input
              type="text"
              value={api.modelId}
              onChange={(event) => updateApi(api.id, { ...api, modelId: event.target.value })}
              className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark"
            />
          </label>
        </div>
      )}
      addLabel={t('settings.addVideoApi')}
      removeLabel={t('settings.removeVideoApi')}
      emptyLabel={t('settings.noVideoApisConfigured')}
    />
  );
}
