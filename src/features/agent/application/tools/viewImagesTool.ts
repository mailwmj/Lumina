import { tool } from 'ai';

import { viewImagesInputSchema } from '@/features/agent/domain/agentTools';
import { buildCanvasAgentNodeImages } from '@/features/canvas-agent/application/canvasAgentNodeImages';
import { useProjectStore } from '@/stores/projectStore';

const VIEW_MAX_DIMENSION = 768;

type ViewedImage = Record<string, unknown> & { dataUrl?: string; mimeType?: string };

type ModelContentPart =
  | { type: 'text'; text: string }
  | { type: 'file'; mediaType: string; data: { type: 'data'; data: string } };

/**
 * Pixels go to the model as file parts. Persisted transcripts drop `dataUrl`, so a replayed
 * call degrades to its metadata instead of failing.
 */
export function viewedImagesToModelContent(images: readonly ViewedImage[]): ModelContentPart[] {
  return images.flatMap((image) => {
    const { dataUrl, mimeType, ...metadata } = image;
    const parts: ModelContentPart[] = [{ type: 'text', text: JSON.stringify(metadata) }];
    if (dataUrl && mimeType) {
      parts.push({ type: 'file', mediaType: mimeType, data: { type: 'data', data: dataUrl.slice(dataUrl.indexOf(',') + 1) } });
    }
    return parts;
  });
}

export function createViewImagesTool() {
  return tool({
    description: 'Look at canvas image nodes (results or references) to judge quality or describe them.',
    inputSchema: viewImagesInputSchema,
    execute: async ({ nodeIds }) => {
      const projectId = useProjectStore.getState().getCurrentProject()?.id;
      if (!projectId) {
        throw new Error('No project is open.');
      }
      const { images } = await buildCanvasAgentNodeImages({ projectId, nodeIds, maxDimension: VIEW_MAX_DIMENSION });
      return { images: images as ViewedImage[] };
    },
    toModelOutput: ({ output }) => ({ type: 'content', value: viewedImagesToModelContent(output.images) }),
  });
}
