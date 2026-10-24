import {
  APICallError,
  generateText,
  tool,
  ToolChoiceViolationError,
  type LanguageModel,
  type ToolChoice,
} from 'ai';
import { z } from 'zod';

export interface ProbedAgentModelCapabilities {
  tools: boolean;
  vision: boolean;
}

// 4×4 orange PNG: the smallest image request that still exercises vision support.
const PROBE_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP438AARwzEcQB+ohfxXaFgBQAAAABJRU5ErkJggg==';

const probeTools = {
  ping: tool({ description: 'Connectivity check.', inputSchema: z.object({}) }),
};

/** A 400/422 means the provider rejected the feature; anything else is a connection problem. */
function isFeatureRejection(error: unknown): boolean {
  return APICallError.isInstance(error) && (error.statusCode === 400 || error.statusCode === 422);
}

async function callsTool(model: LanguageModel, toolChoice: ToolChoice<typeof probeTools>): Promise<boolean> {
  try {
    const result = await generateText({
      model,
      tools: probeTools,
      toolChoice,
      prompt: 'Call the ping tool now.',
    });
    return result.toolCalls.some((call) => call.toolName === 'ping');
  } catch (error) {
    // The SDK throws when `required` is answered with plain text.
    if (ToolChoiceViolationError.isInstance(error)) return false;
    throw error;
  }
}

async function supportsTools(model: LanguageModel): Promise<boolean> {
  try {
    return await callsTool(model, 'required');
  } catch (error) {
    if (!isFeatureRejection(error)) throw error;
  }
  // Some gateways reject `tool_choice: required` but still support tools.
  try {
    return await callsTool(model, 'auto');
  } catch (error) {
    if (isFeatureRejection(error)) return false;
    throw error;
  }
}

async function supportsVision(model: LanguageModel): Promise<boolean> {
  try {
    await generateText({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Name the color of this image in one word.' },
          { type: 'file', mediaType: 'image/png', data: PROBE_IMAGE_BASE64 },
        ],
      }],
    });
    return true;
  } catch (error) {
    if (isFeatureRejection(error)) return false;
    throw error;
  }
}

/**
 * Sends one tiny tool-call request and one tiny image request. Connection or auth failures
 * throw so the caller does not cache a wrong "unsupported" verdict.
 */
export async function probeAgentModel(model: LanguageModel): Promise<ProbedAgentModelCapabilities> {
  const tools = await supportsTools(model);
  const vision = await supportsVision(model);
  return { tools, vision };
}
