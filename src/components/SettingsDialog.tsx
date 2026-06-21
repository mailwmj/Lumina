import { useState, useCallback, useEffect, useMemo } from 'react';
import { X, Eye, EyeOff, FolderOpen, Loader2, Plus, Trash2 } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getLogConfig, setLogConfig, resetLogConfig, useLogStore } from '@/lib/logger';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore, type TextApiConfig, type VideoApiConfig, DEFAULT_TEXT_API_PROMPT, DEFAULT_VIDEO_SD10_POLISH_PROMPT, DEFAULT_VIDEO_SD15_PROMPT } from '@/stores/settingsStore';
import { testTextApi } from '@/features/canvas/infrastructure/textPolishService';
import { UiCheckbox, UiSelect } from '@/components/ui';
import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion';
import { useDialogTransition } from '@/components/ui/useDialogTransition';
import { listModelProviders } from '@/features/canvas/models';
import { GRSAI_NANO_BANANA_PRO_MODEL_OPTIONS } from '@/features/canvas/models/providers/grsai';
import { GRSAI_CREDIT_TIERS } from '@/features/canvas/pricing/types';
import providerGuideMarkdown from '../../docs/settings/provider-guide.md?raw';
import type { SettingsCategory } from '@/features/settings/settingsEvents';
import { logger } from '@/lib/logger';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialCategory?: SettingsCategory;
  onCheckUpdate?: () => Promise<'has-update' | 'up-to-date' | 'failed'>;
}

