import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, SquareArrowOutUpRight } from '@/components/ui/icons';
import { UiTooltip } from '@/components/ui';
import type { StoryboardFrameItem, StoryboardExportOptions } from '../domain/canvasNodes';
import { resolveImageDisplayUrl } from '../application/imageData';
import { useCanvasStore } from '@/stores/canvasStore';
import { CanvasNodeImage } from './CanvasNodeImage';

interface FrameCardProps {
  nodeId: string;
  frame: StoryboardFrameItem;
  index: number;
  frameAspectRatioCss: string;
  imageFit: StoryboardExportOptions['imageFit'];
  viewerImageList: string[];
  dragging: boolean;
  asDropTarget: boolean;
  onSortStart: (frameId: string) => void;
  onSortHover: (frameId: string) => void;
  onTogglePicker: (frameId: string, x: number, y: number) => void;
  onEditFrame: (frame: StoryboardFrameItem) => void;
}

export const StoryboardFrameCard = memo(
  ({
    nodeId,
    frame,
    index,
    frameAspectRatioCss,
    imageFit,
    viewerImageList,
    dragging,
    asDropTarget,
    onSortStart,
    onSortHover,
    onTogglePicker,
    onEditFrame,
  }: FrameCardProps) => {
    const { t } = useTranslation();
    const updateStoryboardFrame = useCanvasStore((state) => state.updateStoryboardFrame);

    const imageSource = useMemo(() => {
      const picked = frame.previewImageUrl || frame.imageUrl;
      return picked ? resolveImageDisplayUrl(picked) : null;
    }, [frame.imageUrl, frame.previewImageUrl]);
    const viewerSource = useMemo(() => {
      const picked = frame.imageUrl || frame.previewImageUrl;
      return picked ? resolveImageDisplayUrl(picked) : null;
    }, [frame.imageUrl, frame.previewImageUrl]);

    return (
      <div
        onPointerEnter={(event) => {
          event.stopPropagation();
          onSortHover(frame.id);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className={`nodrag relative bg-bg-dark/85 transition-colors ${dragging
          ? 'z-10 opacity-55 ring-1 ring-accent/65'
          : asDropTarget
            ? 'z-10 ring-1 ring-emerald-400/70'
            : ''
          }`}
      >
        <div
          className={`group/frame relative overflow-hidden bg-surface-dark ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ aspectRatio: frameAspectRatioCss }}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            onSortStart(frame.id);
          }}
        >
          {frame.imageUrl || frame.previewImageUrl ? (
            <CanvasNodeImage
              src={imageSource ?? ''}
              alt={t('node.storyboardNode.frameIndex', { index: index + 1 })}
              viewerSourceUrl={viewerSource}
              viewerImageList={viewerImageList}
              className={`h-full w-full ${imageFit === 'contain' ? 'object-contain' : 'object-cover'}`}
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[11px] text-text-muted">
              {t('node.storyboardNode.emptyFrame')}
            </div>
          )}

          <UiTooltip content={t('common.edit')}>
            <button
              type="button"
              aria-label={t('common.edit')}
              className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white opacity-0 transition-all duration-150 hover:bg-black/75 group-hover/frame:opacity-100"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onEditFrame(frame);
              }}
            >
              <SquareArrowOutUpRight className="h-3 w-3" />
            </button>
          </UiTooltip>

          <UiTooltip content={t('common.replace')}>
            <button
              type="button"
              aria-label={t('common.replace')}
              className="absolute bottom-1 right-1 rounded bg-black/60 p-1 text-white opacity-0 transition-all duration-150 hover:bg-black/75 group-hover/frame:opacity-100"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePicker(frame.id, event.clientX, event.clientY);
              }}
            >
              <ImagePlus className="h-3 w-3" />
            </button>
          </UiTooltip>
        </div>

        <textarea
          value={frame.note}
          onChange={(event) => {
            const nextValue = event.target.value;
            updateStoryboardFrame(nodeId, frame.id, {
              note: nextValue,
            });
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onWheelCapture={(event) => event.stopPropagation()}
          placeholder={t('node.storyboardGen.framePlaceholder', { index: String(index + 1).padStart(2, '0') })}
          className="ui-scrollbar nodrag nowheel block h-10 w-full resize-none overflow-y-auto border-0 border-t border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)] px-2 py-1 text-[10px] text-text-dark outline-none focus:border-accent"
        />
      </div>
    );
  }
);

StoryboardFrameCard.displayName = 'StoryboardFrameCard';
