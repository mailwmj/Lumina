import { describe, expect, it } from 'vitest';
import { createCenteredCrop, fitImageWithinBounds, normalizeRotationDegrees } from './domain';

describe('batch image crop geometry', () => {
  it('centers a portrait crop without changing the requested ratio', () => {
    const crop = createCenteredCrop(4000, 6000, 1440, 1920);

    expect(crop.x).toBeCloseTo(0);
    expect(crop.width).toBeCloseTo(1);
    expect(crop.y).toBeCloseTo(1 / 18);
    expect((4000 * crop.width) / (6000 * crop.height)).toBeCloseTo(1440 / 1920);
  });

  it('centers a square crop inside a landscape image', () => {
    const crop = createCenteredCrop(6000, 4000, 1440, 1440);

    expect(crop.x).toBeCloseTo(1 / 6);
    expect(crop.y).toBe(0);
    expect(crop.width).toBeCloseTo(2 / 3);
    expect(crop.height).toBe(1);
  });

  it('normalizes repeated left and right turns', () => {
    expect(normalizeRotationDegrees(-90)).toBe(270);
    expect(normalizeRotationDegrees(450)).toBe(90);
  });

  it('keeps a portrait preview portrait while fitting it inside the editor', () => {
    const rendered = fitImageWithinBounds(3574, 5361, 1448, 920);

    expect(rendered.width).toBeLessThan(rendered.height);
    expect(rendered.width / rendered.height).toBeCloseTo(3574 / 5361, 3);
    expect(rendered.width).toBe(613);
    expect(rendered.height).toBe(920);
  });
});
