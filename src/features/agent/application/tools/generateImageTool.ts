import { tool } from 'ai';

import {
  generateImageInputSchema,
  type GenerateImageInput,
  type GenerateImageOutput,
} from '@/features/agent/domain/agentTools';
import { waitForImageResults } from '@/features/agent/application/agentImageState';
import { resolveGenerationRowPositions } from '@/features/agent/application/generationRowLayout';
import type { TurnBudgetCounter } from '@/features/agent/application/turnBudget';
import type { CanvasChangeOperation } from '@/features/canvas-agent/domain/types';
import { runImageGenerationNodes } from '@/features/canvas/application/imageGenerationRun';
import {
  CANVAS_NODE_TYPES,
  IMAGE_OUTPUT_COUNTS,
  type ImageOutputCount,
} from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

export interface GenerateImageToolContext {
  imageModelId: string | null;
  imageResolution: string;
  budget: TurnBudgetCounter;
  /** What the user explicitly asked for this turn; null means one image per call. */
  requestedImageCount: number | null;
  /** Nodes this conversation created so far; calls in the current run append to it. */
  threadNodeIds: string[];
}

const OUTPUT_COUNTS_DESCENDING = [...IMAGE_OUTPUT_COUNTS].sort((a, b) => b - a);

/** A node renders 1, 2 or 4 outputs, so other counts become several identical nodes (3 = 2 + 1). */
export function splitIntoOutputCounts(count: number): ImageOutputCount[] {
  const chunks: ImageOutputCount[] = [];
  let remaining = count;
  while (remaining > 0) {
    const chunk = OUTPUT_COUNTS_DESCENDING.find((size) => size <= remaining) ?? 1;
    chunks.push(chunk);
    remaining -= chunk;
  }
  return chunks;
}

function createGenerationNodes(
  input: GenerateImageInput,
  model: string,
  size: string,
  outputCounts: ImageOutputCount[],
  threadNodeIds: readonly string[],
): string[] {
  const projectId = useProjectStore.getState().getCurrentProject()?.id;
  if (!projectId) {
    throw new Error('No project is open.');
  }
  const positions = resolveGenerationRowPositions({
    nodes: useCanvasStore.getState().nodes,
    threadNodeIds,
    referenceNodeIds: input.referenceNodeIds ?? [],
    rows: outputCounts.map((outputCount) => ({ outputCount, aspectRatio: input.aspectRatio })),
  });
  const operations: CanvasChangeOperation[] = outputCounts.flatMap((outputCount, index) => {
    const clientId = `agent-gen-${index}`;
    return [
      {
        type: 'create_node' as const,
        clientId,
        nodeType: CANVAS_NODE_TYPES.imageEdit,
        position: positions[index],
        data: {
          prompt: input.prompt,
          model,
          size,
          outputCount,
          ...(input.aspectRatio ? { requestAspectRatio: input.aspectRatio } : {}),
        },
      },
      ...(input.referenceNodeIds ?? []).map((sourceNodeId) => ({
        type: 'connect_nodes' as const,
        sourceNodeId,
        targetNodeId: clientId,
      })),
    ];
  });
  const applied = useCanvasStore.getState().applyAgentChangeSet({
    projectId,
    // The in-app agent writes synchronously in-process; revisions only guard external agents.
    baseRevision: 'in-app-agent',
    summary: 'Agent: generate image',
    operations,
  });
  return outputCounts.map((_, index) => applied.nodeIdMap[`agent-gen-${index}`]);
}

export async function executeGenerateImage(
  input: GenerateImageInput,
  context: GenerateImageToolContext,
  abortSignal?: AbortSignal,
): Promise<GenerateImageOutput> {
  const { budget } = context;
  if (!context.imageModelId) {
    return {
      status: 'refused',
      grantedCount: 0,
      code: 'no_image_model',
      reason: 'No image model is selected. Stop and ask the user to pick an image model below the chat input.',
      budget: budget.snapshot(),
    };
  }
  // Without an explicit user count every call makes one image, whatever the model asks for.
  const requested = context.requestedImageCount === null ? 1 : input.count ?? 1;
  const granted = budget.take(requested);
  if (granted === 0) {
    return {
      status: 'refused',
      grantedCount: 0,
      code: 'budget_exhausted',
      reason: `This turn's image limit (${budget.limit}) is used up. Stop and tell the user.`,
      budget: budget.snapshot(),
    };
  }

  let sourceNodeIds: string[] = [];
  // Nothing reached the provider, so the attempt must not count against the turn.
  const failBeforeSubmission = (error: string): GenerateImageOutput => {
    budget.refund(granted);
    return { status: 'failed', grantedCount: 0, error, sourceNodeIds, budget: budget.snapshot() };
  };
  try {
    sourceNodeIds = createGenerationNodes(
      input,
      context.imageModelId,
      context.imageResolution,
      splitIntoOutputCounts(granted),
      context.threadNodeIds,
    );
    // Registered before awaiting so a parallel call in the same step lays out below these rows.
    context.threadNodeIds.push(...sourceNodeIds);
    const { runs } = await runImageGenerationNodes(sourceNodeIds);
    const resultNodeIds = runs.flatMap((run) => (run.status === 'started' ? run.resultNodeIds : []));
    context.threadNodeIds.push(...resultNodeIds);
    const errors = runs.flatMap((run) => (run.status === 'failed' ? [run.error] : []));
    if (resultNodeIds.length === 0) {
      return failBeforeSubmission(errors.join('; ') || 'Generation did not start.');
    }
    return {
      status: 'completed',
      grantedCount: granted,
      ...(granted < requested ? { truncatedFrom: requested } : {}),
      sourceNodeIds,
      results: await waitForImageResults(resultNodeIds, abortSignal),
      budget: budget.snapshot(),
    };
  } catch (error) {
    return failBeforeSubmission(error instanceof Error ? error.message : String(error));
  }
}

export function createGenerateImageTool(context: GenerateImageToolContext) {
  return tool({
    description: [
      'Create AI image generation node(s) on the canvas with the image model and resolution selected in the panel and run them.',
      'For edits, pass the image to change in referenceNodeIds; originals are never modified.',
      'Returns result node IDs with their final status and the remaining turn budget.',
    ].join(' '),
    inputSchema: generateImageInputSchema,
    execute: (input, { abortSignal }) => executeGenerateImage(input, context, abortSignal),
  });
}
