export const TEXT_GENERATION_DEFAULT_WIDTH = 520;
export const TEXT_GENERATION_DEFAULT_HEIGHT = 360;
export const TEXT_GENERATION_MIN_WIDTH = 390;
export const TEXT_GENERATION_MIN_HEIGHT = 240;
export const TEXT_GENERATION_MAX_WIDTH = 1400;
export const TEXT_GENERATION_MAX_HEIGHT = 1000;
export const TEXT_GENERATION_FOOTER_HEIGHT = 40;

interface TextGenerationLayoutInput {
  width?: number;
  height?: number;
  hasContext: boolean;
  hasResult: boolean;
}

export interface TextGenerationLayout {
  width: number;
  height: number;
  contextMaxHeight: number;
  bodyGridTemplateRows: string;
}

function clampDimension(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function resolveTextGenerationLayout({
  width,
  height,
  hasContext,
  hasResult,
}: TextGenerationLayoutInput): TextGenerationLayout {
  const resolvedWidth = clampDimension(
    width,
    TEXT_GENERATION_DEFAULT_WIDTH,
    TEXT_GENERATION_MIN_WIDTH,
    TEXT_GENERATION_MAX_WIDTH
  );
  const resolvedHeight = clampDimension(
    height,
    TEXT_GENERATION_DEFAULT_HEIGHT,
    TEXT_GENERATION_MIN_HEIGHT,
    TEXT_GENERATION_MAX_HEIGHT
  );
  const usableHeight = Math.max(0, resolvedHeight - TEXT_GENERATION_FOOTER_HEIGHT);

  return {
    width: resolvedWidth,
    height: resolvedHeight,
    contextMaxHeight: hasContext
      ? Math.min(120, Math.round(usableHeight * 0.25))
      : 0,
    bodyGridTemplateRows: hasResult ? '45fr 55fr' : '1fr',
  };
}
