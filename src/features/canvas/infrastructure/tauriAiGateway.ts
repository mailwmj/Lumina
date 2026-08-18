import {
  generateImage,
  getGenerateImageJob,
  retryGenerateImageJob,
  setApiKey,
  submitGenerateImageJob,
} from '@/commands/ai';
import { persistImageLocally, isLikelyLocalImagePath } from '@/features/canvas/application/imageData';
import { uploadImageToVolcVod } from '@/commands/image';
import { uploadMediaToPublicUrl } from '@/commands/media';

import type {
  AiGateway,
  GenerateImagePayload,
} from '../application/ports';
import { submitGenerationJobBatch } from '../application/generationJobBatch';
import { logger } from '@/lib/logger';

/**
 * 上传本地图片到火山 VOD 点播空间，返回公网直链
 */
async function uploadImageToVolcVodBackend(imagePath: string): Promise<string> {
  logger.info('[VolcVOD] Uploading image to VOD via backend:', imagePath);
  return await uploadImageToVolcVod(imagePath);
}

async function normalizeReferenceImages(payload: GenerateImagePayload): Promise<string[] | undefined> {
  const isKieModel = payload.model.startsWith('kie/');
  const isFalModel = payload.model.startsWith('fal/');
  const isRunninghubModel = payload.model.startsWith('runninghub/');
  const isOpenAiModel = payload.model.startsWith('openai/');
  const isGeminiNativeImageModel = payload.model.startsWith('gemini/');
  const isOpenAiCompatibleImageModel =
    isOpenAiModel
    || isGeminiNativeImageModel
    || payload.model.startsWith('ai-media/')
    || payload.model.startsWith('chaomo/')
    || payload.model.startsWith('fhl/');
  // Video models need HTTP public URLs - if local path, upload to VOD
  // Check both volcvideo/ prefix and doubao-seedance model name (for compatibility with stored model values without prefix)
  const isVideoModel = payload.providerId === 'volcvideo'
    || payload.model.startsWith('volcvideo/')
    || payload.model.includes('doubao-seedance');
  logger.info('[normalizeReferenceImages] model:', payload.model, 'isVideoModel:', isVideoModel, 'referenceImages count:', payload.referenceImages?.length ?? 0);
  if (payload.referenceImages) {
    payload.referenceImages.forEach((img, i) => {
      logger.info('[normalizeReferenceImages] image[{}] original: {}...', i, img.substring(0, 100));
      logger.info('[normalizeReferenceImages] image[{}] isLikelyLocalImagePath:', i, isLikelyLocalImagePath(img));
    });
  }
  return payload.referenceImages
    ? await Promise.all(
      payload.referenceImages.map(async (imageUrl, index) =>
        isKieModel || isFalModel || isRunninghubModel || isOpenAiCompatibleImageModel
          ? imageUrl // KIE/FAL/RunningHub 使用 data URL（后端会上传到服务器）
          : isVideoModel
          ? isLikelyLocalImagePath(imageUrl)
            ? (logger.info('[normalizeReferenceImages] image[' + index + '] uploading to VOD...'), await uploadImageToVolcVodBackend(imageUrl)) // 视频模型需要公网直链，上传到火山 VOD
            : (logger.info('[normalizeReferenceImages] image[' + index + '] using as-is (not local path)'), imageUrl) // 已经是公网直链，直接使用
          : await persistImageLocally(imageUrl, payload.projectId)
      )
    )
    : undefined;
}

function isPublicHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

async function normalizeVideoContent(payload: GenerateImagePayload) {
  if (!payload.videoContent) {
    return undefined;
  }

  return await Promise.all(payload.videoContent.map(async (item) => {
    if (item.type === 'text' || isPublicHttpUrl(item.url)) {
      return item;
    }
    return {
      ...item,
      url: await uploadMediaToPublicUrl(item.url),
    };
  }));
}

function submitNormalizedGenerateImageJob(
  payload: GenerateImagePayload,
  normalizedReferenceImages: string[] | undefined,
  normalizedVideoContent = payload.videoContent
): Promise<string> {
  return submitGenerateImageJob({
    prompt: payload.prompt,
    model: payload.model,
    provider_id: payload.providerId,
    size: payload.size,
    aspect_ratio: payload.aspectRatio,
    reference_images: normalizedReferenceImages,
    video_content: normalizedVideoContent,
    extra_params: payload.extraParams,
    provider_config: payload.providerConfig,
    draftTaskId: payload.draftTaskId,
    project_id: payload.projectId,
  });
}

export const tauriAiGateway: AiGateway = {
  setApiKey,
  generateImage: async (payload: GenerateImagePayload) => {
    const normalizedReferenceImages = await normalizeReferenceImages(payload);
    const normalizedVideoContent = await normalizeVideoContent(payload);

    return await generateImage({
      prompt: payload.prompt,
      model: payload.model,
      provider_id: payload.providerId,
      size: payload.size,
      aspect_ratio: payload.aspectRatio,
      reference_images: normalizedReferenceImages,
      video_content: normalizedVideoContent,
      extra_params: payload.extraParams,
      provider_config: payload.providerConfig,
      draftTaskId: payload.draftTaskId,
    });
  },
  submitGenerateImageJob: async (payload: GenerateImagePayload) => {
    const normalizedReferenceImages = await normalizeReferenceImages(payload);
    const normalizedVideoContent = await normalizeVideoContent(payload);
    if (normalizedReferenceImages) {
      normalizedReferenceImages.forEach((img, i) => {
        logger.info('[submitGenerateImageJob] normalized image[{}]: {}...', i, img.substring(0, 100));
      });
    }
    return await submitNormalizedGenerateImageJob(
      payload,
      normalizedReferenceImages,
      normalizedVideoContent
    );
  },
  submitGenerateImageJobs: async (payload, outputCount, onSettled, beforeSubmit) => {
    const normalizedReferenceImages = await normalizeReferenceImages(payload);
    const normalizedVideoContent = await normalizeVideoContent(payload);
    beforeSubmit();
    const safeOutputCount = Math.max(1, Math.min(4, Math.floor(outputCount)));
    return submitGenerationJobBatch({
      outputCount: safeOutputCount,
      submit: () => submitNormalizedGenerateImageJob(
        payload,
        normalizedReferenceImages,
        normalizedVideoContent
      ),
      onSettled,
    });
  },
  getGenerateImageJob,
  retryGenerateImageJob,
};
