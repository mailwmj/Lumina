import { useCallback, useState, type ReactNode } from 'react';
import { Eye, EyeOff, Loader2, Plus, Trash2 } from '@/components/ui/icons';
import { useTranslation } from 'react-i18next';

import { discoverImageModels } from '@/commands/ai';
import { UiCheckbox, UiTooltip } from '@/components/ui';
import { toConfiguredImageModelId } from '@/features/canvas/models';
import {
  createCustomImageApiConfig,
  DEFAULT_TEXT_API_PROMPT,
  isCustomImageProviderId,
  type ChaomoImageApiConfig,
  type CustomImageApiConfig,
  type ImageModelCatalog,
  type ImageProviderApiConfig,
  type ImageProviderId,
  type OpenAiImageApiConfig,
} from '@/stores/settingsStore';

interface ImageApisSettingsProps {
  openAiImageApi: OpenAiImageApiConfig;
  chaomoImageApi: ChaomoImageApiConfig;
  customImageApis: CustomImageApiConfig[];
  imagePolishPrompt: string;
  onOpenAiImageApiChange: (config: OpenAiImageApiConfig) => void;
  onChaomoImageApiChange: (config: ChaomoImageApiConfig) => void;
  onCustomImageApisChange: (configs: CustomImageApiConfig[]) => void;
  onImagePolishPromptChange: (prompt: string) => void;
}

interface DiscoveryState {
  isLoading: boolean;
  error: string | null;
}

interface ImageModelSelectionPanelProps {
  catalog: ImageModelCatalog | null;
  selectedModelIds: string[];
  state: DiscoveryState;
  onRefresh: () => void;
  onSelectionChange: (modelId: string, selected: boolean) => void;
}

