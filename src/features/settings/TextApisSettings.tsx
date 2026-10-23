import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { discoverTextModels } from '@/commands/ai';
import { UiCheckbox, UiTooltip } from '@/components/ui';
import { Eye, EyeOff, Loader2, Plus } from '@/components/ui/icons';
import { testTextApi } from '@/features/canvas/infrastructure/textPolishService';
import { textProviderHealth } from '@/features/settings/application/settingsHealth';
import {
  ConnectionTestRow,
  ProviderDetailSection,
  StaleModelsNotice,
  type ConnectionTestState,
} from '@/features/settings/providers/ProviderDetailParts';
import { ProviderListShell } from '@/features/settings/providers/ProviderListShell';
import { SettingsTextInput } from '@/features/settings/SettingsTextField';
import {
  createTextApiConfig,
  type DiscoveredImageModel,
  type ImageModelCatalog,
  type TextApiConfig,
} from '@/stores/settingsStore';

interface TextApisSettingsProps {
  apis: TextApiConfig[];
  onChange: (apis: TextApiConfig[]) => void;
  onDetailChange?: (isOpen: boolean) => void;
}

interface AsyncState {
  isLoading: boolean;
  error: string | null;
}

const IDLE_STATE: AsyncState = { isLoading: false, error: null };

