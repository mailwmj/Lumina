import { memo, useRef, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { AlertTriangle, Unlink2 } from '@/components/ui/icons';
import type {
  ResolvedImageInput,
  ResolvedTextInput,
} from '@/features/canvas/application/textGenerationInputs';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';

type InputKind = 'text' | 'image';

interface DraggedInput {
  kind: InputKind;
  sourceId: string;
}

interface TextGenerationUpstreamContextProps {
  textInputs: ResolvedTextInput[];
  imageInputs: ResolvedImageInput[];
  maxHeight: number;
  onLocate: (nodeId: string) => void;
  onDisconnect: (edgeId: string) => void;
  onReorder: (
    kind: InputKind,
    draggedSourceId: string,
    targetSourceId: string
  ) => void;
}

export const TextGenerationUpstreamContext = memo(({
  textInputs,
  imageInputs,
  maxHeight,
  onLocate,
  onDisconnect,
  onReorder,
}: TextGenerationUpstreamContextProps) => {
  const { t } = useTranslation();
  const draggedInputRef = useRef<DraggedInput | null>(null);
  const hasInputs = textInputs.length > 0 || imageInputs.length > 0;
  if (!hasInputs) {
    return null;
  }

  const startDrag = (
    event: DragEvent<HTMLElement>,
    kind: InputKind,
    sourceId: string
  ) => {
    draggedInputRef.current = { kind, sourceId };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `${kind}:${sourceId}`);
  };

  const dropOn = (
    event: DragEvent<HTMLElement>,
    kind: InputKind,
    targetSourceId: string
  ) => {
    event.preventDefault();
    const dragged = draggedInputRef.current;
    draggedInputRef.current = null;
    if (dragged?.kind === kind && dragged.sourceId !== targetSourceId) {
      onReorder(kind, dragged.sourceId, targetSourceId);
    }
  };

  return (
    <section
      className="nodrag nowheel shrink-0 overflow-y-auto border-b border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)]/55 px-2 py-1.5"
      style={{ maxHeight }}
      aria-label={t('node.textGeneration.upstreamContext')}
    >
      {textInputs.length > 0 && (
        <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-1">
          {textInputs.map((input) => (
            <article
              key={input.edgeId}
              draggable
              onDragStart={(event) => startDrag(event, 'text', input.nodeId)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropOn(event, 'text', input.nodeId)}
              onClick={() => onLocate(input.nodeId)}
              className="group/input relative w-36 shrink-0 cursor-pointer rounded-md border border-[var(--ui-border-soft)] bg-surface-dark/65 px-2 py-1 text-left hover:border-[var(--ui-border-strong)]"
            >
              <div className="truncate pr-4 text-[10px] font-medium text-text-muted">
                {input.displayName}
              </div>
              <div
                className="overflow-hidden break-words text-[11px] leading-4 text-text-dark"
                style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}
              >
                {input.text}
              </div>
              <button
                type="button"
                aria-label={t('node.textGeneration.disconnectInput')}
                className="absolute right-1 top-1 rounded p-0.5 text-text-muted opacity-0 hover:bg-[var(--ui-hover)] hover:text-text-dark group-hover/input:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  onDisconnect(input.edgeId);
                }}
              >
                <Unlink2 className="h-3 w-3" />
              </button>
            </article>
          ))}
        </div>
      )}

      {imageInputs.length > 0 && (
        <div className="flex min-w-0 gap-1.5 overflow-x-auto">
          {imageInputs.map((input) => {
            const preview = input.previewImageUrl || input.imageUrl;
            return (
              <article
                key={input.edgeId}
                draggable
                title={input.displayName}
                onDragStart={(event) => startDrag(event, 'image', input.nodeId)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => dropOn(event, 'image', input.nodeId)}
                onClick={() => onLocate(input.nodeId)}
                className="group/input relative h-12 w-12 shrink-0 cursor-pointer overflow-hidden rounded-md border border-[var(--ui-border-soft)] bg-bg-dark hover:border-[var(--ui-border-strong)]"
              >
                {preview ? (
                  <img
                    src={resolveImageDisplayUrl(preview)}
                    alt={input.displayName}
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-red-300">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                )}
                <button
                  type="button"
                  aria-label={t('node.textGeneration.disconnectInput')}
                  className="absolute right-0.5 top-0.5 rounded bg-black/55 p-0.5 text-white opacity-0 group-hover/input:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDisconnect(input.edgeId);
                  }}
                >
                  <Unlink2 className="h-3 w-3" />
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
});

TextGenerationUpstreamContext.displayName = 'TextGenerationUpstreamContext';
