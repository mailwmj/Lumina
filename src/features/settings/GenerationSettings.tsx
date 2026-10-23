import { useTranslation } from 'react-i18next';

import { PromptPolishSettings } from '@/features/settings/PromptPolishSettings';
import { SettingsCheckboxCard } from '@/features/settings/SettingsCheckboxCard';
import { SettingsPageSection } from '@/features/settings/SettingsPageSection';
import { useSettingsStore } from '@/stores/settingsStore';

export function GenerationSettings() {
  const { t } = useTranslation();
  const settings = useSettingsStore();

  return (
    <div>
      <SettingsPageSection title={t('settings.sectionPromptPolish')}>
        <PromptPolishSettings
          textApis={settings.textApis}
          imagePolishConfig={settings.imagePolishConfig}
          textPolishConfig={settings.textPolishConfig}
          onImagePolishConfigChange={settings.setImagePolishConfig}
          onTextPolishConfigChange={settings.setTextPolishConfig}
        />
      </SettingsPageSection>

      <SettingsPageSection title={t('settings.sectionStoryboard')}>
        <SettingsCheckboxCard
          checked={settings.storyboardGenKeepStyleConsistent}
          onCheckedChange={settings.setStoryboardGenKeepStyleConsistent}
          title={t('settings.storyboardGenKeepStyleConsistent')}
          description={t('settings.storyboardGenKeepStyleConsistentDesc')}
        />
        <SettingsCheckboxCard
          checked={settings.storyboardGenDisableTextInImage}
          onCheckedChange={settings.setStoryboardGenDisableTextInImage}
          title={t('settings.storyboardGenDisableTextInImage')}
          description={t('settings.storyboardGenDisableTextInImageDesc')}
        />
        <SettingsCheckboxCard
          checked={settings.storyboardGenAutoInferEmptyFrame}
          onCheckedChange={settings.setStoryboardGenAutoInferEmptyFrame}
          title={t('settings.storyboardGenAutoInferEmptyFrame')}
          description={t('settings.storyboardGenAutoInferEmptyFrameDesc')}
        />
      </SettingsPageSection>

      <SettingsPageSection title={t('settings.sectionTextHandling')}>
        <SettingsCheckboxCard
          checked={settings.ignoreAtTagWhenCopyingAndGenerating}
          onCheckedChange={settings.setIgnoreAtTagWhenCopyingAndGenerating}
          title={t('settings.ignoreAtTagWhenCopyingAndGenerating')}
          description={t('settings.ignoreAtTagWhenCopyingAndGeneratingDesc')}
        />
      </SettingsPageSection>
    </div>
  );
}