function ImageModelSelectionPanel({
  catalog,
  selectedModelIds,
  state,
  onRefresh,
  onSelectionChange,
}: ImageModelSelectionPanelProps) {
  const { t } = useTranslation();
  const selectedModelIdSet = new Set(selectedModelIds);

  return (
    <div className="border-t border-[var(--ui-border-soft)] pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-text-dark">{t('settings.imageModelsSelect')}</span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={state.isLoading}
          className="inline-flex h-7 shrink-0 items-center rounded border border-border-dark bg-bg-dark px-2 text-xs text-text-dark transition-colors hover:bg-surface-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state.isLoading && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          {state.isLoading
            ? t('settings.imageModelsFetching')
            : t('settings.imageModelsFetch')}
        </button>
      </div>

      {state.error && <p className="mt-2 text-xs text-red-400">{state.error}</p>}
      {!state.error && (!catalog || catalog.models.length === 0) && (
        <p className="mt-2 text-xs text-text-muted">{t('settings.imageModelsEmpty')}</p>
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

interface ProviderSectionProps<TConfig extends ImageProviderApiConfig> {
  providerId: ImageProviderId;
  title: string;
  description: string;
  config: TConfig;
  discoveryState: DiscoveryState;
  isApiKeyRevealed: boolean;
  onApiKeyRevealToggle: () => void;
  onChange: (config: TConfig) => void;
  onDiscover: () => void;
  headerAction?: ReactNode;
  nameField?: ReactNode;
  manualModelField?: ReactNode;
}

function ProviderSection<TConfig extends ImageProviderApiConfig>({
  title,
  description,
  config,
  discoveryState,
  isApiKeyRevealed,
  onApiKeyRevealToggle,
  onChange,
  onDiscover,
  headerAction,
  nameField,
  manualModelField,
}: ProviderSectionProps<TConfig>) {
  const { t } = useTranslation();
  const updateConnection = (patch: Partial<Pick<TConfig, 'apiKey' | 'baseUrl'>>) => {
    onChange({
      ...config,
      ...patch,
      modelCatalog: null,
      selectedModelIds: [],
    });
  };

  return (
    <section className="border-b border-[var(--ui-border-soft)] py-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-text-dark">{title}</h3>
          <p className="mt-1 text-xs text-text-muted">{description}</p>
        </div>
        {headerAction}
      </div>

      <div className="space-y-3">
        {nameField}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-dark">
            {t('settings.openAiImageBaseUrl')}
          </span>
          <input
            type="url"
            value={config.baseUrl}
            onChange={(event) => updateConnection({ baseUrl: event.target.value })}
            placeholder="https://api.example.com/v1"
            className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark placeholder:text-text-muted"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-dark">
            {t('settings.openAiImageApiKey')}
          </span>
          <div className="relative">
            <input
              type={isApiKeyRevealed ? 'text' : 'password'}
              value={config.apiKey}
              onChange={(event) => updateConnection({ apiKey: event.target.value })}
              placeholder={t('settings.enterApiKey')}
              className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 pr-10 text-sm text-text-dark placeholder:text-text-muted"
            />
            <UiTooltip content={isApiKeyRevealed ? t('settings.hideApiKey') : t('settings.showApiKey')}>
              <button
                type="button"
                aria-label={isApiKeyRevealed ? t('settings.hideApiKey') : t('settings.showApiKey')}
                onClick={onApiKeyRevealToggle}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-[var(--ui-hover)]"
              >
                {isApiKeyRevealed ? (
                  <EyeOff className="h-4 w-4 text-text-muted" />
                ) : (
                  <Eye className="h-4 w-4 text-text-muted" />
                )}
              </button>
            </UiTooltip>
          </div>
        </label>

        {manualModelField}
        <ImageModelSelectionPanel
          catalog={config.modelCatalog}
          selectedModelIds={config.selectedModelIds}
          state={discoveryState}
          onRefresh={onDiscover}
          onSelectionChange={(modelId, selected) =>
            onChange({
              ...config,
              selectedModelIds: selected
                ? Array.from(new Set([...config.selectedModelIds, modelId]))
                : config.selectedModelIds.filter((id) => id !== modelId),
            })
          }
        />
      </div>
    </section>
  );
}

export function ImageApisSettings({
  openAiImageApi,
  chaomoImageApi,
  customImageApis,
  imagePolishPrompt,
  onOpenAiImageApiChange,
  onChaomoImageApiChange,
  onCustomImageApisChange,
  onImagePolishPromptChange,
}: ImageApisSettingsProps) {
  const { t } = useTranslation();
  const [discoveryByProvider, setDiscoveryByProvider] = useState<Record<string, DiscoveryState>>({});
  const [revealedProviderIds, setRevealedProviderIds] = useState<Set<string>>(() => new Set());
  const [manualModelIds, setManualModelIds] = useState<Record<string, string>>({});
  const discoveryState = (providerId: string): DiscoveryState =>
    discoveryByProvider[providerId] ?? { isLoading: false, error: null };

  const toggleApiKey = (providerId: string) => {
    setRevealedProviderIds((current) => {
      const next = new Set(current);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  };

  const handleDiscover = useCallback(async <TConfig extends ImageProviderApiConfig>(
    providerId: ImageProviderId,
    config: TConfig,
    onChange: (next: TConfig) => void
  ) => {
    setDiscoveryByProvider((current) => ({
      ...current,
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
          ...(model.label || isCustomImageProviderId(providerId)
            ? { label: model.label || model.id }
            : {}),
        })),
        refreshedAt: Date.now(),
      };
      const selectedModelIds = new Set(config.selectedModelIds);
      onChange({
        ...config,
        modelCatalog,
        selectedModelIds: modelCatalog.models
          .map((model) => model.id)
          .filter((modelId) => selectedModelIds.has(modelId)),
      });
      setDiscoveryByProvider((current) => ({
        ...current,
        [providerId]: { isLoading: false, error: null },
      }));
    } catch (error) {
      setDiscoveryByProvider((current) => ({
        ...current,
        [providerId]: {
          isLoading: false,
          error: error instanceof Error ? error.message : t('settings.imageModelsFetchFailed'),
        },
      }));
    }
  }, [t]);

  const updateCustomProvider = (providerId: string, next: CustomImageApiConfig) => {
    onCustomImageApisChange(customImageApis.map((config) =>
      config.id === providerId ? next : config
    ));
  };

  const addManualModel = (config: CustomImageApiConfig) => {
    const rawModelId = manualModelIds[config.id]?.trim();
    if (!rawModelId) return;
    const modelId = toConfiguredImageModelId(config.id, rawModelId);
    const existingModels = config.modelCatalog?.models ?? [];
    const modelCatalog: ImageModelCatalog = {
      models: existingModels.some((model) => model.id === modelId)
        ? existingModels
        : [...existingModels, { id: modelId, label: rawModelId }],
      refreshedAt: Date.now(),
    };
    updateCustomProvider(config.id, {
      ...config,
      modelCatalog,
      selectedModelIds: Array.from(new Set([...config.selectedModelIds, modelId])),
    });
    setManualModelIds((current) => ({ ...current, [config.id]: '' }));
  };

  return (
    <>
      <ProviderSection
        providerId="ai-media"
        title={t('settings.openAiImageApi')}
        description={t('settings.openAiImageApiDesc')}
        config={openAiImageApi}
        discoveryState={discoveryState('ai-media')}
        isApiKeyRevealed={revealedProviderIds.has('ai-media')}
        onApiKeyRevealToggle={() => toggleApiKey('ai-media')}
        onChange={onOpenAiImageApiChange}
        onDiscover={() => void handleDiscover('ai-media', openAiImageApi, onOpenAiImageApiChange)}
      />
      <ProviderSection
        providerId="chaomo"
        title={t('settings.chaomoImageApi')}
        description={t('settings.chaomoImageApiDesc')}
        config={chaomoImageApi}
        discoveryState={discoveryState('chaomo')}
        isApiKeyRevealed={revealedProviderIds.has('chaomo')}
        onApiKeyRevealToggle={() => toggleApiKey('chaomo')}
        onChange={onChaomoImageApiChange}
        onDiscover={() => void handleDiscover('chaomo', chaomoImageApi, onChaomoImageApiChange)}
      />

      <div className="flex items-center justify-between gap-3 border-b border-[var(--ui-border-soft)] py-4">
        <div>
          <h3 className="text-sm font-medium text-text-dark">{t('settings.customImageApis')}</h3>
          <p className="mt-1 text-xs text-text-muted">{t('settings.customImageApisDesc')}</p>
        </div>
        <button
          type="button"
          onClick={() => onCustomImageApisChange([...customImageApis, createCustomImageApiConfig()])}
          className="inline-flex h-8 shrink-0 items-center rounded-md border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-[var(--ui-hover)]"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t('settings.addCustomImageApi')}
        </button>
      </div>

      {customImageApis.map((config) => (
        <ProviderSection
          key={config.id}
          providerId={config.id}
          title={config.name || t('settings.customImageApiUntitled')}
          description={t('settings.customImageApiDesc')}
          config={config}
          discoveryState={discoveryState(config.id)}
          isApiKeyRevealed={revealedProviderIds.has(config.id)}
          onApiKeyRevealToggle={() => toggleApiKey(config.id)}
          onChange={(next) => updateCustomProvider(config.id, next)}
          onDiscover={() => void handleDiscover(
            config.id,
            config,
            (next) => updateCustomProvider(config.id, next)
          )}
          headerAction={(
            <UiTooltip content={t('settings.removeCustomImageApi')}>
              <button
                type="button"
                aria-label={t('settings.removeCustomImageApi')}
                onClick={() => onCustomImageApisChange(
                  customImageApis.filter((candidate) => candidate.id !== config.id)
                )}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </UiTooltip>
          )}
          nameField={(
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-dark">
                {t('settings.customImageApiName')}
              </span>
              <input
                value={config.name}
                onChange={(event) => updateCustomProvider(config.id, {
                  ...config,
                  name: event.target.value,
                })}
                placeholder={t('settings.customImageApiNamePlaceholder')}
                className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark placeholder:text-text-muted"
              />
            </label>
          )}
          manualModelField={(
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-dark">
                {t('settings.customImageModelId')}
              </span>
              <div className="flex gap-2">
                <input
                  value={manualModelIds[config.id] ?? ''}
                  onChange={(event) => setManualModelIds((current) => ({
                    ...current,
                    [config.id]: event.target.value,
                  }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addManualModel(config);
                    }
                  }}
                  placeholder="gpt-image-1"
                  className="min-w-0 flex-1 rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark placeholder:text-text-muted"
                />
                <UiTooltip content={t('settings.addCustomImageModel')}>
                  <button
                    type="button"
                    aria-label={t('settings.addCustomImageModel')}
                    onClick={() => addManualModel(config)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-dark bg-surface-dark text-text-dark transition-colors hover:bg-[var(--ui-hover)]"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </UiTooltip>
              </div>
            </label>
          )}
        />
      ))}

      <section className="py-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <label className="text-sm font-medium text-text-dark">
            {t('settings.imagePolishPromptTemplate')}
          </label>
          <button
            type="button"
            onClick={() => onImagePolishPromptChange(DEFAULT_TEXT_API_PROMPT)}
            className="shrink-0 text-xs text-accent hover:underline"
          >
            {t('common.restoreDefault')}
          </button>
        </div>
        <textarea
          value={imagePolishPrompt}
          onChange={(event) => onImagePolishPromptChange(event.target.value)}
          rows={6}
          placeholder={t('settings.imagePolishPromptPlaceholder')}
          className="w-full resize-none rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark"
        />
      </section>
    </>
  );
}
