import {
  getModelCategoryRules,
  ModelCategoryFields,
  ModelCategoryRule,
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

function includesAlias(values: Set<string>, aliases: string[]) {
  return aliases.some((alias) => values.has(alias));
}

function addFieldValues(
  target: Set<string>,
  values?: string[],
  extraValue?: string,
) {
  values?.forEach((value) => target.add(value));
  if (extraValue) {
    target.add(extraValue);
  }
}

function applyCategoryFields(
  types: Set<string>,
  features: Set<string>,
  capabilities: Set<string>,
  fields: ModelCategoryFields,
) {
  addFieldValues(types, fields.types, fields.type);
  addFieldValues(features, fields.features);
  addFieldValues(capabilities, fields.capabilities);
}

function normalizeExistingCategories(
  category?: unknown,
  categories?: unknown,
): ModelCategoryKey[] {
  const result = new Set<ModelCategoryKey>();
  addNormalizedValues(result as Set<string>, category);
  addNormalizedValues(result as Set<string>, categories);

  return [...result].filter(
    (value): value is ModelCategoryKey =>
      value === "image" ||
      value === "video" ||
      value === "web" ||
      value === "thinking",
  );
}

export function normalizeModelClassification(
  model: Record<string, unknown>,
): NormalizedModelClassification {
  const rawTypes = new Set<string>();
  const rawFeatures = new Set<string>();
  const rawCapabilities = new Set<string>();
  const rawValues = new Set<string>();

  addNormalizedValues(rawTypes, model.types);
  addNormalizedValues(rawFeatures, model.features);
  addNormalizedValues(rawCapabilities, model.capabilities);

  addNormalizedValues(rawTypes, model.type);
  addNormalizedValues(rawTypes, model.model_type);
  addNormalizedValues(rawCapabilities, model.supported_endpoint_type);

  addNormalizedValues(rawValues, [
    ...rawTypes,
    ...rawFeatures,
    ...rawCapabilities,
  ]);

  const lowerModelName = String(
    model.id || model.name || model.model_id || model.model_name || "",
  ).toLowerCase();

  const types = new Set<string>(rawTypes);
  const features = new Set<string>(rawFeatures);
  const capabilities = new Set<string>(rawCapabilities);
  const existingCategories = normalizeExistingCategories(
    model.category,
    model.categories,
  );
  const existingCategorySource =
    model.categorySource === 0 || model.categorySource === 1
      ? model.categorySource
      : undefined;
  const categories = new Set<ModelCategoryKey>(existingCategories);

  (
    Object.entries(getModelCategoryRules()) as [
      ModelCategoryKey,
      ModelCategoryRule,
    ][]
  ).forEach(([category, definition]) => {
    const matched =
      categories.has(category) ||
      includesAlias(rawValues, definition.aliases) ||
      definition.namePatterns.some((pattern) => pattern.test(lowerModelName));

    if (!matched) return;

    categories.add(category);
    applyCategoryFields(types, features, capabilities, definition.fields);
  });

  const normalizedCategories = [...categories];
  const normalizedTypes = [...types];
  const normalizedFeatures = [...features];
  const normalizedCapabilities = [...capabilities];
  const primaryCategory = normalizedCategories[0];

  return {
    category: primaryCategory,
    categorySource:
      primaryCategory && existingCategories.length > 0
        ? existingCategorySource ?? 1
        : primaryCategory
        ? 0
        : undefined,
    type:
      primaryCategory === "video"
        ? "video"
        : primaryCategory === "image"
        ? "image"
        : normalizedTypes[0],
    types: normalizedTypes.length > 0 ? normalizedTypes : undefined,
    features: normalizedFeatures.length > 0 ? normalizedFeatures : undefined,
    capabilities:
      normalizedCapabilities.length > 0 ? normalizedCapabilities : undefined,
    categories:
      normalizedCategories.length > 0 ? normalizedCategories : undefined,
  };
}
