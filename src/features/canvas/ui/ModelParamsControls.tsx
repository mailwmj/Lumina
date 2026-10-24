import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, SlidersHorizontal, Zap } from '@/components/ui/icons';
import { useTranslation } from 'react-i18next';
import { UI_POPOVER_TRANSITION_MS } from '@/components/ui/motion';
import { useDialogTransition } from '@/components/ui/useDialogTransition';

import {
  AUTO_REQUEST_ASPECT_RATIO,
  IMAGE_OUTPUT_COUNTS,
  type ImageOutputCount,
} from '@/features/canvas/domain/canvasNodes';
import {
  getModelProvider,
  type AspectRatioOption,
  type ImageModelDefinition,
  type ResolutionOption,
} from '@/features/canvas/models';
import {
  UiChipButton,
  UiPanel,
  UiInput,
  UiCheckbox,
  UiSelect,
} from '@/components/ui';

interface ModelParamsControlsProps {
  imageModels: ImageModelDefinition[];
  selectedModel: ImageModelDefinition;
  resolutionOptions: ResolutionOption[];
  selectedResolution: ResolutionOption;
  selectedAspectRatio: AspectRatioOption;
  aspectRatioOptions: AspectRatioOption[];
  onModelChange: (modelId: string) => void;
  onResolutionChange: (resolution: string) => void;
  onAspectRatioChange: (aspectRatio: string) => void;
  outputCount?: ImageOutputCount;
  onOutputCountChange?: (outputCount: ImageOutputCount) => void;
  extraParams?: Record<string, unknown>;
  onExtraParamChange?: (key: string, value: boolean | number | string) => void;
  showWebSearchToggle?: boolean;
  webSearchEnabled?: boolean;
  onWebSearchToggle?: (enabled: boolean) => void;
  webSearchLabel?: string;
  showProviderName?: boolean;
  triggerSize?: 'md' | 'sm';
  chipClassName?: string;
  modelChipClassName?: string;
  paramsChipClassName?: string;
  modelPanelAlign?: 'center' | 'start';
  paramsPanelAlign?: 'center' | 'start';
  modelPanelClassName?: string;
  paramsPanelClassName?: string;
  providerOptionClassName?: string;
  modelOptionClassName?: string;
}

interface PanelAnchor {
  left: number;
  top: number;
  bottom: number;
}

type PanelKind = 'model' | 'params' | 'otherParams';

const OTHER_PARAMS_PANEL_CLASS_NAME = 'w-[280px] p-3';
const DEFAULT_MODEL_PANEL_CLASS_NAME = 'w-full p-1.5';
const DEFAULT_PROVIDER_OPTION_CLASS_NAME = 'h-7 px-2.5';
const DEFAULT_MODEL_OPTION_CLASS_NAME = 'h-8 px-2.5';
const MODEL_PANEL_WIDTH = 300;
const PARAMS_PANEL_WIDTH = 344;

// One selected treatment for every option in these panels, matching the active
// trigger chip, so the lime fill stays reserved for the generate button.
const OPTION_ACTIVE_CLASS = 'bg-accent/15 text-text-dark ring-1 ring-inset ring-accent/50';
const OPTION_IDLE_CLASS = 'text-text-muted hover:bg-[var(--ui-hover)] hover:text-text-dark';
const SEGMENTED_GROUP_CLASS =
  'flex gap-0.5 rounded-[10px] border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)] p-0.5';

function parseRatio(ratio: string): number | null {
  const [rawW, rawH] = ratio.split(':').map((value) => Number(value));
  return Number.isFinite(rawW) && Number.isFinite(rawH) && rawW > 0 && rawH > 0
    ? rawW / rawH
    : null;
}

// Auto first, then widest to tallest so landscape, square and portrait read as
// a continuum regardless of the order a model declares them in.
function sortAspectRatioOptions(options: AspectRatioOption[]): AspectRatioOption[] {
  const rank = (option: AspectRatioOption) =>
    option.value === AUTO_REQUEST_ASPECT_RATIO
      ? Number.MAX_VALUE
      : parseRatio(option.value) ?? -1;
  return [...options].sort((left, right) => rank(right) - rank(left));
}

