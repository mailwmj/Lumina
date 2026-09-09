import { useTranslation } from 'react-i18next';
import { ArrowRight, FolderOpen, Pencil, Trash2 } from '@/components/ui/icons';
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
  const date = new Date(project.updatedAt);

  return (
    <article className="group min-w-0 rounded-lg border border-[var(--ui-border-soft)] bg-surface-dark transition-colors hover:border-[var(--ui-border-strong)] focus-within:border-accent/60">
      <button
        type="button"
        disabled={disabled}
        aria-label={t('project.openNamed', { name: project.name })}
        onClick={(event) => {
          recordProjectOpenClick(event);
          onOpen();
        }}
        className="flex w-full flex-col gap-5 rounded-lg p-4 text-left transition-colors hover:bg-[var(--ui-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-wait disabled:opacity-50"
      >
        <span className="flex w-full items-center justify-between text-text-muted">
          <FolderOpen className="h-5 w-5" />
          <span className="text-xs tabular-nums">{t('project.nodeCount', { count: project.nodeCount })}</span>
        </span>
        <span className="flex w-full min-w-0 items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-dark" title={project.name}>{project.name}</span>
          <ArrowRight className="h-4 w-4 shrink-0 text-text-muted" />
        </span>
      </button>
      <div className="flex items-center justify-between gap-2 border-t border-[var(--ui-border-soft)] px-4 py-2">
        <p className="min-w-0 text-xs leading-5 text-text-muted">
          {t('project.modified')}{' '}
          <time dateTime={date.toISOString()} title={date.toLocaleString(i18n.language)}>
            {date.toLocaleDateString(i18n.language)}
          </time>
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <UiIconButton label={t('project.rename')} disabled={disabled} onClick={onRename} className="h-8 w-8">
            <Pencil className="h-3.5 w-3.5" />
          </UiIconButton>
          <UiIconButton label={t('project.delete')} disabled={disabled} onClick={onDelete} className="h-8 w-8 hover:bg-red-500/10 hover:text-red-500">
            <Trash2 className="h-3.5 w-3.5" />
          </UiIconButton>
        </div>
      </div>
    </article>
  );
}
