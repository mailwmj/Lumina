import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, FolderOpen, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { useProjectStore } from '@/stores/projectStore';
import { getConfiguredApiKeyCount, useSettingsStore } from '@/stores/settingsStore';
import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion';
import { useDialogTransition } from '@/components/ui/useDialogTransition';
import { UiButton, UiSelect } from '@/components/ui/primitives';
import { MissingApiKeyHint } from '@/features/settings/MissingApiKeyHint';
import { listModelProviders } from '@/features/canvas/models';
import { RenameDialog } from './RenameDialog';

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
  const { shouldRender, isVisible } = useDialogTransition(isOpen, UI_DIALOG_TRANSITION_MS);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!shouldRender) return null;

  return (
    <div className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-[100] flex items-center justify-center`}>
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        className={`relative w-96 rounded-lg border border-border-dark bg-surface-dark p-6 shadow-xl transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="w-6 h-6 text-red-500 shrink-0" />
          <h2 className="text-lg font-semibold text-text-dark">
            {t('project.deleteConfirmTitle')}
          </h2>
        </div>
        <p className="text-sm text-text-muted mb-6 leading-relaxed">
          {t('project.deleteConfirmMessage', { name: projectName })}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-text-muted hover:text-text-dark transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => { onConfirm(); onClose(); }}
            className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-500 transition-colors"
          >
            {t('project.deleteConfirmButton')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProjectManager() {
  const { t } = useTranslation();
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [sortField, setSortField] = useState<ProjectSortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const providerIds = useMemo(() => listModelProviders().map((provider) => provider.id), []);
  const configuredApiKeyCount = useSettingsStore((state) =>
    getConfiguredApiKeyCount(state.apiKeys, providerIds)
  );

  const { projects, isOpeningProject, createProject, deleteProject, renameProject, openProject } =
    useProjectStore();

  const handleCreateProject = () => {
    setEditingProjectId(null);
    setEditingProjectName('');
    setShowRenameDialog(true);
  };

  const handleRenameClick = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProjectId(id);
    setEditingProjectName(name);
    setShowRenameDialog(true);
  };

  const handleDeleteClick = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget({ id, name });
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

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  const sortedProjects = useMemo(() => {
    const list = [...projects];
    const direction = sortDirection === 'asc' ? 1 : -1;

    list.sort((a, b) => {
      if (sortField === 'name') {
        return a.name.localeCompare(b.name, 'zh-Hans-CN', { sensitivity: 'base' }) * direction;
      }

      const left = sortField === 'createdAt' ? a.createdAt : a.updatedAt;
      const right = sortField === 'createdAt' ? b.createdAt : b.updatedAt;
      return (left - right) * direction;
    });

    return list;
  }, [projects, sortDirection, sortField]);

  return (
    <div className="ui-scrollbar h-full w-full overflow-auto p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-text-dark">{t('project.title')}</h1>
            <div className="flex items-center gap-2">
              <UiSelect
                aria-label={t('project.sortBy')}
                value={sortField}
                onChange={(event) => setSortField(event.target.value as ProjectSortField)}
                className="h-9 w-[100px] rounded-lg text-sm"
              >
                <option value="name">{t('project.sortByName')}</option>
                <option value="createdAt">{t('project.sortByCreatedAt')}</option>
                <option value="updatedAt">{t('project.sortByUpdatedAt')}</option>
              </UiSelect>
              <UiSelect
                aria-label={t('project.sortDirection')}
                value={sortDirection}
                onChange={(event) => setSortDirection(event.target.value as SortDirection)}
                className="h-9 w-[60px] rounded-lg text-sm"
              >
                <option value="asc">{t('project.sortAsc')}</option>
                <option value="desc">{t('project.sortDesc')}</option>
              </UiSelect>
            </div>
          </div>
          <UiButton type="button" variant="primary" onClick={handleCreateProject} className="gap-2">
            <Plus className="w-5 h-5" />
            {t('project.newProject')}
          </UiButton>
        </div>

        {configuredApiKeyCount === 0 && <MissingApiKeyHint className="mb-8" />}

        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-text-muted">
            <FolderOpen className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-lg">{t('project.empty')}</p>
            <p className="text-sm mt-2">{t('project.emptyHint')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedProjects.map((project) => (
              <div
                key={project.id}
                onClick={() => openProject(project.id)}
                className="bg-surface-dark border border-border-dark rounded-lg p-4 cursor-pointer hover:border-primary/50 hover:shadow-lg transition-all group"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-text-dark truncate flex-1">
                    {project.name}
                  </h3>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => handleRenameClick(project.id, project.name, e)}
                      className="p-1 hover:bg-bg-dark rounded"
                      title={t('project.rename')}
                    >
                      <Pencil className="w-4 h-4 text-text-muted hover:text-text-dark" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteClick(project.id, project.name, e)}
                      className="p-1 hover:bg-bg-dark rounded"
                      title={t('project.delete')}
                    >
                      <Trash2 className="w-4 h-4 text-text-muted hover:text-red-500" />
                    </button>
                  </div>
                </div>
                <div className="text-xs text-text-muted">
                  <p>
                    {t('project.modified')}: {formatDate(project.updatedAt)}
                  </p>
                  <p>
                    {t('project.created')}: {formatDate(project.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isOpeningProject && (
        <div className={`pointer-events-none fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} bg-black/10`} />
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
