// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { open } from '@tauri-apps/plugin-dialog';
import { BatchImageCropWorkbench } from './BatchImageCropWorkbench';
import {
  cleanupBatchCropCache,
  exportBatchCropImage,
  prepareBatchCropImage,
} from './infrastructure/tauriBatchImageCropGateway';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    close: vi.fn(),
    onCloseRequested: vi.fn(),
  }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

vi.mock('./infrastructure/tauriBatchImageCropGateway', () => ({
  cleanupBatchCropCache: vi.fn(),
  exportBatchCropImage: vi.fn(),
  prepareBatchCropImage: vi.fn(),
  resolveBatchCropDisplayUrl: (path: string) => path,
  suggestBatchCrop: vi.fn(),
}));

const preparedImage = {
  sourcePath: '/fixtures/source.jpg',
  fileName: 'source.jpg',
  fileSize: 1024,
  previewPath: '/fixtures/preview.jpg',
  thumbnailPath: '/fixtures/thumbnail.jpg',
  width: 3574,
  height: 5361,
  suggestion: {
    crop: { x: 0, y: 1 / 18, width: 1, height: 8 / 9 },
    requiresReview: false,
  },
};

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return button;
}

async function createCompletedBatch(container: HTMLElement): Promise<void> {
  vi.mocked(open)
    .mockResolvedValueOnce(['/fixtures/source.jpg'])
    .mockResolvedValueOnce('/exports');
  vi.mocked(prepareBatchCropImage).mockResolvedValue(preparedImage);
  vi.mocked(exportBatchCropImage).mockResolvedValue({ outputPath: '/exports/source_1440x1920.jpg' });

  await act(async () => {
    findButton(container, '1440×1920').click();
  });
  await act(async () => {
    findButton(container, '添加图片').click();
  });
  await act(async () => {
    findButton(container, '确认并导出').click();
  });
}

describe('BatchImageCropWorkbench completed export', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage('zh');
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('ResizeObserver', class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(cleanupBatchCropCache).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps a fully exported batch after the user confirms the completion dialog', async () => {
    await act(async () => {
      root.render(<BatchImageCropWorkbench onExit={() => undefined} backHandlerRef={{ current: () => undefined }} />);
    });
    await createCompletedBatch(container);

    expect(container.textContent).toContain('导出完成');
    await act(async () => {
      findButton(container, '确认').click();
    });

    expect(container.textContent).toContain('source.jpg');
    expect(cleanupBatchCropCache).not.toHaveBeenCalled();
  });

  it('clears the exported images only after the user starts a new batch', async () => {
    await act(async () => {
      root.render(<BatchImageCropWorkbench onExit={() => undefined} backHandlerRef={{ current: () => undefined }} />);
    });
    await createCompletedBatch(container);

    await act(async () => {
      findButton(container, '添加新批次').click();
    });

    expect(cleanupBatchCropCache).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('source.jpg');
    expect(findButton(container, '添加图片').disabled).toBe(false);
  });

  it('prepares no more than two original images concurrently', async () => {
    const completePreparations: Array<() => void> = [];
    let activePreparations = 0;
    let peakPreparations = 0;
    vi.mocked(open).mockResolvedValueOnce([
      '/fixtures/one.jpg',
      '/fixtures/two.jpg',
      '/fixtures/three.jpg',
    ]);
    vi.mocked(prepareBatchCropImage).mockImplementation((_batchId, sourcePath) => new Promise((resolve) => {
      activePreparations += 1;
      peakPreparations = Math.max(peakPreparations, activePreparations);
      completePreparations.push(() => {
        activePreparations -= 1;
        resolve({
          ...preparedImage,
          sourcePath,
          fileName: sourcePath.split('/').pop() ?? 'source.jpg',
        });
      });
    }));

    await act(async () => {
      root.render(<BatchImageCropWorkbench onExit={() => undefined} backHandlerRef={{ current: () => undefined }} />);
    });
    await act(async () => {
      findButton(container, '1440×1920').click();
    });
    await act(async () => {
      findButton(container, '添加图片').click();
    });

    await vi.waitFor(() => expect(prepareBatchCropImage).toHaveBeenCalledTimes(2));
    expect(peakPreparations).toBe(2);

    await act(async () => {
      completePreparations.splice(0, 2).forEach((complete) => complete());
    });
    await vi.waitFor(() => expect(prepareBatchCropImage).toHaveBeenCalledTimes(3));

    expect(peakPreparations).toBe(2);
    await act(async () => {
      completePreparations.splice(0).forEach((complete) => complete());
    });
  });
});
