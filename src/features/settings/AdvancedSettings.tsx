import { useTranslation } from 'react-i18next';

import { LoggingSettings } from '@/features/settings/LoggingSettings';
import { SettingsCheckboxCard } from '@/features/settings/SettingsCheckboxCard';
import { SettingsPageSection } from '@/features/settings/SettingsPageSection';
import { useSettingsStore } from '@/stores/settingsStore';

export function AdvancedSettings() {
  const { t } = useTranslation();
  const settings = useSettingsStore();

  return (
    <div>
      <SettingsPageSection title={t('settings.sectionExperimental')}>
        <SettingsCheckboxCard
          checked={settings.enableStoryboardGenGridPreviewShortcut}
          onCheckedChange={settings.setEnableStoryboardGenGridPreviewShortcut}
          title={t('settings.enableStoryboardGenGridPreviewShortcut')}
          description={t('settings.enableStoryboardGenGridPreviewShortcutDesc')}
        />
        <SettingsCheckboxCard
          checked={settings.showStoryboardGenAdvancedRatioControls}
          onCheckedChange={settings.setShowStoryboardGenAdvancedRatioControls}
          title={t('settings.showStoryboardGenAdvancedRatioControls')}
          description={t('settings.showStoryboardGenAdvancedRatioControlsDesc')}
        />
      </SettingsPageSection>

      <SettingsPageSection title={t('settings.sectionUpdates')}>
        <SettingsCheckboxCard
          checked={settings.autoCheckAppUpdateOnLaunch}
          onCheckedChange={settings.setAutoCheckAppUpdateOnLaunch}
          title={t('settings.autoCheckUpdateOnLaunch')}
          description={t('settings.autoCheckUpdateOnLaunchDesc')}
        />
        <SettingsCheckboxCard
          checked={settings.enableUpdateDialog}
          onCheckedChange={settings.setEnableUpdateDialog}
          title={t('settings.enableUpdateDialog')}
          description={t('settings.enableUpdateDialogDesc')}
        />
      </SettingsPageSection>

      <SettingsPageSection title={t('settings.logging')}>
        <LoggingSettings />
      </SettingsPageSection>
    </div>
  );
}
