import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy } from '@/components/ui/icons';
import { UiTooltip } from '@/components/ui';
import { copyImageToSystemClipboard } from '../application/imageClipboard';

export function ImageCopyButton({ source, className }: { source: string; className: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { setCopied(false); setError(null); }, [source]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const label = t(copied ? 'nodeToolbar.copied' : 'nodeToolbar.copyImage');
  return <>
    <UiTooltip content={label}><button type="button" aria-label={label} disabled={busy} className={className}
      onClick={async () => {
        setBusy(true); setError(null);
        const result = await copyImageToSystemClipboard(source);
        setBusy(false);
        if (!result.ok) { setError(t('nodeToolbar.copyImageFailed', { message: result.error })); return; }
        setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1100);
      }}><Copy className="h-3.5 w-3.5" /><span>{label}</span></button></UiTooltip>
    {error && <span role="alert" className="max-w-xs text-xs text-red-500">{error}</span>}
  </>;
}
