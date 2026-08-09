import { describe, expect, it } from 'vitest';

import {
  TEXT_GENERATION_DEFAULT_HEIGHT,
  TEXT_GENERATION_DEFAULT_WIDTH,
  TEXT_GENERATION_MAX_HEIGHT,
  TEXT_GENERATION_MAX_WIDTH,
  TEXT_GENERATION_MIN_HEIGHT,
  TEXT_GENERATION_MIN_WIDTH,
  TEXT_GENERATION_PROMPT_HEIGHT,
  TEXT_GENERATION_PROMPT_WITH_RESULT_HEIGHT,
  TEXT_GENERATION_REFERENCE_IMAGES_HEIGHT,
  TEXT_GENERATION_RESULT_HEIGHT,
  TEXT_GENERATION_UPSTREAM_TEXT_HEIGHT,
  resolveTextGenerationLayout,
} from './textGenerationLayout';

describe('text generation node layout', () => {
  it('keeps the compact default width and prompt height when no optional section exists', () => {
    expect(resolveTextGenerationLayout({
      hasResult: false,
    })).toEqual({
      width: TEXT_GENERATION_DEFAULT_WIDTH,
      height: TEXT_GENERATION_DEFAULT_HEIGHT,
      minWidth: TEXT_GENERATION_MIN_WIDTH,
      minHeight: TEXT_GENERATION_MIN_HEIGHT,
      upstreamTextHeight: 0,
      referenceImagesHeight: 0,
      promptHeight: TEXT_GENERATION_PROMPT_HEIGHT,
      resultHeight: 0,
    });
  });

  it('adds independent text and image context regions without widening the node', () => {
    const layout = resolveTextGenerationLayout({
      hasTextContext: true,
      hasImageContext: true,
      hasResult: false,
    });

    expect(layout).toMatchObject({
      width: TEXT_GENERATION_DEFAULT_WIDTH,
      upstreamTextHeight: TEXT_GENERATION_UPSTREAM_TEXT_HEIGHT,
      referenceImagesHeight: TEXT_GENERATION_REFERENCE_IMAGES_HEIGHT,
      promptHeight: TEXT_GENERATION_PROMPT_HEIGHT,
      resultHeight: 0,
    });
    expect(layout.height).toBeGreaterThan(TEXT_GENERATION_DEFAULT_HEIGHT);
  });

  it('adds a compact generated-result region and preserves a manual size above the active minimum', () => {
    const layout = resolveTextGenerationLayout({
      width: 900,
      height: 900,
      hasTextContext: true,
      hasImageContext: true,
      hasResult: true,
      isSizeManuallyAdjusted: true,
    });

    expect(layout).toMatchObject({
      width: 900,
      height: 900,
      promptHeight: TEXT_GENERATION_PROMPT_WITH_RESULT_HEIGHT,
      resultHeight: TEXT_GENERATION_RESULT_HEIGHT,
    });
    expect(layout.minHeight).toBeGreaterThan(TEXT_GENERATION_MIN_HEIGHT);
  });

  it('enforces the minimum and maximum dimensions', () => {
    const contextLayout = resolveTextGenerationLayout({
      width: 1,
      height: 1,
      hasTextContext: true,
      hasResult: false,
      isSizeManuallyAdjusted: true,
    });
    expect(contextLayout).toMatchObject({
      width: TEXT_GENERATION_MIN_WIDTH,
    });
    expect(contextLayout.height).toBe(contextLayout.minHeight);
    expect(resolveTextGenerationLayout({
      width: 9999,
      height: 9999,
      hasContext: false,
      hasResult: true,
      isSizeManuallyAdjusted: true,
    })).toMatchObject({
      width: TEXT_GENERATION_MAX_WIDTH,
      height: TEXT_GENERATION_MAX_HEIGHT,
    });
  });
});
