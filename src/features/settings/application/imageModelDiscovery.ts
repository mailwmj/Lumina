import type { ImageModelCatalog } from '@/stores/settingsStore';

export function resolveDiscoveredImageModelSelection(
  previousCatalog: ImageModelCatalog | null,
  selectedModelIds: string[],
  discoveredModelIds: string[]
): string[] {
  const discoveredIdSet = new Set(discoveredModelIds);
  const preservedSelection = selectedModelIds.filter((modelId) => discoveredIdSet.has(modelId));

  return preservedSelection.length > 0 || previousCatalog
    ? preservedSelection
    : discoveredModelIds;
}
