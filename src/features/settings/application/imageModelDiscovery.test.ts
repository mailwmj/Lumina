import { describe, expect, it } from 'vitest';

import { resolveDiscoveredImageModelSelection } from './imageModelDiscovery';

describe('image model discovery selection', () => {
  it('makes every discovered model available after the first fetch', () => {
    const discoveredModelIds = [
      'chaomo/gpt-image-2.5-flare-1K-Hight',
      'chaomo/gpt-image-2.5-sunburst-4K-Hight',
    ];

    expect(resolveDiscoveredImageModelSelection(null, [], discoveredModelIds)).toEqual(
      discoveredModelIds
    );
  });

  it('preserves explicit model choices on later refreshes', () => {
    expect(resolveDiscoveredImageModelSelection(
      { models: [{ id: 'chaomo/old-model' }], refreshedAt: 1 },
      ['chaomo/gpt-image-2.5-sunburst-4K-Hight'],
      [
        'chaomo/gpt-image-2.5-flare-1K-Hight',
        'chaomo/gpt-image-2.5-sunburst-4K-Hight',
      ]
    )).toEqual(['chaomo/gpt-image-2.5-sunburst-4K-Hight']);
  });
});
