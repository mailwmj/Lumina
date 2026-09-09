import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, FolderOpen, AlertTriangle, Crop, Loader2 } from '@/components/ui/icons';
import { useProjectStore } from '@/stores/projectStore';
import { UI_CONTENT_OVERLAY_INSET_CLASS } from '@/components/ui/motion';
import { UiButton, UiInput, UiModal, UiSelect } from '@/components/ui';
import { RenameDialog } from './RenameDialog';
import { ProjectCard } from './ProjectCard';

type ProjectSortField = 'name' | 'createdAt' | 'updatedAt';
type SortDirection = 'asc' | 'desc';

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  projectName: string;
  onClose: () => void;
  onConfirm: () => void;
}

function DeleteConfirmDialog({
  isOpen,
  projectName,
  onClose,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <UiModal
      isOpen={isOpen}
      title={t('project.deleteConfirmTitle')}
      closeLabel={t('common.close')}
      onClose={onClose}
      widthClassName="w-[420px] max-w-[calc(100vw-24px)]"
      footer={(
        <>
          <UiButton onClick={onClose}>{t('common.cancel')}</UiButton>
          <UiButton
            variant="danger"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {t('project.deleteConfirmButton')}
          </UiButton>
        </>
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
        <p className="text-sm leading-6 text-text-muted">
          {t('project.deleteConfirmMessage', { name: projectName })}
        </p>
      </div>
    </UiModal>
  );
}

interface ProjectManagerProps {
  onOpenBatchCrop: () => void;
}

export function ProjectManager({ onOpenBatchCrop }: ProjectManagerProps) {
  const { t, i18n } = useTranslation();
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [sortField, setSortField] = useState<ProjectSortField>('updatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [query, setQuery] = useState('');
  const [openError, setOpenError] = useState<{ id: string; name: string } | null>(null);
  const openingTarget = useRef<{ id: string; name: string } | null>(null);

  const { projects, isOpeningProject, createProject, deleteProject, renameProject, openProject } =
    useProjectStore();

  useEffect(() => useProjectStore.subscribe((state, previous) => {
    if (previous.isOpeningProject && !state.isOpeningProject && openingTarget.current) {
      if (!state.currentProjectId) setOpenError(openingTarget.current);
      openingTarget.current = null;
    }
  }), []);

  const handleOpen = (project: { id: string; name: string }) => {
    setOpenError(null);
    openingTarget.current = project;
    openProject(project.id);
  };

  const handleCreateProject = () => {
    setEditingProjectId(null);
    setEditingProjectName('');
    setShowRenameDialog(true);
  };

  const handleRenameClick = (id: string, name: string) => {
    setEditingProjectId(id);
    setEditingProjectName(name);
    setShowRenameDialog(true);
  };

  const handleConfirmDelete = () => {
    if (deleteTarget) {
      deleteProject(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  const handleConfirm = (name: string) => {
    if (editingProjectId) {
      renameProject(editingProjectId, name);
    } else {
      createProject(name);
    }
  };

  const sortedProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(i18n.language);
    const list = projects.filter((project) => project.name.toLocaleLowerCase(i18n.language).includes(normalizedQuery));
    const direction = sortDirection === 'asc' ? 1 : -1;

    list.sort((a, b) => {
      if (sortField === 'name') {
        return a.name.localeCompare(b.name, i18n.language, { sensitivity: 'base' }) * direction;
      }

      const left = sortField === 'createdAt' ? a.createdAt : a.updatedAt;
      const right = sortField === 'createdAt' ? b.createdAt : b.updatedAt;
      return (left - right) * direction;
    });

    return list;
  }, [projects, query, sortDirection, sortField, i18n.language]);

  return (
    <div className="ui-scrollbar h-full w-full overflow-auto bg-bg-dark px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-text-dark">{t('project.title')}</h1>
            <p className="mt-1.5 text-sm text-text-muted">{t('project.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <UiButton type="button" disabled={isOpeningProject} onClick={onOpenBatchCrop} className="gap-2">
              <Crop className="h-4 w-4" />
              {t('batchCrop.entry')}
            </UiButton>
            <UiButton type="button" disabled={isOpeningProject} variant="primary" onClick={handleCreateProject} className="gap-2">
              <Plus className="h-4 w-4" />
              {t('project.newProject')}
            </UiButton>
          </div>
        </header>

        {projects.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-[var(--ui-border-soft)] pb-4">
            <div className="flex min-w-0 flex-1 basis-60 items-center gap-2">
              <UiInput
                type="search"
                aria-label={t('project.search')}
                placeholder={t('project.search')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-9"
              />
              {query && <UiButton size="sm" className="shrink-0" onClick={() => setQuery('')}>{t('project.clearSearch')}</UiButton>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <UiSelect
                aria-label={t('project.sortBy')}
                value={sortField}
                onChange={(event) => setSortField(event.target.value as ProjectSortField)}
                className="h-9 w-[144px] text-xs"
              >
                <option value="updatedAt">{t('project.sortByUpdatedAt')}</option>
                <option value="createdAt">{t('project.sortByCreatedAt')}</option>
                <option value="name">{t('project.sortByName')}</option>
              </UiSelect>
              <UiSelect
                aria-label={t('project.sortDirection')}
                value={sortDirection}
                onChange={(event) => setSortDirection(event.target.value as SortDirection)}
                className="h-9 w-[128px] text-xs"
              >
                <option value="desc">{t('project.sortDesc')}</option>
                <option value="asc">{t('project.sortAsc')}</option>
              </UiSelect>
            </div>
            <p role="status" className="w-full text-xs text-text-muted tabular-nums">
              {t('project.resultCount', { count: sortedProjects.length, total: projects.length })}
            </p>
          </div>
        )}

        {openError && (
          <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-500/25 bg-red-500/5 p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
            <p className="min-w-0 flex-1 break-words text-sm text-text-dark">{t('project.openFailed', { name: openError.name })}</p>
            <UiButton size="sm" disabled={isOpeningProject} onClick={() => handleOpen(openError)}>{t('project.retryOpen')}</UiButton>
            <UiButton size="sm" variant="ghost" onClick={() => setOpenError(null)}>{t('common.close')}</UiButton>
          </div>
        )}

        {projects.length === 0 ? (
          <section className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-[var(--ui-border-strong)] px-6 py-16 text-center">
            <FolderOpen className="mb-5 h-9 w-9 text-text-muted" />
            <h2 className="text-base font-medium text-text-dark">{t('project.empty')}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-text-muted">{t('project.emptyHint')}</p>
            <UiButton variant="primary" disabled={isOpeningProject} onClick={handleCreateProject} className="mt-6 gap-2">
              <Plus className="h-4 w-4" />{t('project.createFirst')}
            </UiButton>
          </section>
        ) : sortedProjects.length === 0 ? (
          <section className="flex flex-col items-center py-16 text-center">
            <h2 className="text-sm font-medium text-text-dark">{t('project.noSearchResults')}</h2>
            <p className="mt-2 text-sm text-text-muted">{t('project.searchHint')}</p>
            <UiButton className="mt-4" onClick={() => setQuery('')}>{t('project.clearSearch')}</UiButton>
          </section>
        ) : (
          <div aria-busy={isOpeningProject} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sortedProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                disabled={isOpeningProject}
                onOpen={() => handleOpen(project)}
                onRename={() => handleRenameClick(project.id, project.name)}
                onDelete={() => setDeleteTarget({ id: project.id, name: project.name })}
              />
            ))}
          </div>
        )}
      </div>

      {isOpeningProject && (
        <div className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-20 flex items-center justify-center bg-bg-dark/60`}>
          <div role="status" className="flex max-w-[calc(100%-32px)] items-center gap-3 rounded-lg border border-[var(--ui-border-soft)] bg-surface-dark px-5 py-4 text-sm text-text-dark shadow-[var(--ui-shadow-panel)]">
            <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin" />
            <span className="min-w-0 break-words">{t('project.opening')}</span>
          </div>
        </div>
      )}

      <RenameDialog
        isOpen={showRenameDialog}
        title={editingProjectId ? t('project.renameTitle') : t('project.newProjectTitle')}
        defaultValue={editingProjectName}
        onClose={() => setShowRenameDialog(false)}
        onConfirm={handleConfirm}
      />

      <DeleteConfirmDialog
        isOpen={deleteTarget !== null}
        projectName={deleteTarget?.name ?? ''}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
