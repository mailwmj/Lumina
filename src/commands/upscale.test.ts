import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelUpscaleJob,
  getUpscaleJobStatus,
  startUpscaleJob,
} from './upscale';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauri.invoke,
}));

describe('upscale command adapter', () => {
  beforeEach(() => {
    tauri.invoke.mockReset();
  });

  it('keeps the fixed job contract at the command boundary', async () => {
    tauri.invoke.mockResolvedValue({ job_id: 'upscale-job-1' });

    await expect(startUpscaleJob({
      projectId: 'project-1',
      sourceImageUrl: 'C:\\projects\\project-1\\uploads\\source.jpg',
      scale: 4,
    })).resolves.toEqual({ jobId: 'upscale-job-1' });

    expect(tauri.invoke).toHaveBeenCalledWith('start_upscale_job', {
      projectId: 'project-1',
      sourceImageUrl: 'C:\\projects\\project-1\\uploads\\source.jpg',
      scale: 4,
    });
  });

  it('normalizes the Rust camelCase status payload without leaking it into the node layer', async () => {
    tauri.invoke.mockResolvedValue({
      jobId: 'upscale-job-1',
      status: 'succeeded',
      progress: 1,
      outputImageUrl: 'C:\\projects\\project-1\\outputs\\images\\upscaled.png',
      errorCode: null,
    });

    await expect(getUpscaleJobStatus('upscale-job-1')).resolves.toEqual({
      jobId: 'upscale-job-1',
      status: 'succeeded',
      progress: 1,
      resultImageUrl: 'C:\\projects\\project-1\\outputs\\images\\upscaled.png',
      previewImageUrl: null,
      aspectRatio: null,
      error: null,
      errorCode: null,
    });
  });

  it('exposes the non-sRGB rejection as a typed UI-safe error', async () => {
    tauri.invoke.mockRejectedValue({
      errorCode: 'unsupportedColorProfile',
    });

    await expect(startUpscaleJob({
      projectId: 'project-1',
      sourceImageUrl: 'C:\\projects\\project-1\\uploads\\p3.jpg',
      scale: 2,
    })).rejects.toMatchObject({
      code: 'NON_SRGB_INPUT',
      message: 'Upscale command failed',
    });
  });

  it.each([
    ['sidecar_unavailable', 'SIDECAR_UNAVAILABLE'],
    ['sidecar_failed', 'SIDECAR_FAILED'],
    ['cache_failed', 'CACHE_FAILED'],
    ['image_too_large', 'IMAGE_TOO_LARGE'],
  ] as const)('normalizes stable backend error code %s', async (rawCode, expectedCode) => {
    tauri.invoke.mockResolvedValue({
      jobId: 'upscale-job-1',
      status: 'failed',
      error: rawCode,
      errorCode: rawCode,
    });

    await expect(getUpscaleJobStatus('upscale-job-1')).resolves.toMatchObject({
      errorCode: expectedCode,
    });
  });

  it('forwards cancellation by job ID only', async () => {
    tauri.invoke.mockResolvedValue(undefined);

    await cancelUpscaleJob('upscale-job-1');

    expect(tauri.invoke).toHaveBeenCalledWith('cancel_upscale_job', { jobId: 'upscale-job-1' });
  });
});
