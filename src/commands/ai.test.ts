import { describe, expect, it } from 'vitest';

import { normalizeGeneratedTextResponse } from './ai';

describe('text generation command response', () => {
  it('uses trimming only to detect emptiness and preserves the complete response', () => {
    expect(normalizeGeneratedTextResponse('  indented result\n')).toBe('  indented result\n');
    expect(() => normalizeGeneratedTextResponse('   \n')).toThrow('API 返回内容为空');
  });
});
