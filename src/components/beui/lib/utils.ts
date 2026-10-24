import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// React 18 has no boolean `inert` prop; an empty string sets the attribute, omission clears it.
export function inertProps(inert: boolean): Record<string, unknown> {
  return inert ? { inert: "" } : {};
}
