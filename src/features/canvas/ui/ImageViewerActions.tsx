import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Sparkles } from '@/components/ui/icons';
import { UiTooltip } from '@/components/ui';
import { downloadImage } from '../application/imageDownload';
import { continueFromImage } from '../application/continueFromImage';
import { ImageCopyButton } from './ImageCopyButton';

export function ImageViewerActions({ imageUrl, nodeId, onClose, className }: {
  imageUrl: string; nodeId?: string | null; onClose: () => void; className: string;
}) {
  const { t } = useTranslation();
  const [downloadFailed, setDownloadFailed] = useState(false);
  return <>
    <UiTooltip content={t('nodeToolbar.download')}><button type="button" className={className} aria-label={t('nodeToolbar.download')}
      onClick={async () => setDownloadFailed(await downloadImage(imageUrl, { nodeId: nodeId ?? undefined }) === 'failed')}>
      <Download className="h-4 w-4" />
    </button></UiTooltip>
    <ImageCopyButton source={imageUrl} className={`${className} gap-1.5`} />
    {nodeId && <UiTooltip content={t('nodeToolbar.continueFromImage')}><button type="button" className={className}
      aria-label={t('nodeToolbar.continueFromImage')} onClick={() => { if (continueFromImage(nodeId)) onClose(); }}>
      <Sparkles className="h-4 w-4" />
    </button></UiTooltip>}
    {downloadFailed && <span role="alert" className="text-xs text-red-400">{t('viewer.downloadFailed')}</span>}
  </>;
}
