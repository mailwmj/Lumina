import type {
  CanvasNode,
  CanvasNodeData,
  CanvasWorkflowNode,
  StoryboardFrameItem,
} from '@/features/canvas/domain/canvasNodes';

export type CanvasImagePreviewJob =
  | {
    kind: 'node';
    nodeId: string;
    imageUrl: string;
  }
  | {
    kind: 'storyboardFrame';
    nodeId: string;
    frameId: string;
    imageUrl: string;
  };

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function needsDerivatives(
  imageUrl: unknown,
  previewImageUrl: unknown,
  referenceImageUrl: unknown
): imageUrl is string {
  const source = nonEmptyString(imageUrl);
  const preview = nonEmptyString(previewImageUrl);
  const reference = nonEmptyString(referenceImageUrl);
  return Boolean(source && (!preview || !reference));
}

function getStoryboardFrames(data: CanvasWorkflowNode['data']): StoryboardFrameItem[] {
  const frames = (data as { frames?: unknown }).frames;
  return Array.isArray(frames) ? frames as StoryboardFrameItem[] : [];
}

export function getCanvasImagePreviewJobKey(job: CanvasImagePreviewJob): string {
  return job.kind === 'node'
    ? `${job.kind}:${job.nodeId}:${job.imageUrl}`
    : `${job.kind}:${job.nodeId}:${job.frameId}:${job.imageUrl}`;
}

export function collectCanvasImagePreviewJobs(
  nodes: readonly CanvasWorkflowNode[]
): CanvasImagePreviewJob[] {
  const jobs: CanvasImagePreviewJob[] = [];

  for (const node of nodes) {
    const data = node.data as Record<string, unknown>;
    if (needsDerivatives(data.imageUrl, data.previewImageUrl, data.referenceImageUrl)) {
      jobs.push({
        kind: 'node',
        nodeId: node.id,
        imageUrl: data.imageUrl,
      });
    }

    for (const frame of getStoryboardFrames(node.data)) {
      if (needsDerivatives(frame.imageUrl, frame.previewImageUrl, frame.referenceImageUrl)) {
        jobs.push({
          kind: 'storyboardFrame',
          nodeId: node.id,
          frameId: frame.id,
          imageUrl: frame.imageUrl,
        });
      }
    }
  }

  return jobs;
}

export function createCanvasImagePreviewPatch(
  node: CanvasNode,
  job: CanvasImagePreviewJob,
  derivatives: { previewImageUrl: string; referenceImageUrl: string }
): Partial<CanvasNodeData> | null {
  const data = node.data as Record<string, unknown>;
  if (job.kind === 'node') {
    if (
      data.imageUrl !== job.imageUrl
      || !needsDerivatives(data.imageUrl, data.previewImageUrl, data.referenceImageUrl)
    ) {
      return null;
    }
    return derivatives as Partial<CanvasNodeData>;
  }

  const frames = getStoryboardFrames(node.data);
  const frameIndex = frames.findIndex((frame) => frame.id === job.frameId);
  const frame = frameIndex >= 0 ? frames[frameIndex] : null;
  if (
    !frame
    || frame.imageUrl !== job.imageUrl
    || !needsDerivatives(frame.imageUrl, frame.previewImageUrl, frame.referenceImageUrl)
  ) {
    return null;
  }

  const nextFrames = frames.map((item) => (
    item.id === job.frameId ? { ...item, ...derivatives } : item
  ));
  return { frames: nextFrames } as Partial<CanvasNodeData>;
}
