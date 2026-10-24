import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  type ClipboardEvent,
  type CompositionEvent,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { AlertTriangle } from '@/components/ui/icons';
import {
  findImageReferencePromptTokens,
  insertImageReferencePromptToken,
  normalizeImageReferenceShortcuts,
  removeImageReferencePromptToken,
  type ImageReferencePromptInput as ImageReferencePromptValue,
} from '@/features/canvas/application/imageReferencePrompt';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import {
  filterImageReferencePickerItems,
  IMAGE_REFERENCE_PICKER_COLUMNS,
  moveImageReferencePickerGridIndex,
  resolveImageReferencePickerGeometry,
  resolveImageReferencePickerQuery,
  shouldCloseImageReferencePickerOnPointerDown,
  type ImageReferencePickerCaretRect,
} from '@/features/canvas/application/imageReferencePicker';

export interface ImageReferencePromptItem extends ImageReferencePromptValue {
  previewImageUrl?: string | null;
}

export interface ImageReferencePromptInputProps {
  value: string;
  imageInputs: ImageReferencePromptItem[];
  placeholder: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  onValueChange: (value: string, nativeIsComposing: boolean) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: (value: string) => void;
  onBlur?: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export interface ImageReferencePromptInputHandle {
  insertReference: (edgeId: string, options?: { reuseExisting: boolean }) => void;
}

const CARET_ANCHOR_CHARACTER = '\u200B';

function readEditorNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\u200B/g, '');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as HTMLElement;
  const edgeId = element.dataset.imageReferenceEdgeId;
  if (edgeId) {
    return `{{image-ref:${edgeId}}}`;
  }
  if (element.tagName === 'BR') {
    return '\n';
  }

  const text = Array.from(element.childNodes).map(readEditorNode).join('');
  return (element.tagName === 'DIV' || element.tagName === 'P') && text && !text.endsWith('\n')
    ? `${text}\n`
    : text;
}

function readEditorValue(root: HTMLElement): string {
  return Array.from(root.childNodes).map(readEditorNode).join('');
}

function getSelectionOffset(root: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.anchorNode || !root.contains(selection.anchorNode)) {
    return null;
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(selection.anchorNode, selection.anchorOffset);
  } catch {
    return null;
  }
  return Array.from(range.cloneContents().childNodes).map(readEditorNode).join('').length;
}

function getSelectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.anchorNode || !selection.focusNode) {
    return null;
  }
  if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
    return null;
  }

  const getOffset = (node: Node, offset: number): number | null => {
    const range = document.createRange();
    range.selectNodeContents(root);
    try {
      range.setEnd(node, offset);
    } catch {
      return null;
    }
    return Array.from(range.cloneContents().childNodes).map(readEditorNode).join('').length;
  };

  const anchor = getOffset(selection.anchorNode, selection.anchorOffset);
  const focus = getOffset(selection.focusNode, selection.focusOffset);
  if (anchor === null || focus === null) {
    return null;
  }
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
}

type ReferenceCaretAffinity = 'before' | 'after';

// Where the `@` was typed and the digits typed after it.
interface PickerSession {
  start: number;
  query: string;
}

function readCaretRect(root: HTMLElement): ImageReferencePickerCaretRect {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const rect = range?.getClientRects()[0] ?? range?.getBoundingClientRect();
  if (rect && (rect.left !== 0 || rect.top !== 0 || rect.height !== 0)) {
    return { left: rect.left, top: rect.top, bottom: rect.bottom };
  }
  const rootRect = root.getBoundingClientRect();
  return { left: rootRect.left + 12, top: rootRect.top + 8, bottom: rootRect.top + 32 };
}

