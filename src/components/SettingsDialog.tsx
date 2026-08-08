import { useState, useCallback, useEffect } from 'react';
import { X, Eye, EyeOff, FolderOpen, Loader2, Plus, Trash2 } from '@/components/ui/icons';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import { getLogConfig, setLogConfig, resetLogConfig, useLogStore } from '@/lib/logger';
import { invoke } from '@tauri-apps/api/core';
import {
  useSettingsStore,
  type ChaomoImageApiConfig,
  type ImageModelCatalog,
  type ImageProviderId,
  type OpenAiImageApiConfig,
  type TextApiConfig,
  type VideoApiConfig,
  DEFAULT_TEXT_API_PROMPT,
  DEFAULT_VIDEO_SD10_POLISH_PROMPT,
  DEFAULT_VIDEO_SD15_PROMPT,
} from '@/stores/settingsStore';
import { discoverImageModels } from '@/commands/ai';
import { toConfiguredImageModelId } from '@/features/canvas/models';
import { testTextApi } from '@/features/canvas/infrastructure/textPolishService';
import { UiButton, UiCheckbox, UiInput, UiSelect, UiTooltip } from '@/components/ui';
import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion';
import { useDialogTransition } from '@/components/ui/useDialogTransition';
import type { SettingsCategory } from '@/features/settings/settingsEvents';
import { DEFAULT_ACCENT_COLOR } from '@/features/settings/application/accentColor';
import { logger } from '@/lib/logger';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialCategory?: SettingsCategory;
}

interface SettingsCheckboxCardProps {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

interface ImageModelSelectionPanelProps {
  catalog: ImageModelCatalog | null;
  selectedModelIds: string[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelectionChange: (modelId: string, selected: boolean) => void;
  refreshLabel: string;
  refreshingLabel: string;
  noModelsLabel: string;
  selectModelsLabel: string;
}

function ImageModelSelectionPanel({
  catalog,
  selectedModelIds,
  isLoading,
  error,
  onRefresh,
  onSelectionChange,
  refreshLabel,
  refreshingLabel,
  noModelsLabel,
  selectModelsLabel,
}: ImageModelSelectionPanelProps) {
  const selectedModelIdSet = new Set(selectedModelIds);

  return (
    <div className="rounded border border-border-dark bg-surface-dark p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-text-dark">{selectModelsLabel}</span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="inline-flex h-7 shrink-0 items-center rounded border border-border-dark bg-bg-dark px-2 text-xs text-text-dark transition-colors hover:bg-surface-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          {isLoading ? refreshingLabel : refreshLabel}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {!error && !catalog && (
        <p className="mt-2 text-xs text-text-muted">{noModelsLabel}</p>
      )}

      {catalog && catalog.models.length === 0 && (
        <p className="mt-2 text-xs text-text-muted">{noModelsLabel}</p>
      )}