function getRatioPreviewStyle(ratio: string): { width: number; height: number } {
  const value = parseRatio(ratio) ?? 1;
  const box = 18;
  if (value >= 1) {
    return { width: box, height: Math.max(7, Math.round(box / value)) };
  }
  return { width: Math.max(7, Math.round(box * value)), height: box };
}

function resolveTranslatedText(
  t: (key: string) => string,
  key: string | undefined,
  fallback: string | undefined
): string {
  if (!key) {
    return fallback ?? '';
  }

  const translated = t(key);
  return translated === key ? (fallback ?? key) : translated;
}

function resolveExtraParamValue(
  key: string,
  extraParams: Record<string, unknown> | undefined,
  defaultExtraParams: Record<string, unknown> | undefined,
  schemaDefault: boolean | number | string | undefined
): boolean | number | string | undefined {
  const currentValue = extraParams?.[key];
  if (typeof currentValue === 'boolean' || typeof currentValue === 'number' || typeof currentValue === 'string') {
    return currentValue;
  }

  const modelDefaultValue = defaultExtraParams?.[key];
  if (
    typeof modelDefaultValue === 'boolean' ||
    typeof modelDefaultValue === 'number' ||
    typeof modelDefaultValue === 'string'
  ) {
    return modelDefaultValue;
  }

  return schemaDefault;
}

