import { Music } from 'lucide-react';
import type { ReferenceItem, PickerAnchor } from '@/features/canvas/hooks/useReferencePicker';

interface ReferencePickerProps {
  items: ReferenceItem[];
  pickerAnchor: PickerAnchor;
  pickerActiveIndex: number;
  onItemClick: (type: 'image' | 'video' | 'audio', index: number) => void;
  onItemHover: (index: number) => void;
}

export function ReferencePicker({
  items,
  pickerAnchor,
  pickerActiveIndex,
  onItemClick,
  onItemHover,
}: ReferencePickerProps) {
  if (items.length === 0) return null;

  return (
    <div
      className="nowheel absolute z-30 w-[120px] overflow-hidden rounded-xl border border-[rgba(255,255,255,0.16)] bg-surface-dark shadow-xl"
      style={{ left: pickerAnchor.left, top: pickerAnchor.top }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseDownCapture={(e) => e.stopPropagation()}
      onWheelCapture={(e) => e.stopPropagation()}
    >
      <div
        className="ui-scrollbar nowheel max-h-[180px] overflow-y-auto"
        onWheelCapture={(e) => e.stopPropagation()}
      >
        {items.map((item, index) => (
          <button
            key={`${item.type}-${item.index}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onItemClick(item.type, item.index);
            }}
            onMouseEnter={() => onItemHover(index)}
            className={`flex w-full items-center gap-2 border border-transparent bg-bg-dark/70 px-2 py-2 text-left text-sm text-text-dark transition-colors hover:border-[rgba(255,255,255,0.18)] ${
              pickerActiveIndex === index
                ? 'border-[rgba(255,255,255,0.24)] bg-bg-dark'
                : ''
            }`}
          >
            {item.type === 'image' && (
              <img
                src={item.previewUrl}
                alt={item.label}
                className="h-8 w-8 rounded object-cover"
                draggable={false}
              />
            )}
            {item.type === 'video' && (
              <video
                src={item.previewUrl}
                className="h-8 w-8 rounded object-cover"
                draggable={false}
              />
            )}
            {item.type === 'audio' && (
              <div className="flex h-8 w-8 items-center justify-center rounded bg-purple-500/20">
                <Music className="h-4 w-4 text-purple-400" />
              </div>
            )}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
