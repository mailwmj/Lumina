import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChevronRight } from '@/components/ui/icons';
import {
  deriveCapabilities,
  type Capability,
  type CapabilityLevel,
} from '@/features/settings/application/settingsHealth';
import { useSettingsStore } from '@/stores/settingsStore';

const LEVEL_STYLE: Record<CapabilityLevel, { card: string; dot: string }> = {
  ready: { card: 'border-[var(--ui-border-soft)]', dot: 'bg-emerald-500' },
  warn: { card: 'border-amber-500/40', dot: 'bg-amber-500' },
  missing: { card: 'border-dashed border-[var(--ui-border-strong)]', dot: 'bg-text-muted/40' },
};

interface SettingsOverviewProps {
  onNavigate: (target: Capability['target']) => void;
}

function useCapabilities(): Capability[] {
  const openAiImageApi = useSettingsStore((state) => state.openAiImageApi);
  const chaomoImageApi = useSettingsStore((state) => state.chaomoImageApi);
  const customImageApis = useSettingsStore((state) => state.customImageApis);
  const textApis = useSettingsStore((state) => state.textApis);
  const videoApis = useSettingsStore((state) => state.videoApis);
  const imagePolishConfig = useSettingsStore((state) => state.imagePolishConfig);
  const textPolishConfig = useSettingsStore((state) => state.textPolishConfig);

  return useMemo(() => deriveCapabilities({
    openAiImageApi,
    chaomoImageApi,
    customImageApis,
    textApis,
    videoApis,
    imagePolishConfig,
    textPolishConfig,
  }), [
    openAiImageApi,
    chaomoImageApi,
    customImageApis,
    textApis,
    videoApis,
    imagePolishConfig,
    textPolishConfig,
  ]);
}

function useCapabilitySummary() {
  const { t } = useTranslation();
  return (capability: Capability): string => {
    const isPolish = capability.key === 'imagePolish' || capability.key === 'textPolish';
    if (isPolish) {
      if (capability.level === 'ready') {
        return t('settings.capabilitySummary.polishReady', { model: capability.polishModelLabel });
      }
      return t(`settings.capabilitySummary.polish_${capability.level}`);
    }
    if (capability.level === 'ready') {
      return capability.key === 'video'
        ? t('settings.capabilitySummary.videoReady', { providers: capability.providerCount })
        : t('settings.capabilitySummary.imageReady', {
          providers: capability.providerCount,
          models: capability.modelCount,
        });
    }
    return t(`settings.capabilitySummary.media_${capability.level}`);
  };
}

export function SettingsOverview({ onNavigate }: SettingsOverviewProps) {
  const { t } = useTranslation();
  const capabilities = useCapabilities();
  const summarize = useCapabilitySummary();
  const allReady = capabilities.every((capability) => capability.level === 'ready');

  return (
    <div>
      <p className="mb-4 text-sm text-text-muted">
        {allReady ? t('settings.overviewAllReady') : t('settings.overviewNeedsAttention')}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {capabilities.map((capability) => {
          const style = LEVEL_STYLE[capability.level];
          return (
            <button
              key={capability.key}
              type="button"
              onClick={() => onNavigate(capability.target)}
              className={`group rounded-lg border ${style.card} bg-[var(--ui-surface-field)] p-4 text-left transition-colors hover:bg-[var(--ui-hover)]`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-text-dark">
                  {t(`settings.capability.${capability.key}`)}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
                  <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                  {t(`settings.capabilityLevel.${capability.level}`)}
                </span>
              </div>
              <p className="mt-2 min-h-[2.5rem] break-words text-xs leading-5 text-text-muted">
                {summarize(capability)}
              </p>
              <span className="mt-2 inline-flex items-center text-xs font-medium text-accent">
                {t(`settings.capabilityAction.${capability.level}`)}
                <ChevronRight className="ml-0.5 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
