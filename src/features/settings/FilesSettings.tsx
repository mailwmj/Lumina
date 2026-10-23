import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';

import { UiTooltip } from '@/components/ui';
import { FolderOpen, Plus, Trash2 } from '@/components/ui/icons';
import { SettingsCheckboxCard } from '@/features/settings/SettingsCheckboxCard';
import { SettingsPageSection } from '@/features/settings/SettingsPageSection';
import { logger } from '@/lib/logger';
import { useSettingsStore } from '@/stores/settingsStore';

export function FilesSettings() {
  const { t } = useTranslation();
  const useUploadFilenameAsNodeTitle = useSettingsStore((state) => state.useUploadFilenameAsNodeTitle);
  const setUseUploadFilenameAsNodeTitle = useSettingsStore((state) => state.setUseUploadFilenameAsNodeTitle);
  const downloadPresetPaths = useSettingsStore((state) => state.downloadPresetPaths);
  const setDownloadPresetPaths = useSettingsStore((state) => state.setDownloadPresetPaths);
  const [pathInput, setPathInput] = useState('');

  // The store setter de-duplicates, trims and caps the list at 8.
  const addPath = (path: string) => setDownloadPresetPaths([...downloadPresetPaths, path]);

  const handleAddFromInput = () => {
    if (!pathInput.trim()) {
      return;
    }
    addPath(pathInput);
    setPathInput('');
  };

  const handlePickFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      addPath(selected);
    } catch (error) {
      logger.error('Failed to pick download path', error);
    }
  };

  return (
    <div>
      <SettingsPageSection title={t('settings.sectionUpload')}>
        <SettingsCheckboxCard
          checked={useUploadFilenameAsNodeTitle}
          onCheckedChange={setUseUploadFilenameAsNodeTitle}
          title={t('settings.useUploadFilenameAsNodeTitle')}
          description={t('settings.useUploadFilenameAsNodeTitleDesc')}
        />
      </SettingsPageSection>

      <SettingsPageSection title={t('settings.sectionDownload')}>
        <div>
          <h4 className="text-sm font-medium text-text-dark">{t('settings.downloadPresetPaths')}</h4>
          <p className="mt-1 text-xs text-text-muted">{t('settings.downloadPresetPathsDesc')}</p>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                handleAddFromInput();
              }
            }}
            placeholder={t('settings.downloadPathPlaceholder')}
            className="h-9 min-w-0 flex-1 rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted"
          />
          <button
            type="button"
            className="inline-flex h-9 shrink-0 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark"
            onClick={handleAddFromInput}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('settings.addPath')}
          </button>
          <button
            type="button"
            className="inline-flex h-9 shrink-0 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark"
            onClick={() => void handlePickFolder()}
          >
            <FolderOpen className="mr-1 h-3.5 w-3.5" />
            {t('settings.chooseFolder')}
          </button>
        </div>

        <div className="space-y-1">
          {downloadPresetPaths.length > 0 ? (
            downloadPresetPaths.map((path) => (
              <div
                key={path}
                className="flex items-center gap-2 rounded border border-border-dark bg-surface-dark px-2 py-1.5"
              >
                <span className="truncate text-xs text-text-dark">{path}</span>
                <UiTooltip content={t('common.delete')}>
                  <button
                    type="button"
                    aria-label={t('common.delete')}
                    className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-[var(--ui-hover)] hover:text-red-400"
                    onClick={() => setDownloadPresetPaths(downloadPresetPaths.filter((value) => value !== path))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </UiTooltip>
              </div>
            ))
          ) : (
            <div className="text-xs text-text-muted">{t('settings.noDownloadPresetPaths')}</div>
          )}
        </div>
      </SettingsPageSection>
    </div>
  );
}
