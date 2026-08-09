import { describe, expect, it } from 'vitest';

import {
  TEXT_GENERATION_DEFAULT_HEIGHT,
  TEXT_GENERATION_DEFAULT_WIDTH,
  TEXT_GENERATION_MAX_HEIGHT,
  TEXT_GENERATION_MAX_WIDTH,
  TEXT_GENERATION_MIN_HEIGHT,
  TEXT_GENERATION_MIN_WIDTH,
  resolveTextGenerationLayout,
} from './textGenerationLayout';

describe('text generation node layout', () => {
  it('uses the P0 default size with one body region when no result exists', () => {
    expect(resolveTextGenerationLayout({
      hasContext: false,
      hasResult: false,
    })).toEqual({
      width: TEXT_GENERATION_DEFAULT_WIDTH,
      height: TEXT_GENERATION_DEFAULT_HEIGHT,
      contextMaxHeight: 0,
      bodyGridTemplateRows: '1fr',
    });
  });

  it('caps the context and splits input/result without changing node size', () => {
    expect(resolveTextGenerationLayout({
      width: 900,
      height: 900,
      hasContext: true,
      hasResult: true,
    })).toEqual({
      width: 900,
      height: 900,
      contextMaxHeight: 120,
      bodyGridTemplateRows: '45fr 55fr',
    });
  });

  it('enforces the minimum and maximum dimensions', () => {
    expect(resolveTextGenerationLayout({
      width: 1,
      height: 1,
      hasContext: true,
      hasResult: false,
    })).toMatchObject({
      width: TEXT_GENERATION_MIN_WIDTH,
      height: TEXT_GENERATION_MIN_HEIGHT,
    });
    expect(resolveTextGenerationLayout({
      width: 9999,
      height: 9999,
      hasContext: false,
      hasResult: true,
    })).toMatchObject({
      width: TEXT_GENERATION_MAX_WIDTH,
      height: TEXT_GENERATION_MAX_HEIGHT,
    });
  });
});
