export type ModelCategoryKey = "image" | "video" | "web" | "thinking";

export type ModelCategoryMetadata = {
  category?: string;
  categorySource?: 0 | 1;
  type?: string;
  types?: string[];
  features?: string[];
  capabilities?: string[];
  categories?: string[];
};

export type ModelCategoryFields = {
  type?: string;
  types?: string[];
  features?: string[];
  capabilities?: string[];
};

export type ModelCategoryRule = {
  fields: ModelCategoryFields;
  aliases: string[];
  namePatterns: RegExp[];
  metadataKeywords: string[];
  titleKeywords: string[];
};

export const MODEL_CATEGORY_RULES: Record<ModelCategoryKey, ModelCategoryRule> =
  {
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
      metadataKeywords: [
        "image",
        "vision",
        "visual",
        "multimodal",
        "vl",
        "vqa",
        "ocr",
        "segmentation",
        "detection",
        "generate-image",
        "inpaint",
        "outpaint",
        "upscale",
        "super-resolution",
      ],
      titleKeywords: [
        "image",
        "visual",
        "multimodal",
        "vl",
        "vqa",
        "ocr",
        "vision-image",
        "gpt-image",
        "dall-e",
        "dalle",
        "dall·e",
        "stable-diffusion",
        "sdxl",
        "sd3",
        "flux",
        "midjourney",
        "mj",
        "niji",
        "recraft",
        "ideogram",
        "imagen",
        "janus",
        "kolors",
        "cogview",
        "controlnet",
        "clip",
        "blip",
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
      metadataKeywords: [
        "video",
        "generate-video",
        "text-to-video",
        "image-to-video",
        "temporal",
        "frame",
        "motion",
        "animation",
        "sequence",
      ],
      titleKeywords: [
        "video",
        "vid",
        "movie",
        "veo",
        "sora",
        "kling",
        "可灵",
        "runway",
        "gen-2",
        "gen-3",
        "luma",
        "dream machine",
        "pika",
        "hailuo",
        "cogvideo",
        "hunyuanvideo",
        "wanx2.1-t2v",
        "temporal",
        "frame",
        "motion",
        "animation",
        "sequence",
        "animate",
        "t2v",
        "i2v",
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
      metadataKeywords: [
        "search",
        "web-search",
        "web",
        "online",
        "retrieval",
        "browser",
        "browse",
        "browsing",
        "rag",
        "grounding",
        "plugin",
        "realtime",
        "real-time",
      ],
      titleKeywords: [
        "search",
        "web",
        "联网",
        "联网版",
        "sonar",
        "perplexity",
        "pplx",
        "copilot",
        "bing",
        "searchgpt",
        "grounding",
        "browser",
        "browse",
        "online",
        "retrieval",
        "rag",
        "internet",
        "real-time",
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
      metadataKeywords: [
        "reason",
        "reasoning",
        "thinking",
        "logic",
        "cot",
        "planner",
        "plan",
        "solver",
        "math",
        "analysis",
        "reflect",
      ],
      titleKeywords: [
        "reason",
        "reasoner",
        "reasoning",
        "thinking",
        "think",
        "r1",
        "o1",
        "o3",
        "o4",
        "qwq",
        "qwq-math",
        "cot",
        "planner",
        "planning",
        "multi-step",
        "logic",
        "reflective",
        "reflect",
        "deliberate",
        "analysis",
        "plan",
        "solver",
        "math",
        "deepseek-r",
        "deepseek-r1",
        "r2",
        "sonnet-4",
      ],
      namePatterns: [
        /(^o[134]\b|(?:^|[-_/ ])r1(?:[-_/ ]|$)|(?:^|[-_/ ])r2(?:[-_/ ]|$)|deepseek-r1|deepseek-r|reason|reasoner|reasoning|thinking|think|qwq(?:-math)?|cot|planner|planning|multi[- ]?step|reflective|reflect|deliberate|analysis|solver|math|claude-sonnet-4|sonnet-4)/,
      ],
    },
  };

export function getModelCategoryRule(category: ModelCategoryKey) {
  return MODEL_CATEGORY_RULES[category];
}

export function getModelCategoryRules() {
  return MODEL_CATEGORY_RULES;
}

export function matchModelCategory(
  category: ModelCategoryKey,
  input: {
    title: string;
    searchText?: string;
    meta?: ModelCategoryMetadata & {
      capabilities?: string[];
      categories?: string[];
      category?: string;
    };
  },
) {
  const rule = getModelCategoryRule(category);
  const metaValues = [
    input.meta?.category,
    input.meta?.type,
    ...(input.meta?.types ?? []),
    ...(input.meta?.features ?? []),
    ...(input.meta?.capabilities ?? []),
    ...(input.meta?.categories ?? []),
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  const normalizedTitle = String(input.title || "").toLowerCase();
  const normalizedSearchText = String(input.searchText || "").toLowerCase();
  const combinedText = `${normalizedTitle} ${normalizedSearchText}`.trim();

  if (rule.aliases.some((alias) => metaValues.includes(alias))) {
    return true;
  }

  if (rule.metadataKeywords.some((keyword) => metaValues.includes(keyword))) {
    return true;
  }

  if (
    combinedText &&
    rule.titleKeywords.some((keyword) => combinedText.includes(keyword))
  ) {
    return true;
  }

  if (
    combinedText &&
    rule.namePatterns.some((pattern) => pattern.test(combinedText))
  ) {
    return true;
  }

  return false;
}