      {catalog && catalog.models.length > 0 && (
        <div className="ui-scrollbar mt-2 max-h-40 space-y-1 overflow-y-auto">
          {catalog.models.map((model) => {
            const selected = selectedModelIdSet.has(model.id);
            return (
              <label
                key={model.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-xs text-text-dark hover:bg-bg-dark"
              >
                <UiCheckbox
                  aria-label={model.label || model.id}
                  checked={selected}
                  onCheckedChange={(checked) => onSelectionChange(model.id, checked)}
                  onClick={(event) => event.stopPropagation()}
                />
                <span className="min-w-0 break-words">{model.label || model.id}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SettingsCheckboxCard({
  title,
  description,
  checked,
  onCheckedChange,
}: SettingsCheckboxCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onCheckedChange(!checked)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onCheckedChange(!checked);
        }
      }}
      className="w-full border-b border-[var(--ui-border-soft)] py-3 text-left transition-colors hover:bg-[var(--ui-hover)]"
    >
      <div className="flex items-start gap-3">
        <UiCheckbox
          aria-label={title}
          checked={checked}
          onCheckedChange={(nextChecked) => onCheckedChange(nextChecked)}
          onClick={(event) => event.stopPropagation()}
          className="mt-0.5 shrink-0"
        />
        <div>
          <h3 className="text-sm font-medium text-text-dark">{title}</h3>
          <p className="mt-1 text-xs text-text-muted">{description}</p>
        </div>
      </div>
    </div>
  );
}

export function SettingsDialog({
  isOpen,
  onClose,
  initialCategory = 'general',
}: SettingsDialogProps) {
  const { t } = useTranslation();
  const {
    openAiImageApi,
    chaomoImageApi,
    downloadPresetPaths,
    useUploadFilenameAsNodeTitle,
    storyboardGenKeepStyleConsistent,
    storyboardGenDisableTextInImage,
    storyboardGenAutoInferEmptyFrame,
    ignoreAtTagWhenCopyingAndGenerating,
    enableStoryboardGenGridPreviewShortcut,
    showStoryboardGenAdvancedRatioControls,
    accentColor,
    canvasEdgeRoutingMode,
    setOpenAiImageApi,
    setChaomoImageApi,
    setDownloadPresetPaths,
    setUseUploadFilenameAsNodeTitle,
    setStoryboardGenKeepStyleConsistent,
    setStoryboardGenDisableTextInImage,
    setStoryboardGenAutoInferEmptyFrame,
    setIgnoreAtTagWhenCopyingAndGenerating,
    setEnableStoryboardGenGridPreviewShortcut,
    setShowStoryboardGenAdvancedRatioControls,
    setAccentColor,
    setCanvasEdgeRoutingMode,
    textApis,
    setTextApis,
    imagePolishPrompt,
    setImagePolishPrompt,
    videoApis,
    setVideoApis,
  } = useSettingsStore();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(initialCategory);
  const [localOpenAiImageApi, setLocalOpenAiImageApi] = useState<OpenAiImageApiConfig>(
    openAiImageApi
  );
  const [localChaomoImageApi, setLocalChaomoImageApi] = useState<ChaomoImageApiConfig>(
    chaomoImageApi
  );
  const [modelDiscoveryState, setModelDiscoveryState] = useState<
    Record<ImageProviderId, { isLoading: boolean; error: string | null }>
  >({
    'ai-media': { isLoading: false, error: null },
    chaomo: { isLoading: false, error: null },
  });
  const [localDownloadPathInput, setLocalDownloadPathInput] = useState('');
  const [localDownloadPresetPaths, setLocalDownloadPresetPaths] = useState(downloadPresetPaths);
  const [localUseUploadFilenameAsNodeTitle, setLocalUseUploadFilenameAsNodeTitle] = useState(
    useUploadFilenameAsNodeTitle
  );
  const [localStoryboardGenKeepStyleConsistent, setLocalStoryboardGenKeepStyleConsistent] =
    useState(storyboardGenKeepStyleConsistent);
  const [localStoryboardGenDisableTextInImage, setLocalStoryboardGenDisableTextInImage] = useState(
    storyboardGenDisableTextInImage
  );
  const [localStoryboardGenAutoInferEmptyFrame, setLocalStoryboardGenAutoInferEmptyFrame] = useState(
    storyboardGenAutoInferEmptyFrame
  );
  const [localIgnoreAtTagWhenCopyingAndGenerating, setLocalIgnoreAtTagWhenCopyingAndGenerating] =
    useState(ignoreAtTagWhenCopyingAndGenerating);
  const [localEnableStoryboardGenGridPreviewShortcut, setLocalEnableStoryboardGenGridPreviewShortcut] =
    useState(enableStoryboardGenGridPreviewShortcut);
  const [localShowStoryboardGenAdvancedRatioControls, setLocalShowStoryboardGenAdvancedRatioControls] =
    useState(showStoryboardGenAdvancedRatioControls);
  const [localAccentColor, setLocalAccentColor] = useState(accentColor);
  const [localCanvasEdgeRoutingMode, setLocalCanvasEdgeRoutingMode] = useState(canvasEdgeRoutingMode);
  const [isOpenAiApiKeyRevealed, setIsOpenAiApiKeyRevealed] = useState(false);
  const [isChaomoApiKeyRevealed, setIsChaomoApiKeyRevealed] = useState(false);
  const [localTextApis, setLocalTextApis] = useState<TextApiConfig[]>(textApis);
  const [localImagePolishPrompt, setLocalImagePolishPrompt] = useState<string>(imagePolishPrompt);
  const [localVideoApis, setLocalVideoApis] = useState<VideoApiConfig[]>(videoApis);
  const [testingApiId, setTestingApiId] = useState<string | null>(null);
  const { shouldRender, isVisible } = useDialogTransition(isOpen, UI_DIALOG_TRANSITION_MS);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setLocalOpenAiImageApi(openAiImageApi);
    setLocalChaomoImageApi(chaomoImageApi);
    setLocalDownloadPresetPaths(downloadPresetPaths);
    setLocalUseUploadFilenameAsNodeTitle(useUploadFilenameAsNodeTitle);
    setLocalStoryboardGenKeepStyleConsistent(storyboardGenKeepStyleConsistent);
    setLocalStoryboardGenDisableTextInImage(storyboardGenDisableTextInImage);
    setLocalStoryboardGenAutoInferEmptyFrame(storyboardGenAutoInferEmptyFrame);
    setLocalIgnoreAtTagWhenCopyingAndGenerating(ignoreAtTagWhenCopyingAndGenerating);
    setLocalEnableStoryboardGenGridPreviewShortcut(enableStoryboardGenGridPreviewShortcut);
    setLocalShowStoryboardGenAdvancedRatioControls(showStoryboardGenAdvancedRatioControls);
    setLocalAccentColor(accentColor);
    setLocalCanvasEdgeRoutingMode(canvasEdgeRoutingMode);
    setLocalTextApis(textApis);
    setLocalImagePolishPrompt(imagePolishPrompt);
    setLocalVideoApis(videoApis);
    setIsOpenAiApiKeyRevealed(false);
    setIsChaomoApiKeyRevealed(false);
    setModelDiscoveryState({
      'ai-media': { isLoading: false, error: null },
      chaomo: { isLoading: false, error: null },
    });
    setLocalDownloadPathInput('');
  }, [
    isOpen,
    openAiImageApi,
    chaomoImageApi,
    downloadPresetPaths,
    useUploadFilenameAsNodeTitle,
    storyboardGenKeepStyleConsistent,
    storyboardGenDisableTextInImage,
    storyboardGenAutoInferEmptyFrame,
    ignoreAtTagWhenCopyingAndGenerating,
    enableStoryboardGenGridPreviewShortcut,
    showStoryboardGenAdvancedRatioControls,
    accentColor,
    canvasEdgeRoutingMode,
    textApis,
    imagePolishPrompt,
    videoApis,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveCategory(initialCategory);
  }, [initialCategory, isOpen]);

  const handleDiscoverImageModels = useCallback(
    async (providerId: ImageProviderId, config: OpenAiImageApiConfig | ChaomoImageApiConfig) => {
      setModelDiscoveryState((previous) => ({
        ...previous,
        [providerId]: { isLoading: true, error: null },
      }));

      try {
        const models = await discoverImageModels({
          provider_id: providerId,
          base_url: config.baseUrl,
          api_key: config.apiKey,
        });
        const modelCatalog: ImageModelCatalog = {
          models: models.map((model) => ({
            id: toConfiguredImageModelId(providerId, model.id),
            ...(model.label ? { label: model.label } : {}),
          })),
          refreshedAt: Date.now(),
        };
        const selectedModelIds = new Set(config.selectedModelIds);
        const nextConfig = {
          ...config,
          modelCatalog,
          selectedModelIds: modelCatalog.models
            .map((model) => model.id)
            .filter((modelId) => selectedModelIds.has(modelId)),
        };

        if (providerId === 'ai-media') {
          setLocalOpenAiImageApi(nextConfig);
        } else {
          setLocalChaomoImageApi(nextConfig);
        }
      } catch (error) {
        setModelDiscoveryState((previous) => ({
          ...previous,
          [providerId]: {
            isLoading: false,
            error: error instanceof Error ? error.message : t('settings.imageModelsFetchFailed'),
          },
        }));
        return;
      }

      setModelDiscoveryState((previous) => ({
        ...previous,
        [providerId]: { isLoading: false, error: null },
      }));
    },
    [t]
  );

  const handleSave = useCallback(() => {
    setOpenAiImageApi(localOpenAiImageApi);
    setChaomoImageApi(localChaomoImageApi);
    setDownloadPresetPaths(localDownloadPresetPaths);
    setUseUploadFilenameAsNodeTitle(localUseUploadFilenameAsNodeTitle);
    setStoryboardGenKeepStyleConsistent(localStoryboardGenKeepStyleConsistent);
    setStoryboardGenDisableTextInImage(localStoryboardGenDisableTextInImage);
    setStoryboardGenAutoInferEmptyFrame(localStoryboardGenAutoInferEmptyFrame);
    setIgnoreAtTagWhenCopyingAndGenerating(localIgnoreAtTagWhenCopyingAndGenerating);
    setEnableStoryboardGenGridPreviewShortcut(localEnableStoryboardGenGridPreviewShortcut);
    setShowStoryboardGenAdvancedRatioControls(localShowStoryboardGenAdvancedRatioControls);
    setAccentColor(localAccentColor);
    setCanvasEdgeRoutingMode(localCanvasEdgeRoutingMode);
    setTextApis(localTextApis);
    setImagePolishPrompt(localImagePolishPrompt);
    setVideoApis(localVideoApis);
    onClose();
  }, [
    localOpenAiImageApi,
    localChaomoImageApi,
    localDownloadPresetPaths,
    localUseUploadFilenameAsNodeTitle,
    localStoryboardGenKeepStyleConsistent,
    localStoryboardGenDisableTextInImage,
    localStoryboardGenAutoInferEmptyFrame,
    localIgnoreAtTagWhenCopyingAndGenerating,
    localEnableStoryboardGenGridPreviewShortcut,
    localShowStoryboardGenAdvancedRatioControls,
    localAccentColor,
    localCanvasEdgeRoutingMode,
    localTextApis,
    localImagePolishPrompt,
    localVideoApis,
    setOpenAiImageApi,
    setChaomoImageApi,
    setDownloadPresetPaths,
    setUseUploadFilenameAsNodeTitle,
    setStoryboardGenKeepStyleConsistent,
    setStoryboardGenDisableTextInImage,
    setStoryboardGenAutoInferEmptyFrame,
    setIgnoreAtTagWhenCopyingAndGenerating,
    setEnableStoryboardGenGridPreviewShortcut,
    setShowStoryboardGenAdvancedRatioControls,
    setAccentColor,
    setCanvasEdgeRoutingMode,
    setTextApis,
    setVideoApis,
    onClose,
  ]);

  const handlePickDownloadPath = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      setLocalDownloadPresetPaths((previous) => {
        if (previous.includes(selected)) {
          return previous;
        }
        return [...previous, selected].slice(0, 8);
      });
    } catch (error) {
      logger.error('Failed to pick download path', error);
    }
  }, []);

