import { isStepCount, ToolLoopAgent, type InferAgentUIMessage, type LanguageModel } from 'ai';

import type { AgentMessageMetadata, AgentTurnBudget } from '@/features/agent/domain/types';
import { buildAgentInstructions } from './agentInstructions';
import { pruneHistoryImages } from './historyImagePruning';
import { createAskUserTool } from './tools/askUserTool';
import { createGenerateImageTool } from './tools/generateImageTool';
import { createViewImagesTool } from './tools/viewImagesTool';
import { TurnBudgetCounter } from './turnBudget';

const MAX_STEPS_PER_RUN = 12;

export interface CanvasAgentConfig {
  model: LanguageModel;
  providerOptions: Record<string, Record<string, string>>;
  imageModelId: string | null;
  budget: AgentTurnBudget;
  requestedImageCount: number | null;
  /** False for models whose capability probe rejected images. */
  vision: boolean;
}

function createAgentTools(config: CanvasAgentConfig) {
  return {
    generate_image: createGenerateImageTool({
      imageModelId: config.imageModelId,
      budget: new TurnBudgetCounter(config.budget.limit, config.budget.used),
      requestedImageCount: config.requestedImageCount,
    }),
    view_images: createViewImagesTool(),
    ask_user: createAskUserTool(),
  };
}

type AgentToolName = keyof ReturnType<typeof createAgentTools>;

/** One agent per run: the budget counter and instructions reflect the turn at send time. */
export function createCanvasAgent(config: CanvasAgentConfig) {
  const activeTools: AgentToolName[] = config.vision
    ? ['generate_image', 'view_images', 'ask_user']
    : ['generate_image', 'ask_user'];

  return new ToolLoopAgent({
    model: config.model,
    instructions: buildAgentInstructions(config),
    tools: createAgentTools(config),
    // Keeps one tool set (and one message type) while hiding view_images from text-only models.
    activeTools,
    stopWhen: isStepCount(MAX_STEPS_PER_RUN),
    providerOptions: config.providerOptions,
    prepareStep: ({ messages }) => ({ messages: pruneHistoryImages(messages) }),
  });
}

export type CanvasAgentUIMessage = InferAgentUIMessage<ReturnType<typeof createCanvasAgent>, AgentMessageMetadata>;
