import { AGENT_MAX_IMAGES_PER_CALL, ASK_USER_ANSWERED_IN_CHAT, askUserClosedStatus } from '@/features/agent/domain/agentTools';
import type { AgentMessageMetadata, AgentTurnBudget } from '@/features/agent/domain/types';

const CHINESE_NUMBERS: Record<string, number> = {
  一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};
const ENGLISH_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// "第2张" is an ordinal and "这两张" points at existing images; neither asks for new ones.
const CHINESE_COUNT = /(第|这|那|上面|前|后)?\s*(\d+|[一两二三四五六七八九十])\s*(张|幅|版|个版本|个方案)/g;
const ENGLISH_COUNT = /\b(these|those|the)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\w+\s+)?(images?|pictures?|pics?|variations?|versions?|options?)\b/gi;

/** Image count the user explicitly asked for, or null. The last explicit count wins. */
export function parseRequestedImageCount(text: string): number | null {
  let requested: number | null = null;
  for (const match of text.matchAll(CHINESE_COUNT)) {
    if (match[1]) continue;
    requested = Number(match[2]) || CHINESE_NUMBERS[match[2]] || requested;
  }
  for (const match of text.matchAll(ENGLISH_COUNT)) {
    if (match[1]) continue;
    requested = Number(match[2]) || ENGLISH_NUMBERS[match[2].toLowerCase()] || requested;
  }
  return requested === null ? null : Math.min(AGENT_MAX_IMAGES_PER_CALL, Math.max(1, requested));
}

interface BudgetMessagePart {
  type: string;
  state?: string;
  output?: unknown;
}

interface BudgetMessage {
  role: string;
  metadata?: unknown;
  parts: BudgetMessagePart[];
}

function grantedCountOf(part: BudgetMessagePart): number {
  if (part.type !== 'tool-generate_image' || part.state !== 'output-available') {
    return 0;
  }
  const granted = (part.output as { grantedCount?: unknown } | undefined)?.grantedCount;
  return typeof granted === 'number' && granted > 0 ? granted : 0;
}

function answeredInChat(message: BudgetMessage): boolean {
  return message.role === 'assistant' && message.parts.some((part) => (
    part.type === 'tool-ask_user' && askUserClosedStatus(part.output) === ASK_USER_ANSWERED_IN_CHAT.status
  ));
}

/** A chat reply to pending questions continues their turn; any other user message starts one. */
function turnStartIndex(messages: readonly BudgetMessage[]): number {
  const roles = messages.map((message) => message.role);
  let start = roles.lastIndexOf('user');
  while (start > 0 && answeredInChat(messages[start - 1])) {
    const previous = roles.lastIndexOf('user', start - 1);
    if (previous < 0) break;
    start = previous;
  }
  return start;
}

/** The latest explicit count the user gave in this turn, or null. */
export function resolveTurnImageCount(messages: readonly BudgetMessage[]): number | null {
  return messages
    .slice(Math.max(0, turnStartIndex(messages)))
    .filter((message) => message.role === 'user')
    .reduce<number | null>((count, message) => (message.metadata as AgentMessageMetadata | undefined)?.requestedImageCount ?? count, null);
}

/**
 * Derived from the transcript, so an ask_user round-trip, a chat reply to the questions or an
 * app restart inside a turn resumes with the same budget.
 */
export function resolveTurnBudget(messages: readonly BudgetMessage[], maxImagesPerTurn: number): AgentTurnBudget {
  const start = turnStartIndex(messages);
  const used = messages
    .slice(start + 1)
    .flatMap((message) => message.parts)
    .reduce((total, part) => total + grantedCountOf(part), 0);
  return { limit: Math.max(maxImagesPerTurn, resolveTurnImageCount(messages) ?? 0), used };
}

/** Hands out images within one agent run, starting from what the turn already used. */
export class TurnBudgetCounter {
  private used: number;

  constructor(readonly limit: number, used: number) {
    this.used = used;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.used);
  }

  /** Returns how many of the requested images may be generated (0 when exhausted). */
  take(requested: number): number {
    const granted = Math.min(requested, this.remaining);
    this.used += granted;
    return granted;
  }

  /** Gives back images that were never submitted. */
  refund(count: number): void {
    this.used = Math.max(0, this.used - count);
  }

  snapshot(): AgentTurnBudget {
    return { limit: this.limit, used: this.used };
  }
}
