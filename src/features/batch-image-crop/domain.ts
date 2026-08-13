export const BATCH_CROP_MAX_IMAGES = 100;
export const BATCH_CROP_MAX_FILE_BYTES = 60 * 1024 * 1024;

export const BATCH_CROP_TARGETS = [
  { id: '1440x1440', width: 1440, height: 1440 },
  { id: '1440x1920', width: 1440, height: 1920 },
  { id: '1440x2200', width: 1440, height: 2200 },
] as const;

export type BatchCropTargetId = (typeof BATCH_CROP_TARGETS)[number]['id'];
export type BatchCropTarget = (typeof BATCH_CROP_TARGETS)[number];

export interface NormalizedCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BatchCropItemStatus =
  | 'pending'
  | 'processing'
  | 'auto'
  | 'review'
  | 'adjusted'
  | 'confirmed'
  | 'exporting'
  | 'exported'
  | 'error';

export interface BatchCropImageItem {
  id: string;
  sourcePath: string;
  fileName: string;
  fileSize: number;
  previewPath: string;
  thumbnailPath: string;
  width: number;
  height: number;
  rotationDegrees: number;
  status: BatchCropItemStatus;
  crop: NormalizedCropRect | null;
  automaticCrop: NormalizedCropRect | null;
  requiresReview: boolean;
  lowResolution: boolean;
  errorMessage?: string;
  outputPath?: string;
}

export function getBatchCropTarget(id: BatchCropTargetId): BatchCropTarget {
  return BATCH_CROP_TARGETS.find((target) => target.id === id) ?? BATCH_CROP_TARGETS[0];
}

export function normalizeRotationDegrees(value: number): number {
  return ((Math.round(value / 90) * 90) % 360 + 360) % 360;
}

export function fitImageWithinBounds(
  imageWidth: number,
  imageHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  const safeImageWidth = Math.max(1, imageWidth);
  const safeImageHeight = Math.max(1, imageHeight);
  const scale = Math.min(
    Math.max(1, maxWidth) / safeImageWidth,
    Math.max(1, maxHeight) / safeImageHeight,
    1
  );

  return {
    width: Math.max(1, Math.round(safeImageWidth * scale)),
    height: Math.max(1, Math.round(safeImageHeight * scale)),
  };
}

export function createCenteredCrop(
  imageWidth: number,
  imageHeight: number,
  targetWidth: number,
  targetHeight: number
): NormalizedCropRect {
  const safeImageWidth = Math.max(1, imageWidth);
  const safeImageHeight = Math.max(1, imageHeight);
  const targetRatio = Math.max(1, targetWidth) / Math.max(1, targetHeight);
  const imageRatio = safeImageWidth / safeImageHeight;

  if (imageRatio > targetRatio) {
    const width = targetRatio / imageRatio;
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }

  const height = imageRatio / targetRatio;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

export function isLowResolutionCrop(
  imageWidth: number,
  imageHeight: number,
  crop: NormalizedCropRect,
  targetWidth: number,
  targetHeight: number
): boolean {
  return imageWidth * crop.width < targetWidth || imageHeight * crop.height < targetHeight;
}

export function formatBatchCropFileSize(bytes: number): string {
  const megabytes = bytes / 1024 / 1024;
  return megabytes < 1 ? `${megabytes.toFixed(1)} MB` : `${Math.round(megabytes)} MB`;
}
