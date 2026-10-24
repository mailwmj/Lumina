import { z } from 'zod';

import type { AgentImageState, AgentTurnBudget } from './types';

export const AGENT_MAX_IMAGES_PER_CALL = 8;
export const AGENT_MAX_REFERENCES = 6;
export const AGENT_MAX_VIEWED_IMAGES = 4;

export const generateImageInputSchema = z.object({
  prompt: z.string().min(1).describe(
    'Full, self-contained image prompt. Refer to reference images as 图片1, 图片2 in the order of referenceNodeIds.'
  ),
  aspectRatio: z.string().regex(/^\d+:\d+$/).optional().describe('e.g. 1:1, 16:9, 9:16, 3:4'),
  referenceNodeIds: z.array(z.string()).max(AGENT_MAX_REFERENCES).optional()
    .describe('Existing canvas image node IDs used as references, in order.'),
  count: z.number().int().min(1).max(AGENT_MAX_IMAGES_PER_CALL).optional()
    .describe('Only pass when the user explicitly asked for a number of images. Defaults to 1.'),
});
export type GenerateImageInput = z.infer<typeof generateImageInputSchema>;

export type GenerateImageRefusal = 'no_image_model' | 'budget_exhausted';

export type AgentImageResult = Omit<AgentImageState, 'status'> & {
  status: AgentImageState['status'] | 'stopped_waiting' | 'timeout';
};

export type GenerateImageOutput =
  | {
    status: 'completed';
    grantedCount: number;
    /** Set when the request was cut down to fit the turn budget. */
    truncatedFrom?: number;
    sourceNodeIds: string[];
    results: AgentImageResult[];
    budget: AgentTurnBudget;
  }
  | { status: 'refused'; grantedCount: 0; code: GenerateImageRefusal; reason: string; budget: AgentTurnBudget }
  | { status: 'failed'; grantedCount: 0; error: string; sourceNodeIds: string[]; budget: AgentTurnBudget };

export const viewImagesInputSchema = z.object({
  nodeIds: z.array(z.string()).min(1).max(AGENT_MAX_VIEWED_IMAGES),
});

const askUserOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

export const AGENT_MAX_QUESTIONS = 5;

export const askUserInputSchema = z.object({
  questions: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    options: z.array(askUserOptionSchema).max(6).optional(),
    multiple: z.boolean().optional(),
  })).min(1).max(AGENT_MAX_QUESTIONS),
});
export type AskUserInput = z.infer<typeof askUserInputSchema>;

/** Filled in by the panel through `addToolOutput` once the user answers, keyed by question id. */
export const askUserAnswersSchema = z.record(z.string(), z.object({
  selected: z.array(z.string()),
  custom: z.string().optional(),
}));
export type AskUserAnswers = z.infer<typeof askUserAnswersSchema>;

/** Model-only stand-in for questions the user moved past by sending a new message. */
export const ASK_USER_UNANSWERED = { status: 'unanswered' } as const;

export const askUserOutputSchema = z.union([
  askUserAnswersSchema,
  z.object({ status: z.literal(ASK_USER_UNANSWERED.status) }),
]);
export type AskUserOutput = z.infer<typeof askUserOutputSchema>;
