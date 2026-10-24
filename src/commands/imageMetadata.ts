import { invoke } from '@tauri-apps/api/core';

export interface ImageDimensions {
  width: number;
  height: number;
}

export function readImageDimensions(source: string): Promise<ImageDimensions | null> {
  return invoke('read_image_dimensions', { source });
}