export const ModelParamsControls = memo(({
  imageModels,
  selectedModel,
  resolutionOptions,
  selectedResolution,
  selectedAspectRatio,
  aspectRatioOptions,
  onModelChange,
  onResolutionChange,
  onAspectRatioChange,
  outputCount,
  onOutputCountChange,
  extraParams,
  onExtraParamChange,
  showWebSearchToggle = false,
  webSearchEnabled = false,
  onWebSearchToggle,
  webSearchLabel,
  showProviderName = true,
  triggerSize = 'md',
  chipClassName = '',
  modelChipClassName = 'w-auto justify-start',
  paramsChipClassName = 'w-auto justify-start',
  modelPanelAlign = 'start',
  paramsPanelAlign = 'center',
  modelPanelClassName = DEFAULT_MODEL_PANEL_CLASS_NAME,
  paramsPanelClassName = 'w-full p-2',
  providerOptionClassName = DEFAULT_PROVIDER_OPTION_CLASS_NAME,
  modelOptionClassName = DEFAULT_MODEL_OPTION_CLASS_NAME,
}: ModelParamsControlsProps) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLDivElement>(null);
  const paramsTriggerRef = useRef<HTMLDivElement>(null);
  const otherParamsTriggerRef = useRef<HTMLDivElement>(null);
  const modelPanelRef = useRef<HTMLDivElement>(null);
  const paramsPanelRef = useRef<HTMLDivElement>(null);
  const otherParamsPanelRef = useRef<HTMLDivElement>(null);
  const [openPanel, setOpenPanel] = useState<PanelKind | null>(null);
  // Keeps the last panel mounted while it fades out; switching panels swaps instantly.
  const [lastPanel, setLastPanel] = useState<PanelKind | null>(null);
  const { shouldRender, isVisible: isPanelVisible } = useDialogTransition(
    openPanel !== null,
    UI_POPOVER_TRANSITION_MS
  );
  const renderPanel = shouldRender ? openPanel ?? lastPanel : null;
  const [modelPanelAnchor, setModelPanelAnchor] = useState<PanelAnchor | null>(null);
  const [paramsPanelAnchor, setParamsPanelAnchor] = useState<PanelAnchor | null>(null);
  const [otherParamsPanelAnchor, setOtherParamsPanelAnchor] = useState<PanelAnchor | null>(null);
  const [modelAnchorBaseWidth, setModelAnchorBaseWidth] = useState<number | null>(null);
  const [paramsAnchorBaseWidth, setParamsAnchorBaseWidth] = useState<number | null>(null);
  const [otherParamsAnchorBaseWidth, setOtherParamsAnchorBaseWidth] = useState<number | null>(null);
  const [panelProviderId, setPanelProviderId] = useState(selectedModel.providerId);

  const selectedProvider = useMemo(
    () => getModelProvider(selectedModel.providerId, selectedModel.providerName),
    [selectedModel.providerId, selectedModel.providerName]
  );
  const selectedModelName = useMemo(
    () => selectedModel.displayName.replace(/\s*\([^)]*\)\s*$/u, '').trim() || selectedModel.displayName,
    [selectedModel.displayName]
  );
  const selectedProviderName = selectedProvider.label || selectedProvider.name;
  const sortedAspectRatioOptions = useMemo(
    () => sortAspectRatioOptions(aspectRatioOptions),
    [aspectRatioOptions]
  );
  const providerOptions = useMemo(() => {
    const providerOrder = ['kie', 'ppio', 'fal', 'grsai', 'bltcy'];
    const providerIndex = new Map(providerOrder.map((id, index) => [id, index]));
    const uniqueProviderIds = Array.from(new Set(imageModels.map((model) => model.providerId)));
    return uniqueProviderIds
      .map((providerId) => {
        const providerModel = imageModels.find((model) => model.providerId === providerId);
        return getModelProvider(providerId, providerModel?.providerName);
      })
      .sort((left, right) => {
        const leftIndex = providerIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = providerIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
      });
  }, [imageModels]);
  const providerModels = useMemo(
    () => imageModels.filter((model) => model.providerId === panelProviderId),
    [imageModels, panelProviderId]
  );
  const modelGroups = useMemo(() => {
    const grouped = new Map<string, ImageModelDefinition[]>();
    providerModels.forEach((model) => {
      const normalizedName = model.displayName.replace(/\s*\([^)]*\)\s*$/u, '').trim();
      const key = normalizedName.length > 0 ? normalizedName : model.displayName;
      const current = grouped.get(key) ?? [];
      current.push(model);
      grouped.set(key, current);
    });
    return Array.from(grouped.entries())
      .map(([name, models]) => ({ name, models }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [providerModels]);
  const isCompactTrigger = triggerSize === 'sm';
  const paramsIconClassName = isCompactTrigger ? 'h-2.5 w-2.5 shrink-0' : 'h-4 w-4 shrink-0';
  const modelTextClassName = isCompactTrigger
    ? 'min-w-0 truncate font-mono text-[10px] font-medium leading-none'
    : 'min-w-0 truncate font-mono font-medium';
  const providerTextClassName = isCompactTrigger
    ? 'shrink-0 font-mono text-[10px] leading-none text-text-muted/80'
    : 'shrink-0 font-mono text-text-muted/80';
  const paramsPrimaryTextClassName = isCompactTrigger
    ? 'truncate text-[10px] leading-none'
    : 'truncate';
  const paramsSecondaryTextClassName = isCompactTrigger
    ? 'text-[10px] leading-none text-text-muted/80'
    : 'text-text-muted/80';
  const extraParamSchema = selectedModel.extraParamsSchema ?? [];
  const inlineExtraParamSchema = useMemo(
    () =>
      extraParamSchema.filter(
        (definition) => definition.key === 'thinking_level' && definition.type === 'enum'
      ),
    [extraParamSchema]
  );
  const panelExtraParamSchema = useMemo(
    () => extraParamSchema.filter((definition) => definition.key !== 'thinking_level'),
    [extraParamSchema]
  );
  const hasOtherParamsPanel = showWebSearchToggle || inlineExtraParamSchema.length > 0;

  const togglePanel = (panel: PanelKind) => {
    if (openPanel === panel) {
      setOpenPanel(null);
      return false;
    }
    setLastPanel(panel);
    setOpenPanel(panel);
    return true;
  };

  useEffect(() => {
    if (!openPanel) {
      return;
    }

    const isInside = (target: EventTarget | null) => {
      const node = target as globalThis.Node | null;
      return [containerRef, modelPanelRef, paramsPanelRef, otherParamsPanelRef].some(
        (ref) => ref.current?.contains(node)
      );
    };
    const handleOutside = (event: Event) => {
      if (!isInside(event.target)) {
        setOpenPanel(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenPanel(null);
      }
    };

    // Panels are fixed to the viewport, so zooming the canvas would leave them
    // detached from their node; close instead of following.
    document.addEventListener('mousedown', handleOutside, true);
    document.addEventListener('wheel', handleOutside, { capture: true, passive: true });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
      document.removeEventListener('wheel', handleOutside, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openPanel]);

  const getPanelAnchor = (
    triggerElement: HTMLDivElement | null,
    align: 'center' | 'start',
    baseWidth?: number | null
  ): PanelAnchor | null => {
    if (!triggerElement) {
      return null;
    }
    const rect = triggerElement.getBoundingClientRect();
    const anchorWidth = typeof baseWidth === 'number' && baseWidth > 0 ? baseWidth : rect.width;
    return {
      left: align === 'center' ? rect.left + anchorWidth / 2 : rect.left,
      top: rect.top - 8,
      bottom: rect.bottom + 8,
    };
  };

  const buildPanelStyle = (
    anchor: PanelAnchor | null,
    align: 'center' | 'start',
    preferredWidth: number,
    preferredHeight: number
  ): React.CSSProperties | undefined => {
    if (!anchor) {
      return undefined;
    }

    const viewportWidth = Math.max(0, window.innerWidth);
    const viewportHeight = Math.max(0, window.innerHeight);
    const panelWidth = Math.min(preferredWidth, Math.max(0, viewportWidth - 24));
    const idealLeft = align === 'center' ? anchor.left - panelWidth / 2 : anchor.left;
    const maxLeft = Math.max(12, viewportWidth - panelWidth - 12);
    const left = Math.min(Math.max(idealLeft, 12), maxLeft);
    const availableAbove = anchor.top - 12;
    const availableBelow = viewportHeight - anchor.bottom - 12;
    const showBelow =
      availableAbove < Math.min(preferredHeight, 220) && availableBelow > availableAbove;

    return {
      left,
      top: showBelow ? anchor.bottom : anchor.top,
      width: panelWidth,
      transform: showBelow ? undefined : 'translateY(-100%)',
    };
  };

  return (
    <div ref={containerRef} className="nodrag nowheel flex items-center gap-1">
      <div ref={modelTriggerRef} className="relative flex">
        <UiChipButton
          active={openPanel === 'model'}
          className={`${chipClassName} ${modelChipClassName}`}
          onClick={(event) => {
            event.stopPropagation();
            if (!togglePanel('model')) {
              return;
            }
            setPanelProviderId(selectedModel.providerId);
            const triggerWidth = modelTriggerRef.current?.getBoundingClientRect().width ?? null;
            const nextBaseWidth = modelAnchorBaseWidth ?? triggerWidth;
            if (modelAnchorBaseWidth == null && triggerWidth) {
              setModelAnchorBaseWidth(triggerWidth);
            }
            setModelPanelAnchor(getPanelAnchor(modelTriggerRef.current, modelPanelAlign, nextBaseWidth));
          }}
        >
          <span className={modelTextClassName}>{selectedModelName}</span>
          {showProviderName && (
            <span className={providerTextClassName}>{selectedProviderName}</span>
          )}
        </UiChipButton>
      </div>

      <div ref={paramsTriggerRef} className="relative flex">
        <UiChipButton
          active={openPanel === 'params'}
          className={`${chipClassName} ${paramsChipClassName}`}
          onClick={(event) => {
            event.stopPropagation();
            if (!togglePanel('params')) {
              return;
            }
            const triggerWidth = paramsTriggerRef.current?.getBoundingClientRect().width ?? null;
            const nextBaseWidth = paramsAnchorBaseWidth ?? triggerWidth;
            if (paramsAnchorBaseWidth == null && triggerWidth) {
              setParamsAnchorBaseWidth(triggerWidth);
            }
            setParamsPanelAnchor(getPanelAnchor(paramsTriggerRef.current, paramsPanelAlign, nextBaseWidth));
          }}
        >
          <SlidersHorizontal className={paramsIconClassName} />
          <span className={`${paramsPrimaryTextClassName} font-mono`}>{selectedAspectRatio.label}</span>
          <span className={paramsSecondaryTextClassName}>· {selectedResolution.label}</span>
        </UiChipButton>
      </div>

      {hasOtherParamsPanel && (
        <div ref={otherParamsTriggerRef} className="relative flex">
          <UiChipButton
            active={openPanel === 'otherParams'}
            className={`${chipClassName} w-auto shrink-0 justify-center`}
            onClick={(event) => {
              event.stopPropagation();
              if (!togglePanel('otherParams')) {
                return;
              }
              const triggerWidth = otherParamsTriggerRef.current?.getBoundingClientRect().width ?? null;
              const nextBaseWidth = otherParamsAnchorBaseWidth ?? triggerWidth;
              if (otherParamsAnchorBaseWidth == null && triggerWidth) {
                setOtherParamsAnchorBaseWidth(triggerWidth);
              }
              setOtherParamsPanelAnchor(
                getPanelAnchor(otherParamsTriggerRef.current, 'center', nextBaseWidth)
              );
            }}
          >
            <SlidersHorizontal className={paramsIconClassName} />
            <span className={paramsPrimaryTextClassName}>{t('modelParams.otherParams')}</span>
          </UiChipButton>
        </div>
      )}

      {typeof document !== 'undefined' && renderPanel === 'model' && createPortal(
        <div
          ref={modelPanelRef}
          className={`fixed z-[80] transition-opacity ease-out ${isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          style={{
            ...buildPanelStyle(modelPanelAnchor, modelPanelAlign, MODEL_PANEL_WIDTH, 360),
            transitionDuration: `${UI_POPOVER_TRANSITION_MS}ms`,
          }}
        >
          <UiPanel
            className={modelPanelClassName}
            style={{ width: '100%', minWidth: 0, maxWidth: '100%' }}
          >
            {providerOptions.length > 1 && (
              <div
                role="tablist"
                aria-label={t('modelParams.provider')}
                className="mb-1 flex flex-wrap gap-1 border-b border-[var(--ui-border-soft)] p-0.5 pb-1.5"
              >
                {providerOptions.map((provider) => {
                  const active = provider.id === panelProviderId;
                  const holdsSelectedModel = provider.id === selectedModel.providerId;
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`inline-flex items-center gap-1.5 rounded-md text-xs transition-colors ${providerOptionClassName} ${active ? OPTION_ACTIVE_CLASS : OPTION_IDLE_CLASS}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setPanelProviderId(provider.id);
                      }}
                    >
                      {provider.label || provider.name}
                      {holdsSelectedModel && !active && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <div
              role="listbox"
              aria-label={t('modelParams.model')}
              className="ui-scrollbar max-h-[min(320px,calc(100vh-120px))] space-y-0.5 overflow-y-auto overflow-x-hidden p-0.5"
            >
              {modelGroups.map((group) => {
                const active = group.models.some((model) => model.id === selectedModel.id);
                const targetModel = group.models.find((model) => model.id === selectedModel.id)
                  ?? group.models[0];
                return (
                  <button
                    key={group.name}
                    type="button"
                    role="option"
                    aria-selected={active}
                    title={group.name}
                    className={`flex w-full min-w-0 items-center gap-2 rounded-md text-left text-xs transition-colors ${modelOptionClassName} ${active ? OPTION_ACTIVE_CLASS : OPTION_IDLE_CLASS}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onModelChange(targetModel.id);
                      setOpenPanel(null);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono">{group.name}</span>
                    {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </UiPanel>
        </div>,
        document.body
      )}

      {typeof document !== 'undefined' && renderPanel === 'params' && createPortal(
        <div
          ref={paramsPanelRef}
          className={`fixed z-[80] transition-opacity ease-out ${isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          style={{
            ...buildPanelStyle(paramsPanelAnchor, paramsPanelAlign, PARAMS_PANEL_WIDTH, 300),
            transitionDuration: `${UI_POPOVER_TRANSITION_MS}ms`,
          }}
        >
          <UiPanel
            className={`space-y-2 ${paramsPanelClassName}`}
            style={{ width: '100%', minWidth: 0, maxWidth: '100%' }}
          >
            <div
              role="radiogroup"
              aria-label={t('modelParams.aspectRatio')}
              className="grid grid-cols-6 gap-0.5 rounded-[10px] border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)] p-0.5"
            >
              {sortedAspectRatioOptions.map((item) => {
                const active = item.value === selectedAspectRatio.value;
                const isAuto = item.value === AUTO_REQUEST_ASPECT_RATIO;
                return (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`flex flex-col items-center gap-1 rounded-lg px-1 pb-1.5 pt-2 transition-colors ${active ? OPTION_ACTIVE_CLASS : OPTION_IDLE_CLASS}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAspectRatioChange(item.value);
                    }}
                  >
                    <span className="flex h-[18px] items-center justify-center">
                      {isAuto ? (
                        <Zap className="h-3.5 w-3.5" strokeWidth={2.2} />
                      ) : (
                        <span
                          className="inline-block rounded-[3px] border-[1.5px] border-current"
                          style={getRatioPreviewStyle(item.value)}
                        />
                      )}
                    </span>
                    <span className={`text-[11px] leading-none ${isAuto ? '' : 'font-mono'}`}>
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2">
              <div
                role="radiogroup"
                aria-label={t('modelParams.quality')}
                className={`min-w-0 flex-1 ${SEGMENTED_GROUP_CLASS}`}
              >
                {resolutionOptions.map((item) => {
                  const active = item.value === selectedResolution.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`h-7 min-w-0 flex-1 rounded-lg font-mono text-xs transition-colors ${active ? OPTION_ACTIVE_CLASS : OPTION_IDLE_CLASS}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onResolutionChange(item.value);
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>

              {outputCount !== undefined && onOutputCountChange && (
                <div
                  role="radiogroup"
                  aria-label={t('modelParams.outputCount')}
                  className={`min-w-0 flex-1 ${SEGMENTED_GROUP_CLASS}`}
                >
                  {IMAGE_OUTPUT_COUNTS.map((count) => {
                    const active = count === outputCount;
                    return (
                      <button
                        key={count}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={`h-7 min-w-0 flex-1 rounded-lg text-xs transition-colors ${active ? OPTION_ACTIVE_CLASS : OPTION_IDLE_CLASS}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onOutputCountChange(count);
                        }}
                      >
                        {t('modelParams.outputCountOption', { count })}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {panelExtraParamSchema.length > 0 && (
              <div>
                <div className="space-y-2 rounded-[10px] border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)] p-3">
                  {panelExtraParamSchema.map((definition) => {
                    const translatedLabel = resolveTranslatedText(
                      t,
                      definition.labelKey,
                      definition.label
                    );
                    const translatedDescription = definition.description || definition.descriptionKey
                      ? resolveTranslatedText(
                        t,
                        definition.descriptionKey,
                        definition.description
                      )
                      : '';
                    const resolvedValue = resolveExtraParamValue(
                      definition.key,
                      extraParams,
                      selectedModel.defaultExtraParams,
                      definition.defaultValue
                    );

                    return (
                      <div key={definition.key} className="space-y-2 border-t border-[var(--ui-border-soft)] pt-2 first:border-t-0 first:pt-0">
                        <div>
                          <div className="text-xs font-medium text-text-dark">{translatedLabel}</div>
                          {translatedDescription && (
                            <div className="mt-0.5 text-[11px] leading-4 text-text-muted">
                              {translatedDescription}
                            </div>
                          )}
                        </div>

                        {definition.type === 'enum' && definition.options && (
                          <UiSelect
                            value={String(resolvedValue ?? '')}
                            onChange={(event) =>
                              onExtraParamChange?.(definition.key, event.target.value)
                            }
                            className="h-9 text-sm"
                          >
                            {definition.options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {resolveTranslatedText(t, option.labelKey, option.label)}
                              </option>
                            ))}
                          </UiSelect>
                        )}

                        {definition.type === 'boolean' && (
                          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-dark">
                            <UiCheckbox
                              aria-label={translatedLabel}
                              checked={Boolean(resolvedValue)}
                              onCheckedChange={(checked) =>
                                onExtraParamChange?.(definition.key, checked)
                              }
                            />
                            <span>{translatedLabel}</span>
                          </label>
                        )}

                        {definition.type === 'number' && (
                          <UiInput
                            type="number"
                            min={definition.min}
                            max={definition.max}
                            step={definition.step}
                            value={typeof resolvedValue === 'number' ? String(resolvedValue) : ''}
                            onChange={(event) =>
                              onExtraParamChange?.(definition.key, Number(event.target.value))
                            }
                            className="h-9 text-sm"
                          />
                        )}

                        {definition.type === 'string' && (
                          <UiInput
                            value={typeof resolvedValue === 'string' ? resolvedValue : ''}
                            onChange={(event) =>
                              onExtraParamChange?.(definition.key, event.target.value)
                            }
                            className="h-9 text-sm"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </UiPanel>
        </div>,
        document.body
      )}

      {typeof document !== 'undefined' && renderPanel === 'otherParams' && createPortal(
        <div
          ref={otherParamsPanelRef}
          className={`fixed z-[80] transition-opacity ease-out ${isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          style={{
            ...buildPanelStyle(otherParamsPanelAnchor, 'center', 280, 260),
            transitionDuration: `${UI_POPOVER_TRANSITION_MS}ms`,
          }}
        >
          <UiPanel
            className={OTHER_PARAMS_PANEL_CLASS_NAME}
            style={{ width: '100%', minWidth: 0, maxWidth: '100%' }}
          >
            <div className="space-y-3">
              {showWebSearchToggle && (
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)] px-3 py-2">
                  <UiCheckbox
                    aria-label={webSearchLabel ?? t('modelParams.enableWebSearch')}
                    checked={webSearchEnabled}
                    onCheckedChange={(checked) => onWebSearchToggle?.(checked)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-text-dark">
                      {webSearchLabel ?? t('modelParams.enableWebSearch')}
                    </div>
                  </div>
                </label>
              )}

              {inlineExtraParamSchema.map((definition) => {
                const translatedLabel = resolveTranslatedText(t, definition.labelKey, definition.label);
                const translatedDescription = definition.description || definition.descriptionKey
                  ? resolveTranslatedText(
                    t,
                    definition.descriptionKey,
                    definition.description
                  )
                  : '';
                const resolvedValue = resolveExtraParamValue(
                  definition.key,
                  extraParams,
                  selectedModel.defaultExtraParams,
                  definition.defaultValue
                );

                return (
                  <div
                    key={definition.key}
                    className="space-y-2 rounded-lg border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)] p-3"
                  >
                    <div>
                      <div className="text-xs font-medium text-text-dark">{translatedLabel}</div>
                      {translatedDescription && (
                        <div className="mt-0.5 text-[11px] leading-4 text-text-muted">
                          {translatedDescription}
                        </div>
                      )}
                    </div>
                    <UiSelect
                      value={String(resolvedValue ?? '')}
                      onChange={(event) => onExtraParamChange?.(definition.key, event.target.value)}
                      className="h-9 text-sm"
                    >
                      {(definition.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {resolveTranslatedText(t, option.labelKey, option.label)}
                        </option>
                      ))}
                    </UiSelect>
                  </div>
                );
              })}
            </div>
          </UiPanel>
        </div>,
        document.body
      )}

    </div>
  );
});

ModelParamsControls.displayName = 'ModelParamsControls';