export function TextApisSettings({ apis, onChange, onDetailChange }: TextApisSettingsProps) {
  const { t } = useTranslation();
  const [discoveryByApi, setDiscoveryByApi] = useState<Record<string, AsyncState>>({});
  const [testByApi, setTestByApi] = useState<Record<string, ConnectionTestState>>({});
  const [staleApiIds, setStaleApiIds] = useState<Set<string>>(() => new Set());
  const [revealedApiIds, setRevealedApiIds] = useState<Set<string>>(() => new Set());
  const [manualModelIds, setManualModelIds] = useState<Record<string, string>>({});

  const updateApi = useCallback((apiId: string, next: TextApiConfig) => {
    onChange(apis.map((api) => (api.id === apiId ? next : api)));
  }, [apis, onChange]);

  // Keep the catalog and selection when the connection changes; the user decides whether to refetch.
  const updateConnection = (api: TextApiConfig, patch: Partial<Pick<TextApiConfig, 'apiKey' | 'baseUrl'>>) => {
    updateApi(api.id, { ...api, ...patch });
    setTestByApi((current) => ({ ...current, [api.id]: { status: 'idle' } }));
    if (api.modelCatalog) {
      setStaleApiIds((current) => new Set(current).add(api.id));
    }
  };

  const handleTest = async (api: TextApiConfig, modelId: string) => {
    setTestByApi((current) => ({ ...current, [api.id]: { status: 'testing' } }));
    try {
      const result = await testTextApi({ ...api, modelId });
      setTestByApi((current) => ({
        ...current,
        [api.id]: { status: 'ok', message: t('settings.textApiTestSucceeded', { message: result.message }) },
      }));
    } catch (error) {
      setTestByApi((current) => ({
        ...current,
        [api.id]: {
          status: 'error',
          message: t('settings.textApiTestFailed', {
            message: error instanceof Error ? error.message : t('common.error'),
          }),
        },
      }));
    }
  };

  const toggleApiKey = (apiId: string) => {
    setRevealedApiIds((current) => {
      const next = new Set(current);
      if (next.has(apiId)) next.delete(apiId);
      else next.add(apiId);
      return next;
    });
  };

  const handleDiscover = useCallback(async (api: TextApiConfig) => {
    setDiscoveryByApi((current) => ({
      ...current,
      [api.id]: { isLoading: true, error: null },
    }));
    try {
      const discovered = await discoverTextModels({
        base_url: api.baseUrl,
        api_key: api.apiKey,
      });
      const discoveredIds = new Set(discovered.map((model) => model.id));
      const preservedSelectedModels = api.selectedModelIds
        .filter((modelId) => !discoveredIds.has(modelId))
        .map((modelId) => ({ id: modelId }));
      const modelCatalog: ImageModelCatalog = {
        models: [...discovered, ...preservedSelectedModels],
        refreshedAt: Date.now(),
      };
      updateApi(api.id, { ...api, modelCatalog });
      setDiscoveryByApi((current) => ({
        ...current,
        [api.id]: IDLE_STATE,
      }));
      setStaleApiIds((current) => {
        const next = new Set(current);
        next.delete(api.id);
        return next;
      });
    } catch (error) {
      setDiscoveryByApi((current) => ({
        ...current,
        [api.id]: {
          isLoading: false,
          error: error instanceof Error ? error.message : t('settings.textModelsFetchFailed'),
        },
      }));
    }
  }, [t, updateApi]);

  const addManualModel = (api: TextApiConfig) => {
    const modelId = manualModelIds[api.id]?.trim();
    if (!modelId) return;

    const models = api.modelCatalog?.models ?? [];
    updateApi(api.id, {
      ...api,
      modelId: api.modelId || modelId,
      modelCatalog: {
        models: models.some((model) => model.id === modelId)
          ? models
          : [...models, { id: modelId }],
        refreshedAt: Date.now(),
      },
      selectedModelIds: Array.from(new Set([...api.selectedModelIds, modelId])),
    });
    setManualModelIds((current) => ({ ...current, [api.id]: '' }));
  };

  const changeModelSelection = (api: TextApiConfig, modelId: string, selected: boolean) => {
    const selectedModelIds = selected
      ? Array.from(new Set([...api.selectedModelIds, modelId]))
      : api.selectedModelIds.filter((candidate) => candidate !== modelId);
    const defaultModelId = api.modelId === modelId && !selected
      ? selectedModelIds[0] ?? ''
      : api.modelId || selectedModelIds[0] || '';
    updateApi(api.id, { ...api, modelId: defaultModelId, selectedModelIds });
  };

  const renderDetail = (api: TextApiConfig) => {
    const discoveryState = discoveryByApi[api.id] ?? IDLE_STATE;
    const catalogModels = api.modelCatalog?.models ?? [];
    const visibleModels: DiscoveredImageModel[] = [
      ...catalogModels,
      ...api.selectedModelIds
        .filter((modelId) => !catalogModels.some((model) => model.id === modelId))
        .map((modelId) => ({ id: modelId })),
    ];
    const selectedModelIdSet = new Set(api.selectedModelIds);
    const testModelId = selectedModelIdSet.has(api.modelId)
      ? api.modelId
      : api.selectedModelIds[0] ?? '';
    const isRevealed = revealedApiIds.has(api.id);

    return (
      <div className="space-y-5">
        <ProviderDetailSection title={t('settings.providerSectionConnection')}>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-dark">
              {t('settings.textApiName')}
            </span>
            <SettingsTextInput
              value={api.name}
              onCommit={(name) => updateApi(api.id, { ...api, name })}
              placeholder={t('settings.textApiNamePlaceholder')}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-dark">
              {t('settings.textApiBaseUrl')}
            </span>
            <SettingsTextInput
              type="url"
              value={api.baseUrl}
              onCommit={(baseUrl) => updateConnection(api, { baseUrl })}
              placeholder="https://api.example.com/v1"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-dark">
              {t('settings.textApiKey')}
            </span>
            <div className="relative">
              <SettingsTextInput
                type={isRevealed ? 'text' : 'password'}
                value={api.apiKey}
                onCommit={(apiKey) => updateConnection(api, { apiKey })}
                placeholder={t('settings.enterApiKey')}
                className="pr-10"
              />
              <UiTooltip content={isRevealed ? t('settings.hideApiKey') : t('settings.showApiKey')}>
                <button
                  type="button"
                  aria-label={isRevealed ? t('settings.hideApiKey') : t('settings.showApiKey')}
                  onClick={() => toggleApiKey(api.id)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-[var(--ui-hover)]"
                >
                  {isRevealed
                    ? <EyeOff className="h-4 w-4 text-text-muted" />
                    : <Eye className="h-4 w-4 text-text-muted" />}
                </button>
              </UiTooltip>
            </div>
          </label>

          <ConnectionTestRow
            state={testByApi[api.id] ?? { status: 'idle' }}
            disabledReason={!api.apiKey || !api.baseUrl
              ? t('settings.connectionTestNeedsFields')
              : !testModelId
                ? t('settings.connectionTestNeedsModel')
                : undefined}
            onTest={() => void handleTest(api, testModelId)}
          />
        </ProviderDetailSection>

        <ProviderDetailSection title={t('settings.providerSectionModels')}>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-dark">
              {t('settings.textApiManualModel')}
            </span>
            <div className="flex gap-2">
              <input
                value={manualModelIds[api.id] ?? ''}
                onChange={(event) => setManualModelIds((current) => ({
                  ...current,
                  [api.id]: event.target.value,
                }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addManualModel(api);
                  }
                }}
                placeholder="gpt-5.6-terra"
                className="min-w-0 flex-1 rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark placeholder:text-text-muted"
              />
              <UiTooltip content={t('settings.textApiAddModel')}>
                <button
                  type="button"
                  aria-label={t('settings.textApiAddModel')}
                  onClick={() => addManualModel(api)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-dark bg-surface-dark text-text-dark transition-colors hover:bg-[var(--ui-hover)]"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </UiTooltip>
            </div>
          </label>

          <div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-text-dark">
                {t('settings.textModelsSelect')}
              </span>
              <button
                type="button"
                onClick={() => void handleDiscover(api)}
                disabled={discoveryState.isLoading || !api.apiKey || !api.baseUrl}
                className="inline-flex h-7 shrink-0 items-center rounded border border-border-dark bg-bg-dark px-2 text-xs text-text-dark transition-colors hover:bg-surface-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {discoveryState.isLoading && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                {discoveryState.isLoading
                  ? t('settings.textModelsFetching')
                  : t('settings.textModelsFetch')}
              </button>
            </div>
            {staleApiIds.has(api.id) && !discoveryState.error && <StaleModelsNotice />}
            {discoveryState.error && (
              <p className="mt-2 text-xs text-red-400">{discoveryState.error}</p>
            )}
            {visibleModels.length === 0 && !discoveryState.error && (
              <p className="mt-2 text-xs text-text-muted">{t('settings.textModelsEmpty')}</p>
            )}
            {visibleModels.length > 0 && (
              <div className="ui-scrollbar mt-2 max-h-40 space-y-1 overflow-y-auto">
                {visibleModels.map((model) => (
                  <label
                    key={model.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-xs text-text-dark hover:bg-bg-dark"
                  >
                    <UiCheckbox
                      aria-label={model.label || model.id}
                      checked={selectedModelIdSet.has(model.id)}
                      onCheckedChange={(selected) => changeModelSelection(api, model.id, selected)}
                    />
                    <span className="min-w-0 break-words">{model.label || model.id}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </ProviderDetailSection>
      </div>
    );
  };

  return (
    <ProviderListShell<TextApiConfig>
      items={apis}
      getItemId={(api) => api.id}
      getItemTitle={(api) => api.name || t('settings.textApiUntitled')}
      getItemHealth={textProviderHealth}
      getItemMeta={(api) =>
        api.selectedModelIds.length > 0
          ? t('settings.providerModelsCount', { count: api.selectedModelIds.length })
          : undefined
      }
      onAdd={() => {
        const config = createTextApiConfig();
        onChange([...apis, config]);
        return config.id;
      }}
      onRemove={(id) => onChange(apis.filter((api) => api.id !== id))}
      onRestore={(api, index) => {
        const next = [...apis];
        next.splice(index, 0, api);
        onChange(next);
      }}
      onDetailChange={onDetailChange}
      renderDetail={renderDetail}
      addLabel={t('settings.addTextApi')}
      removeLabel={t('settings.removeTextApi')}
      emptyLabel={t('settings.noTextApisConfigured')}
    />
  );
}
