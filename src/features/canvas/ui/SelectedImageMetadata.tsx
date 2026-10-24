import { memo, useEffect, useState } from 'react';
import { getImageDimensions } from '../application/imageDimensions';

type ImageDimensions = {
  width: number;
  height: number;
};

type SelectedImageMetadataProps = {
  filename: string;
  imageSource: string;
};

export const SelectedImageMetadata = memo(({
  filename,
  imageSource,
}: SelectedImageMetadataProps) => {
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null);

  useEffect(() => {
    setDimensions(null);
    let active = true;
    void getImageDimensions(imageSource).then((result) => {
      if (active) setDimensions(result);
    });

    return () => {
      active = false;
    };
  }, [imageSource]);

  return (
    <div className="pointer-events-none absolute left-0 top-[calc(100%+10px)] z-10 flex w-full justify-center px-2">
      <div className="flex min-w-0 max-w-full items-center gap-2 rounded-md border border-[var(--ui-border-soft)] bg-[var(--ui-surface-elevated)] px-2 py-1 text-xs text-text-dark shadow-[var(--ui-shadow-tooltip)]">
        <span className="min-w-0 truncate" title={filename}>{filename}</span>
        {dimensions && (
          <span className="shrink-0 tabular-nums">
            {dimensions.width} × {dimensions.height}
          </span>
        )}
      </div>
    </div>
  );
});

SelectedImageMetadata.displayName = 'SelectedImageMetadata';
