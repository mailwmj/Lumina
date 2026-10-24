"use client";

import type { ReactNode } from "react";
import { cn } from "@/components/beui/lib/utils";

export type StreamingResponseStatus = "streaming" | "complete" | "error";

export interface StreamingResponseProps {
  /** Rendered response content. Pass plain text or the output of a Markdown renderer. */
  children: ReactNode;
  status?: StreamingResponseStatus;
  /** Set false when a surrounding conversation log announces streamed text. */
  announce?: boolean;
  className?: string;
  contentClassName?: string;
}

export function StreamingResponse({
  children,
  status = "streaming",
  announce = true,
  className,
  contentClassName,
}: StreamingResponseProps) {
  return (
    <div
      data-state={status}
      aria-busy={status === "streaming"}
      className={cn("w-full", className)}
    >
      <div
        aria-live={announce ? "polite" : "off"}
        className={cn(
          "text-sm leading-6 text-foreground/90 [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_p+p]:mt-3 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/45 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5",
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
