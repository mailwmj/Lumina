import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { logger } from '@/lib/logger';

import {
  createImagePreview,
  loadImage,
  prepareNodeImageBinary,
  persistImageSource,
  prepareNodeImageSource,
} from '@/commands/image';

export function parseAspectRatio(value: string): number {
  const [width, height] = value.split(':').map((item) => Number(item));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1;
  }

  return width / height;
}

export function reduceAspectRatio(width: number, height: number): string {
  if (width <= 0 || height <= 0) {
    return '1:1';
  }

  const gcd = greatestCommonDivisor(Math.round(width), Math.round(height));
  return `${Math.round(width / gcd)}:${Math.round(height / gcd)}`;
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);

  while (y !== 0) {
    const temp = y;
    y = x % y;
    x = temp;
  }

  return x || 1;
}

export const CANVAS_IMAGE_PREVIEW_MAX_DIMENSION = 1024;
const CANVAS_PREVIEW_SOURCE_MAX_BYTES = 4 * 1024 * 1024;
const CANVAS_PREVIEW_SOURCE_MAX_LONG_EDGE = 2048;
const CANVAS_PREVIEW_SOURCE_MAX_PIXELS = 2048 * 2048;
const REFERENCE_SOURCE_MAX_BYTES = 12 * 1024 * 1024;
const REFERENCE_SOURCE_MAX_LONG_EDGE = 4096;
const REFERENCE_SOURCE_MAX_PIXELS = 16_000_000;
const LOCAL_PATH_PREFIX_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

export interface PreparedNodeImage {
  imageUrl: string;
  previewImageUrl: string;
  referenceImageUrl: string;
  aspectRatio: string;
}

export interface PreparedNodeImagePreview {
  previewImageUrl: string;
  referenceImageUrl: string;
  aspectRatio: string;
}

interface ErrorWithDetails extends Error {
  details?: string;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function createImagePipelineError(message: string, details?: string, cause?: unknown): ErrorWithDetails {
  const error: ErrorWithDetails = new Error(message);
  const detailParts: string[] = [];
  if (details) {
    detailParts.push(details);
  }
  if (cause !== undefined) {
    detailParts.push(`cause: ${stringifyUnknown(cause)}`);
  }
  if (detailParts.length > 0) {
    error.details = detailParts.join('\n');
  }
  return error;
}

export function isLikelyLocalImagePath(imageUrl: string): boolean {
  if (!imageUrl) {
    return false;
  }

  const lower = imageUrl.toLowerCase();
  if (
    lower.startsWith('data:') ||
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('blob:') ||
    lower.startsWith('tauri:') ||
    lower.startsWith('file://') ||
    lower.startsWith('asset:')
  ) {
    return false;
  }

  return LOCAL_PATH_PREFIX_PATTERN.test(imageUrl);
}

export function resolveImageDisplayUrl(imageUrl: string): string {
  const lower = imageUrl.toLowerCase();
  if (lower.startsWith('file://')) {
    if (!isTauri()) {
      return imageUrl;
    }

    try {
      const parsed = new URL(imageUrl);
      const decodedPathname = decodeURIComponent(parsed.pathname);
      const normalizedPath = decodedPathname.replace(/^\/([A-Za-z]:[\\/])/, '$1');
      if (!normalizedPath) {
        return imageUrl;
      }
      return convertFileSrc(normalizedPath);
    } catch {
      return imageUrl;
    }
  }

  if (!isLikelyLocalImagePath(imageUrl)) {
    return imageUrl;
  }

  if (!isTauri()) {
    return imageUrl;
  }

  return convertFileSrc(imageUrl);
}

export function resolveVideoDisplayUrl(videoUrl: string): string {
  if (!videoUrl) {
    return videoUrl;
  }

  // Already a URL (http/https/data/blob)
  const lower = videoUrl.toLowerCase();
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:')
  ) {
    return videoUrl;
  }

