export type ModelCategoryKey = "image" | "video" | "web" | "thinking";

export type NormalizedModelClassification = {
  category?: ModelCategoryKey;
  categorySource?: 0 | 1;
  type?: string;
  types?: string[];
  features?: string[];
  capabilities?: string[];
  categories?: ModelCategoryKey[];
};

type ModelCategoryDefinition = {
  fields: Partial<
    Pick<
      NormalizedModelClassification,
      "type" | "types" | "features" | "capabilities"
    >
  >;
  aliases: string[];
  namePatterns: RegExp[];
};

const COMMON_MODEL_CATEGORIES: Record<
  ModelCategoryKey,
  ModelCategoryDefinition
> = {
  image: {
    fields: {
      type: "image",
      types: ["image", "image_generation"],
      capabilities: ["image", "generate-image"],
    },
    aliases: [
      "image",
      "image_generation",
      "image-generation",
      "vision",
      "visual",
      "multimodal",
      "vl",
      "vqa",
      "ocr",
      "vision-image",
      "generate-image",
      "text-to-image",
      "image-to-image",
      "image-edit",
      "stable-diffusion",
      "sdxl",
      "midjourney",
      "mj",
      "niji",
      "clip",
      "blip",
      "controlnet",
      "segmentation",
      "detection",
      "inpaint",
      "outpaint",
      "upscale",
      "super-resolution",
    ],
    namePatterns: [
      /(gpt-image|dall-e|dalle|recraft|ideogram|flux|nano-banana|seedream|qwen-image|cogview|kolors|imagen|stable[- ]?diffusion|sdxl|midjourney|(?:^|[-_/ ])mj(?:[-_/ ]|$)|niji|controlnet|clip|blip|(?:^|[-_/ ])vl(?:[-_/ ]|$)|vqa|ocr|segmentation|detection|inpaint|outpaint|upscale|super[- ]?resolution|multimodal|visual)/,
    ],
  },
  video: {
    fields: {
      type: "video",
      types: ["video", "video_generation"],
      capabilities: ["video", "generate-video"],
    },
    aliases: [
      "video",
      "video_generation",
      "video-generation",
      "generate-video",
      "text-to-video",
      "image-to-video",
      "t2v",
      "i2v",
      "temporal",
      "frame",
      "motion",
      "animation",
      "sequence",
      "animate",
      "movie",
    ],
    namePatterns: [
      /(runway|gen[- ]?[23]|vidu|pixverse|sora|veo|jimeng|wanx|kling|可灵|luma|dream[- ]?machine|pika|hailuo|cogvideo|hunyuanvideo|t2v|i2v|animate|temporal|motion|video[- ]?generation)/,
    ],
  },
  web: {
    fields: {
      features: ["web", "web_search"],
      capabilities: ["web", "search"],
    },
    aliases: [
      "web",
      "web_search",
      "web-search",
      "online",
      "browser",
      "search",
      "deepsearch",
      "retrieval",
      "联网",
      "联网版",
      "rag",
      "browse",
      "browsing",
      "internet",
      "real-time",
      "grounding",
      "realtime",
      "plugin",
      "plugins",
      "web-enabled",
      "search-enabled",
    ],
    namePatterns: [
      /(perplexity|pplx|sonar|searchgpt|search|browser|browse|browsing|online|deepsearch|copilot|bing|grounding|联网版|realtime|real[- ]?time|plugin|plugins|web[- ]?enabled|search[- ]?enabled|retrieval|rag)/,
    ],
  },
  thinking: {
    fields: {
      features: ["thinking"],
      capabilities: ["reasoning"],
    },
    aliases: [
      "thinking",
      "reasoning",
      "reason",
      "reasoner",
      "chain-of-thought",
      "cot",
      "planner",
      "planning",
      "multi-step",
      "logic",
      "reflective",
      "deliberate",
      "reflect",
      "analysis",
      "plan",
      "solver",
      "math",
    ],
    namePatterns: [
      /(^o[134]\b|(?:^|[-_/ ])r1(?:[-_/ ]|$)|(?:^|[-_/ ])r2(?:[-_/ ]|$)|deepseek-r1|deepseek-r|reason|reasoner|reasoning|thinking|think|qwq(?:-math)?|cot|planner|planning|multi[- ]?step|reflective|reflect|deliberate|analysis|solver|math|claude-sonnet-4|sonnet-4)/,
    ],
  },
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
    Object.entries(COMMON_MODEL_CATEGORIES) as [
      ModelCategoryKey,
      ModelCategoryDefinition,
    ][]
  ).forEach(([category, definition]) => {
    const matched =
      categories.has(category) ||
      includesAlias(rawValues, definition.aliases) ||
      definition.namePatterns.some((pattern) => pattern.test(lowerModelName));

    if (!matched) return;

    categories.add(category);
    addFieldValues(types, definition.fields.types, definition.fields.type);
    addFieldValues(features, definition.fields.features);
    addFieldValues(capabilities, definition.fields.capabilities);
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
