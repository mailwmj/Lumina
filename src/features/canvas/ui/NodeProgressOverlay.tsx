interface NodeProgressOverlayProps {
  /** Simulated completion in the 0-1 range. */
  progress: number;
}

/** Determinate wait indicator for result nodes; leaves the placeholder label readable. */
export function NodeProgressOverlay({ progress }: NodeProgressOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute left-0 top-0 h-full border-r border-accent/60 bg-gradient-to-r from-accent/5 to-accent/20 transition-[width] duration-100 ease-linear"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
}