function setSelectionOffset(
  root: HTMLElement,
  requestedOffset: number,
  affinity?: ReferenceCaretAffinity
): void {
  const offset = Math.max(0, Math.min(requestedOffset, readEditorValue(root).length));
  const range = document.createRange();

  if (affinity) {
    let referenceOffset = 0;
    for (const child of Array.from(root.childNodes)) {
      const childLength = readEditorNode(child).length;
      const isReference = child.nodeType === Node.ELEMENT_NODE
        && Boolean((child as HTMLElement).dataset.imageReferenceEdgeId);
      const matchesAffinity = isReference && (
        affinity === 'before'
          ? referenceOffset === offset
          : referenceOffset + childLength === offset
      );
      if (matchesAffinity) {
        const anchorText = affinity === 'before' ? child.previousSibling : child.nextSibling;
        if (anchorText?.nodeType === Node.TEXT_NODE) {
          const text = anchorText.textContent ?? '';
          const anchorCharacterOffset = text.indexOf(CARET_ANCHOR_CHARACTER);
          range.setStart(
            anchorText,
            affinity === 'before'
              ? text.length
              : anchorCharacterOffset === -1
                ? 0
                : anchorCharacterOffset + CARET_ANCHOR_CHARACTER.length
          );
          range.collapse(true);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          return;
        }
      }
      referenceOffset += childLength;
    }
  }

  let remaining = offset;

  for (const child of Array.from(root.childNodes)) {
    const length = readEditorNode(child).length;
    if (remaining > length) {
      remaining -= length;
      continue;
    }

    if (child.nodeType === Node.TEXT_NODE) {
      range.setStart(child, Math.min(remaining, child.textContent?.length ?? 0));
    } else if ((child as HTMLElement).dataset.imageReferenceEdgeId) {
      if (remaining === 0) {
        range.setStartBefore(child);
      } else {
        range.setStartAfter(child);
      }
    } else {
      range.setStart(root, Array.from(root.childNodes).indexOf(child));
    }
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return;
  }

  range.selectNodeContents(root);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function findDeletionRange(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  direction: 'backward' | 'forward'
): { start: number; end: number } | null {
  const tokens = findImageReferencePromptTokens(value);
  if (selectionStart !== selectionEnd) {
    const touched = tokens.filter((token) => token.end > selectionStart && token.start < selectionEnd);
    if (touched.length === 0) {
      return null;
    }
    return {
      start: Math.min(selectionStart, ...touched.map((token) => token.start)),
      end: Math.max(selectionEnd, ...touched.map((token) => token.end)),
    };
  }

  const point = direction === 'backward'
    ? Math.max(0, selectionStart - 1)
    : selectionStart;
  const token = tokens.find((item) => point >= item.start && point < item.end);
  return token ? { start: token.start, end: token.end } : null;
}

function isCompositionKeyboardEvent(event: KeyboardEvent<HTMLDivElement>): boolean {
  return event.nativeEvent.isComposing === true || event.nativeEvent.keyCode === 229;
}

function isImageReferenceTrigger(event: KeyboardEvent<HTMLDivElement>): boolean {
  return event.key === '@'
    || (event.key === '2' && event.shiftKey && event.code === 'Digit2');
}

export function resolveImageReferenceCursorMove(
  value: string,
  selection: { start: number; end: number },
  direction: 'backward' | 'forward'
): number | null {
  const tokens = findImageReferencePromptTokens(value);
  if (tokens.length === 0) {
    return null;
  }

  if (selection.start !== selection.end) {
    const touchesTag = tokens.some(
      (token) => token.end > selection.start && token.start < selection.end
    );
    if (touchesTag) {
      return direction === 'backward' ? selection.start : selection.end;
    }
    return null;
  }

  const cursor = selection.start;
  const adjacentTag = direction === 'backward'
    ? tokens.find((token) => token.end === cursor)
    : tokens.find((token) => token.start === cursor);
  return adjacentTag
    ? direction === 'backward' ? adjacentTag.start : adjacentTag.end
    : null;
}

export const ImageReferencePromptInput = forwardRef<ImageReferencePromptInputHandle, ImageReferencePromptInputProps>(function ImageReferencePromptInput({
  value,
  imageInputs,
  placeholder,
  ariaLabel,
  disabled = false,
  className = '',
  onValueChange,
  onCompositionStart,
  onCompositionEnd,
  onBlur,
  onKeyDown,
}: ImageReferencePromptInputProps, ref) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const renderedImageInputsKeyRef = useRef<string | null>(null);
  const pendingSelectionOffsetRef = useRef<number | null>(null);
  const pendingSelectionAffinityRef = useRef<ReferenceCaretAffinity | null>(null);
  const isComposingRef = useRef(false);
  const pickerSessionRef = useRef<PickerSession | null>(null);
  const pickerActiveIndexRef = useRef(0);
  const [pickerSession, setPickerSession] = useState<PickerSession | null>(null);
  const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
  const [pickerCaret, setPickerCaret] = useState<ImageReferencePickerCaretRect | null>(null);
  const [isVisuallyEmpty, setIsVisuallyEmpty] = useState(value.length === 0);

  const setActivePickerIndex = useCallback((index: number) => {
    pickerActiveIndexRef.current = index;
    setPickerActiveIndex(index);
  }, []);

  const updatePickerSession = useCallback((session: PickerSession | null) => {
    pickerSessionRef.current = session;
    setPickerSession(session);
    setActivePickerIndex(0);
    if (!session) {
      setPickerCaret(null);
    }
  }, [setActivePickerIndex]);

  const pickerIndices = useMemo(
    () => pickerSession
      ? filterImageReferencePickerItems(imageInputs.length, pickerSession.query)
      : [],
    [imageInputs.length, pickerSession]
  );

  const imageInputsKey = useMemo(
    () => imageInputs.map((input, index) => [
      input.edgeId,
      input.previewImageUrl ?? '',
      input.imageUrl ?? '',
      index,
    ].join(':')).join('|'),
    [imageInputs]
  );
  const itemsByEdgeId = useMemo(
    () => new Map(imageInputs.map((item, index) => [item.edgeId, { item, index }])),
    [imageInputs]
  );

  const renderEditor = useCallback((root: HTMLDivElement, nextValue: string) => {
    const fragment = document.createDocumentFragment();
    const tokens = findImageReferencePromptTokens(nextValue);
    let lastIndex = 0;
    // This must remain a text node. A fixed-width editable element receives
    // keystrokes itself, which makes the typed characters wrap one per line.
    const createCaretAnchor = () => document.createTextNode(CARET_ANCHOR_CHARACTER);

    for (const token of tokens) {
      if (token.start > lastIndex) {
        fragment.append(document.createTextNode(nextValue.slice(lastIndex, token.start)));
      }

      const reference = itemsByEdgeId.get(token.edgeId);
      if (reference) {
        const label = t('node.imageReference.label', { index: reference.index + 1 });
        const chip = document.createElement('span');
        chip.contentEditable = 'false';
        chip.dataset.imageReferenceEdgeId = token.edgeId;
        chip.className = 'mx-0.5 inline-flex h-5 max-w-full select-none items-center gap-1 rounded border border-[var(--ui-border-strong)] bg-[var(--ui-surface-elevated)] pl-0.5 pr-1.5 align-middle text-sm font-medium leading-none text-text-dark shadow-sm';

        const previewSource = reference.item.previewImageUrl || reference.item.imageUrl;
        if (previewSource) {
          const image = document.createElement('img');
          image.src = resolveImageDisplayUrl(previewSource);
          image.alt = label;
          image.draggable = false;
          image.className = 'h-4 w-4 shrink-0 rounded-[3px] object-cover';
          chip.append(image);
        } else {
          const fallback = document.createElement('span');
          fallback.className = 'flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] bg-red-500/20 text-[9px] text-red-300';
          fallback.textContent = '!';
          chip.append(fallback);
        }

        const text = document.createElement('span');
        text.className = 'truncate';
        text.textContent = label;
        chip.append(text);
        fragment.append(createCaretAnchor());
        fragment.append(chip);
        fragment.append(createCaretAnchor());
      }
      lastIndex = token.end;
    }

    if (lastIndex < nextValue.length) {
      fragment.append(document.createTextNode(nextValue.slice(lastIndex)));
    }
    if (fragment.childNodes.length === 0) {
      fragment.append(document.createTextNode(''));
    }

    root.replaceChildren(fragment);
  }, [itemsByEdgeId, t]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const currentValue = readEditorValue(root);
    const needsRender = currentValue !== value || renderedImageInputsKeyRef.current !== imageInputsKey;
    if (!needsRender) {
      return;
    }

    const preservedOffset = pendingSelectionOffsetRef.current ?? getSelectionOffset(root);
    const preservedAffinity = pendingSelectionAffinityRef.current ?? undefined;
    renderEditor(root, value);
    renderedImageInputsKeyRef.current = imageInputsKey;
    pendingSelectionOffsetRef.current = null;
    pendingSelectionAffinityRef.current = null;
    setIsVisuallyEmpty(value.length === 0);
    if (document.activeElement === root && preservedOffset !== null) {
      setSelectionOffset(root, preservedOffset, preservedAffinity);
    }
  }, [imageInputsKey, renderEditor, value]);

  useLayoutEffect(() => {
    setActivePickerIndex(
      Math.min(pickerActiveIndexRef.current, Math.max(0, imageInputs.length - 1))
    );
    if (imageInputs.length === 0) {
      updatePickerSession(null);
    }
  }, [imageInputs.length, setActivePickerIndex, updatePickerSession]);

  const emitValue = useCallback((nextValue: string, nativeIsComposing: boolean) => {
    setIsVisuallyEmpty(nextValue.length === 0);
    onValueChange(nextValue, nativeIsComposing);
  }, [onValueChange]);

  const normalizeReferenceShortcuts = useCallback((
    root: HTMLDivElement,
    nextValue: string,
    selectionOffset: number | null,
    restoreFocus = true
  ): string | null => {
    const normalized = normalizeImageReferenceShortcuts(
      nextValue,
      imageInputs,
      selectionOffset ?? nextValue.length
    );
    if (normalized.nextText === nextValue) {
      return null;
    }

    pendingSelectionOffsetRef.current = normalized.selectionOffset;
    pendingSelectionAffinityRef.current = 'after';
    emitValue(normalized.nextText, false);
    if (restoreFocus) {
      requestAnimationFrame(() => {
        root.focus();
        setSelectionOffset(root, normalized.selectionOffset, 'after');
      });
    }
    return normalized.nextText;
  }, [emitValue, imageInputs]);

  const closePicker = useCallback(() => {
    updatePickerSession(null);
  }, [updatePickerSession]);

  const isPickerOpen = pickerSession !== null;
  useEffect(() => {
    if (!isPickerOpen) {
      return;
    }

    const handleDocumentPointerDown = (event: Event) => {
      const target = event.target;
      const isPointerInsidePicker = target instanceof Node
        && pickerRef.current?.contains(target) === true;
      if (shouldCloseImageReferencePickerOnPointerDown(isPointerInsidePicker)) {
        closePicker();
      }
    };

    // The picker is fixed to the viewport, so zooming or panning the canvas
    // would leave it behind; close instead.
    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    document.addEventListener('wheel', handleDocumentPointerDown, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
      document.removeEventListener('wheel', handleDocumentPointerDown, true);
    };
  }, [closePicker, isPickerOpen]);

  useEffect(() => {
    pickerRef.current
      ?.querySelector('[data-active]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [pickerActiveIndex]);

  const insertReference = useCallback((index: number) => {
    const root = rootRef.current;
    const item = imageInputs[index];
    if (!root || !item || isComposingRef.current) {
      return;
    }
    // An open picker replaces the typed `@` and digits with the reference.
    const session = pickerSessionRef.current;
    const selection = (session
      ? { start: session.start, end: session.start + 1 + session.query.length }
      : null
    ) ?? (
      document.activeElement === root ? getSelectionOffsets(root) : null
    ) ?? {
      start: value.length,
      end: value.length,
    };
    const valueWithoutSelection = `${value.slice(0, selection.start)}${value.slice(selection.end)}`;
    const result = insertImageReferencePromptToken(valueWithoutSelection, selection.start, item.edgeId);
    pendingSelectionOffsetRef.current = result.nextOffset;
    pendingSelectionAffinityRef.current = 'after';
    emitValue(result.nextText, false);
    closePicker();
    requestAnimationFrame(() => {
      root.focus();
      setSelectionOffset(root, result.nextOffset, 'after');
    });
  }, [closePicker, emitValue, imageInputs, value]);

  useImperativeHandle(ref, () => ({
    insertReference: (edgeId: string, options?: { reuseExisting: boolean }) => {
      const existing = options?.reuseExisting && findImageReferencePromptTokens(value).find((token) => token.edgeId === edgeId);
      if (existing) {
        rootRef.current?.focus();
        if (rootRef.current) setSelectionOffset(rootRef.current, existing.end, 'after');
        return;
      }
      const index = imageInputs.findIndex((item) => item.edgeId === edgeId);
      if (index >= 0) {
        insertReference(index);
      }
    },
  }), [imageInputs, insertReference, value]);

  // Opens the picker for an `@` at `triggerOffset`. Without an offset the `@`
  // was intercepted before reaching the editor, so it is inserted here; either
  // way it stays in the text and Escape simply leaves it there.
  const openPicker = useCallback((triggerOffset?: number) => {
    const root = rootRef.current;
    if (!root || imageInputs.length === 0 || isComposingRef.current) {
      return;
    }
    let start = triggerOffset;
    if (start === undefined) {
      const selection = getSelectionOffsets(root) ?? { start: value.length, end: value.length };
      start = selection.start;
      pendingSelectionOffsetRef.current = start + 1;
      emitValue(`${value.slice(0, selection.start)}@${value.slice(selection.end)}`, false);
    }
    const session = { start, query: '' };
    updatePickerSession(session);
    requestAnimationFrame(() => {
      if (pickerSessionRef.current !== session) {
        return;
      }
      root.focus();
      setSelectionOffset(root, session.start + 1);
      setPickerCaret(readCaretRect(root));
    });
  }, [emitValue, imageInputs.length, updatePickerSession, value]);

  const handleBeforeInput = useCallback((event: FormEvent<HTMLDivElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent;
    if (
      nativeEvent.data !== '@'
      || nativeEvent.isComposing === true
      || isComposingRef.current
      || imageInputs.length === 0
    ) {
      return;
    }
    event.preventDefault();
    openPicker();
  }, [imageInputs.length, openPicker]);

  const handleInput = useCallback((event: FormEvent<HTMLDivElement>) => {
    const root = event.currentTarget;
    const nextValue = readEditorValue(root);
    const nativeEvent = event.nativeEvent as InputEvent;
    const nativeIsComposing = nativeEvent.isComposing === true;
    const cursor = getSelectionOffset(root);
    const isTyping = !nativeIsComposing && !isComposingRef.current;

    // `beforeinput` is not consistently emitted by every keyboard/input-method
    // combination. If a literal @ reached the editor, open the picker for it.
    if (
      isTyping
      && imageInputs.length > 0
      && cursor !== null
      && cursor > 0
      && nextValue[cursor - 1] === '@'
      && (nativeEvent.inputType ?? '').startsWith('insert')
      && pickerSessionRef.current?.start !== cursor - 1
    ) {
      emitValue(nextValue, false);
      openPicker(cursor - 1);
      return;
    }

    const session = pickerSessionRef.current;
    if (session && isTyping) {
      const query = resolveImageReferencePickerQuery(nextValue, session.start, cursor);
      if (query === null || filterImageReferencePickerItems(imageInputs.length, query).length === 0) {
        closePicker();
      } else if (query !== session.query) {
        updatePickerSession({ start: session.start, query });
      }
    }

    if (!nativeIsComposing && !isComposingRef.current) {
      const normalizedValue = normalizeReferenceShortcuts(root, nextValue, cursor);
      if (normalizedValue !== null) {
        return;
      }
    }

    emitValue(nextValue, nativeIsComposing);
  }, [closePicker, emitValue, imageInputs.length, normalizeReferenceShortcuts, openPicker, updatePickerSession]);

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
    closePicker();
    onCompositionStart?.();
  }, [closePicker, onCompositionStart]);

  const handleCompositionEnd = useCallback((event: CompositionEvent<HTMLDivElement>) => {
    isComposingRef.current = false;
    const nextValue = readEditorValue(event.currentTarget);
    const normalizedValue = normalizeReferenceShortcuts(
      event.currentTarget,
      nextValue,
      getSelectionOffset(event.currentTarget)
    );
    const emittedValue = normalizedValue ?? nextValue;
    if (normalizedValue === null) {
      emitValue(emittedValue, false);
    }
    onCompositionEnd?.(emittedValue);
  }, [emitValue, normalizeReferenceShortcuts, onCompositionEnd]);

  const handleBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    closePicker();
    const nextValue = readEditorValue(event.currentTarget);
    const normalizedValue = isComposingRef.current
      ? null
      : normalizeReferenceShortcuts(
        event.currentTarget,
        nextValue,
        getSelectionOffset(event.currentTarget),
        false
      );
    onBlur?.(normalizedValue ?? nextValue);
  }, [closePicker, normalizeReferenceShortcuts, onBlur]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData('text/plain');
    if (!text) {
      return;
    }
    event.preventDefault();
    document.execCommand('insertText', false, text);
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    // Some IMEs report keyCode 229 for punctuation even when they emit a real
    // `@` character. Handle the trigger before the composition-key fallback.
    if (
      isImageReferenceTrigger(event)
      && event.nativeEvent.isComposing !== true
      && imageInputs.length > 0
    ) {
      event.preventDefault();
      openPicker();
      return;
    }

    if (isCompositionKeyboardEvent(event)) {
      return;
    }

    const root = rootRef.current;
    if (!root) {
      return;
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      const selection = getSelectionOffsets(root);
      if (selection) {
        const range = findDeletionRange(
          value,
          selection.start,
          selection.end,
          event.key === 'Backspace' ? 'backward' : 'forward'
        );
        if (range) {
          event.preventDefault();
          const result = removeImageReferencePromptToken(value, range.start, range.end);
          pendingSelectionOffsetRef.current = result.nextOffset;
          emitValue(result.nextText, false);
          requestAnimationFrame(() => {
            root.focus();
            setSelectionOffset(root, result.nextOffset);
          });
          return;
        }
      }
    }

    const session = pickerSessionRef.current;
    const pickerIsOpen = session !== null;
    if (session) {
      const indices = filterImageReferencePickerItems(imageInputs.length, session.query);
      const gridDirection = ({
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
      } as const)[event.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'];
      if (gridDirection) {
        event.preventDefault();
        setActivePickerIndex(moveImageReferencePickerGridIndex(
          pickerActiveIndexRef.current,
          indices.length,
          Math.min(IMAGE_REFERENCE_PICKER_COLUMNS, indices.length),
          gridDirection
        ));
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const index = indices[pickerActiveIndexRef.current];
        if (index !== undefined) {
          event.preventDefault();
          insertReference(index);
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePicker();
        return;
      }
    }

    if (
      !pickerIsOpen
      && !event.shiftKey
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      const selection = getSelectionOffsets(root);
      const nextOffset = selection
        ? resolveImageReferenceCursorMove(
          value,
          selection,
          event.key === 'ArrowLeft' ? 'backward' : 'forward'
        )
        : null;
      if (nextOffset !== null) {
        event.preventDefault();
        setSelectionOffset(
          root,
          nextOffset,
          event.key === 'ArrowLeft' ? 'before' : 'after'
        );
        return;
      }
    }

    onKeyDown?.(event);
  }, [closePicker, emitValue, imageInputs.length, insertReference, onKeyDown, openPicker, setActivePickerIndex, value]);

  const pickerGeometry = pickerCaret && pickerIndices.length > 0
    ? resolveImageReferencePickerGeometry(pickerCaret, pickerIndices.length, {
      width: window.innerWidth,
      height: window.innerHeight,
    })
    : null;

  const stopPropagation = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  }, []);

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={rootRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        data-placeholder={isVisuallyEmpty ? placeholder : undefined}
        onBeforeInput={handleBeforeInput}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onBlur={handleBlur}
        onPaste={handlePaste}
        onMouseDown={stopPropagation}
        className={`ui-scrollbar nodrag nowheel h-full min-h-0 w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words border-0 bg-transparent px-3 py-2 text-sm leading-6 text-text-dark outline-none empty:before:text-text-muted/65 before:pointer-events-none before:content-[attr(data-placeholder)] ${disabled ? 'cursor-default opacity-70' : ''} ${className}`}
      />

      {pickerGeometry && typeof document !== 'undefined' && createPortal(
        <div
          ref={pickerRef}
          role="listbox"
          aria-label={ariaLabel}
          className="ui-scrollbar nodrag nowheel fixed z-[80] overflow-y-auto overflow-x-hidden rounded-[10px] border border-[var(--ui-border-soft)] bg-[var(--ui-surface-elevated)] p-1.5 shadow-[var(--ui-shadow-panel)]"
          style={{ left: pickerGeometry.left, top: pickerGeometry.top, maxHeight: pickerGeometry.maxHeight }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${pickerGeometry.columns}, 3rem)` }}
          >
            {pickerIndices.map((index, position) => {
              const item = imageInputs[index];
              const label = t('node.imageReference.label', { index: index + 1 });
              const previewSource = item.previewImageUrl || item.imageUrl;
              const active = pickerActiveIndex === position;
              return (
                <button
                  key={item.edgeId}
                  type="button"
                  role="option"
                  aria-selected={active}
                  aria-label={label}
                  title={label}
                  data-active={active || undefined}
                  onClick={() => insertReference(index)}
                  onMouseEnter={() => setActivePickerIndex(position)}
                  className={`relative h-12 w-12 overflow-hidden rounded-md border bg-bg-dark transition-[border-color,box-shadow] ${active
                    ? 'border-accent ring-2 ring-accent/40'
                    : 'border-[var(--ui-border-soft)] hover:border-[var(--ui-border-strong)]'
                  }`}
                >
                  {previewSource ? (
                    <img
                      src={resolveImageDisplayUrl(previewSource)}
                      alt=""
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-red-300">
                      <AlertTriangle className="h-4 w-4" />
                    </span>
                  )}
                  <span className="pointer-events-none absolute bottom-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-white/25 bg-black/70 px-1 text-[10px] font-semibold leading-none text-white">
                    {index + 1}
                  </span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
});

ImageReferencePromptInput.displayName = 'ImageReferencePromptInput';
