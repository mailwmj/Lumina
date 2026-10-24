import { tool } from 'ai';

import { askUserInputSchema, askUserOutputSchema } from '@/features/agent/domain/agentTools';

/**
 * No `execute`: the loop pauses on this call, the panel renders the questions, and the
 * user's answers come back through `addToolOutput`, which resumes the turn.
 */
export function createAskUserTool() {
  return tool({
    description: [
      'Ask the user 1-3 short multiple-choice questions and wait for the answers.',
      'Use only when an unclear choice would clearly change the result, or to confirm which image to edit.',
    ].join(' '),
    inputSchema: askUserInputSchema,
    outputSchema: askUserOutputSchema,
  });
}
