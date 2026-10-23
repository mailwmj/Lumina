import type { ReactNode } from 'react';

export function SettingsPageSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-[var(--ui-border-soft)] py-5 last:border-b-0">
      <h3 className="mb-3 text-xs font-semibold text-text-muted">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