  const handleAddDownloadPathFromInput = useCallback(() => {
    const next = localDownloadPathInput.trim();
    if (!next) {
      return;
    }
    setLocalDownloadPresetPaths((previous) => {
      if (previous.includes(next)) {
        return previous;
      }
      return [...previous, next].slice(0, 8);
    });
    setLocalDownloadPathInput('');
  }, [localDownloadPathInput]);

  const handleRemoveDownloadPath = useCallback((path: string) => {
    setLocalDownloadPresetPaths((previous) => previous.filter((value) => value !== path));
  }, []);

  const categoryButtonClass = (category: SettingsCategory) =>
    `mx-2 flex w-[calc(100%-1rem)] items-center rounded-lg px-3 py-2 text-left text-sm transition-colors ${
      activeCategory === category
        ? 'bg-accent/14 font-medium text-accent'
        : 'text-text-muted hover:bg-[var(--ui-hover)] hover:text-text-dark'
    }`;

  if (!shouldRender) return null;

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

          {/* Sidebar */}
          <div className="flex w-[200px] shrink-0 flex-col border-r border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)]">
            <div className="px-4 py-4">
              <span className="text-xs font-medium text-text-muted">
                {t('settings.title')}
              </span>
            </div>

            <nav className="flex-1">
              <button
                onClick={() => setActiveCategory('general')}
                className={categoryButtonClass('general')}
              >
                <span className="text-sm">{t('settings.general')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('imageApis')}
                className={categoryButtonClass('imageApis')}
              >
                <span className="text-sm">{t('settings.imageApis')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('appearance')}
                className={categoryButtonClass('appearance')}
              >
                <span className="text-sm">{t('settings.appearance')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('experimental')}
                className={categoryButtonClass('experimental')}
              >
                <span className="text-sm">{t('settings.experimental')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('textApis')}
                className={categoryButtonClass('textApis')}
              >
                <span className="text-sm">{t('settings.textApis')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('videoApis')}
                className={categoryButtonClass('videoApis')}
              >
                <span className="text-sm">{t('settings.videoApis')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('logging')}
                className={categoryButtonClass('logging')}
              >
                <span className="text-sm">{t('settings.logging')}</span>
              </button>
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col">
            {activeCategory === 'imageApis' && (
              <>
                <div className="border-b border-[var(--ui-border-soft)] px-6 py-4">
                  <h2 className="text-base font-semibold text-text-dark">
                    {t('settings.imageApis')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.imageApisDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 overflow-y-auto px-6 py-2">
                  <div className="border-b border-[var(--ui-border-soft)] py-4">
                    <div className="mb-4">
                      <h3 className="text-sm font-medium text-text-dark">
                        {t('settings.openAiImageApi')}
                      </h3>
                      <p className="mt-1 text-xs text-text-muted">
                        {t('settings.openAiImageApiDesc')}
                      </p>
                    </div>

                    <div className="space-y-3">
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-text-dark">
                          {t('settings.openAiImageBaseUrl')}
                        </span>
                        <input
                          type="url"
                          value={localOpenAiImageApi.baseUrl}
                            onChange={(event) =>
                              setLocalOpenAiImageApi((previous) => ({
                                ...previous,
                                baseUrl: event.target.value,
                                modelCatalog: null,
                                selectedModelIds: [],
                              }))
                            }
                          className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-text-dark">
                          {t('settings.openAiImageApiKey')}
                        </span>
                        <div className="relative">
                          <input
                            type={isOpenAiApiKeyRevealed ? 'text' : 'password'}
                            value={localOpenAiImageApi.apiKey}
                            onChange={(event) =>
                              setLocalOpenAiImageApi((previous) => ({
                                ...previous,
                                apiKey: event.target.value,
                                modelCatalog: null,
                                selectedModelIds: [],
                              }))
                            }
                            placeholder={t('settings.enterApiKey')}
                            className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 pr-10 text-sm text-text-dark placeholder:text-text-muted"
                          />
                          <UiTooltip content={isOpenAiApiKeyRevealed ? t('settings.hideApiKey') : t('settings.showApiKey')}>
                            <button
                              type="button"
                              aria-label={isOpenAiApiKeyRevealed ? t('settings.hideApiKey') : t('settings.showApiKey')}
                              onClick={() => setIsOpenAiApiKeyRevealed((visible) => !visible)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-[var(--ui-hover)]"
                            >
                              {isOpenAiApiKeyRevealed ? (
                                <EyeOff className="h-4 w-4 text-text-muted" />
                              ) : (
                                <Eye className="h-4 w-4 text-text-muted" />
                              )}
                            </button>
                          </UiTooltip>
                        </div>
                      </label>

                      <ImageModelSelectionPanel
                        catalog={localOpenAiImageApi.modelCatalog}
                        selectedModelIds={localOpenAiImageApi.selectedModelIds}
                        isLoading={modelDiscoveryState['ai-media'].isLoading}
                        error={modelDiscoveryState['ai-media'].error}
                        onRefresh={() => void handleDiscoverImageModels('ai-media', localOpenAiImageApi)}
                        onSelectionChange={(modelId, selected) =>
                          setLocalOpenAiImageApi((previous) => ({
                            ...previous,
                            selectedModelIds: selected
                              ? Array.from(new Set([...previous.selectedModelIds, modelId]))
                              : previous.selectedModelIds.filter((id) => id !== modelId),
                          }))
                        }
                        refreshLabel={t('settings.imageModelsFetch')}
                        refreshingLabel={t('settings.imageModelsFetching')}
                        noModelsLabel={t('settings.imageModelsEmpty')}
                        selectModelsLabel={t('settings.imageModelsSelect')}
                      />
                    </div>
                  </div>

                  <div className="py-4">
                    <div className="mb-4">
                      <h3 className="text-sm font-medium text-text-dark">
                        {t('settings.chaomoImageApi')}
                      </h3>
                      <p className="mt-1 text-xs text-text-muted">
                        {t('settings.chaomoImageApiDesc')}
                      </p>
                    </div>

                    <div className="space-y-3">
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-text-dark">
                          {t('settings.openAiImageBaseUrl')}
                        </span>
                        <input
                          type="url"
                          value={localChaomoImageApi.baseUrl}
                            onChange={(event) =>
                              setLocalChaomoImageApi((previous) => ({
                                ...previous,
                                baseUrl: event.target.value,
                                modelCatalog: null,
                                selectedModelIds: [],
                              }))
                          }
                          className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-text-dark">
                          {t('settings.openAiImageApiKey')}
                        </span>
                        <div className="relative">
                          <input
                            type={isChaomoApiKeyRevealed ? 'text' : 'password'}
                            value={localChaomoImageApi.apiKey}
                            onChange={(event) =>
                              setLocalChaomoImageApi((previous) => ({
                                ...previous,
                                apiKey: event.target.value,
                                modelCatalog: null,
                                selectedModelIds: [],
                              }))
                            }
                            placeholder={t('settings.enterApiKey')}
                            className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 pr-10 text-sm text-text-dark placeholder:text-text-muted"
                          />
                          <UiTooltip content={isChaomoApiKeyRevealed ? t('settings.hideApiKey') : t('settings.showApiKey')}>
                            <button
                              type="button"
                              aria-label={isChaomoApiKeyRevealed ? t('settings.hideApiKey') : t('settings.showApiKey')}
                              onClick={() => setIsChaomoApiKeyRevealed((visible) => !visible)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-[var(--ui-hover)]"
                            >
                              {isChaomoApiKeyRevealed ? (
                                <EyeOff className="h-4 w-4 text-text-muted" />
                              ) : (
                                <Eye className="h-4 w-4 text-text-muted" />
                              )}
                            </button>
                          </UiTooltip>
                        </div>
                      </label>

                      <ImageModelSelectionPanel
                        catalog={localChaomoImageApi.modelCatalog}
                        selectedModelIds={localChaomoImageApi.selectedModelIds}
                        isLoading={modelDiscoveryState.chaomo.isLoading}
                        error={modelDiscoveryState.chaomo.error}
                        onRefresh={() => void handleDiscoverImageModels('chaomo', localChaomoImageApi)}
                        onSelectionChange={(modelId, selected) =>
                          setLocalChaomoImageApi((previous) => ({
                            ...previous,
                            selectedModelIds: selected
                              ? Array.from(new Set([...previous.selectedModelIds, modelId]))
                              : previous.selectedModelIds.filter((id) => id !== modelId),
                          }))
                        }
                        refreshLabel={t('settings.imageModelsFetch')}
                        refreshingLabel={t('settings.imageModelsFetching')}
                        noModelsLabel={t('settings.imageModelsEmpty')}
                        selectModelsLabel={t('settings.imageModelsSelect')}
                      />
                    </div>
                  </div>

                  {/* 全局图片润色提示词模板 */}
                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-sm font-medium text-text-dark">
                        图片提示词润色模板
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setLocalImagePolishPrompt(DEFAULT_TEXT_API_PROMPT);
                        }}
                        className="text-xs text-accent hover:underline"
                      >
                        恢复默认
                      </button>
                    </div>
                    <textarea
                      value={localImagePolishPrompt}
                      onChange={(e) => {
                        setLocalImagePolishPrompt(e.target.value);
                      }}
                      rows={6}
                      placeholder="设置图片提示词润色的系统提示词模板。"
                      className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark resize-none"
                    />
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-border-dark flex justify-end">
                  <button
                    onClick={handleSave}
                    className="px-4 py-2 text-sm font-medium bg-accent text-[var(--accent-foreground)] rounded
                             hover:bg-accent/80 transition-colors"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'appearance' && (
              <>
                <div className="border-b border-[var(--ui-border-soft)] px-6 py-4">
                  <h2 className="text-base font-semibold text-text-dark">
                    {t('settings.appearance')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.appearanceDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 overflow-y-auto px-6">
                  <section className="border-b border-[var(--ui-border-soft)] py-5">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.edgeRoutingMode')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.edgeRoutingModeDesc')}
                    </p>
                    <div className="mt-3">
                      <UiSelect
                        value={localCanvasEdgeRoutingMode}
                        onChange={(event) =>
                          setLocalCanvasEdgeRoutingMode(
                            event.target.value as typeof localCanvasEdgeRoutingMode
                          )
                        }
                        className="h-9 text-sm"
                      >
                        <option value="spline">{t('settings.edgeRoutingSpline')}</option>
                        <option value="orthogonal">{t('settings.edgeRoutingOrthogonal')}</option>
                        <option value="smartOrthogonal">{t('settings.edgeRoutingSmartOrthogonal')}</option>
                      </UiSelect>
                    </div>
                  </section>

                  <section className="py-5">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.accentColor')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.accentColorDesc')}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="color"
                        value={localAccentColor}
                        onChange={(event) => setLocalAccentColor(event.target.value)}
                        className="h-9 w-12 rounded-lg border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)] p-1"
                      />
                      <input
                        value={localAccentColor}
                        onChange={(event) => setLocalAccentColor(event.target.value)}
                        placeholder={DEFAULT_ACCENT_COLOR}
                        className="h-9 flex-1 rounded-lg border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)] px-3 font-mono text-sm text-text-dark outline-none placeholder:text-text-muted focus:border-accent"
                      />
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded-lg border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)] px-3 text-xs text-text-dark transition-colors hover:bg-[var(--ui-hover)]"
                        onClick={() => setLocalAccentColor(DEFAULT_ACCENT_COLOR)}
                      >
                        {t('settings.resetAccentColor')}
                      </button>
                    </div>
                  </section>
                </div>

                <div className="flex justify-end border-t border-[var(--ui-border-soft)] px-6 py-4">
                  <button
                    onClick={handleSave}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] transition-colors hover:bg-accent/85"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'general' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.general')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.generalDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <SettingsCheckboxCard
                    checked={localStoryboardGenKeepStyleConsistent}
                    onCheckedChange={setLocalStoryboardGenKeepStyleConsistent}
                    title={t('settings.storyboardGenKeepStyleConsistent')}
                    description={t('settings.storyboardGenKeepStyleConsistentDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localIgnoreAtTagWhenCopyingAndGenerating}
                    onCheckedChange={setLocalIgnoreAtTagWhenCopyingAndGenerating}
                    title={t('settings.ignoreAtTagWhenCopyingAndGenerating')}
                    description={t('settings.ignoreAtTagWhenCopyingAndGeneratingDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localStoryboardGenDisableTextInImage}
                    onCheckedChange={setLocalStoryboardGenDisableTextInImage}
                    title={t('settings.storyboardGenDisableTextInImage')}
                    description={t('settings.storyboardGenDisableTextInImageDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localUseUploadFilenameAsNodeTitle}
                    onCheckedChange={setLocalUseUploadFilenameAsNodeTitle}
                    title={t('settings.useUploadFilenameAsNodeTitle')}
                    description={t('settings.useUploadFilenameAsNodeTitleDesc')}
                  />

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-medium text-text-dark">
                        {t('settings.downloadPresetPaths')}
                      </h3>
                      <p className="mt-1 text-xs text-text-muted">
                        {t('settings.downloadPresetPathsDesc')}
                      </p>
                    </div>

                    <div className="mb-2 flex items-center gap-2">
                      <input
                        value={localDownloadPathInput}
                        onChange={(event) => setLocalDownloadPathInput(event.target.value)}
                        placeholder={t('settings.downloadPathPlaceholder')}
                        className="h-9 flex-1 rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted"
                      />
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                        onClick={handleAddDownloadPathFromInput}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        {t('settings.addPath')}
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                        onClick={() => {
                          void handlePickDownloadPath();
                        }}
                      >
                        <FolderOpen className="mr-1 h-3.5 w-3.5" />
                        {t('settings.chooseFolder')}
                      </button>
                    </div>

                    <div className="space-y-1">
                      {localDownloadPresetPaths.length > 0 ? (
                        localDownloadPresetPaths.map((path) => (
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
                                onClick={() => handleRemoveDownloadPath(path)}
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
                  </div>
                </div>

                <div className="flex justify-end border-t border-border-dark px-6 py-4">
                  <button
                    onClick={handleSave}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] transition-colors hover:bg-accent/85"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'experimental' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.experimental')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.experimentalDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <SettingsCheckboxCard
                    checked={localEnableStoryboardGenGridPreviewShortcut}
                    onCheckedChange={setLocalEnableStoryboardGenGridPreviewShortcut}
                    title={t('settings.enableStoryboardGenGridPreviewShortcut')}
                    description={t('settings.enableStoryboardGenGridPreviewShortcutDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localShowStoryboardGenAdvancedRatioControls}
                    onCheckedChange={setLocalShowStoryboardGenAdvancedRatioControls}
                    title={t('settings.showStoryboardGenAdvancedRatioControls')}
                    description={t('settings.showStoryboardGenAdvancedRatioControlsDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localStoryboardGenAutoInferEmptyFrame}
                    onCheckedChange={setLocalStoryboardGenAutoInferEmptyFrame}
                    title={t('settings.storyboardGenAutoInferEmptyFrame')}
                    description={t('settings.storyboardGenAutoInferEmptyFrameDesc')}
                  />
                </div>

                <div className="flex justify-end border-t border-border-dark px-6 py-4">
                  <button
                    onClick={handleSave}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] transition-colors hover:bg-accent/85"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'textApis' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.textApis')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.textApisDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  {localTextApis.length === 0 ? (
                    <div className="rounded-lg border border-border-dark bg-bg-dark p-4 text-center text-sm text-text-muted">
                      {t('settings.noTextApisConfigured')}
                    </div>
                  ) : (
                    localTextApis.map((api, index) => (
                      <div key={api.id} className="rounded-lg border border-border-dark bg-bg-dark p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-medium text-text-dark">{api.name}</h3>
                            {api.enabled && (
                              <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
                                {t('settings.textApiActive')}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer">
                              <input
                                type="checkbox"
                                checked={api.enabled}
                                onChange={(e) => {
                                  const updated = localTextApis.map((a, i) => ({
                                    ...a,
                                    enabled: i === index ? e.target.checked : false,
                                  }));
                                  setLocalTextApis(updated);
                                }}
                                className="rounded border-border-dark"
                              />
                              {t('settings.textApiEnabled')}
                            </label>
                            <UiTooltip content={t('settings.removeTextApi')}>
                              <button
                                type="button"
                                aria-label={t('settings.removeTextApi')}
                                onClick={() => {
                                  const updated = localTextApis.filter((_, i) => i !== index);
                                  setLocalTextApis(updated);
                                }}
                                className="inline-flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </UiTooltip>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-text-dark">
                              {t('settings.textApiName')}
                            </label>
                            <input
                              type="text"
                              value={api.name}
                              onChange={(e) => {
                                const updated = [...localTextApis];
                                updated[index] = { ...updated[index], name: e.target.value };
                                setLocalTextApis(updated);
                              }}
                              className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium text-text-dark">
                              {t('settings.textApiKey')}
                            </label>
                            <input
                              type="password"
                              value={api.apiKey}
                              onChange={(e) => {
                                const updated = [...localTextApis];
                                updated[index] = { ...updated[index], apiKey: e.target.value };
                                setLocalTextApis(updated);
                              }}
                              placeholder={t('settings.enterApiKey')}
                              className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium text-text-dark">
                              {t('settings.textApiBaseUrl')}
                            </label>
                            <input
                              type="text"
                              value={api.baseUrl}
                              onChange={(e) => {
                                const updated = [...localTextApis];
                                updated[index] = { ...updated[index], baseUrl: e.target.value };
                                setLocalTextApis(updated);
                              }}
                              className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium text-text-dark">
                              {t('settings.textApiModel')}
                            </label>
                            <input
                              type="text"
                              value={api.modelId}
                              onChange={(e) => {
                                const updated = [...localTextApis];
                                updated[index] = { ...updated[index], modelId: e.target.value };
                                setLocalTextApis(updated);
                              }}
                              className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark"
                            />
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                setTestingApiId(api.id);
                                try {
                                  const result = await testTextApi(api);
                                  alert(`测试成功！\n\nAI回复：${result.message}`);
                                } catch (err) {
                                  alert(`测试失败：${err instanceof Error ? err.message : '未知错误'}`);
                                } finally {
                                  setTestingApiId(null);
                                }
                              }}
                              disabled={testingApiId === api.id || !api.apiKey || !api.baseUrl}
                              className="inline-flex h-8 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark disabled:opacity-50"
                            >
                              {testingApiId === api.id ? (
                                <>
                                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                                  测试中...
                                </>
                              ) : (
                                '测试连接'
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const newApi = {
                        id: `custom-${Date.now()}`,
                        name: 'Custom API',
                        apiKey: '',
                        baseUrl: '',
                        modelId: 'custom-model',
                        enabled: false,
                      };
                      setLocalTextApis([...localTextApis, newApi]);
                    }}
                    className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-4 text-sm text-text-dark transition-colors hover:bg-bg-dark"
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    {t('settings.addTextApi')}
                  </button>
                </div>

                <div className="flex justify-end border-t border-border-dark px-6 py-4">
                  <button
                    onClick={handleSave}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] transition-colors hover:bg-accent/85"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'videoApis' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.videoApis')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.videoApisDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  {localVideoApis.length === 0 ? (
                    <div className="rounded-lg border border-border-dark bg-bg-dark p-4 text-center text-sm text-text-muted">
                      {t('settings.noVideoApisConfigured')}
                    </div>
                  ) : (
                    localVideoApis.map((api, index) => (
                      <div key={api.id} className="rounded-lg border border-border-dark bg-bg-dark p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-medium text-text-dark">{api.name}</h3>
                            {api.modelId && (
                              <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-text-muted">
                                {api.modelId}
                              </span>
                            )}
                          </div>
                          <UiTooltip content={t('settings.removeVideoApi')}>
                            <button
                              type="button"
                              aria-label={t('settings.removeVideoApi')}
                              onClick={() => {
                                const updated = localVideoApis.filter((_, i) => i !== index);
                                setLocalVideoApis(updated);
                              }}
                              className="inline-flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </UiTooltip>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-text-dark">
                              {t('settings.videoApiName')}
                            </label>
                            <input
                              type="text"
                              value={api.name}
                              onChange={(e) => {
                                const updated = [...localVideoApis];
                                updated[index] = { ...updated[index], name: e.target.value };
                                setLocalVideoApis(updated);
                              }}
                              className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium text-text-dark">
                              {t('settings.videoApiKey')}
                            </label>
                            <input
                              type="password"
                              value={api.apiKey}
                              onChange={(e) => {
                                const updated = [...localVideoApis];
                                updated[index] = { ...updated[index], apiKey: e.target.value };
                                setLocalVideoApis(updated);
                              }}
                              placeholder={t('settings.enterApiKey')}
                              className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium text-text-dark">
                              {t('settings.videoApiBaseUrl')}
                            </label>
                            <input
                              type="text"
                              value={api.baseUrl}
                              onChange={(e) => {
                                const updated = [...localVideoApis];
                                updated[index] = { ...updated[index], baseUrl: e.target.value };
                                setLocalVideoApis(updated);
                              }}
                              className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium text-text-dark">
                              {t('settings.videoApiModel')}
                            </label>
                            <input
                              type="text"
                              value={api.modelId}
                              onChange={(e) => {
                                const updated = [...localVideoApis];
                                updated[index] = { ...updated[index], modelId: e.target.value };
                                setLocalVideoApis(updated);
                              }}
                              className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark"
                            />
                          </div>

                          <div>
                            <div className="mb-1 flex items-center justify-between">
                              <label className="text-xs font-medium text-text-dark">
                                提示词润色模板
                              </label>
                              <button
                                type="button"
                                onClick={() => {
                                  const api = localVideoApis[index];
                                  // 根据 modelId 判断使用哪个默认模板
                                  const modelId = api.modelId || '';
                                  let defaultTemplate = DEFAULT_VIDEO_SD10_POLISH_PROMPT;
                                  if (modelId.includes('1-5-pro')) {
                                    defaultTemplate = DEFAULT_VIDEO_SD15_PROMPT;
                                  }
                                  const updated = [...localVideoApis];
                                  updated[index] = {
                                    ...updated[index],
                                    polishPrompt: api.defaultPolishPrompt || defaultTemplate,
                                  };
                                  setLocalVideoApis(updated);
                                }}
                                className="text-xs text-accent hover:underline"
                              >
                                恢复默认
                              </button>
                            </div>
                            <textarea
                              value={api.polishPrompt ?? ''}
                              onChange={(e) => {
                                const updated = [...localVideoApis];
                                updated[index] = {
                                  ...updated[index],
                                  polishPrompt: e.target.value,
                                };
                                setLocalVideoApis(updated);
                              }}
                              rows={6}
                              placeholder="设置该模型的提示词润色模板，留空则使用默认模板。"
                              className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark resize-none"
                            />
                          </div>
                        </div>
                      </div>
                    ))
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const newApi = {
                        id: `custom-video-${Date.now()}`,
                        name: 'Custom Video API',
                        apiKey: '',
                        baseUrl: '',
                        modelId: 'custom-video-model',
                        enabled: false,
                        defaultPolishPrompt: DEFAULT_VIDEO_SD10_POLISH_PROMPT,
                      };
                      setLocalVideoApis([...localVideoApis, newApi]);
                    }}
                    className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-4 text-sm text-text-dark transition-colors hover:bg-bg-dark"
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    {t('settings.addVideoApi')}
                  </button>
                </div>

                <div className="flex justify-end border-t border-border-dark px-6 py-4">
                  <button
                    onClick={handleSave}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] transition-colors hover:bg-accent/85"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'logging' && (
              <>
                <div className="border-b border-[var(--ui-border-soft)] px-6 py-4">
                  <h2 className="text-base font-semibold text-text-dark">
                    {t('settings.logging')}
                  </h2>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <LoggingSettings />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LoggingSettings(): JSX.Element {
  const { t } = useTranslation();
  const [config, setLocal] = useState(getLogConfig());
  const [moduleText, setModuleText] = useState(
    Object.entries(config.moduleLevels).map(([k, v]) => `${k}=${v}`).join(',')
  );

  function commitModuleText(text: string) {
    setModuleText(text);
    const out: Record<string, 'debug' | 'info' | 'warn' | 'error'> = {};
    for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [k, v] = part.split('=');
      if (k && (v === 'debug' || v === 'info' || v === 'warn' || v === 'error')) {
        out[k] = v;
      }
    }
    setLogConfig({ moduleLevels: out });
    setLocal(getLogConfig());
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-text-dark">{t('logger.settings.globalLevel')}</label>
        <UiSelect
          className="h-9 w-40 font-mono text-sm"
          value={config.level}
          onChange={(e) => {
            setLogConfig({ level: e.target.value as 'debug' | 'info' | 'warn' | 'error' });
            setLocal(getLogConfig());
          }}
        >
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </UiSelect>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-text-dark">{t('logger.settings.moduleOverride')}</label>
        <UiInput
          type="text"
          className="h-9 max-w-xl font-mono text-sm"
          value={moduleText}
          onChange={(e) => commitModuleText(e.target.value)}
          placeholder={t('logger.settings.moduleOverridePlaceholder')}
        />
        <p className="mt-1.5 text-xs text-text-muted">{t('logger.settings.moduleOverrideHint')}</p>
      </div>

      <div className="flex flex-wrap gap-4 border-y border-[var(--ui-border-soft)] py-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-text-dark">
          <UiCheckbox
            aria-label={t('logger.settings.consoleOutput')}
            checked={config.console}
            onCheckedChange={(checked) => {
              setLogConfig({ console: checked });
              setLocal(getLogConfig());
            }}
          />
          <span>{t('logger.settings.consoleOutput')}</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-text-dark">
          <UiCheckbox
            aria-label={t('logger.settings.persist')}
            checked={config.persist}
            onCheckedChange={(checked) => {
              setLogConfig({ persist: checked });
              setLocal(getLogConfig());
            }}
          />
          <span>{t('logger.settings.persist')}</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-text-dark">
          <UiCheckbox
            aria-label={t('logger.settings.consoleTimestamps')}
            checked={config.consoleTimestamps}
            onCheckedChange={(checked) => {
              setLogConfig({ consoleTimestamps: checked });
              setLocal(getLogConfig());
            }}
          />
          <span>{t('logger.settings.consoleTimestamps')}</span>
        </label>
      </div>

      <div className="flex gap-2">
        <UiButton
          size="sm"
          onClick={async () => {
            try {
              await invoke('open_log_dir');
            } catch {
              alert(t('logger.settings.openFolderError'));
            }
          }}
        >
          {t('logger.settings.openFolder')}
        </UiButton>
        <UiButton
          size="sm"
          onClick={() => {
            const entries = useLogStore.getState().snapshot().slice(-100);
            navigator.clipboard.writeText(
              entries.map((e) => `[${e.level}] ${e.target}: ${e.message}`).join('\n')
            );
          }}
        >
          {t('logger.settings.copyAll')}
        </UiButton>
        <UiButton
          size="sm"
          onClick={() => {
            resetLogConfig();
            setLocal(getLogConfig());
            setModuleText('');
          }}
        >
          {t('logger.settings.reset')}
        </UiButton>
      </div>
    </div>
  );
}
