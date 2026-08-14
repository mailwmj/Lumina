import { useTranslation } from 'react-i18next';

import { UiInput } from '@/components/ui';
import { SettingsCheckboxCard } from '@/features/settings/SettingsCheckboxCard';
import type { ExternalAgentConnectionConfig } from '@/stores/settingsStore';

interface ExternalAgentSettingsProps {
  value: ExternalAgentConnectionConfig;
  onChange: (value: ExternalAgentConnectionConfig) => void;
}

export function ExternalAgentSettings({
  value,
  onChange,
}: ExternalAgentSettingsProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5 py-5">
      <SettingsCheckboxCard
        checked={value.enabled}
        onCheckedChange={(enabled) => onChange({ ...value, enabled })}
        title={t('settings.externalAgentEnabled')}
        description={t('settings.externalAgentEnabledDesc')}
      />

      <section>
        <label className="block text-sm font-medium text-text-dark" htmlFor="external-agent-url">
          {t('settings.externalAgentUrl')}
        </label>
        <p className="mt-1 text-xs text-text-muted">
          {t('settings.externalAgentUrlDesc')}
        </p>
        <UiInput
          id="external-agent-url"
          value={value.url}
          spellCheck={false}
          className="mt-3 h-9 font-mono text-xs"
          placeholder="http://127.0.0.1:17372"
          onChange={(event) => onChange({ ...value, url: event.target.value })}
        />
      </section>

      <section>
        <label className="block text-sm font-medium text-text-dark" htmlFor="external-agent-token">
          {t('settings.externalAgentToken')}
        </label>
        <p className="mt-1 text-xs text-text-muted">
          {t('settings.externalAgentTokenDesc')}
        </p>
        <UiInput
          id="external-agent-token"
          type="password"
          value={value.token}
          autoComplete="off"
          spellCheck={false}
          className="mt-3 h-9 font-mono text-xs"
          placeholder={t('settings.externalAgentTokenPlaceholder')}
          onChange={(event) => onChange({ ...value, token: event.target.value })}
        />
      </section>
    </div>
  );
}