  // Handle file:// protocol
  if (lower.startsWith('file://')) {
    if (!isTauri()) {
      return videoUrl;
    }

    try {
      const parsed = new URL(videoUrl);
      const decodedPathname = decodeURIComponent(parsed.pathname);
      const normalizedPath = decodedPathname.replace(/^\/([A-Za-z]:[\\/])/, '$1');
      if (!normalizedPath) {
        return videoUrl;
      }
      return convertFileSrc(normalizedPath);
    } catch {
      return videoUrl;
    }
  }

  // Handle local path (bare path like C:\... or /home/...)
  if (!isTauri()) {
    return videoUrl;
  }

  return convertFileSrc(videoUrl);
}

export function resolveAudioDisplayUrl(audioUrl: string): string {
  if (!audioUrl) {
    return audioUrl;
  }

  const lower = audioUrl.toLowerCase();
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:')
  ) {
    return audioUrl;
  }

  if (lower.startsWith('file://')) {
    if (!isTauri()) {
      return audioUrl;
    }
    try {
      const parsed = new URL(audioUrl);
      const decodedPathname = decodeURIComponent(parsed.pathname);
      const normalizedPath = decodedPathname.replace(/^\/([A-Za-z]:[\\/])/, '$1');
      if (!normalizedPath) {
        return audioUrl;
      }
      return convertFileSrc(normalizedPath);
    } catch {
      return audioUrl;
    }
  }

  if (!isTauri()) {
    return audioUrl;
  }

  return convertFileSrc(audioUrl);
}

export async function persistImageLocally(source: string, projectId?: string): Promise<string> {
  // Always persist to project directory if in Tauri, regardless of source path
  // This ensures reference images are always loaded from project directory (uploads/outputs)
  // and saved to project directory, not from/to global directories
  if (!isTauri()) {
    return source;
  }

  return await persistImageSource(source, projectId);
}

export async function loadImageElement(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  const displaySource = resolveImageDisplayUrl(source);
  if (
    displaySource.startsWith('http://') ||
    displaySource.startsWith('https://') ||
    displaySource.startsWith('asset:')
  ) {
    image.crossOrigin = 'anonymous';
  }

  return await new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(
        createImagePipelineError('图片加载失败', `source=${source}\ndisplaySource=${displaySource}`)
      );
    image.src = displaySource;
  });
}

export async function imageUrlToDataUrl(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith('data:')) {
    return imageUrl;
  }

  if (isLikelyLocalImagePath(imageUrl)) {
    if (isTauri()) {
      try {
        return await loadImage(imageUrl);
      } catch (error) {
        throw createImagePipelineError('无法读取本地图片数据', `source=${imageUrl}`, error);
      }
    }
    const localResponse = await fetch(resolveImageDisplayUrl(imageUrl));
    if (!localResponse.ok) {
      throw createImagePipelineError(
        '无法读取本地图片数据',
        `source=${imageUrl}\nstatus=${localResponse.status}`
      );
    }
    const localBlob = await localResponse.blob();
    return await blobToDataUrl(localBlob);
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw createImagePipelineError('无法下载图片数据', `url=${imageUrl}\nstatus=${response.status}`);
  }

  const blob = await response.blob();
  return await blobToDataUrl(blob);
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const reader = new FileReader();

  return await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('图片转换失败'));
    reader.readAsDataURL(blob);
  });
}

