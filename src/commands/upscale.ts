import { invoke } from '@tauri-apps/api/core';

import type { UpscaleScale } from '@/features/canvas/domain/canvasNodes';

export type UpscaleJobState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'not_found';

export type UpscaleCommandErrorCode =
  | 'NON_SRGB_INPUT'
  | 'INPUT_NOT_FOUND'
  | 'JOB_NOT_FOUND'
  | 'INVALID_SCALE'
  | 'UNSUPPORTED_IMAGE'
  | 'IMAGE_TOO_LARGE'
  | 'SIDECAR_UNAVAILABLE'
  | 'SIDECAR_FAILED'
  | 'CACHE_FAILED'
  | 'CANCELLED'
  | 'INTERNAL_ERROR'
  | 'INVALID_RESPONSE'
  | 'UNKNOWN';

export interface StartUpscaleJobRequest {
  projectId: string;
  sourceImageUrl: string;
  scale: UpscaleScale;
}

export interface UpscaleJobStartResult {
  jobId: string;
}

export interface UpscaleJobStatus {
  jobId: string;
  status: UpscaleJobState;
  progress: number | null;
  resultImageUrl: string | null;
  previewImageUrl: string | null;
  aspectRatio: string | null;
  error: string | null;
  errorCode: UpscaleCommandErrorCode | null;
}

