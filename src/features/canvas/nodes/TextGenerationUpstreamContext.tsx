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
  textContextHeight: number;
  referenceImagesHeight: number;
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
  textContextHeight,
  referenceImagesHeight,
  onLocate,
  onDisconnect,
  onReorder,
}: TextGenerationUpstreamContextProps) => {
  const { t } = useTranslation();
  const draggedInputRef = useRef<DraggedInput | null>(null);
  if (textInputs.length === 0 && imageInputs.length === 0) {
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
    <>
      {textInputs.length > 0 && (
        <section className="min-w-0 shrink-0" aria-label={t('node.textGeneration.upstreamText')}>
          <div className="mb-1 text-[10px] font-medium text-text-muted">
            {t('node.textGeneration.upstreamText')}
          </div>
          <div
            className="ui-scrollbar nodrag nowheel space-y-1 overflow-y-auto rounded-lg border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)]/70 p-1.5"
            style={{ height: textContextHeight }}
          >
            {textInputs.map((input) => (
              <article
                key={input.edgeId}
                draggable
                onDragStart={(event) => startDrag(event, 'text', input.nodeId)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => dropOn(event, 'text', input.nodeId)}
                onClick={(event) => {
                  event.stopPropagation();
                  onLocate(input.nodeId);
                }}
                className="nodrag nowheel group/input relative cursor-grab rounded-md border border-[var(--ui-border-soft)] bg-surface-dark/65 px-2 py-1.5 text-left active:cursor-grabbing hover:border-[var(--ui-border-strong)]"
              >
                <div className="truncate pr-4 text-[10px] font-medium text-text-muted">
                  {input.displayName}
                </div>
                <div
                  className="overflow-hidden break-words text-[11px] leading-4 text-text-dark"
                  style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3 }}
                >
                  {input.text}
                </div>
                <button
                  type="button"
                  aria-label={t('node.textGeneration.disconnectInput')}
                  className="nodrag nowheel absolute right-1 top-1 rounded p-0.5 text-text-muted opacity-0 hover:bg-[var(--ui-hover)] hover:text-text-dark group-hover/input:opacity-100"
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
        </section>
      )}

      {imageInputs.length > 0 && (
        <section className="min-w-0 shrink-0" aria-label={t('node.textGeneration.upstreamImages')}>
          <div className="mb-1 text-[10px] font-medium text-text-muted">
            {t('node.textGeneration.upstreamImages')}
          </div>
          <div
            className="ui-scrollbar nodrag nowheel flex min-w-0 gap-1.5 overflow-x-auto overflow-y-hidden rounded-lg border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)]/70 p-2"
            style={{ height: referenceImagesHeight }}
          >
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
                  onClick={(event) => {
                    event.stopPropagation();
                    onLocate(input.nodeId);
                  }}
                  className="nodrag nowheel group/input relative h-16 w-16 shrink-0 cursor-grab overflow-hidden rounded-md border border-[var(--ui-border-soft)] bg-bg-dark active:cursor-grabbing hover:border-[var(--ui-border-strong)]"
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
                    className="nodrag nowheel absolute right-0.5 top-0.5 rounded bg-black/55 p-0.5 text-white opacity-0 group-hover/input:opacity-100"
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
        </section>
      )}
    </>
  );
});

TextGenerationUpstreamContext.displayName = 'TextGenerationUpstreamContext';
