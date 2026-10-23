interface SettingsSegmentedProps<TValue extends string> {
  value: TValue;
  options: Array<{ value: TValue; label: string }>;
  onChange: (value: TValue) => void;
  ariaLabel: string;
}

export function SettingsSegmented<TValue extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: SettingsSegmentedProps<TValue>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-lg border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)] p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-3 py-1 text-xs transition-colors ${
            value === option.value
              ? 'bg-[var(--ui-surface-panel)] font-medium text-text-dark shadow-sm'
              : 'text-text-muted hover:text-text-dark'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