export function extractBase64Payload(dataUrl: string): string {
  const [, payload = ''] = dataUrl.split(',');
  return payload;
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  const reader = new FileReader();

  return await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function resolveFileExtension(file: File): string {
  const mime = file.type.toLowerCase();
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/bmp') return 'bmp';
  if (mime === 'image/tiff') return 'tiff';
  if (mime === 'image/avif') return 'avif';

  const name = file.name.trim();
  const dot = name.lastIndexOf('.');
  if (dot >= 0 && dot < name.length - 1) {
    return name.slice(dot + 1).toLowerCase();
  }
  return 'png';
}

export async function prepareNodeImageFromFile(
  file: File,
  maxPreviewDimension = CANVAS_IMAGE_PREVIEW_MAX_DIMENSION,
  projectId?: string
): Promise<PreparedNodeImage> {
  const started = performance.now();
  const tauriFilePath = (file as File & { path?: string }).path;
  const normalizedPath = typeof tauriFilePath === 'string' ? tauriFilePath.trim() : '';
  const canUseLocalPath =
    normalizedPath.length > 0
    && (isLikelyLocalImagePath(normalizedPath) || normalizedPath.toLowerCase().startsWith('file://'));

  // Debug logging
  logger.debug(
    `prepareNodeImageFromFile: name=${file.name}, type=${file.type}, size=${file.size}, canUseLocalPath=${canUseLocalPath}, normalizedPath=${normalizedPath.substring(0, 100)}, projectId=${projectId ?? 'none'}`,
    { context: 'imageData.prepareNodeImageFromFile' }
  );

  if (canUseLocalPath) {
    const prepared = await prepareNodeImage(normalizedPath, maxPreviewDimension, projectId);
    logger.info(
      `[upload-perf][imageData] prepareNodeImageFromFile path-mode name="${file.name}" size=${file.size}B elapsed=${Math.round(performance.now() - started)}ms`
    );
    return prepared;
  }

  if (isTauri()) {
    const safeMaxDimension = Math.max(64, Math.floor(maxPreviewDimension));
    const readStarted = performance.now();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const readElapsed = Math.round(performance.now() - readStarted);
    const extension = resolveFileExtension(file);

    // Debug logging
    logger.debug(
      `prepareNodeImageFromFile binary-mode: name=${file.name}, type=${file.type}, size=${file.size}, extension=${extension}, bytes.length=${bytes.length}`,
      { context: 'imageData.prepareNodeImageFromFile' }
    );

    const tauriStarted = performance.now();
    const prepared = await prepareNodeImageBinary(bytes, extension, safeMaxDimension, projectId);
    const tauriElapsed = Math.round(performance.now() - tauriStarted);

    // Debug logging
    logger.debug(
      `prepareNodeImageFromFile binary-mode result: imageUrl=${prepared.imagePath}, previewImageUrl=${prepared.previewImagePath}`,
      { context: 'imageData.prepareNodeImageFromFile' }
    );

    logger.info(
      `[upload-perf][imageData] prepareNodeImageFromFile binary-mode name="${file.name}" size=${file.size}B readArrayBuffer=${readElapsed}ms tauriPrepare=${tauriElapsed}ms total=${Math.round(performance.now() - started)}ms`
    );
    return {
      imageUrl: prepared.imagePath,
      previewImageUrl: prepared.previewImagePath,
      referenceImageUrl: prepared.referenceImagePath || prepared.imagePath,
      aspectRatio: prepared.aspectRatio,
    };
  }

  const dataUrlStarted = performance.now();
  const source = await readFileAsDataUrl(file);
  const dataUrlElapsed = Math.round(performance.now() - dataUrlStarted);
  const prepared = await prepareNodeImage(source, maxPreviewDimension, projectId);
  logger.info(
    `[upload-perf][imageData] prepareNodeImageFromFile dataurl-fallback name="${file.name}" size=${file.size}B readDataUrl=${dataUrlElapsed}ms total=${Math.round(performance.now() - started)}ms`
  );
  return prepared;
}

export async function detectAspectRatio(imageUrl: string): Promise<string> {
  const image = await loadImageElement(imageUrl);
  return reduceAspectRatio(image.naturalWidth, image.naturalHeight);
}

export function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

function resolvePreviewMimeType(imageUrl: string): string {
  if (imageUrl.startsWith('data:image/png')) {
    return 'image/png';
  }
  if (imageUrl.startsWith('data:image/webp')) {
    return 'image/webp';
  }
  return 'image/jpeg';
}

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    return new Blob([dataUrl]).size;
  }
  const payload = dataUrl.slice(commaIndex + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function exceedsImageSourceLimits(
  sourceBytes: number,
  width: number,
  height: number,
  limits: { maxBytes: number; maxLongEdge: number; maxPixels: number }
): boolean {
  return sourceBytes > limits.maxBytes
    || Math.max(width, height) > limits.maxLongEdge
    || width * height > limits.maxPixels;
}

function renderPreviewDataUrl(
  image: HTMLImageElement,
  sourceDataUrl: string,
  maxDimension: number,
  forceReencode = false,
  outputMimeType?: 'image/jpeg' | 'image/png' | 'image/webp',
  maxPixels = Number.MAX_SAFE_INTEGER,
  quality = 0.9
): string {
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const sourcePixels = image.naturalWidth * image.naturalHeight;
  if (!forceReencode && longestSide <= maxDimension && sourcePixels <= maxPixels) {
    return sourceDataUrl;
  }

  const scale = Math.min(
    1,
    maxDimension / longestSide,
    Math.sqrt(maxPixels / Math.max(1, sourcePixels))
  );
  const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    return sourceDataUrl;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const mimeType = outputMimeType ?? resolvePreviewMimeType(sourceDataUrl);
  if (mimeType === 'image/jpeg' || mimeType === 'image/webp') {
    return canvas.toDataURL(mimeType, quality);
  }
  return canvas.toDataURL(mimeType);
}

async function createBrowserNodeImageDerivatives(
  image: HTMLImageElement,
  normalizedDataUrl: string,
  originalImageUrl: string,
  maxPreviewDimension: number,
  projectId?: string
): Promise<Pick<PreparedNodeImage, 'previewImageUrl' | 'referenceImageUrl'>> {
  const sourceBytes = estimateDataUrlBytes(normalizedDataUrl);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const needsPreview = exceedsImageSourceLimits(sourceBytes, width, height, {
    maxBytes: CANVAS_PREVIEW_SOURCE_MAX_BYTES,
    maxLongEdge: CANVAS_PREVIEW_SOURCE_MAX_LONG_EDGE,
    maxPixels: CANVAS_PREVIEW_SOURCE_MAX_PIXELS,
  });
  const needsReference = exceedsImageSourceLimits(sourceBytes, width, height, {
    maxBytes: REFERENCE_SOURCE_MAX_BYTES,
    maxLongEdge: REFERENCE_SOURCE_MAX_LONG_EDGE,
    maxPixels: REFERENCE_SOURCE_MAX_PIXELS,
  });
  const previewDataUrl = needsPreview
    ? renderPreviewDataUrl(
      image,
      normalizedDataUrl,
      maxPreviewDimension,
      true,
      'image/jpeg',
      maxPreviewDimension * maxPreviewDimension,
      0.9
    )
    : normalizedDataUrl;
  const referenceDataUrl = needsReference
    ? renderPreviewDataUrl(
      image,
      normalizedDataUrl,
      REFERENCE_SOURCE_MAX_LONG_EDGE,
      true,
      undefined,
      REFERENCE_SOURCE_MAX_PIXELS,
      0.95
    )
    : normalizedDataUrl;

  return {
    previewImageUrl: previewDataUrl === normalizedDataUrl
      ? originalImageUrl
      : await persistImageLocally(previewDataUrl, projectId),
    referenceImageUrl: referenceDataUrl === normalizedDataUrl
      ? originalImageUrl
      : await persistImageLocally(referenceDataUrl, projectId),
  };
}

export async function createPreviewDataUrl(
  imageUrl: string,
  maxDimension = CANVAS_IMAGE_PREVIEW_MAX_DIMENSION,
  forceReencode = false,
  outputMimeType?: 'image/jpeg' | 'image/png' | 'image/webp'
): Promise<string> {
  const normalizedDataUrl = await imageUrlToDataUrl(imageUrl);
  const image = await loadImageElement(normalizedDataUrl);
  const safeMaxDimension = Math.max(64, Math.floor(maxDimension));
  return renderPreviewDataUrl(
    image,
    normalizedDataUrl,
    safeMaxDimension,
    forceReencode,
    outputMimeType
  );
}

export async function createNodeImagePreview(
  imageUrl: string,
  maxPreviewDimension = CANVAS_IMAGE_PREVIEW_MAX_DIMENSION,
  projectId?: string
): Promise<PreparedNodeImagePreview> {
  const trimmedImageUrl = imageUrl.trim();
  if (!trimmedImageUrl) {
    throw createImagePipelineError('未获取到可用图片结果', 'imageUrl is empty');
  }

  const safeMaxDimension = Math.max(64, Math.floor(maxPreviewDimension));
  if (isTauri()) {
    try {
      const prepared = await createImagePreview(trimmedImageUrl, safeMaxDimension, projectId);
      return {
        previewImageUrl: prepared.previewImagePath,
        referenceImageUrl: prepared.referenceImagePath || trimmedImageUrl,
        aspectRatio: prepared.aspectRatio,
      };
    } catch (error) {
      logger.warn('[imageData] createNodeImagePreview tauri-source failed, fallback to browser path', {
        source: trimmedImageUrl,
        error,
      });
    }
  }

  const normalizedDataUrl = await imageUrlToDataUrl(trimmedImageUrl);
  const image = await loadImageElement(normalizedDataUrl);
  const derivatives = await createBrowserNodeImageDerivatives(
    image,
    normalizedDataUrl,
    trimmedImageUrl,
    safeMaxDimension,
    projectId
  );

  return {
    ...derivatives,
    aspectRatio: reduceAspectRatio(image.naturalWidth, image.naturalHeight),
  };
}

export async function prepareNodeImage(
  imageUrl: string,
  maxPreviewDimension = CANVAS_IMAGE_PREVIEW_MAX_DIMENSION,
  projectId?: string
): Promise<PreparedNodeImage> {
  const trimmedImageUrl = imageUrl.trim();
  if (!trimmedImageUrl) {
    throw createImagePipelineError('未获取到可用图片结果', 'imageUrl is empty');
  }

  const started = performance.now();
  if (isTauri()) {
    const safeMaxDimension = Math.max(64, Math.floor(maxPreviewDimension));
    try {
      const tauriStarted = performance.now();
      const prepared = await prepareNodeImageSource(trimmedImageUrl, safeMaxDimension, projectId);
      logger.info(
        `[upload-perf][imageData] prepareNodeImage tauri-source elapsed=${Math.round(performance.now() - tauriStarted)}ms total=${Math.round(performance.now() - started)}ms`
      );
      return {
        imageUrl: prepared.imagePath,
        previewImageUrl: prepared.previewImagePath,
        referenceImageUrl: prepared.referenceImagePath || prepared.imagePath,
        aspectRatio: prepared.aspectRatio,
      };
    } catch (error) {
      logger.warn('[imageData] prepareNodeImage tauri-source failed, fallback to browser path', {
        source: trimmedImageUrl,
        error,
      });
      // fallback to browser path for compatibility
    }
  }

  try {
    const persistedImagePath = await persistImageLocally(trimmedImageUrl, projectId);
    const normalizedDataUrl = await imageUrlToDataUrl(persistedImagePath);
    const image = await loadImageElement(normalizedDataUrl);
    const safeMaxDimension = Math.max(64, Math.floor(maxPreviewDimension));
    const derivatives = await createBrowserNodeImageDerivatives(
      image,
      normalizedDataUrl,
      persistedImagePath,
      safeMaxDimension,
      projectId
    );

    logger.info(
      `[upload-perf][imageData] prepareNodeImage browser-fallback total=${Math.round(performance.now() - started)}ms`
    );
    return {
      imageUrl: persistedImagePath,
      ...derivatives,
      aspectRatio: reduceAspectRatio(image.naturalWidth, image.naturalHeight),
    };
  } catch (error) {
    throw createImagePipelineError(
      '生成结果无法解析为图片',
      `source=${trimmedImageUrl}`,
      error
    );
  }
}
