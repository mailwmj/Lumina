import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Loader2 } from '@/components/ui/icons';
import type { ProviderHealth } from '@/features/settings/application/settingsHealth';

const HEALTH_STYLE: Record<ProviderHealth, { dot: string; text: string }> = {
  ready: { dot: 'bg-emerald-500', text: 'text-emerald-500' },
  noModels: { dot: 'bg-amber-500', text: 'text-amber-500' },
  unconfigured: { dot: 'bg-text-muted/40', text: 'text-text-muted' },
  disabled: { dot: 'bg-text-muted/25', text: 'text-text-muted' },
};

export function ProviderHealthBadge({ health }: { health: ProviderHealth }) {
  const { t } = useTranslation();
  const style = HEALTH_STYLE[health];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs ${style.text}`}>
      <span className={`h-2 w-2 rounded-full ${style.dot}`} />
      {t(`settings.providerHealth.${health}`)}
    </span>
  );
}

export function ProviderDetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--ui-border-soft)] pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-3 text-xs font-semibold text-text-muted">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export type ConnectionTestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; message: string }
  | { status: 'error'; message: string };

export function ConnectionTestRow({
  state,
  disabledReason,
  onTest,
}: {
  state: ConnectionTestState;
  /** When set, the test cannot run and this explains why. */
  disabledReason?: string;
  onTest: () => void;
}) {
  const disabled = Boolean(disabledReason);
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center gap-3">
      <button
        type="button"
        onClick={onTest}
        disabled={disabled || state.status === 'testing'}
        className="inline-flex h-8 shrink-0 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark disabled:opacity-50"
      >
        {state.status === 'testing' && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        {state.status === 'testing' ? t('settings.connectionTesting') : t('settings.connectionTest')}
      </button>
      {state.status === 'ok' && (
        <span className="min-w-0 break-words text-xs text-emerald-500">{state.message}</span>
      )}
      {state.status === 'error' && (
        <span className="min-w-0 break-words text-xs text-red-400">{state.message}</span>
      )}
      {state.status === 'idle' && disabledReason && (
        <span className="text-xs text-text-muted">{disabledReason}</span>
      )}
    </div>
  );
}

export function StaleModelsNotice() {
  const { t } = useTranslation();
  return (
    <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-500">
      {t('settings.modelsMayBeStale')}
    </p>
  );
}
