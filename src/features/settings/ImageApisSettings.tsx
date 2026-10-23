import { useCallback, useState, type ReactNode } from 'react';
import { Eye, EyeOff, Loader2, Plus } from '@/components/ui/icons';
import { useTranslation } from 'react-i18next';

import { discoverImageModels } from '@/commands/ai';
import { UiButton, UiCheckbox, UiModal, UiSelect, UiTooltip } from '@/components/ui';
import { toConfiguredImageModelId } from '@/features/canvas/models';
import {
  CUSTOM_IMAGE_PROTOCOLS,
  getCustomImageProtocolDefinition,
  migrateCustomImageBaseUrlForProtocolChange,
  type CustomImageProtocol,
} from '@/features/canvas/models/imageProviderProtocols';
import {
  resolveDiscoveredImageModelSelection,
} from '@/features/settings/application/imageModelDiscovery';
import { imageProviderHealth } from '@/features/settings/application/settingsHealth';
import {
  ConnectionTestRow,
  ProviderDetailSection,
  StaleModelsNotice,
  type ConnectionTestState,
} from '@/features/settings/providers/ProviderDetailParts';
import { ProviderListShell } from '@/features/settings/providers/ProviderListShell';
import { SettingsTextInput } from '@/features/settings/SettingsTextField';
import {
  createCustomImageApiConfig,
  isCustomImageProviderId,
  type ChaomoImageApiConfig,
  type CustomImageApiConfig,
  type ImageModelCatalog,
  type ImageProviderApiConfig,
  type ImageProviderId,
  type OpenAiImageApiConfig,
} from '@/stores/settingsStore';

export interface ImageApisSettingsValue {
  openAiImageApi: OpenAiImageApiConfig;
  chaomoImageApi: ChaomoImageApiConfig;
  customImageApis: CustomImageApiConfig[];
}

interface ImageApisSettingsProps {
  value: ImageApisSettingsValue;
  /** Receives only the parts that changed, so an async result never overwrites another provider's edit. */
  onChange: (patch: Partial<ImageApisSettingsValue>) => void;
  onDetailChange?: (isOpen: boolean) => void;
}

interface DiscoveryState {
  isLoading: boolean;
  error: string | null;
}

interface PendingProtocolChange {
  providerId: string;
  protocol: CustomImageProtocol;
}

type ImageProviderEntry =
  | { kind: 'openai'; config: OpenAiImageApiConfig }
  | { kind: 'chaomo'; config: ChaomoImageApiConfig }
  | { kind: 'custom'; config: CustomImageApiConfig };

const BUILTIN_ENTRY_ID = {
  openai: 'ai-media',
  chaomo: 'chaomo',
} as const;

