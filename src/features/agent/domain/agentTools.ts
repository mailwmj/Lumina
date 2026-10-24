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
  /** The user left this question to the agent. */
  delegated: z.boolean().optional(),
}));
export type AskUserAnswers = z.infer<typeof askUserAnswersSchema>;

/** The user moved past the questions by sending a new message. Only the model's copy carries it. */
export const ASK_USER_UNANSWERED = { status: 'unanswered' } as const;
/** The user's next chat message answers the questions and continues the same turn. */
export const ASK_USER_ANSWERED_IN_CHAT = { status: 'answered_in_chat' } as const;
/** The user called off the task; the agent does not resume. */
export const ASK_USER_CANCELLED = { status: 'cancelled' } as const;

const askUserClosedSchema = z.object({
  status: z.enum([ASK_USER_UNANSWERED.status, ASK_USER_ANSWERED_IN_CHAT.status, ASK_USER_CANCELLED.status]),
});

export const askUserOutputSchema = z.union([askUserAnswersSchema, askUserClosedSchema]);
export type AskUserOutput = z.infer<typeof askUserOutputSchema>;

export function isAskUserAnswers(output: unknown): output is AskUserAnswers {
  return typeof output === 'object' && output !== null && typeof (output as { status?: unknown }).status !== 'string';
}

export function askUserClosedStatus(output: unknown): z.infer<typeof askUserClosedSchema>['status'] | null {
  return askUserClosedSchema.safeParse(output).data?.status ?? null;
}
