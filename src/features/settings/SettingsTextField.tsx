import {
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { UiInput } from '@/components/ui';

/**
 * Settings auto-save on commit, not per keystroke: store setters trim and normalize
 * (e.g. a built-in base URL snaps back to its default when emptied), which would fight
 * the user mid-typing. The draft is committed on blur, on Enter, and when the field
 * unmounts (closing the dialog or switching pages).
 */
function useCommittedDraft(value: string, onCommit: (value: string) => void) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const committedRef = useRef(value);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    // External change (another field normalized this value, undo, etc.).
    committedRef.current = value;
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (draftRef.current !== committedRef.current) {
      committedRef.current = draftRef.current;
      onCommitRef.current(draftRef.current);
    }
  };

  useEffect(() => () => {
    if (draftRef.current !== committedRef.current) {
      onCommitRef.current(draftRef.current);
    }
  }, []);

  const change = (next: string) => {
    draftRef.current = next;
    setDraft(next);
  };

  return { draft, change, commit };
}

type SettingsTextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onCommit: (value: string) => void;
};

export function SettingsTextInput({ value, onCommit, onBlur, onKeyDown, ...props }: SettingsTextInputProps) {
  const { draft, change, commit } = useCommittedDraft(value, onCommit);
  return (
    <UiInput
      {...props}
      value={draft}
      onChange={(event) => change(event.target.value)}
      onBlur={(event) => {
        commit();
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
        }
        onKeyDown?.(event);
      }}
    />
  );
}

type SettingsTextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onCommit: (value: string) => void;
};

export function SettingsTextArea({ value, onCommit, onBlur, className = '', ...props }: SettingsTextAreaProps) {
  const { draft, change, commit } = useCommittedDraft(value, onCommit);
  return (
    <textarea
      {...props}
      value={draft}
      onChange={(event) => change(event.target.value)}
      onBlur={(event) => {
        commit();
        onBlur?.(event);
      }}
      className={`ui-scrollbar w-full resize-y rounded border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark placeholder:text-text-muted ${className}`}
    />
  );
}
