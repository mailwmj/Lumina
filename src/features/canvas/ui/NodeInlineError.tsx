interface NodeInlineErrorProps {
  message: string;
  className?: string;
}

/** Single error presentation for node footers; clamps long provider errors, full text on hover. */
export function NodeInlineError({ message, className = '' }: NodeInlineErrorProps) {
  return (
    <div
      role="alert"
      title={message}
      className={`shrink-0 rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-node-sm text-danger line-clamp-2 break-words ${className}`}
    >
      {message}
    </div>
  );
}
