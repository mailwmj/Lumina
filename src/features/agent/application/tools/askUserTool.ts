import { tool } from 'ai';

import { askUserInputSchema, askUserOutputSchema } from '@/features/agent/domain/agentTools';

/**
 * No `execute`: the loop pauses on this call, the panel renders the questions, and the
 * user's answers come back through `addToolOutput`, which resumes the turn.
 */
export function createAskUserTool() {
  return tool({
    description: [
      'Ask the user short questions and wait for the answers.',
      'Use only when missing information would make the result wrong or force a redo,',
      'e.g. exact names, dates or text that must appear in the image, or which image to edit.',
      'Usually 1-2 questions, at most 5; never pad. Give each 2-4 clearly different options.',
      'The panel always adds a free-text field, so do not add an "other" option.',
      'Each answer has the selected option values and optional custom text; the custom text wins when they conflict.',
    ].join(' '),
    inputSchema: askUserInputSchema,
    outputSchema: askUserOutputSchema,
  });
}
