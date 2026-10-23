import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { UiCheckbox, UiSelect } from '@/components/ui';
import { DEFAULT_ACCENT_COLOR } from '@/features/settings/application/accentColor';
import { SettingsPageSection } from '@/features/settings/SettingsPageSection';
import { SettingsSegmented } from '@/features/settings/SettingsSegmented';
import { SettingsTextInput } from '@/features/settings/SettingsTextField';
import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';

function SettingsRow({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className={`flex justify-between gap-6 ${description ? 'items-start' : 'items-center'}`}>
      <div className="min-w-0">
        <h4 className="text-sm font-medium text-text-dark">{title}</h4>
        {description && <p className="mt-1 text-xs text-text-muted">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function CanvasAppearanceSettings() {
  const { t, i18n } = useTranslation();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const accentColor = useSettingsStore((state) => state.accentColor);
  const setAccentColor = useSettingsStore((state) => state.setAccentColor);
  const canvasEdgeRoutingMode = useSettingsStore((state) => state.canvasEdgeRoutingMode);
  const setCanvasEdgeRoutingMode = useSettingsStore((state) => state.setCanvasEdgeRoutingMode);
  const snapToGridEnabled = useSettingsStore((state) => state.snapToGridEnabled);
  const setSnapToGridEnabled = useSettingsStore((state) => state.setSnapToGridEnabled);
  const language = i18n.language.startsWith('zh') ? 'zh' : 'en';

  return (
    <div>
      <SettingsPageSection title={t('settings.sectionAppearance')}>
        <SettingsRow title={t('settings.theme')}>
          <SettingsSegmented
            ariaLabel={t('settings.theme')}
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'dark', label: t('theme.dark') },
              { value: 'light', label: t('theme.light') },
            ]}
          />
        </SettingsRow>

        <SettingsRow title={t('settings.language')}>
          <SettingsSegmented
            ariaLabel={t('settings.language')}
            value={language}
            onChange={(next) => void i18n.changeLanguage(next)}
            options={[
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'English' },
            ]}
          />
        </SettingsRow>

        <div>
          <h4 className="text-sm font-medium text-text-dark">{t('settings.accentColor')}</h4>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="color"
              aria-label={t('settings.accentColor')}
              value={accentColor}
              onChange={(event) => setAccentColor(event.target.value)}
              className="h-9 w-12 rounded-lg border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)] p-1"
            />
            <SettingsTextInput
              value={accentColor}
              onCommit={setAccentColor}
              placeholder={DEFAULT_ACCENT_COLOR}
              className="h-9 flex-1 font-mono"
            />
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)] px-3 text-xs text-text-dark transition-colors hover:bg-[var(--ui-hover)]"
              onClick={() => setAccentColor(DEFAULT_ACCENT_COLOR)}
            >
              {t('settings.resetAccentColor')}
            </button>
          </div>
        </div>
      </SettingsPageSection>

      <SettingsPageSection title={t('settings.sectionCanvas')}>
        <SettingsRow title={t('settings.edgeRoutingMode')}>
          <UiSelect
            aria-label={t('settings.edgeRoutingMode')}
            value={canvasEdgeRoutingMode}
            onChange={(event) =>
              setCanvasEdgeRoutingMode(event.target.value as typeof canvasEdgeRoutingMode)
            }
            className="h-9 w-[200px] text-sm"
          >
            <option value="spline">{t('settings.edgeRoutingSpline')}</option>
            <option value="orthogonal">{t('settings.edgeRoutingOrthogonal')}</option>
            <option value="smartOrthogonal">{t('settings.edgeRoutingSmartOrthogonal')}</option>
          </UiSelect>
        </SettingsRow>

        <SettingsRow title={t('settings.snapToGrid')}>
          <UiCheckbox
            aria-label={t('settings.snapToGrid')}
            checked={snapToGridEnabled}
            onCheckedChange={setSnapToGridEnabled}
          />
        </SettingsRow>
      </SettingsPageSection>
    </div>
  );
}
