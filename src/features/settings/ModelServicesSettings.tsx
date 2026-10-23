import { useTranslation } from 'react-i18next';

import type { SettingsProviderKind } from '@/features/settings/application/settingsHealth';
import { ImageApisSettings } from '@/features/settings/ImageApisSettings';
import { SettingsSegmented } from '@/features/settings/SettingsSegmented';
import { TextApisSettings } from '@/features/settings/TextApisSettings';
import { VideoApisSettings } from '@/features/settings/VideoApisSettings';
import { useSettingsStore } from '@/stores/settingsStore';

const PROVIDER_KINDS: SettingsProviderKind[] = ['image', 'text', 'video'];

interface ModelServicesSettingsProps {
  providerKind: SettingsProviderKind;
  onProviderKindChange: (kind: SettingsProviderKind) => void;
  isDetailOpen: boolean;
  onDetailChange: (isOpen: boolean) => void;
}

export function ModelServicesSettings({
  providerKind,
  onProviderKindChange,
  isDetailOpen,
  onDetailChange,
}: ModelServicesSettingsProps) {
  const { t } = useTranslation();
  const openAiImageApi = useSettingsStore((state) => state.openAiImageApi);
  const chaomoImageApi = useSettingsStore((state) => state.chaomoImageApi);
  const customImageApis = useSettingsStore((state) => state.customImageApis);
  const setOpenAiImageApi = useSettingsStore((state) => state.setOpenAiImageApi);
  const setChaomoImageApi = useSettingsStore((state) => state.setChaomoImageApi);
  const setCustomImageApis = useSettingsStore((state) => state.setCustomImageApis);
  const textApis = useSettingsStore((state) => state.textApis);
  const setTextApis = useSettingsStore((state) => state.setTextApis);
  const videoApis = useSettingsStore((state) => state.videoApis);
  const setVideoApis = useSettingsStore((state) => state.setVideoApis);

  return (
    <div>
      {!isDetailOpen && (
        <div className="pt-4">
          <SettingsSegmented
            ariaLabel={t('settings.services')}
            value={providerKind}
            onChange={onProviderKindChange}
            options={PROVIDER_KINDS.map((kind) => ({
              value: kind,
              label: t(`settings.serviceKind.${kind}`),
            }))}
          />
        </div>
      )}

      {providerKind === 'image' && (
        <ImageApisSettings
          value={{ openAiImageApi, chaomoImageApi, customImageApis }}
          onChange={(patch) => {
            if (patch.openAiImageApi) setOpenAiImageApi(patch.openAiImageApi);
            if (patch.chaomoImageApi) setChaomoImageApi(patch.chaomoImageApi);
            if (patch.customImageApis) setCustomImageApis(patch.customImageApis);
          }}
          onDetailChange={onDetailChange}
        />
      )}
      {providerKind === 'text' && (
        <TextApisSettings apis={textApis} onChange={setTextApis} onDetailChange={onDetailChange} />
      )}
      {providerKind === 'video' && (
        <VideoApisSettings apis={videoApis} onChange={setVideoApis} onDetailChange={onDetailChange} />
      )}
    </div>
  );
}
