import { describe, expect, it } from 'vitest';

import { parseRequestedImageCount, resolveTurnBudget, TurnBudgetCounter } from './turnBudget';

describe('parseRequestedImageCount', () => {
  it('reads explicit counts in Chinese and English', () => {
    expect(parseRequestedImageCount('帮我出 4 张海报')).toBe(4);
    expect(parseRequestedImageCount('来三张不同风格的')).toBe(3);
    expect(parseRequestedImageCount('give me four images of a cat')).toBe(4);
    expect(parseRequestedImageCount('make 2 variations')).toBe(2);
  });

  it('returns null when no count is given', () => {
    expect(parseRequestedImageCount('画一只猫')).toBeNull();
    expect(parseRequestedImageCount('a cat on the moon')).toBeNull();
  });

  it('ignores ordinals and references to existing images', () => {
    expect(parseRequestedImageCount('把第2张的背景换成蓝色')).toBeNull();
    expect(parseRequestedImageCount('这两张图合成一张')).toBe(1);
    expect(parseRequestedImageCount('combine these two images')).toBeNull();
  });

  it('caps a single request at 8', () => {
    expect(parseRequestedImageCount('出 20 张')).toBe(8);
  });
});

function user(requestedImageCount: number | null = null) {
  return { role: 'user', metadata: { requestedImageCount }, parts: [{ type: 'text' }] };
}

function assistantGenerated(...grantedCounts: number[]) {
  return {
    role: 'assistant',
    parts: grantedCounts.map((grantedCount) => ({
      type: 'tool-generate_image',
      state: 'output-available',
      output: { grantedCount },
    })),
  };
}

describe('resolveTurnBudget', () => {
  it('uses the settings limit when the user asked for fewer or no images', () => {
    expect(resolveTurnBudget([user()], 4)).toEqual({ limit: 4, used: 0 });
    expect(resolveTurnBudget([user(2)], 4)).toEqual({ limit: 4, used: 0 });
  });

  it('lets an explicit user count above the settings limit win', () => {
    expect(resolveTurnBudget([user(6)], 4)).toEqual({ limit: 6, used: 0 });
  });

  it('counts only images generated since the last user message', () => {
    const messages = [user(), assistantGenerated(4), user(), assistantGenerated(1, 2)];
    expect(resolveTurnBudget(messages, 4)).toEqual({ limit: 4, used: 3 });
  });

  it('ignores generate_image calls that have not produced output yet', () => {
    const pending = { role: 'assistant', parts: [{ type: 'tool-generate_image', state: 'input-available' }] };
    expect(resolveTurnBudget([user(), pending], 4).used).toBe(0);
  });
});

describe('TurnBudgetCounter', () => {
  it('truncates a request to the remaining budget and refuses once exhausted', () => {
    const counter = new TurnBudgetCounter(4, 1);
    expect(counter.take(2)).toBe(2);
    expect(counter.take(4)).toBe(1);
    expect(counter.take(1)).toBe(0);
    expect(counter.snapshot()).toEqual({ limit: 4, used: 4 });
  });
});
