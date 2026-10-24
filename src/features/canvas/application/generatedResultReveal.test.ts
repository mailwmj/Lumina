import { describe, expect, it } from 'vitest';

import { resolveGeneratedResultRevealCenter } from './generatedResultReveal';

describe('generated result reveal', () => {
  const visible = { x: 0, y: 0, width: 1_200, height: 800 };
  const source = { x: 100, y: 300, width: 320, height: 240 };

  it('leaves the view alone while the results are fully visible', () => {
    const result = { x: 492, y: 276, width: 288, height: 288 };

    expect(resolveGeneratedResultRevealCenter(visible, [result], source)).toBeNull();
  });

  it('pans to frame the source and its results together when they fit', () => {
    const offscreenResult = { x: 492, y: 600, width: 288, height: 288 };

    expect(resolveGeneratedResultRevealCenter(visible, [offscreenResult], source)).toEqual({
      x: (100 + 780) / 2,
      y: (300 + 888) / 2,
    });
  });

  it('centers on the whole batch when it cannot share the view with the source', () => {
    const farBatch = [
      { x: 492, y: 3_000, width: 288, height: 288 },
      { x: 796, y: 3_000, width: 288, height: 288 },
    ];

    expect(resolveGeneratedResultRevealCenter(visible, farBatch, source)).toEqual({
      x: (492 + 1_084) / 2,
      y: 3_144,
    });
  });
});