interface SettingsCheckboxCardProps {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

const PROVIDER_REGISTER_URLS: Record<string, string> = {
  ppio: 'https://ppio.com/user/register?invited_by=WGY0DZ',
  grsai: 'https://grsai.com',
  kie: 'https://kie.ai?ref=eef20ef0b0595cad227d45b29c635f6c',
  fal: 'https://fal.ai',
};

const PROVIDER_GET_KEY_URLS: Record<string, string> = {
  ppio: 'https://ppio.com/settings/key-management',
  grsai: 'https://grsai.com/zh/dashboard/api-keys',
  kie: 'https://kie.ai/api-key',
  fal: 'https://fal.ai/dashboard/keys',
};

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
      className="w-full rounded-lg border border-border-dark bg-bg-dark p-4 text-left transition-colors hover:border-[rgba(255,255,255,0.2)]"
    >
      <div className="flex items-start gap-3">
        <UiCheckbox
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
  onCheckUpdate,
}: SettingsDialogProps) {
  const { t, i18n } = useTranslation();
  const {
    apiKeys,
    grsaiNanoBananaProModel,
    hideProviderGuidePopover,
    downloadPresetPaths,
    useUploadFilenameAsNodeTitle,
    storyboardGenKeepStyleConsistent,
    storyboardGenDisableTextInImage,
    storyboardGenAutoInferEmptyFrame,
    ignoreAtTagWhenCopyingAndGenerating,
    enableStoryboardGenGridPreviewShortcut,
    showStoryboardGenAdvancedRatioControls,
    showNodePrice,
    priceDisplayCurrencyMode,
    usdToCnyRate,
    preferDiscountedPrice,
    grsaiCreditTierId,
    uiRadiusPreset,
    themeTonePreset,
    accentColor,
    canvasEdgeRoutingMode,
    autoCheckAppUpdateOnLaunch,
    enableUpdateDialog,
    setProviderApiKey,
    setGrsaiNanoBananaProModel,
    setDownloadPresetPaths,
    setUseUploadFilenameAsNodeTitle,
    setStoryboardGenKeepStyleConsistent,
    setStoryboardGenDisableTextInImage,
    setStoryboardGenAutoInferEmptyFrame,
    setIgnoreAtTagWhenCopyingAndGenerating,
    setEnableStoryboardGenGridPreviewShortcut,
    setShowStoryboardGenAdvancedRatioControls,
    setShowNodePrice,
    setPriceDisplayCurrencyMode,
    setUsdToCnyRate,
    setPreferDiscountedPrice,
    setGrsaiCreditTierId,
    setUiRadiusPreset,
    setThemeTonePreset,
    setAccentColor,
    setCanvasEdgeRoutingMode,
    setAutoCheckAppUpdateOnLaunch,
    setEnableUpdateDialog,
    textApis,
    setTextApis,
    imagePolishPrompt,
    setImagePolishPrompt,
    videoApis,
    setVideoApis,
  } = useSettingsStore();
  const providers = useMemo(() => {
    const providerOrder = ['kie', 'ppio', 'fal', 'grsai'];
    const providerIndex = new Map(providerOrder.map((id, index) => [id, index]));
    return listModelProviders().slice().sort((left, right) => {
      const leftIndex = providerIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = providerIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
  }, []);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(initialCategory);
  const [appVersion, setAppVersion] = useState<string>('');
  const [localApiKeys, setLocalApiKeys] = useState<Record<string, string>>(apiKeys);
  const [localGrsaiNanoBananaProModel, setLocalGrsaiNanoBananaProModel] = useState(
    grsaiNanoBananaProModel
  );
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
  const [localShowNodePrice, setLocalShowNodePrice] = useState(showNodePrice);
  const [localPriceDisplayCurrencyMode, setLocalPriceDisplayCurrencyMode] = useState(
    priceDisplayCurrencyMode
  );
  const [localUsdToCnyRate, setLocalUsdToCnyRate] = useState(String(usdToCnyRate));
  const [localPreferDiscountedPrice, setLocalPreferDiscountedPrice] = useState(
    preferDiscountedPrice
  );
  const [localGrsaiCreditTierId, setLocalGrsaiCreditTierId] = useState(grsaiCreditTierId);
  const [localUiRadiusPreset, setLocalUiRadiusPreset] = useState(uiRadiusPreset);
  const [localThemeTonePreset, setLocalThemeTonePreset] = useState(themeTonePreset);
  const [localAccentColor, setLocalAccentColor] = useState(accentColor);
  const [localCanvasEdgeRoutingMode, setLocalCanvasEdgeRoutingMode] = useState(canvasEdgeRoutingMode);
  const [localAutoCheckAppUpdateOnLaunch, setLocalAutoCheckAppUpdateOnLaunch] = useState(
    autoCheckAppUpdateOnLaunch
  );
  const [localEnableUpdateDialog, setLocalEnableUpdateDialog] = useState(enableUpdateDialog);
  const [checkUpdateStatus, setCheckUpdateStatus] = useState<'' | 'checking' | 'has-update' | 'up-to-date' | 'failed'>('');
  const [revealedApiKeys, setRevealedApiKeys] = useState<Record<string, boolean>>({});
  const [localTextApis, setLocalTextApis] = useState<TextApiConfig[]>(textApis);
  const [localImagePolishPrompt, setLocalImagePolishPrompt] = useState<string>(imagePolishPrompt);
  const [localVideoApis, setLocalVideoApis] = useState<VideoApiConfig[]>(videoApis);
  const [testingApiId, setTestingApiId] = useState<string | null>(null);
  const { shouldRender, isVisible } = useDialogTransition(isOpen, UI_DIALOG_TRANSITION_MS);

  useEffect(() => {
    let mounted = true;
    const loadAppVersion = async () => {
      try {
        const version = await getVersion();
        if (mounted) {
          setAppVersion(version);
        }
      } catch {
        if (mounted) {
          setAppVersion('');
        }
      }
    };
    void loadAppVersion();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setLocalApiKeys(apiKeys);
    setLocalDownloadPresetPaths(downloadPresetPaths);
    setLocalGrsaiNanoBananaProModel(grsaiNanoBananaProModel);
    setLocalUseUploadFilenameAsNodeTitle(useUploadFilenameAsNodeTitle);
    setLocalStoryboardGenKeepStyleConsistent(storyboardGenKeepStyleConsistent);
    setLocalStoryboardGenDisableTextInImage(storyboardGenDisableTextInImage);
    setLocalStoryboardGenAutoInferEmptyFrame(storyboardGenAutoInferEmptyFrame);
    setLocalIgnoreAtTagWhenCopyingAndGenerating(ignoreAtTagWhenCopyingAndGenerating);
    setLocalEnableStoryboardGenGridPreviewShortcut(enableStoryboardGenGridPreviewShortcut);
    setLocalShowStoryboardGenAdvancedRatioControls(showStoryboardGenAdvancedRatioControls);
    setLocalShowNodePrice(showNodePrice);
    setLocalPriceDisplayCurrencyMode(priceDisplayCurrencyMode);
    setLocalUsdToCnyRate(String(usdToCnyRate));
    setLocalPreferDiscountedPrice(preferDiscountedPrice);
    setLocalGrsaiCreditTierId(grsaiCreditTierId);
    setLocalUiRadiusPreset(uiRadiusPreset);
    setLocalThemeTonePreset(themeTonePreset);
    setLocalAccentColor(accentColor);
    setLocalCanvasEdgeRoutingMode(canvasEdgeRoutingMode);
    setLocalAutoCheckAppUpdateOnLaunch(autoCheckAppUpdateOnLaunch);
    setLocalEnableUpdateDialog(enableUpdateDialog);
    setLocalTextApis(textApis);
    setLocalVideoApis(videoApis);
    setCheckUpdateStatus('');
    setRevealedApiKeys({});
    setLocalDownloadPathInput('');
  }, [
    isOpen,
    textApis,
    videoApis,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveCategory(initialCategory);
  }, [initialCategory, isOpen]);

  const handleSave = useCallback(() => {
    providers.forEach((provider) => {
      setProviderApiKey(provider.id, localApiKeys[provider.id] ?? '');
    });
    setGrsaiNanoBananaProModel(localGrsaiNanoBananaProModel);
    setDownloadPresetPaths(localDownloadPresetPaths);
    setUseUploadFilenameAsNodeTitle(localUseUploadFilenameAsNodeTitle);
    setStoryboardGenKeepStyleConsistent(localStoryboardGenKeepStyleConsistent);
    setStoryboardGenDisableTextInImage(localStoryboardGenDisableTextInImage);
    setStoryboardGenAutoInferEmptyFrame(localStoryboardGenAutoInferEmptyFrame);
    setIgnoreAtTagWhenCopyingAndGenerating(localIgnoreAtTagWhenCopyingAndGenerating);
    setEnableStoryboardGenGridPreviewShortcut(localEnableStoryboardGenGridPreviewShortcut);
    setShowStoryboardGenAdvancedRatioControls(localShowStoryboardGenAdvancedRatioControls);
    setShowNodePrice(localShowNodePrice);
    setPriceDisplayCurrencyMode(localPriceDisplayCurrencyMode);
    setUsdToCnyRate(Number(localUsdToCnyRate));
    setPreferDiscountedPrice(localPreferDiscountedPrice);
    setGrsaiCreditTierId(localGrsaiCreditTierId);
    setUiRadiusPreset(localUiRadiusPreset);
    setThemeTonePreset(localThemeTonePreset);
    setAccentColor(localAccentColor);
    setCanvasEdgeRoutingMode(localCanvasEdgeRoutingMode);
    setAutoCheckAppUpdateOnLaunch(localAutoCheckAppUpdateOnLaunch);
    setEnableUpdateDialog(localEnableUpdateDialog);
    setTextApis(localTextApis);
    setImagePolishPrompt(localImagePolishPrompt);
    setVideoApis(localVideoApis);
    onClose();
  }, [
    localApiKeys,
    localDownloadPresetPaths,
    localGrsaiNanoBananaProModel,
    localUseUploadFilenameAsNodeTitle,
    localStoryboardGenKeepStyleConsistent,
    localStoryboardGenDisableTextInImage,
    localStoryboardGenAutoInferEmptyFrame,
    localIgnoreAtTagWhenCopyingAndGenerating,
    localEnableStoryboardGenGridPreviewShortcut,
    localShowStoryboardGenAdvancedRatioControls,
    localShowNodePrice,
    localPriceDisplayCurrencyMode,
    localUsdToCnyRate,
    localPreferDiscountedPrice,
    localGrsaiCreditTierId,
    localUiRadiusPreset,
    localThemeTonePreset,
    localAccentColor,
    localCanvasEdgeRoutingMode,
    localAutoCheckAppUpdateOnLaunch,
    localEnableUpdateDialog,
    localTextApis,
    localImagePolishPrompt,
    localVideoApis,
    providers,
    setProviderApiKey,
    setGrsaiNanoBananaProModel,
    setDownloadPresetPaths,
    setUseUploadFilenameAsNodeTitle,
    setStoryboardGenKeepStyleConsistent,
    setStoryboardGenDisableTextInImage,
    setStoryboardGenAutoInferEmptyFrame,
    setIgnoreAtTagWhenCopyingAndGenerating,
    setEnableStoryboardGenGridPreviewShortcut,
    setShowStoryboardGenAdvancedRatioControls,
    setShowNodePrice,
    setPriceDisplayCurrencyMode,
    setUsdToCnyRate,
    setPreferDiscountedPrice,
    setGrsaiCreditTierId,
    setUiRadiusPreset,
    setThemeTonePreset,
    setAccentColor,
    setCanvasEdgeRoutingMode,
    setAutoCheckAppUpdateOnLaunch,
    setEnableUpdateDialog,
    setTextApis,
    setVideoApis,
    onClose,
  ]);

  const handleCheckUpdate = useCallback(async () => {
    if (!onCheckUpdate) {
      return;
    }

    setCheckUpdateStatus('checking');
    const status = await onCheckUpdate();
    setCheckUpdateStatus(status);
  }, [onCheckUpdate]);

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

  const handleMarkdownLinkClick = useCallback((href?: string) => {
    if (!href) {
      return;
    }
    void openUrl(href);
  }, []);

  if (!shouldRender) return null;

  return (
    <div className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-50 flex items-center justify-center`}>
      <div
        className={`absolute inset-0 bg-black/90 transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div className="relative w-[min(96vw,1120px)]">
        <div
          className={`relative mx-auto h-[500px] w-[700px] overflow-hidden rounded-lg border border-border-dark bg-surface-dark shadow-xl transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'} flex`}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1 hover:bg-bg-dark rounded transition-colors z-10"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>

          {/* Sidebar */}
          <div className="w-[180px] bg-bg-dark border-r border-border-dark flex flex-col">
            <div className="px-4 py-4">
              <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                {t('settings.title')}
              </span>
            </div>

            <nav className="flex-1">
              <button
                onClick={() => setActiveCategory('general')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'general'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.general')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('imageApis')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'imageApis'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.imageApis')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('appearance')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'appearance'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.appearance')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('pricing')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'pricing'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.pricing')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('experimental')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'experimental'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.experimental')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('textApis')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'textApis'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.textApis')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('about')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'about'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.about')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('videoApis')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'videoApis'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.videoApis')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('logging')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'logging'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">日志</span>
              </button>
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col">
            {activeCategory === 'imageApis' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.imageApis')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.imageApisDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  {providers.map((provider) => {
                    const displayName = i18n.language.startsWith('zh') ? provider.label : provider.name;
                    const isRevealed = Boolean(revealedApiKeys[provider.id]);

                    return (
                      <div key={provider.id} className="rounded-lg border border-border-dark bg-bg-dark p-4">
                        <div className="mb-3">
                          <h3 className="text-sm font-medium text-text-dark">{displayName}</h3>
                          {PROVIDER_REGISTER_URLS[provider.id] && PROVIDER_GET_KEY_URLS[provider.id] ? (
                            <p className="text-xs text-text-muted">
                              {t('settings.providerApiKeyGuidePrefix')}{' '}
                              <a
                                href={PROVIDER_REGISTER_URLS[provider.id]}
                                target="_blank"
                                rel="noreferrer"
                                className="text-accent hover:underline"
                              >
                                {t('settings.providerRegisterLink')}
                              </a>
                              {t('settings.providerApiKeyGuideMiddle')}{' '}
                              <a
                                href={PROVIDER_GET_KEY_URLS[provider.id]}
                                target="_blank"
                                rel="noreferrer"
                                className="text-accent hover:underline"
                              >
                                {t('settings.getApiKeyLink')}
                              </a>
                            </p>
                          ) : (
                            <p className="text-xs text-text-muted">{provider.id}</p>
                          )}
                        </div>

                        <div className="relative">
                          <input
                            type={isRevealed ? 'text' : 'password'}
                            value={localApiKeys[provider.id] ?? ''}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setLocalApiKeys((previous) => ({
                                ...previous,
                                [provider.id]: nextValue,
                              }));
                              setProviderApiKey(provider.id, nextValue);
                            }}
                            placeholder={t('settings.enterApiKey')}
                            className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 pr-10 text-sm text-text-dark placeholder:text-text-muted"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setRevealedApiKeys((previous) => ({
                                ...previous,
                                [provider.id]: !isRevealed,
                              }))
                            }
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-bg-dark"
                          >
                            {isRevealed ? (
                              <EyeOff className="h-4 w-4 text-text-muted" />
                            ) : (
                              <Eye className="h-4 w-4 text-text-muted" />
                            )}
                          </button>
                        </div>

                        {provider.id === 'grsai' && (
                          <div className="mt-3">
                            <div className="mb-1 text-xs font-medium text-text-dark">
                              {t('settings.nanoBananaProModel')}
                            </div>
                            <p className="mb-2 text-xs text-text-muted">
                              <Trans
                                i18nKey="settings.nanoBananaProModelDesc"
                                components={{
                                  modelListLink: (
                                    <a
                                      href="https://grsai.com/zh/dashboard/models"
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-accent hover:underline"
                                    />
                                  ),
                                }}
                              />
                            </p>
                            <UiSelect
                              value={localGrsaiNanoBananaProModel}
                              onChange={(event) =>
                                setLocalGrsaiNanoBananaProModel(event.target.value)
                              }
                              className="h-9 text-sm"
                            >
                              {GRSAI_NANO_BANANA_PRO_MODEL_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </UiSelect>
                          </div>
                        )}
                      </div>
                    );
                  })}

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
                    className="px-4 py-2 text-sm font-medium bg-accent text-white rounded
                             hover:bg-accent/80 transition-colors"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'appearance' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.appearance')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.appearanceDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.radiusPreset')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.radiusPresetDesc')}
                    </p>
                    <div className="mt-3">
                      <UiSelect
                        value={localUiRadiusPreset}
                        onChange={(event) =>
                          setLocalUiRadiusPreset(event.target.value as typeof localUiRadiusPreset)
                        }
                        className="h-9 text-sm"
                      >
                        <option value="compact">{t('settings.radiusCompact')}</option>
                        <option value="default">{t('settings.radiusDefault')}</option>
                        <option value="large">{t('settings.radiusLarge')}</option>
                      </UiSelect>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.themeTone')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.themeToneDesc')}
                    </p>
                    <div className="mt-3">
                      <UiSelect
                        value={localThemeTonePreset}
                        onChange={(event) =>
                          setLocalThemeTonePreset(event.target.value as typeof localThemeTonePreset)
                        }
                        className="h-9 text-sm"
                      >
                        <option value="neutral">{t('settings.toneNeutral')}</option>
                        <option value="warm">{t('settings.toneWarm')}</option>
                        <option value="cool">{t('settings.toneCool')}</option>
                      </UiSelect>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
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
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
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
                        className="h-9 w-12 rounded border border-border-dark bg-surface-dark p-1"
                      />
                      <input
                        value={localAccentColor}
                        onChange={(event) => setLocalAccentColor(event.target.value)}
                        placeholder="#3B82F6"
                        className="h-9 flex-1 rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted"
                      />
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                        onClick={() => setLocalAccentColor('#3B82F6')}
                      >
                        {t('settings.resetAccentColor')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end border-t border-border-dark px-6 py-4">
                  <button
                    onClick={handleSave}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'pricing' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.pricing')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.pricingDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <SettingsCheckboxCard
                    checked={localShowNodePrice}
                    onCheckedChange={setLocalShowNodePrice}
                    title={t('settings.showNodePrice')}
                    description={t('settings.showNodePriceDesc')}
                  />

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.priceDisplayCurrencyMode')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.priceDisplayCurrencyModeDesc')}
                    </p>
                    <div className="mt-3">
                      <UiSelect
                        value={localPriceDisplayCurrencyMode}
                        onChange={(event) =>
                          setLocalPriceDisplayCurrencyMode(
                            event.target.value as typeof localPriceDisplayCurrencyMode
                          )
                        }
                        className="h-9 text-sm"
                      >
                        <option value="auto">{t('settings.priceCurrencyAuto')}</option>
                        <option value="cny">{t('settings.priceCurrencyCny')}</option>
                        <option value="usd">{t('settings.priceCurrencyUsd')}</option>
                      </UiSelect>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.usdToCnyRate')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.usdToCnyRateDesc')}
                    </p>
                    <div className="mt-3">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={localUsdToCnyRate}
                        onChange={(event) => setLocalUsdToCnyRate(event.target.value)}
                        className="h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted"
                      />
                    </div>
                  </div>

                  <SettingsCheckboxCard
                    checked={localPreferDiscountedPrice}
                    onCheckedChange={setLocalPreferDiscountedPrice}
                    title={t('settings.preferDiscountedPrice')}
                    description={t('settings.preferDiscountedPriceDesc')}
                  />

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.grsaiCreditTier')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.grsaiCreditTierDesc')}
                    </p>
                    <div className="mt-3">
                      <UiSelect
                        value={localGrsaiCreditTierId}
                        onChange={(event) =>
                          setLocalGrsaiCreditTierId(event.target.value as typeof localGrsaiCreditTierId)
                        }
                        className="h-9 text-sm"
                      >
                        {GRSAI_CREDIT_TIERS.map((tier) => (
                          <option key={tier.id} value={tier.id}>
                            {t('settings.grsaiCreditTierOption', {
                              price: tier.priceCny.toFixed(2),
                              credits: tier.credits.toLocaleString(i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US'),
                            })}
                          </option>
                        ))}
                      </UiSelect>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end border-t border-border-dark px-6 py-4">
                  <button
                    onClick={handleSave}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80"
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
                            <button
                              type="button"
                              className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
                              onClick={() => handleRemoveDownloadPath(path)}
                              title={t('common.delete')}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
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
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80"
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
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'about' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.about')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.aboutDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <div className="flex items-start gap-4">
                      <img
                        src="/app-icon.png"
                        alt={t('settings.aboutAppName')}
                        className="h-14 w-14 rounded-lg border border-border-dark object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <a
                          href="https://space.bilibili.com/39337803"
                          target="_blank"
                          rel="noreferrer"
                          className="text-base font-semibold text-accent hover:underline"
                        >
                          {t('settings.aboutAppName')}
                        </a>
                        <p className="mt-1 text-sm text-text-muted">
                          {t('settings.aboutIntro')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4 space-y-2 text-sm">
                    <p className="text-text-dark">
                      {t('settings.aboutVersionLabel')}: <span className="text-text-muted">{appVersion || t('settings.aboutVersionUnknown')}</span>
                    </p>
                    <p className="text-text-dark">
                      {t('settings.aboutAuthorLabel')}:{' '}
                      <a
                        href="https://space.bilibili.com/39337803"
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                      >
                        {t('settings.aboutAuthor')}
                      </a>
                    </p>
                    <p className="text-text-dark">
                      {t('settings.aboutRepositoryLabel')}:{' '}
                      <a
                        href="https://github.com/xujunjiex/Storyboard-Copilot-Plus"
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline break-all"
                      >
                        https://github.com/xujunjiex/Storyboard-Copilot-Plus
                      </a>
                    </p>
                  </div>

                  <div className="space-y-3">
                    <SettingsCheckboxCard
                      checked={localAutoCheckAppUpdateOnLaunch}
                      onCheckedChange={setLocalAutoCheckAppUpdateOnLaunch}
                      title={t('settings.autoCheckUpdateOnLaunch')}
                      description={t('settings.autoCheckUpdateOnLaunchDesc')}
                    />
                    <SettingsCheckboxCard
                      checked={localEnableUpdateDialog}
                      onCheckedChange={setLocalEnableUpdateDialog}
                      title={t('settings.enableUpdateDialog')}
                      description={t('settings.enableUpdateDialogDesc')}
                    />
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          void handleCheckUpdate();
                        }}
                        className="rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark transition-colors hover:bg-bg-dark disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={checkUpdateStatus === 'checking'}
                      >
                        {checkUpdateStatus === 'checking'
                          ? t('settings.checkingUpdate')
                          : t('settings.checkUpdateNow')}
                      </button>
                      {checkUpdateStatus !== '' && (
                        <p className="mt-2 text-xs text-text-muted">
                          {checkUpdateStatus === 'has-update' && t('settings.checkUpdateHasUpdate')}
                          {checkUpdateStatus === 'up-to-date' && t('settings.checkUpdateUpToDate')}
                          {checkUpdateStatus === 'failed' && t('settings.checkUpdateFailed')}
                          {checkUpdateStatus === 'checking' && t('settings.checkingUpdate')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end border-t border-border-dark px-6 py-4">
                  <div className="flex gap-2">
                    <button
                      onClick={onClose}
                      className="rounded border border-border-dark px-4 py-2 text-sm font-medium text-text-dark transition-colors hover:bg-bg-dark"
                    >
                      {t('common.close')}
                    </button>
                    <button
                      onClick={handleSave}
                      className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80"
                    >
                      {t('common.save')}
                    </button>
                  </div>
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
                            <button
                              type="button"
                              onClick={() => {
                                const updated = localTextApis.filter((_, i) => i !== index);
                                setLocalTextApis(updated);
                              }}
                              className="inline-flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-dark hover:text-red-400"
                              title={t('settings.removeTextApi')}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
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
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80"
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
                          <button
                            type="button"
                            onClick={() => {
                              const updated = localVideoApis.filter((_, i) => i !== index);
                              setLocalVideoApis(updated);
                            }}
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-dark hover:text-red-400"
                            title={t('settings.removeVideoApi')}
                                                    >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
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
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'logging' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    日志设置
                  </h2>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <LoggingSettings />
                </div>
              </>
            )}
          </div>
        </div>
        {activeCategory === 'imageApis' && !hideProviderGuidePopover && (
          <div
            className={`absolute top-0 bottom-0 left-[calc(50%+366px)] right-0 min-w-[240px] max-w-[380px] rounded-lg border border-border-dark bg-surface-dark/95 p-3 shadow-xl transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
          >
            <div className="markdown-body break-words text-xs leading-5 text-text-muted [&_a]:text-accent [&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-xs [&_h2]:font-semibold [&_h3]:text-xs [&_h3]:font-semibold [&_hr]:border-white/10 [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-0 [&_p+_p]:mt-4 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-black/30 [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-4">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={{
                  a: ({ href, children, ...props }) => (
                    <a
                      {...props}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => {
                        event.preventDefault();
                        handleMarkdownLinkClick(href);
                      }}
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {providerGuideMarkdown}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LoggingSettings(): JSX.Element {
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
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">日志配置</h3>

      <div>
        <label className="text-sm">全局级别</label>
        <select
          className="ml-2 bg-zinc-800 px-2 py-1 rounded"
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
        </select>
      </div>

      <div>
        <label className="text-sm">模块级别覆盖</label>
        <input
          type="text"
          className="ml-2 bg-zinc-800 px-2 py-1 rounded w-96"
          value={moduleText}
          onChange={(e) => commitModuleText(e.target.value)}
          placeholder="canvas=debug,ai=warn"
        />
        <p className="text-xs text-zinc-500 mt-1">格式: 模块前缀=级别,逗号分隔。最长前缀优先匹配。</p>
      </div>

      <div className="flex gap-4">
        <label className="text-sm">
          <input
            type="checkbox"
            checked={config.console}
            onChange={(e) => {
              setLogConfig({ console: e.target.checked });
              setLocal(getLogConfig());
            }}
          />
          <span className="ml-2">控制台输出</span>
        </label>
        <label className="text-sm">
          <input
            type="checkbox"
            checked={config.persist}
            onChange={(e) => {
              setLogConfig({ persist: e.target.checked });
              setLocal(getLogConfig());
            }}
          />
          <span className="ml-2">持久化到文件</span>
        </label>
        <label className="text-sm">
          <input
            type="checkbox"
            checked={config.consoleTimestamps}
            onChange={(e) => {
              setLogConfig({ consoleTimestamps: e.target.checked });
              setLocal(getLogConfig());
            }}
          />
          <span className="ml-2">控制台时间戳</span>
        </label>
      </div>

      <div className="flex gap-2">
        <button
          className="px-3 py-1 bg-zinc-800 rounded text-sm"
          onClick={async () => {
            try {
              await invoke('open_log_dir');
            } catch {
              alert('无法打开日志目录');
            }
          }}
        >
          打开日志目录
        </button>
        <button
          className="px-3 py-1 bg-zinc-800 rounded text-sm"
          onClick={() => {
            const entries = useLogStore.getState().snapshot().slice(-100);
            navigator.clipboard.writeText(
              entries.map((e) => `[${e.level}] ${e.target}: ${e.message}`).join('\n')
            );
          }}
        >
          复制最近100条
        </button>
        <button
          className="px-3 py-1 bg-zinc-800 rounded text-sm"
          onClick={() => {
            resetLogConfig();
            setLocal(getLogConfig());
            setModuleText('');
          }}
        >
          重置
        </button>
      </div>
    </div>
  );
}
