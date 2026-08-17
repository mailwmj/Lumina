import { beforeEach, describe, expect, it, vi } from 'vitest';

import { tauriAiGateway } from './tauriAiGateway';

const commands = vi.hoisted(() => ({
  generateImage: vi.fn(),
  getGenerateImageJob: vi.fn(),
  retryGenerateImageJob: vi.fn(),
  setApiKey: vi.fn(),
  submitGenerateImageJob: vi.fn(),
}));

const imageData = vi.hoisted(() => ({
  persistImageLocally: vi.fn(),
}));

vi.mock('@/commands/ai', () => commands);
vi.mock('@/commands/image', () => ({ uploadImageToVolcVod: vi.fn() }));
vi.mock('@/features/canvas/application/imageData', () => ({
  isLikelyLocalImagePath: () => true,
  persistImageLocally: imageData.persistImageLocally,
}));

describe('tauriAiGateway batch submission boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('revalidates only after asynchronous reference normalization and before submit', async () => {
    let finishNormalization: ((path: string) => void) | undefined;
    imageData.persistImageLocally.mockReturnValue(new Promise<string>((resolve) => {
      finishNormalization = resolve;
    }));
    const order: string[] = [];
    commands.submitGenerateImageJob.mockImplementation(async () => {
      order.push('submit');
      return 'job-1';
    });

    const submission = tauriAiGateway.submitGenerateImageJobs({
      prompt: 'Generate one image',
      model: 'provider/edit-model',
      size: '1K',
      aspectRatio: '1:1',
      referenceImages: ['/local/reference.png'],
      projectId: 'project-1',
    }, 1, vi.fn(), () => {
      order.push('guard');
    });

    await Promise.resolve();
    expect(order).toEqual([]);
    finishNormalization?.('/project/reference.png');
    await submission;

    expect(order).toEqual(['guard', 'submit']);
  });
});
