export function pruneMissingAddedModelsWithDetails(
  customModels: string,
  providerIds: Iterable<string>,
  fetchedModelNames: Iterable<string>,
) {
  const normalizedProviderIds = new Set(
    [...providerIds]
      .map((id) =>
        String(id || "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );
  const fetchedNames = new Set(
    [...fetchedModelNames]
      .map((name) =>
        String(name || "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );

  let removedCount = 0;
  const removedModelNames: string[] = [];
  const keptEntries = customModels
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => {
      const cleaned = entry.replace(/^[+-]/, "");
      const atIndex = cleaned.lastIndexOf("@");
      if (atIndex <= 0) return true;
      const modelName = cleaned.slice(0, atIndex).trim().toLowerCase();
      const entryProviderId = cleaned
        .slice(atIndex + 1)
        .trim()
        .toLowerCase();
      const shouldKeep =
        !normalizedProviderIds.has(entryProviderId) ||
        fetchedNames.has(modelName);

      if (!shouldKeep) {
        removedCount += 1;
        removedModelNames.push(cleaned.slice(0, atIndex).trim());
      }
      return shouldKeep;
    });

  return {
    customModels: removedCount > 0 ? keptEntries.join(",") : customModels,
    removedModelNames,
  };
}

export function pruneMissingAddedModels(
  customModels: string,
  providerIds: Iterable<string>,
  fetchedModelNames: Iterable<string>,
) {
  return pruneMissingAddedModelsWithDetails(
    customModels,
    providerIds,
    fetchedModelNames,
  ).customModels;
}
