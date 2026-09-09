import type { ImageModelDefinition } from '../../types';
import { CHAOMO_IMAGE_PROVIDER_ID } from '../../providers/openai';

const ASPECT_RATIOS = [
  '1:1',
  '5:4',
  '9:16',
  '21:9',
  '16:9',
  '3:2',
  '4:3',
  '4:5',
  '3:4',
  '2:3',
] as const;

export function createChaomoGptImage25HightModel(
  id: string,
  resolution: '1K' | '2K' | '4K',
  displayName: string
): ImageModelDefinition {
  return {
    id,
    mediaType: 'image',
    displayName,
    providerId: CHAOMO_IMAGE_PROVIDER_ID,
    description: `${displayName} 超分图片生成与参考图编辑`,
    eta: resolution === '4K' ? '3min' : '2min',
    expectedDurationMs: resolution === '4K' ? 180000 : 120000,
    defaultAspectRatio: '16:9',
    defaultResolution: resolution,
    aspectRatios: ASPECT_RATIOS.map((value) => ({ value, label: value })),
    resolutions: [{ value: resolution, label: resolution }],
    resolveRequest: ({ referenceImageCount }) => ({
      requestModel: id,
      modeLabel: referenceImageCount > 0 ? '编辑模式' : '生成模式',
    }),
  };
}
