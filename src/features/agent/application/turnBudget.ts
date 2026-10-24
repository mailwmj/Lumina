import { AGENT_MAX_IMAGES_PER_CALL } from '@/features/agent/domain/agentTools';
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

/**
 * Derived from the transcript, so an ask_user round-trip or an app restart inside a turn
 * resumes with the same budget. A turn starts at the last user message.
 */
export function resolveTurnBudget(messages: readonly BudgetMessage[], maxImagesPerTurn: number): AgentTurnBudget {
  const lastUserIndex = messages.map((message) => message.role).lastIndexOf('user');
  const metadata = (messages[lastUserIndex]?.metadata ?? {}) as AgentMessageMetadata;
  const requested = metadata.requestedImageCount ?? 0;
  const used = messages
    .slice(lastUserIndex + 1)
    .flatMap((message) => message.parts)
    .reduce((total, part) => total + grantedCountOf(part), 0);
  return { limit: Math.max(maxImagesPerTurn, requested), used };
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
