import { useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { UiTooltip } from '@/components/ui';
import { X } from '@/components/ui/icons';
import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion';
import { useDialogTransition } from '@/components/ui/useDialogTransition';
import { AdvancedSettings } from '@/features/settings/AdvancedSettings';
import type { SettingsProviderKind } from '@/features/settings/application/settingsHealth';
import { CanvasAppearanceSettings } from '@/features/settings/CanvasAppearanceSettings';
import { ExternalAgentSettings } from '@/features/settings/ExternalAgentSettings';
import { FilesSettings } from '@/features/settings/FilesSettings';
import { GenerationSettings } from '@/features/settings/GenerationSettings';
import { ModelServicesSettings } from '@/features/settings/ModelServicesSettings';
import type { SettingsCategory } from '@/features/settings/settingsEvents';
import { SettingsOverview } from '@/features/settings/SettingsOverview';
import { useSettingsStore } from '@/stores/settingsStore';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialCategory?: SettingsCategory;
  initialProviderKind?: SettingsProviderKind;
}

// Grouped by task; `null` draws a divider.
const NAV_ITEMS: Array<SettingsCategory | null> = [
  'overview',
  null,
  'services',
  'generation',
  'canvasAppearance',
  'files',
  null,
  'integration',
  'advanced',
];

/** Every change is written to the store as it is made; there is no save step. */
export function SettingsDialog({
  isOpen,
  onClose,
  initialCategory = 'overview',
  initialProviderKind = 'image',
}: SettingsDialogProps) {
  const { t } = useTranslation();
  const externalAgentConnection = useSettingsStore((state) => state.externalAgentConnection);
  const setExternalAgentConnection = useSettingsStore((state) => state.setExternalAgentConnection);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(initialCategory);
  const [providerKind, setProviderKind] = useState<SettingsProviderKind>(initialProviderKind);
  const [isProviderDetailOpen, setProviderDetailOpen] = useState(false);
  const { shouldRender, isVisible } = useDialogTransition(isOpen, UI_DIALOG_TRANSITION_MS);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setActiveCategory(initialCategory);
    setProviderKind(initialProviderKind);
  }, [initialCategory, initialProviderKind, isOpen]);

  // The provider list does not report on unmount, so reset whenever its host changes.
  useLayoutEffect(() => {
    setProviderDetailOpen(false);
  }, [activeCategory, providerKind, isOpen]);

  if (!shouldRender) return null;

  const showServices = (kind: SettingsProviderKind) => {
    setProviderKind(kind);
    setActiveCategory('services');
  };

  const categoryButtonClass = (category: SettingsCategory) =>
    `mx-2 flex w-[calc(100%-1rem)] items-center rounded-lg px-3 py-2 text-left text-sm transition-colors ${
      activeCategory === category
        ? 'bg-accent/14 font-medium text-accent'
        : 'text-text-muted hover:bg-[var(--ui-hover)] hover:text-text-dark'
    }`;

  const showHeader = !(activeCategory === 'services' && isProviderDetailOpen);

  return (
    <div className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-50 flex items-center justify-center`}>
      <div
        className={`absolute inset-0 bg-black/65 transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div className="relative w-[min(94vw,920px)]">
        <div
          className={`relative mx-auto flex h-[min(84vh,720px)] w-full overflow-hidden rounded-[10px] border border-[var(--ui-border-soft)] bg-[var(--ui-surface-panel)] shadow-[var(--ui-shadow-panel)] transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        >
          <UiTooltip content={t('common.close')}>
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={onClose}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-[var(--ui-hover)] hover:text-text-dark"
            >
              <X className="h-4 w-4" />
            </button>
          </UiTooltip>

          <div className="flex w-[200px] shrink-0 flex-col border-r border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)]">
            <div className="px-4 py-4">
              <span className="text-xs font-medium text-text-muted">{t('settings.title')}</span>
            </div>
            <nav className="flex-1 space-y-0.5">
              {NAV_ITEMS.map((category, index) => (
                category === null ? (
                  <div key={`divider-${index}`} className="mx-4 my-2 border-t border-[var(--ui-border-soft)]" />
                ) : (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setActiveCategory(category)}
                    className={categoryButtonClass(category)}
                  >
                    {t(`settings.category.${category}`)}
                  </button>
                )
              ))}
            </nav>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            {showHeader && (
              <div className="flex items-end justify-between gap-4 border-b border-[var(--ui-border-soft)] py-4 pl-6 pr-14">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-text-dark">
                    {t(`settings.category.${activeCategory}`)}
                  </h2>
                  <p className="mt-1 text-sm text-text-muted">
                    {t(`settings.categoryDesc.${activeCategory}`)}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-text-muted">{t('settings.autosaveHint')}</span>
              </div>
            )}

            {/* Without the page header, keep the detail toolbar clear of the close button. */}
            <div className={`ui-scrollbar flex-1 overflow-y-auto pl-6 ${showHeader ? 'pr-6' : 'pr-14'}`}>
              {activeCategory === 'overview' && (
                <div className="py-5">
                  <SettingsOverview
                    onNavigate={(target) => {
                      if (target.kind === 'services') {
                        showServices(target.providerKind);
                      } else {
                        setActiveCategory('generation');
                      }
                    }}
                  />
                </div>
              )}
              {activeCategory === 'services' && (
                <ModelServicesSettings
                  providerKind={providerKind}
                  onProviderKindChange={setProviderKind}
                  isDetailOpen={isProviderDetailOpen}
                  onDetailChange={setProviderDetailOpen}
                />
              )}
              {activeCategory === 'generation' && <GenerationSettings />}
              {activeCategory === 'canvasAppearance' && <CanvasAppearanceSettings />}
              {activeCategory === 'files' && <FilesSettings />}
              {activeCategory === 'integration' && (
                <ExternalAgentSettings
                  value={externalAgentConnection}
                  onChange={setExternalAgentConnection}
                />
              )}
              {activeCategory === 'advanced' && <AdvancedSettings />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
