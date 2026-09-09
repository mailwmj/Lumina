import { useTranslation } from 'react-i18next';
import { Plus } from '@/components/ui/icons';
import { UiButton } from '@/components/ui';

interface CanvasEmptyStateProps {
  onAddNode: () => void;
}

export function CanvasEmptyState({ onAddNode }: CanvasEmptyStateProps) {
  const { t } = useTranslation();
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 pb-16">
      <div className="flex max-w-md flex-col items-center text-center">
        <h2 className="text-xl font-medium text-text-dark">{t('canvas.emptyHintTitle')}</h2>
        <p className="mt-3 text-sm leading-6 text-text-muted">{t('canvas.emptyHintSubtitle')}</p>
        <UiButton variant="primary" className="pointer-events-auto mt-6 gap-2" onClick={onAddNode}>
          <Plus className="h-4 w-4" />{t('canvas.addNode')}
        </UiButton>
        <p className="mt-4 text-xs leading-5 text-text-muted">{t('canvas.emptyGestureHint')}</p>
      </div>
    </div>
  );
}
