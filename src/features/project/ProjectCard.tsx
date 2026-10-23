import { useState } from 'react';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { useTranslation } from 'react-i18next';
import { Image, Pencil, Trash2 } from '@/components/ui/icons';
import { UiIconButton } from '@/components/ui';
import type { ProjectSummary } from '@/stores/projectStore';
import { recordProjectOpenClick } from '@/features/app/projectOpenPaneClickGuard';

interface ProjectCardProps {
  project: ProjectSummary;
  disabled: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}

export function ProjectCard({ project, disabled, onOpen, onRename, onDelete }: ProjectCardProps) {
  const { t, i18n } = useTranslation();
  const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
  const thumbnail = project.thumbnailUrl && failedThumbnail !== project.thumbnailUrl
    ? resolveImageDisplayUrl(project.thumbnailUrl) : null;
  const date = new Date(project.updatedAt);

  return (
    <article className="group relative min-w-0 rounded-xl border border-[var(--ui-border-soft)] bg-surface-dark transition-[border-color,box-shadow] duration-200 hover:border-[var(--ui-border-strong)] hover:shadow-[var(--ui-shadow-panel)] focus-within:border-accent/60">
      <button
        type="button"
        disabled={disabled}
        aria-label={t('project.openNamed', { name: project.name })}
        onClick={(event) => {
          recordProjectOpenClick(event);
          onOpen();
        }}
        className="flex w-full flex-col gap-3 rounded-xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-wait disabled:opacity-50"
      >
        <span className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-[var(--ui-hover)] text-text-muted">
          {thumbnail ? <img src={thumbnail} alt={project.name} loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-[var(--ui-ease-out)] group-hover:scale-[1.03]"
            onError={() => setFailedThumbnail(project.thumbnailUrl ?? null)} />
            : <Image className="h-7 w-7 opacity-60" aria-hidden="true" />}
        </span>
        <span className="flex w-full min-w-0 flex-col gap-1 px-1 pb-1">
          <span className="truncate text-sm font-semibold text-text-dark" title={project.name}>{project.name}</span>
          <span className="flex items-center gap-1.5 text-xs tabular-nums text-text-muted">
            <span>{t('project.nodeCount', { count: project.nodeCount })}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={date.toISOString()} title={date.toLocaleString(i18n.language)}>
              {date.toLocaleDateString(i18n.language)}
            </time>
          </span>
        </span>
      </button>
      <div className="absolute right-5 top-5 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        <UiIconButton label={t('project.rename')} disabled={disabled} onClick={onRename} className="h-8 w-8">
          <Pencil className="h-3.5 w-3.5" />
        </UiIconButton>
        <UiIconButton label={t('project.delete')} disabled={disabled} onClick={onDelete} className="h-8 w-8 hover:bg-red-500/10 hover:text-red-500">
          <Trash2 className="h-3.5 w-3.5" />
        </UiIconButton>
      </div>
    </article>
  );
}
