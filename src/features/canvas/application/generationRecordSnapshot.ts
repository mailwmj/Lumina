import type { ImageGenerationRecord } from '../domain/canvasNodes';

// Only parameters are captured: no reference images, credentials or media URL fields.
export function buildGenerationRecord(input: ImageGenerationRecord): ImageGenerationRecord {
  return { ...input, extraParams: JSON.parse(JSON.stringify(input.extraParams, (_key, value) =>
    typeof value === 'string' && value.startsWith('data:') ? undefined : value
  )) };
}

