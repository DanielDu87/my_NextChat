import {
  getModelCategoryRules,
  ModelCategoryKey,
} from "./model-category-rules";

export type { ModelCategoryKey } from "./model-category-rules";

export type NormalizedModelClassification = {
  category?: ModelCategoryKey;
  categorySource?: 0 | 1;
  type?: string;
  types?: string[];
  features?: string[];
  capabilities?: string[];
  categories?: ModelCategoryKey[];
};

function addNormalizedValues(target: Set<string>, value: unknown) {
  if (typeof value === "string" && value.trim()) {
    value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
      .forEach((item) => target.add(item));
  }

  if (Array.isArray(value)) {
    value.forEach((item) => addNormalizedValues(target, item));
  }
}

export function normalizeModelClassification(
  model: Record<string, unknown>,
): NormalizedModelClassification {
  const rawTypes = new Set<string>();
  const rawFeatures = new Set<string>();

  addNormalizedValues(rawTypes, model.types);
  addNormalizedValues(rawFeatures, model.features);
  addNormalizedValues(rawTypes, model.type);
  addNormalizedValues(rawTypes, model.model_type);

  const types = new Set<string>(rawTypes);
  const features = new Set<string>(rawFeatures);
  const categories = new Set<ModelCategoryKey>();

  (
    Object.entries(getModelCategoryRules()) as [ModelCategoryKey, any][]
  ).forEach(([category, definition]) => {
    const matched = definition.aliases.some(
      (alias: string) => types.has(alias) || features.has(alias),
    );

    if (!matched) return;

    categories.add(category);
  });

  const normalizedCategories = [...categories];
  const normalizedTypes = [...types];
  const normalizedFeatures = [...features];
  const primaryCategory = normalizedCategories[0];

  return {
    category: primaryCategory,
    categorySource: primaryCategory ? 0 : undefined,
    type:
      primaryCategory === "video"
        ? "video"
        : primaryCategory === "image"
        ? "image"
        : normalizedTypes[0],
    types: normalizedTypes.length > 0 ? normalizedTypes : undefined,
    features: normalizedFeatures.length > 0 ? normalizedFeatures : undefined,
    categories:
      normalizedCategories.length > 0 ? normalizedCategories : undefined,
  };
}