function ImageModelSelectionPanel({
  catalog,
  selectedModelIds,
  state,
  isStale,
  onRefresh,
  onSelectionChange,
}: {
  catalog: ImageModelCatalog | null;
  selectedModelIds: string[];
  state: DiscoveryState;
  isStale: boolean;
  onRefresh: () => void;
  onSelectionChange: (modelId: string, selected: boolean) => void;
}) {
  const { t } = useTranslation();
  const selectedModelIdSet = new Set(selectedModelIds);

  return (
    <div>
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

      {isStale && !state.error && <StaleModelsNotice />}
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

interface ImageDetailFormProps<TConfig extends ImageProviderApiConfig> {
  config: TConfig;
  discoveryState: DiscoveryState;
  testState: ConnectionTestState;
  isModelCatalogStale: boolean;
  isApiKeyRevealed: boolean;
  onApiKeyRevealToggle: () => void;
  onChange: (config: TConfig) => void;
  onConnectionChange: () => void;
  onDiscover: () => void;
  onTest: () => void;
  nameField?: ReactNode;
  protocolField?: ReactNode;
  manualModelField?: ReactNode;
  baseUrlPlaceholder?: string;
}

function ImageDetailForm<TConfig extends ImageProviderApiConfig>({
  config,
  discoveryState,
  testState,
  isModelCatalogStale,
  isApiKeyRevealed,
  onApiKeyRevealToggle,
  onChange,
  onConnectionChange,
  onDiscover,
  onTest,
  nameField,
  protocolField,
  manualModelField,
  baseUrlPlaceholder = 'https://api.example.com/v1',
}: ImageDetailFormProps<TConfig>) {
  const { t } = useTranslation();
  // Keep the catalog and selection when the connection changes; the user decides whether to refetch.
  const updateConnection = (patch: Partial<Pick<TConfig, 'apiKey' | 'baseUrl'>>) => {
    onChange({ ...config, ...patch });
    onConnectionChange();
  };

  return (
    <div className="space-y-5">
      <ProviderDetailSection title={t('settings.providerSectionConnection')}>
      {nameField}
      {protocolField}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-dark">
          {t('settings.openAiImageBaseUrl')}
        </span>
        <SettingsTextInput
          type="url"
          value={config.baseUrl}
          onCommit={(baseUrl) => updateConnection({ baseUrl })}
          placeholder={baseUrlPlaceholder}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-dark">
          {t('settings.openAiImageApiKey')}
        </span>
        <div className="relative">
          <SettingsTextInput
            type={isApiKeyRevealed ? 'text' : 'password'}
            value={config.apiKey}
            onCommit={(apiKey) => updateConnection({ apiKey })}
            placeholder={t('settings.enterApiKey')}
            className="pr-10"
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
      <ConnectionTestRow
        state={testState}
        disabledReason={!config.apiKey.trim() || !config.baseUrl.trim()
          ? t('settings.connectionTestNeedsFields')
          : undefined}
        onTest={onTest}
      />
      </ProviderDetailSection>

      <ProviderDetailSection title={t('settings.providerSectionModels')}>
      {manualModelField}
      <ImageModelSelectionPanel
        catalog={config.modelCatalog}
        selectedModelIds={config.selectedModelIds}
        state={discoveryState}
        isStale={isModelCatalogStale}
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
      </ProviderDetailSection>
    </div>
  );
}

export function ImageApisSettings({
  value,
  onChange,
  onDetailChange,
}: ImageApisSettingsProps) {
  const { openAiImageApi, chaomoImageApi, customImageApis } = value;
  const { t } = useTranslation();
  const [discoveryByProvider, setDiscoveryByProvider] = useState<Record<string, DiscoveryState>>({});
  const [revealedProviderIds, setRevealedProviderIds] = useState<Set<string>>(() => new Set());
  const [manualModelIds, setManualModelIds] = useState<Record<string, string>>({});
  const [pendingProtocolChange, setPendingProtocolChange] = useState<PendingProtocolChange | null>(null);
  const [testByProvider, setTestByProvider] = useState<Record<string, ConnectionTestState>>({});
  const [staleProviderIds, setStaleProviderIds] = useState<Set<string>>(() => new Set());

  const updateOpenAiImageApi = useCallback((config: OpenAiImageApiConfig) => {
    onChange({ openAiImageApi: config });
  }, [onChange]);
  const updateChaomoImageApi = useCallback((config: ChaomoImageApiConfig) => {
    onChange({ chaomoImageApi: config });
  }, [onChange]);
  const updateCustomImageApis = useCallback((configs: CustomImageApiConfig[]) => {
    onChange({ customImageApis: configs });
  }, [onChange]);

  const discoveryState = (providerId: string): DiscoveryState =>
    discoveryByProvider[providerId] ?? { isLoading: false, error: null };
  const testState = (providerId: string): ConnectionTestState =>
    testByProvider[providerId] ?? { status: 'idle' };

  const markConnectionChanged = (providerId: string, config: ImageProviderApiConfig) => {
    setTestByProvider((current) => ({ ...current, [providerId]: { status: 'idle' } }));
    if (config.modelCatalog) {
      setStaleProviderIds((current) => new Set(current).add(providerId));
    }
  };

  const clearStale = (providerId: string) => {
    setStaleProviderIds((current) => {
      if (!current.has(providerId)) return current;
      const next = new Set(current);
      next.delete(providerId);
      return next;
    });
  };

  const handleTest = useCallback(async (
    providerId: ImageProviderId,
    config: ImageProviderApiConfig,
    protocol?: CustomImageProtocol
  ) => {
    setTestByProvider((current) => ({ ...current, [providerId]: { status: 'testing' } }));
    try {
      const models = await discoverImageModels({
        provider_id: providerId,
        base_url: config.baseUrl,
        api_key: config.apiKey,
        ...(protocol ? { protocol } : {}),
      });
      setTestByProvider((current) => ({
        ...current,
        [providerId]: {
          status: 'ok',
          message: t('settings.connectionTestSucceededModels', { count: models.length }),
        },
      }));
    } catch (error) {
      setTestByProvider((current) => ({
        ...current,
        [providerId]: {
          status: 'error',
          message: error instanceof Error ? error.message : t('settings.connectionTestFailed'),
        },
      }));
    }
  }, [t]);

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
    onChange: (next: TConfig) => void,
    protocol?: CustomImageProtocol
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
        ...(protocol ? { protocol } : {}),
      });
      const modelCatalog: ImageModelCatalog = {
        models: models.map((model) => ({
          id: toConfiguredImageModelId(providerId, model.id, protocol),
          ...(model.label || isCustomImageProviderId(providerId)
            ? { label: model.label || model.id }
            : {}),
        })),
        refreshedAt: Date.now(),
      };
      const nextSelectedModelIds = resolveDiscoveredImageModelSelection(
        config.modelCatalog,
        config.selectedModelIds,
        modelCatalog.models.map((model) => model.id)
      );
      onChange({
        ...config,
        modelCatalog,
        selectedModelIds: nextSelectedModelIds,
      });
      setDiscoveryByProvider((current) => ({
        ...current,
        [providerId]: { isLoading: false, error: null },
      }));
      clearStale(providerId);
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
    updateCustomImageApis(customImageApis.map((config) =>
      config.id === providerId ? next : config
    ));
  };

  const applyCustomProtocol = (config: CustomImageApiConfig, protocol: CustomImageProtocol) => {
    updateCustomProvider(config.id, {
      ...config,
      protocol,
      baseUrl: migrateCustomImageBaseUrlForProtocolChange(
        config.baseUrl,
        config.protocol,
        protocol
      ),
      modelCatalog: null,
      selectedModelIds: [],
    });
    setTestByProvider((current) => ({ ...current, [config.id]: { status: 'idle' } }));
    clearStale(config.id);
  };

  const requestCustomProtocolChange = (
    config: CustomImageApiConfig,
    protocol: CustomImageProtocol
  ) => {
    if (protocol === config.protocol) {
      return;
    }

    if (config.selectedModelIds.length > 0) {
      setPendingProtocolChange({ providerId: config.id, protocol });
      return;
    }

    applyCustomProtocol(config, protocol);
  };

  const addManualModel = (config: CustomImageApiConfig) => {
    const rawModelId = manualModelIds[config.id]?.trim();
    if (!rawModelId) return;
    const modelId = toConfiguredImageModelId(config.id, rawModelId, config.protocol);
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

  const pendingProtocolProvider = pendingProtocolChange
    ? customImageApis.find((config) => config.id === pendingProtocolChange.providerId)
    : undefined;
  const pendingProtocolDefinition = pendingProtocolChange
    ? getCustomImageProtocolDefinition(pendingProtocolChange.protocol)
    : undefined;

  const confirmProtocolChange = () => {
    if (pendingProtocolChange && pendingProtocolProvider) {
      applyCustomProtocol(pendingProtocolProvider, pendingProtocolChange.protocol);
    }
    setPendingProtocolChange(null);
  };

  const entries: ImageProviderEntry[] = [
    { kind: 'openai', config: openAiImageApi },
    { kind: 'chaomo', config: chaomoImageApi },
    ...customImageApis.map((config) => ({ kind: 'custom' as const, config })),
  ];

  const getEntryId = (entry: ImageProviderEntry) =>
    entry.kind === 'custom' ? entry.config.id : BUILTIN_ENTRY_ID[entry.kind];

  const getEntryTitle = (entry: ImageProviderEntry) => {
    if (entry.kind === 'openai') return t('settings.openAiImageApi');
    if (entry.kind === 'chaomo') return t('settings.chaomoImageApi');
    return entry.config.name || t('settings.customImageApiUntitled');
  };

  const getEntryHealth = (entry: ImageProviderEntry) =>
    imageProviderHealth(getEntryId(entry), entry.config, value);

  const getEntryMeta = (entry: ImageProviderEntry) => {
    const count = entry.config.selectedModelIds.length;
    return count > 0 ? t('settings.providerModelsCount', { count }) : undefined;
  };

  const isEntryBuiltIn = (entry: ImageProviderEntry) => entry.kind !== 'custom';

  const renderDetail = (entry: ImageProviderEntry) => {
    if (entry.kind === 'openai') {
      const providerId: ImageProviderId = 'ai-media';
      return (
        <ImageDetailForm
          config={entry.config}
          discoveryState={discoveryState(providerId)}
          testState={testState(providerId)}
          isModelCatalogStale={staleProviderIds.has(providerId)}
          isApiKeyRevealed={revealedProviderIds.has(providerId)}
          onApiKeyRevealToggle={() => toggleApiKey(providerId)}
          onChange={updateOpenAiImageApi}
          onConnectionChange={() => markConnectionChanged(providerId, entry.config)}
          onDiscover={() => void handleDiscover(providerId, entry.config, updateOpenAiImageApi)}
          onTest={() => void handleTest(providerId, entry.config)}
        />
      );
    }

    if (entry.kind === 'chaomo') {
      const providerId: ImageProviderId = 'chaomo';
      return (
        <ImageDetailForm
          config={entry.config}
          discoveryState={discoveryState(providerId)}
          testState={testState(providerId)}
          isModelCatalogStale={staleProviderIds.has(providerId)}
          isApiKeyRevealed={revealedProviderIds.has(providerId)}
          onApiKeyRevealToggle={() => toggleApiKey(providerId)}
          onChange={updateChaomoImageApi}
          onConnectionChange={() => markConnectionChanged(providerId, entry.config)}
          onDiscover={() => void handleDiscover(providerId, entry.config, updateChaomoImageApi)}
          onTest={() => void handleTest(providerId, entry.config)}
        />
      );
    }

    const { config } = entry;
    const protocolDefinition = getCustomImageProtocolDefinition(config.protocol);
    return (
      <>
        <ImageDetailForm
          config={config}
          discoveryState={discoveryState(config.id)}
          testState={testState(config.id)}
          isModelCatalogStale={staleProviderIds.has(config.id)}
          isApiKeyRevealed={revealedProviderIds.has(config.id)}
          onApiKeyRevealToggle={() => toggleApiKey(config.id)}
          onChange={(next) => updateCustomProvider(config.id, next)}
          onConnectionChange={() => markConnectionChanged(config.id, config)}
          onDiscover={() => void handleDiscover(
            config.id,
            config,
            (next) => updateCustomProvider(config.id, next),
            config.protocol
          )}
          onTest={() => void handleTest(config.id, config, config.protocol)}
          nameField={(
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-dark">
                {t('settings.customImageApiName')}
              </span>
              <SettingsTextInput
                value={config.name}
                onCommit={(name) => updateCustomProvider(config.id, { ...config, name })}
                placeholder={t('settings.customImageApiNamePlaceholder')}
              />
            </label>
          )}
          protocolField={(
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-dark">
                {t('settings.customImageProtocol')}
              </span>
              <UiSelect
                value={config.protocol}
                onChange={(event) => requestCustomProtocolChange(
                  config,
                  event.target.value as CustomImageProtocol
                )}
                className="h-9 w-full text-sm"
              >
                {CUSTOM_IMAGE_PROTOCOLS.map((protocol) => (
                  <option key={protocol} value={protocol}>
                    {t(getCustomImageProtocolDefinition(protocol).labelKey)}
                  </option>
                ))}
              </UiSelect>
              <p className="mt-1.5 text-xs leading-5 text-text-muted">
                {t(protocolDefinition.summaryKey)}
              </p>
            </label>
          )}
          baseUrlPlaceholder={protocolDefinition.baseUrlPlaceholder}
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
                  placeholder={protocolDefinition.modelIdPlaceholder}
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
        <UiModal
          isOpen={Boolean(pendingProtocolChange)}
          title={t('settings.customImageProtocolChangeTitle')}
          closeLabel={t('common.close')}
          onClose={() => setPendingProtocolChange(null)}
          widthClassName="w-[420px] max-w-[calc(100vw-24px)]"
          containerClassName="z-[60]"
          footer={(
            <>
              <UiButton size="sm" onClick={() => setPendingProtocolChange(null)}>
                {t('common.cancel')}
              </UiButton>
              <UiButton variant="danger" size="sm" onClick={confirmProtocolChange}>
                {t('settings.customImageProtocolChangeConfirm')}
              </UiButton>
            </>
          )}
        >
          <p className="text-sm leading-6 text-text-muted">
            {t('settings.customImageProtocolChangeMessage', {
              protocol: pendingProtocolDefinition ? t(pendingProtocolDefinition.labelKey) : '',
              count: pendingProtocolProvider?.selectedModelIds.length ?? 0,
            })}
          </p>
        </UiModal>
      </>
    );
  };

  return (
    <ProviderListShell<ImageProviderEntry>
      items={entries}
      getItemId={getEntryId}
      getItemTitle={getEntryTitle}
      getItemHealth={getEntryHealth}
      getItemMeta={getEntryMeta}
      isBuiltIn={isEntryBuiltIn}
      onAdd={() => {
        const config = createCustomImageApiConfig();
        updateCustomImageApis([...customImageApis, config]);
        return config.id;
      }}
      onRemove={(id) => updateCustomImageApis(
        customImageApis.filter((config) => config.id !== id)
      )}
      onRestore={(entry, index) => {
        if (entry.kind !== 'custom') return;
        const next = [...customImageApis];
        // Built-in entries occupy the first slots of the list.
        next.splice(Math.max(0, index - 2), 0, entry.config);
        updateCustomImageApis(next);
      }}
      onDetailChange={onDetailChange}
      renderDetail={renderDetail}
      addLabel={t('settings.addCustomImageApi')}
      removeLabel={t('settings.removeCustomImageApi')}
      emptyLabel={t('settings.noCustomImageApisConfigured')}
    />
  );
}
