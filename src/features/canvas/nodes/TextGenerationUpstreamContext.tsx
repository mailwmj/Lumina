import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type WheelEvent,
} from 'react';
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
  const referenceImagesRef = useRef<HTMLDivElement | null>(null);
  const [referenceScroll, setReferenceScroll] = useState({
    hasOverflow: false,
    maxScrollLeft: 0,
    scrollLeft: 0,
    thumbWidthPercent: 100,
  });

  const updateReferenceScroll = useCallback(() => {
    const element = referenceImagesRef.current;
    if (!element) {
      return;
    }
    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    const hasOverflow = maxScrollLeft > 1;
    const thumbWidthPercent = hasOverflow
      ? Math.max(14, (element.clientWidth / element.scrollWidth) * 100)
      : 100;
    setReferenceScroll((previous) => {
      const next = {
        hasOverflow,
        maxScrollLeft,
        scrollLeft: Math.min(maxScrollLeft, element.scrollLeft),
        thumbWidthPercent,
      };
      return previous.hasOverflow === next.hasOverflow
        && previous.maxScrollLeft === next.maxScrollLeft
        && previous.scrollLeft === next.scrollLeft
        && previous.thumbWidthPercent === next.thumbWidthPercent
        ? previous
        : next;
    });
  }, []);

  useLayoutEffect(() => {
    const element = referenceImagesRef.current;
    if (!element) {
      return;
    }
    updateReferenceScroll();
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateReferenceScroll);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [imageInputs.length, updateReferenceScroll]);

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

  const handleReferenceImageWheel = (event: WheelEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (element.scrollWidth <= element.clientWidth) {
      return;
    }
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;
    if (delta === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    element.scrollLeft += delta;
  };

  const singleTextInput = textInputs.length === 1 ? textInputs[0] ?? null : null;

  return (
    <>
      {textInputs.length > 0 && (
        <section className="min-w-0 shrink-0" aria-label={t('node.textGeneration.upstreamText')}>
          <div className="mb-1 text-[10px] font-medium text-text-muted">
            {t('node.textGeneration.upstreamText')}
          </div>
          <div
            className={`nodrag nowheel rounded-lg border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)]/70 ${
              singleTextInput ? 'overflow-hidden' : 'ui-scrollbar-y space-y-1 overflow-x-hidden overflow-y-auto p-1.5'
            }`}
            style={{ height: textContextHeight }}
          >
            {singleTextInput ? (
              <article
                onClick={(event) => {
                  event.stopPropagation();
                  onLocate(singleTextInput.nodeId);
                }}
                className="nodrag nowheel group/input relative h-full min-h-0 cursor-pointer text-left"
              >
                <div
                  className="ui-scrollbar-y h-full overflow-x-hidden overflow-y-auto break-words px-2.5 py-2 pr-7 text-[11px] leading-4 text-text-dark"
                >
                  {singleTextInput.text}
                </div>
                <button
                  type="button"
                  aria-label={t('node.textGeneration.disconnectInput')}
                  className="nodrag nowheel absolute right-1.5 top-1.5 rounded p-0.5 text-text-muted opacity-0 hover:bg-[var(--ui-hover)] hover:text-text-dark group-hover/input:opacity-100 focus-visible:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDisconnect(singleTextInput.edgeId);
                  }}
                >
                  <Unlink2 className="h-3 w-3" />
                </button>
              </article>
            ) : textInputs.map((input) => (
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
                <div
                  className="overflow-hidden break-words pr-4 text-[11px] leading-4 text-text-dark"
                  style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3 }}
                >
                  {input.text}
                </div>
                <button
                  type="button"
                  aria-label={t('node.textGeneration.disconnectInput')}
                  className="nodrag nowheel absolute right-1 top-1 rounded p-0.5 text-text-muted opacity-0 hover:bg-[var(--ui-hover)] hover:text-text-dark group-hover/input:opacity-100 focus-visible:opacity-100"
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
          <div className="relative">
            <div
              ref={referenceImagesRef}
              className="no-scrollbar nodrag nowheel flex min-w-0 gap-1.5 overflow-x-auto overflow-y-hidden rounded-lg border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)]/70 p-2 pb-3"
              style={{ height: referenceImagesHeight }}
              onScroll={updateReferenceScroll}
              onWheel={handleReferenceImageWheel}
            >
              {imageInputs.map((input, index) => {
                const preview = input.previewImageUrl || input.imageUrl;
                const referenceLabel = t('node.imageReference.label', { index: index + 1 });
                return (
                  <article
                    key={input.edgeId}
                    draggable
                    title={referenceLabel}
                    onDragStart={(event) => startDrag(event, 'image', input.nodeId)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => dropOn(event, 'image', input.nodeId)}
                    onClick={(event) => {
                      event.stopPropagation();
                      onLocate(input.nodeId);
                    }}
                    className="nodrag nowheel group/input relative h-16 w-16 shrink-0 cursor-grab rounded-md border border-[var(--ui-border-soft)] bg-bg-dark active:cursor-grabbing hover:border-[var(--ui-border-strong)]"
                  >
                    {preview ? (
                      <img
                        src={resolveImageDisplayUrl(preview)}
                        alt={referenceLabel}
                        className="h-full w-full rounded-[inherit] object-cover"
                        draggable={false}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center rounded-[inherit] text-red-300">
                        <AlertTriangle className="h-4 w-4" />
                      </div>
                    )}
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute -bottom-1 -right-1 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold leading-none text-white shadow-sm"
                    >
                      {index + 1}
                    </span>
                    <button
                      type="button"
                      aria-label={t('node.textGeneration.disconnectInput')}
                      className="nodrag nowheel absolute right-0.5 top-0.5 rounded bg-black/55 p-0.5 text-white opacity-0 group-hover/input:opacity-100 focus-visible:opacity-100"
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
            {referenceScroll.hasOverflow && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute bottom-1.5 left-2 right-2 h-1 rounded-full bg-[var(--ui-border-soft)]"
              >
                <div
                  className="h-full rounded-full bg-text-muted/80"
                  style={{
                    width: `${referenceScroll.thumbWidthPercent}%`,
                    marginLeft: `${(100 - referenceScroll.thumbWidthPercent) * (
                      referenceScroll.scrollLeft / referenceScroll.maxScrollLeft
                    )}%`,
                  }}
                />
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
});

TextGenerationUpstreamContext.displayName = 'TextGenerationUpstreamContext';