export class UpscaleCommandError extends Error {
  constructor(
    message: string,
    readonly code: UpscaleCommandErrorCode = 'UNKNOWN',
    readonly details?: string
  ) {
    super(message);
    this.name = 'UpscaleCommandError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseErrorPayload(value: unknown): Record<string, unknown> | null {
  const directRecord = asRecord(value);
  if (directRecord) {
    return directRecord;
  }

  if (typeof value !== 'string') {
    return null;
  }

  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function normalizeErrorCode(value: unknown): UpscaleCommandErrorCode | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (
    normalized === 'NON_SRGB_INPUT'
    || normalized === 'UNSUPPORTED_COLOR_PROFILE'
    || normalized === 'UNSUPPORTED_COLORPROFILE'
  ) {
    return 'NON_SRGB_INPUT';
  }
  if (
    normalized === 'INPUT_NOT_FOUND'
    || normalized === 'SOURCE_NOT_FOUND'
    || normalized === 'MISSING_INPUT'
    || normalized === 'INVALID_INPUT_SOURCE'
  ) {
    return 'INPUT_NOT_FOUND';
  }
  if (normalized === 'JOB_NOT_FOUND' || normalized === 'JOB_NOTFOUND' || normalized === 'NOT_FOUND') {
    return 'JOB_NOT_FOUND';
  }
  if (normalized === 'INVALID_SCALE') {
    return 'INVALID_SCALE';
  }
  if (normalized === 'UNSUPPORTED_IMAGE') {
    return 'UNSUPPORTED_IMAGE';
  }
  if (normalized === 'IMAGE_TOO_LARGE') {
    return 'IMAGE_TOO_LARGE';
  }
  if (normalized === 'SIDECAR_UNAVAILABLE') {
    return 'SIDECAR_UNAVAILABLE';
  }
  if (normalized === 'SIDECAR_FAILED') {
    return 'SIDECAR_FAILED';
  }
  if (normalized === 'CACHE_FAILED') {
    return 'CACHE_FAILED';
  }
  if (normalized === 'CANCELLED') {
    return 'CANCELLED';
  }
  if (normalized === 'INTERNAL_ERROR') {
    return 'INTERNAL_ERROR';
  }
  if (normalized === 'INVALID_RESPONSE') {
    return 'INVALID_RESPONSE';
  }
  return normalized ? 'UNKNOWN' : null;
}

function normalizeStatus(value: unknown): UpscaleJobState {
  switch (value) {
    case 'queued':
    case 'running':
    case 'succeeded':
    case 'failed':
    case 'cancelled':
    case 'not_found':
      return value;
    default:
      return 'failed';
  }
}

export function normalizeUpscaleCommandError(error: unknown): UpscaleCommandError {
  if (error instanceof UpscaleCommandError) {
    return error;
  }

  const payload = parseErrorPayload(error);
  const nestedError = payload ? asRecord(payload.error) : null;
  const message = payload
    ? readString(payload, ['message', 'error_message', 'error'])
      ?? readString(nestedError ?? {}, ['message', 'error'])
      ?? 'Upscale command failed'
    : error instanceof Error
      ? error.message || 'Upscale command failed'
      : typeof error === 'string' && error.trim()
        ? error.trim()
        : 'Upscale command failed';
  const code = normalizeErrorCode(
    payload
      ? readString(payload, ['code', 'errorCode', 'error_code'])
        ?? readString(nestedError ?? {}, ['code', 'errorCode', 'error_code'])
      : null
  ) ?? (/(?:non[-_ ]?s?rgb|display p3|(?:unsupported[-_ ]?color[-_ ]?profile)|color[-_ ]?profile)/i.test(message)
    ? 'NON_SRGB_INPUT'
    : 'UNKNOWN');
  const details = payload
    ? readString(payload, ['details', 'detail'])
      ?? readString(nestedError ?? {}, ['details', 'detail'])
    : undefined;

  return new UpscaleCommandError(message, code, details ?? undefined);
}

function normalizeStartResult(rawResult: unknown): UpscaleJobStartResult {
  if (typeof rawResult === 'string' && rawResult.trim()) {
    return { jobId: rawResult.trim() };
  }

  const record = asRecord(rawResult);
  const jobId = record ? readString(record, ['jobId', 'job_id']) : null;
  if (!jobId) {
    throw new UpscaleCommandError('Upscale command returned no job ID.', 'INVALID_RESPONSE');
  }

  return { jobId };
}

function normalizeStatusResult(jobId: string, rawResult: unknown): UpscaleJobStatus {
  const record = asRecord(rawResult);
  if (!record) {
    throw new UpscaleCommandError('Upscale command returned an invalid status payload.', 'INVALID_RESPONSE');
  }

  const resultImageUrl = readString(record, [
    'resultImageUrl',
    'result_image_url',
    'outputImageUrl',
    'output_image_url',
    'imageUrl',
    'image_url',
    'result',
  ]);

  return {
    jobId: readString(record, ['jobId', 'job_id']) ?? jobId,
    status: normalizeStatus(record.status),
    progress: readNumber(record, ['progress']),
    resultImageUrl,
    previewImageUrl: readString(record, ['previewImageUrl', 'preview_image_url']),
    aspectRatio: readString(record, ['aspectRatio', 'aspect_ratio']),
    error: readString(record, ['error', 'message', 'error_message']),
    errorCode: normalizeErrorCode(readString(record, ['errorCode', 'error_code', 'code'])),
  };
}

export async function startUpscaleJob(
  request: StartUpscaleJobRequest
): Promise<UpscaleJobStartResult> {
  try {
    const rawResult = await invoke<unknown>('start_upscale_job', {
      projectId: request.projectId,
      sourceImageUrl: request.sourceImageUrl,
      scale: request.scale,
    });
    return normalizeStartResult(rawResult);
  } catch (error) {
    throw normalizeUpscaleCommandError(error);
  }
}

export async function getUpscaleJobStatus(jobId: string): Promise<UpscaleJobStatus> {
  try {
    const rawResult = await invoke<unknown>('get_upscale_job_status', { jobId });
    return normalizeStatusResult(jobId, rawResult);
  } catch (error) {
    throw normalizeUpscaleCommandError(error);
  }
}

export async function cancelUpscaleJob(jobId: string): Promise<void> {
  try {
    await invoke('cancel_upscale_job', { jobId });
  } catch (error) {
    throw normalizeUpscaleCommandError(error);
  }
}
