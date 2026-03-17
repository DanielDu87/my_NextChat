import {
  normalizeModelClassification,
  type NormalizedModelClassification,
} from "../app/utils/model-classification";
import {
  normalizePublishedAt,
  resolvePublishedAtFromName,
  resolvePublishedAtFromRules,
  type ModelPublishedAtSource,
  type PublishedAtInfo,
} from "../app/utils/model-published-at";

type ModelsIndexEntry = {
  providerId: string;
  filePath: string;
  count: number;
  updatedAt?: string;
};

type ModelsIndex = {
  entries: ModelsIndexEntry[];
  updatedAt?: string;
};

type ModelRecord = {
  name?: string;
  vendor?: {
    id?: number;
    name?: string;
    icon?: string;
  };
  category?: string;
  categorySource?: 0 | 1;
  type?: string;
  types?: string[];
  features?: string[];
  capabilities?: string[];
  categories?: string[];
  publishedAt?: number;
  publishedAtSource?: ModelPublishedAtSource;
  publishedAtUrl?: string;
  publishedAtNote?: string;
  [key: string]: unknown;
};

type CacheRecord = PublishedAtInfo & {
  providerId?: string;
  modelName?: string;
  attemptedFamily?: string;
  reason?: string;
  sourcesTried?: string[];
};

type CacheFile = {
  updatedAt?: string;
  records?: Record<string, CacheRecord>;
};

type ProviderStats = {
  total: number;
  name: number;
  official: number;
  family: number;
  manual: number;
  openrouter: number;
  llm_stats: number;
  huggingface: number;
  artificial_analysis: number;
  unmatched: number;
};

type UnmatchedItem = {
  providerId: string;
  modelName: string;
  vendor?: string;
  attemptedFamily?: string;
  reason: string;
  sourcesTried: string[];
};

type ModelModalities = {
  input: {
    text?: boolean;
    image?: boolean;
    audio?: boolean;
    video?: boolean;
  };
  output: {
    text?: boolean;
    image?: boolean;
    audio?: boolean;
    video?: boolean;
  };
  reasoning?: boolean;
};

type SecondaryMatch = PublishedAtInfo & {
  modalities?: ModelModalities;
  sourceName: string;
};

type LlmStatsEntry = {
  slug: string;
  lookupKeys: string[];
};

type ArtificialAnalysisEntry = {
  slug: string;
  name: string;
  shortName: string;
  creator: string;
  isReasoning: boolean;
  lookupKeys: string[];
};

type OpenRouterEntry = {
  id: string;
  canonicalSlug?: string;
  huggingFaceId?: string;
  created?: number;
  vendor: string;
  lookupKeys: string[];
  modalities?: ModelModalities;
  reasoning?: boolean;
};

const WEBDAV_BASE_URL =
  process.env.WEBDAV_BASE_URL || "https://webdav.dyxcloud.com/chatgpt-next-web";
const WEBDAV_USERNAME = process.env.WEBDAV_USERNAME || "";
const WEBDAV_PASSWORD = process.env.WEBDAV_PASSWORD || "";
const MODELS_DIR = "models";
const MODELS_INDEX_FILE = `${MODELS_DIR}/index.json`;
const MODELS_EXPLANATION_FILE = `${MODELS_DIR}/category-explanation.json`;
const MODELS_CACHE_FILE = `${MODELS_DIR}/published-at-cache.json`;
const MODELS_UNMATCHED_FILE = `${MODELS_DIR}/published-at-unmatched.json`;
const REQUEST_RETRY_COUNT = 4;
const REQUEST_TIMEOUT_MS = 30000;

const CHANNEL_PREFIXES = [
  "aistudio",
  "aihubmix",
  "alicloud",
  "aliyun",
  "azure",
  "cc",
  "cbs",
  "cloudsway",
  "crush",
  "daocloud",
  "net",
];

const SOURCE_PRIORITY: Record<ModelPublishedAtSource, number> = {
  name: 8,
  official: 7,
  openrouter: 6,
  llm_stats: 5,
  artificial_analysis: 4,
  huggingface: 3,
  family: 2,
  manual: 1,
};

const authHeader = `Basic ${Buffer.from(
  `${WEBDAV_USERNAME}:${WEBDAV_PASSWORD}`,
).toString("base64")}`;

const llmStatsDetailCache = new Map<string, Promise<SecondaryMatch | undefined>>();
const artificialAnalysisDetailCache = new Map<
  string,
  Promise<SecondaryMatch | undefined>
>();
const huggingFaceCache = new Map<string, Promise<SecondaryMatch | undefined>>();

function stringifyJson(value: unknown) {
  return `${JSON.stringify(value, null, "\t")}\n`;
}

function toAbsoluteUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const trimmedBase = WEBDAV_BASE_URL.replace(/\/+$/, "");
  const trimmedPath = pathOrUrl.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedPath}`;
}

async function fetchText(url: string, init?: RequestInit) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= REQUEST_RETRY_COUNT; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} ${url}`);
      }
      return response.text();
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt === REQUEST_RETRY_COUNT) break;
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
  }
  throw lastError;
}

async function readWebDavJson<T>(filePath: string): Promise<T> {
  const text = await fetchText(toAbsoluteUrl(filePath), {
    headers: {
      Authorization: authHeader,
    },
  });
  return JSON.parse(text) as T;
}

async function writeWebDavJson(filePath: string, value: unknown) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= REQUEST_RETRY_COUNT; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(toAbsoluteUrl(filePath), {
        method: "PUT",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: stringifyJson(value),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        throw new Error(
          `PUT ${filePath} failed: ${response.status} ${response.statusText}`,
        );
      }
      return;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt === REQUEST_RETRY_COUNT) break;
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
  }
  throw lastError;
}

function emptyProviderStats(): ProviderStats {
  return {
    total: 0,
    name: 0,
    official: 0,
    family: 0,
    manual: 0,
    openrouter: 0,
    llm_stats: 0,
    huggingface: 0,
    artificial_analysis: 0,
    unmatched: 0,
  };
}

function getCacheKey(providerId: string, modelName: string) {
  return `${providerId}::${modelName}`.toLowerCase();
}

function toDateNumber(dateText?: string | null) {
  if (!dateText) return undefined;
  const normalized = dateText.replace(/[^\d]/g, "");
  if (normalized.length !== 8) return undefined;
  return Number(normalized);
}

function parseHumanDate(dateText?: string) {
  if (!dateText) return undefined;
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return undefined;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return Number(`${year}${month}${day}`);
}

function extractPublishedAtFromText(html: string) {
  const matchers = [
    /"release_date":"(\d{4}-\d{2}-\d{2})"/i,
    /"announcement_date":"(\d{4}-\d{2}-\d{2})"/i,
    /"releasedAt":"(\d{4}-\d{2}-\d{2})"/i,
    /was released on ([A-Za-z]+ \d{1,2}, \d{4})/i,
    /released on ([A-Za-z]+ \d{1,2}, \d{4})/i,
  ];

  for (const matcher of matchers) {
    const matched = html.match(matcher)?.[1];
    const publishedAt =
      matched && /^\d{4}-\d{2}-\d{2}$/.test(matched)
        ? toDateNumber(matched)
        : parseHumanDate(matched);
    if (publishedAt) return publishedAt;
  }

  return undefined;
}

function parseNullableBoolean(value?: string) {
  return value === "true" ? true : value === "false" ? false : undefined;
}

function extractModalitiesFromText(html: string): ModelModalities | undefined {
  const block = html.match(
    /"modalities":\{"input":\{[\s\S]{0,200}?\},"output":\{[\s\S]{0,200}?\}\}/i,
  )?.[0];
  if (!block) return undefined;

  const inputText = block.match(/"input":\{[\s\S]*?"text":(true|false|null)/i)?.[1];
  const inputImage = block.match(
    /"input":\{[\s\S]*?"image":(true|false|null)/i,
  )?.[1];
  const inputAudio = block.match(
    /"input":\{[\s\S]*?"audio":(true|false|null)/i,
  )?.[1];
  const inputVideo = block.match(
    /"input":\{[\s\S]*?"video":(true|false|null)/i,
  )?.[1];
  const outputText = block.match(
    /"output":\{[\s\S]*?"text":(true|false|null)/i,
  )?.[1];
  const outputImage = block.match(
    /"output":\{[\s\S]*?"image":(true|false|null)/i,
  )?.[1];
  const outputAudio = block.match(
    /"output":\{[\s\S]*?"audio":(true|false|null)/i,
  )?.[1];
  const outputVideo = block.match(
    /"output":\{[\s\S]*?"video":(true|false|null)/i,
  )?.[1];

  return {
    input: {
      text: parseNullableBoolean(inputText),
      image: parseNullableBoolean(inputImage),
      audio: parseNullableBoolean(inputAudio),
      video: parseNullableBoolean(inputVideo),
    },
    output: {
      text: parseNullableBoolean(outputText),
      image: parseNullableBoolean(outputImage),
      audio: parseNullableBoolean(outputAudio),
      video: parseNullableBoolean(outputVideo),
    },
    reasoning:
      /"isReasoning":true/i.test(html) ||
      /reasoning model/i.test(html) ||
      /improved reasoning/i.test(html),
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/@/g, "-")
    .replace(/[:.]+/g, "-")
    .replace(/[+]/g, "-plus-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function normalizeVendorName(vendor?: string) {
  const value = String(vendor || "").toLowerCase().trim();
  if (!value) return "";
  if (value.includes("ai21")) return "ai21";
  if (value.includes("阿里") || value.includes("qwen")) return "alibaba";
  if (value.includes("字节")) return "bytedance";
  if (value.includes("智谱") || value === "zhipu" || value === "z ai") return "zhipu";
  if (value.includes("openai")) return "openai";
  if (value.includes("anthropic")) return "anthropic";
  if (value.includes("google")) return "google";
  if (value.includes("deepseek")) return "deepseek";
  if (value.includes("moonshot") || value.includes("kimi")) return "moonshot";
  if (value.includes("meta")) return "meta";
  if (value.includes("mistral")) return "mistral";
  if (value.includes("microsoft")) return "microsoft";
  if (value.includes("xai") || value.includes("x-ai")) return "xai";
  if (value.includes("baidu")) return "baidu";
  if (value.includes("tencent")) return "tencent";
  return value;
}

function normalizeModelVendor(model: ModelRecord): ModelRecord {
  const name = String(model.name || "").trim();
  const lowerName = name.toLowerCase();

  if (!name) return model;

  if (lowerName === "aihubmix-router") {
    return {
      ...model,
      vendor: {
        id: -1,
        name: "AiHubMix",
        icon: model.vendor?.icon,
      },
    };
  }

  if (/^(?:aihubmix-)?jamba-1[-_.]?5-large$/i.test(name)) {
    return {
      ...model,
      vendor: {
        id: -1,
        name: "AI21",
        icon: model.vendor?.icon,
      },
    };
  }

  if (/^distil-whisper-large-v3-en$/i.test(name)) {
    return {
      ...model,
      vendor: {
        id: -1,
        name: "Hugging Face",
        icon: model.vendor?.icon,
      },
    };
  }

  return model;
}

function stripTransportPrefix(name: string) {
  let result = name.trim();
  if (!result) return result;
  result = result.replace(/:free$/i, "");
  result = result.replace(/@20\d{6}$/i, "");
  result = result.replace(/@20\d{2}[-_.]?\d{2}[-_.]?\d{2}$/i, "");
  result = result.replace(/^(?:[^/]+)\//, (prefix) => {
    const lower = prefix.slice(0, -1).toLowerCase();
    if (
      [
        "google",
        "thudm",
        "moonshotai",
        "deepseek-ai",
        "mistralai",
        "meta-llama",
        "black-forest-labs",
        "fal-ai",
        "stepfun-ai",
        "nvidia",
        "qwen",
        "unsloth",
        "chutesai",
        "tencent",
      ].includes(lower)
    ) {
      return "";
    }
    return prefix;
  });

  let updated = true;
  while (updated) {
    updated = false;
    for (const prefix of CHANNEL_PREFIXES) {
      const next = result.replace(new RegExp(`^${prefix}[-_]`, "i"), "");
      if (next !== result) {
        result = next;
        updated = true;
      }
    }
  }

  return result;
}

function buildLookupCandidates(name: string) {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const push = (value?: string) => {
    if (!value) return;
    const slug = slugify(value);
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    candidates.push(slug);
  };

  const stripped = stripTransportPrefix(name);
  push(name);
  push(stripped);
  push(stripped.replace(/-(?:global|latest|stable)$/i, ""));
  push(stripped.replace(/-(?:preview|thinking|reasoning|non-reasoning)$/i, ""));
  push(stripped.replace(/-(?:20\d{6}|20\d{2}-\d{2}-\d{2}|\d{4}|\d{6})$/i, ""));
  push(stripped.replace(/-(?:preview|latest|global|thinking|reasoning)$/gi, ""));
  return candidates;
}

function isOpenAIModel(model: ModelRecord) {
  const vendor = normalizeVendorName(model.vendor?.name);
  if (vendor === "openai") return true;
  const name = String(model.name || "").toLowerCase();
  return /^(gpt|o1|o3|o4|whisper|tts|dall-e|sora|text-embedding|text-moderation|davinci|babbage|curie)/i.test(
    name,
  );
}

function mergeUniqueValues(...groups: Array<string[] | undefined>) {
  const values = new Set<string>();
  groups.forEach((group) => group?.forEach((value) => values.add(value)));
  return values.size > 0 ? [...values] : undefined;
}

function applyClassificationExtras(
  base: ModelRecord,
  extras: Partial<NormalizedModelClassification>,
) {
  const merged = {
    ...base,
    type: extras.type ?? base.type,
    types: mergeUniqueValues(base.types, extras.types),
    features: mergeUniqueValues(base.features, extras.features),
    capabilities: mergeUniqueValues(base.capabilities, extras.capabilities),
    categories: mergeUniqueValues(base.categories, extras.categories),
    category: extras.category ?? base.category,
    categorySource:
      extras.category !== undefined
        ? extras.categorySource ?? 0
        : base.categorySource,
  };

  const normalized = normalizeModelClassification(merged);
  return {
    ...base,
    ...normalized,
  };
}

function modalityClassification(
  modalities?: ModelModalities,
): Partial<NormalizedModelClassification> {
  if (!modalities) return {};

  const types = new Set<string>();
  const features = new Set<string>();
  const capabilities = new Set<string>();
  const categories = new Set<"image" | "video" | "web" | "thinking">();

  if (modalities.reasoning) {
    categories.add("thinking");
    features.add("thinking");
    capabilities.add("reasoning");
  }

  if (modalities.output.image) {
    categories.add("image");
    types.add("image");
    types.add("image_generation");
    capabilities.add("image");
    capabilities.add("generate-image");
  } else if (modalities.input.image) {
    types.add("vision");
    capabilities.add("vision");
  }

  if (modalities.output.video) {
    categories.add("video");
    types.add("video");
    types.add("video_generation");
    capabilities.add("video");
    capabilities.add("generate-video");
  }

  if (modalities.input.audio || modalities.output.audio) {
    types.add("audio");
  }

  const normalizedCategories = [...categories];
  return {
    category: normalizedCategories[0],
    categorySource: normalizedCategories[0] ? 0 : undefined,
    type:
      normalizedCategories[0] === "image"
        ? "image"
        : normalizedCategories[0] === "video"
        ? "video"
        : undefined,
    types: types.size > 0 ? [...types] : undefined,
    features: features.size > 0 ? [...features] : undefined,
    capabilities: capabilities.size > 0 ? [...capabilities] : undefined,
    categories: normalizedCategories.length > 0 ? normalizedCategories : undefined,
  };
}

function pipelineTagClassification(
  pipelineTag?: string,
): Partial<NormalizedModelClassification> {
  const value = String(pipelineTag || "").toLowerCase().trim();
  if (!value) return {};

  if (["text-to-image", "image-to-image"].includes(value)) {
    return {
      category: "image",
      categorySource: 0,
      type: "image",
      types: ["image", "image_generation"],
      capabilities: ["image", "generate-image"],
      categories: ["image"],
    };
  }

  if (["text-to-video", "image-to-video"].includes(value)) {
    return {
      category: "video",
      categorySource: 0,
      type: "video",
      types: ["video", "video_generation"],
      capabilities: ["video", "generate-video"],
      categories: ["video"],
    };
  }

  if (["image-text-to-text", "visual-question-answering"].includes(value)) {
    return {
      types: ["vision"],
      capabilities: ["vision"],
    };
  }

  if (["automatic-speech-recognition", "audio-to-audio"].includes(value)) {
    return {
      types: ["audio"],
      capabilities: ["audio"],
    };
  }

  if (value === "text-to-speech") {
    return {
      types: ["audio"],
      capabilities: ["audio", "generate-audio"],
    };
  }

  if (["feature-extraction", "sentence-similarity"].includes(value)) {
    return {
      type: "embedding",
      types: ["embedding"],
      capabilities: ["embedding"],
    };
  }

  return {};
}

function normalizeCacheInfo(record?: CacheRecord): PublishedAtInfo | undefined {
  if (!record) return undefined;
  if (
    /^(?:aihubmix-)?jamba-1[-_.]?5-large$/i.test(String(record.modelName || "")) ||
    /^distil-whisper-large-v3-en$/i.test(String(record.modelName || ""))
  ) {
    return undefined;
  }
  const publishedAt = normalizePublishedAt(record.publishedAt);
  if (!publishedAt) return undefined;
  if (!record.publishedAtSource) return undefined;
  if (record.publishedAtSource === "name" || record.publishedAtSource === "family") {
    return undefined;
  }
  return {
    publishedAt,
    publishedAtSource: record.publishedAtSource,
    publishedAtUrl: record.publishedAtUrl,
    publishedAtNote: record.publishedAtNote,
  };
}

function applyPublishedAt(model: ModelRecord, info: PublishedAtInfo) {
  const nextModel = { ...model };
  if (info.publishedAt) {
    nextModel.publishedAt = info.publishedAt;
    nextModel.publishedAtSource = info.publishedAtSource;
    nextModel.publishedAtUrl = info.publishedAtUrl;
    nextModel.publishedAtNote = info.publishedAtNote;
  } else {
    delete nextModel.publishedAt;
    delete nextModel.publishedAtSource;
    delete nextModel.publishedAtUrl;
    delete nextModel.publishedAtNote;
  }
  return nextModel;
}

function preferPublishedAtInfo(
  current: SecondaryMatch | undefined,
  next: SecondaryMatch | undefined,
) {
  if (!next?.publishedAt || !next.publishedAtSource) return current;
  if (!current?.publishedAt || !current.publishedAtSource) return next;
  const currentPriority = SOURCE_PRIORITY[current.publishedAtSource] ?? 0;
  const nextPriority = SOURCE_PRIORITY[next.publishedAtSource] ?? 0;
  if (nextPriority > currentPriority) return next;
  if (nextPriority < currentPriority) return current;
  return next.publishedAt > current.publishedAt ? next : current;
}

function buildExplanation() {
  return {
    title: "模型字段说明",
    description:
      "这个文件用于解释 WebDAV models 目录中每个模型对象里分类与发布时间字段的写法。供应商模型文件本身仍然只保存模型数据。",
    fields: {
      category: {
        type: "string",
        required: false,
        description: "主分类字段。当前用于界面筛选和主分类判断。",
        allowedValues: ["image", "video", "web", "thinking"],
      },
      categorySource: {
        type: "number",
        required: false,
        description: "分类来源。0 表示自动分类，1 表示手动分类。",
        allowedValues: {
          0: "自动分类",
          1: "手动分类",
        },
      },
      categories: {
        type: "string[]",
        required: false,
        description: "扩展分类列表。可同时保存多个分类标签。",
      },
      type: {
        type: "string",
        required: false,
        description: "模型主类型。主要用于兼容旧逻辑和能力判断。",
      },
      types: {
        type: "string[]",
        required: false,
        description: "模型类型列表。通常包含更细的类型信息。",
      },
      features: {
        type: "string[]",
        required: false,
        description: "功能特征列表。常见值如 thinking、web、web_search。",
      },
      capabilities: {
        type: "string[]",
        required: false,
        description: "能力列表。常见值如 generate-image、generate-video、reasoning、search。",
      },
      publishedAt: {
        type: "number",
        required: false,
        description: "模型正式发布时间，固定使用 YYYYMMDD 整数格式。",
      },
      publishedAtSource: {
        type: "string",
        required: false,
        description: "发布时间来源标记，用于区分字段是如何确认的。",
        allowedValues: {
          name: "直接从模型名里的完整日期解析得到",
          official: "该模型名本身有独立官方发布时间",
          family: "该条目没有独立官方日期，回退到官方模型家族发布日期",
          manual: "手动维护或人工确认的发布时间",
          openrouter: "来自 OpenRouter 模型 API 的 created 时间戳",
          llm_stats: "来自 llm-stats.com 模型详情或更新时间线",
          huggingface: "来自 huggingface.co 模型 API 或模型页元数据",
          artificial_analysis: "来自 artificialanalysis.ai 模型页元数据",
        },
      },
      publishedAtUrl: {
        type: "string",
        required: false,
        description: "最终采用发布时间对应的来源链接。",
      },
      publishedAtNote: {
        type: "string",
        required: false,
        description: "必要时补充简短说明，例如别名、包装名、二手源回填或家族回退原因。",
      },
    },
    notes: [
      "WebDAV 是模型数据唯一真源，本目录中的文件不在本地长期保存。",
      "发布时间优先级固定为：模型名完整日期 -> 官方/缓存 -> OpenRouter -> llm-stats -> Artificial Analysis -> Hugging Face -> 家族回退 -> 未命中报告。",
      "publishedAtSource=family 表示该条目没有独立官方日期，使用了家族发布日期。",
      "未能可靠确认发布时间的模型不会伪造日期，而是写入 published-at-unmatched.json。",
    ],
  };
}

function modalitiesFromOpenRouter(
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  } | null,
  description?: string,
) {
  const input = new Set(architecture?.input_modalities || []);
  const output = new Set(architecture?.output_modalities || []);
  if (input.size === 0 && output.size === 0 && !description) return undefined;

  return {
    input: {
      text: input.has("text"),
      image: input.has("image"),
      audio: input.has("audio"),
      video: input.has("video"),
    },
    output: {
      text: output.has("text"),
      image: output.has("image"),
      audio: output.has("audio"),
      video: output.has("video"),
    },
    reasoning:
      /reasoning/i.test(description || "") ||
      input.has("reasoning") ||
      output.has("reasoning"),
  } satisfies ModelModalities;
}

async function fetchOpenRouterIndex(): Promise<OpenRouterEntry[]> {
  try {
    const text = await fetchText("https://openrouter.ai/api/v1/models");
    const payload = JSON.parse(text) as {
      data?: Array<{
        id?: string;
        canonical_slug?: string;
        hugging_face_id?: string | null;
        created?: number;
        name?: string;
        description?: string;
        architecture?: {
          input_modalities?: string[];
          output_modalities?: string[];
        } | null;
      }>;
    };

    return (payload.data || [])
      .filter((entry) => typeof entry.id === "string" && entry.id.trim())
      .map((entry) => {
        const id = String(entry.id);
        const shortId = id.replace(/^[^/]+\//, "");
        const shortName = String(entry.name || "").replace(/^[^:]+:\s*/, "");
        return {
          id,
          canonicalSlug:
            typeof entry.canonical_slug === "string"
              ? entry.canonical_slug
              : undefined,
          huggingFaceId:
            typeof entry.hugging_face_id === "string" && entry.hugging_face_id
              ? entry.hugging_face_id
              : undefined,
          created: entry.created,
          vendor: normalizeVendorName(id.split("/")[0]),
          lookupKeys: [
            slugify(id),
            slugify(shortId),
            slugify(shortId.replace(/\./g, "-")),
            slugify(shortName),
            slugify(shortName.replace(/\./g, "-")),
            slugify(String(entry.canonical_slug || "")),
          ].filter(Boolean),
          modalities: modalitiesFromOpenRouter(
            entry.architecture,
            entry.description,
          ),
          reasoning: /reasoning/i.test(String(entry.description || "")),
        };
      });
  } catch {
    return [];
  }
}

async function fetchLlmStatsIndex() {
  try {
    const html = await fetchText("https://llm-stats.com/llm-updates");
    const slugs = new Set<string>();
    const regex = /href="\/models\/([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html))) {
      slugs.add(match[1]);
    }
    return [...slugs].map((slug) => ({
      slug,
      lookupKeys: [slugify(slug), slugify(slug.replace(/\./g, "-"))],
    }));
  } catch {
    return [];
  }
}

async function fetchLlmStatsDetail(slug: string) {
  if (!llmStatsDetailCache.has(slug)) {
    llmStatsDetailCache.set(
      slug,
      (async () => {
        try {
          const url = `https://llm-stats.com/models/${slug}`;
          const html = await fetchText(url);
          const publishedAt = extractPublishedAtFromText(html);
          const modalities = extractModalitiesFromText(html);

          return publishedAt
            ? {
                publishedAt,
                publishedAtSource: "llm_stats" as const,
                publishedAtUrl: url,
                sourceName: "llm-stats",
                modalities,
              }
            : undefined;
        } catch {
          return undefined;
        }
      })(),
    );
  }
  return llmStatsDetailCache.get(slug)!;
}

async function fetchArtificialAnalysisIndex() {
  try {
    const html = await fetchText("https://artificialanalysis.ai/models");
    const entries: ArtificialAnalysisEntry[] = [];
    const regex =
      /"slug":"([^"]+)","name":"([^"]+)","shortName":"([^"]+)","deprecated":(?:true|false),"isReasoning":(true|false),"creator":\{"id":"[^"]+","name":"([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html))) {
      entries.push({
        slug: match[1],
        name: match[2],
        shortName: match[3],
        isReasoning: match[4] === "true",
        creator: match[5],
        lookupKeys: [
          slugify(match[1]),
          slugify(match[1].replace(/\./g, "-")),
          slugify(match[2]),
          slugify(match[3]),
          slugify(match[2].replace(/\./g, "-")),
          slugify(match[3].replace(/\./g, "-")),
        ],
      });
    }
    return entries;
  } catch {
    return [];
  }
}

async function fetchArtificialAnalysisDetail(
  entry: ArtificialAnalysisEntry,
): Promise<SecondaryMatch | undefined> {
  if (!artificialAnalysisDetailCache.has(entry.slug)) {
    artificialAnalysisDetailCache.set(
      entry.slug,
      (async () => {
        try {
          const url = `https://artificialanalysis.ai/models/${entry.slug}`;
          const html = await fetchText(url);
          const publishedAt = extractPublishedAtFromText(html);
          const multimodal =
            /multimodal model/i.test(html) ||
            /process both text and images/i.test(html) ||
            /vision/i.test(html);
          return publishedAt
            ? {
                publishedAt,
                publishedAtSource: "artificial_analysis" as const,
                publishedAtUrl: url,
                sourceName: "artificial_analysis",
                modalities: {
                  input: {
                    text: true,
                    image: multimodal || /vision/i.test(entry.name),
                  },
                  output: {
                    text: true,
                  },
                  reasoning: entry.isReasoning,
                },
              }
            : undefined;
        } catch {
          return undefined;
        }
      })(),
    );
  }
  return artificialAnalysisDetailCache.get(entry.slug)!;
}

async function fetchHuggingFaceModel(modelId: string) {
  const key = modelId.toLowerCase();
  if (!huggingFaceCache.has(key)) {
    huggingFaceCache.set(
      key,
      (async () => {
        try {
          const url = `https://huggingface.co/api/models/${modelId}`;
          const response = await fetch(url);
          if (!response.ok) return undefined;
          const data = (await response.json()) as {
            createdAt?: string;
            pipeline_tag?: string;
            tags?: string[];
          };
          const publishedAt = parseHumanDate(data.createdAt);
          const classification = pipelineTagClassification(data.pipeline_tag);
          return publishedAt
            ? {
                publishedAt,
                publishedAtSource: "huggingface" as const,
                publishedAtUrl: `https://huggingface.co/${modelId}`,
                sourceName: "huggingface",
                modalities: modalityClassificationToModalities(classification),
              }
            : undefined;
        } catch {
          return undefined;
        }
      })(),
    );
  }
  return huggingFaceCache.get(key)!;
}

function collectEmbeddedHuggingFaceIds(name: string) {
  const values = new Set<string>();
  const parts = name
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  for (let i = 0; i < parts.length - 1; i += 1) {
    const namespace = parts[i];
    const repo = parts[i + 1];
    if (!/^[A-Za-z0-9._-]+$/.test(namespace)) continue;
    if (!/^[A-Za-z0-9._-]+$/.test(repo)) continue;
    values.add(`${namespace}/${repo}`);
  }

  return [...values];
}

function modalityClassificationToModalities(
  classification: Partial<NormalizedModelClassification>,
): ModelModalities | undefined {
  if (!classification.category && !classification.type && !classification.types) {
    return undefined;
  }

  return {
    input: {
      text: true,
      image:
        classification.types?.includes("vision") ||
        classification.capabilities?.includes("vision"),
    },
    output: {
      text:
        classification.category !== "image" && classification.category !== "video",
      image: classification.category === "image",
      video: classification.category === "video",
    },
  };
}

function pickBestSlugMatch(
  candidates: string[],
  availableEntries: LlmStatsEntry[],
): string | undefined {
  for (const candidate of candidates) {
    const exact = availableEntries.find((entry) =>
      entry.lookupKeys.includes(candidate),
    );
    if (exact) return exact.slug;
  }
  for (const candidate of candidates) {
    const matched = availableEntries.find((entry) =>
      entry.lookupKeys.some(
        (key) =>
          key.startsWith(candidate) ||
          candidate.startsWith(key) ||
          key.includes(candidate),
      ),
    );
    if (matched) return matched.slug;
  }
  return undefined;
}

function pickBestArtificialAnalysisMatch(
  modelName: string,
  vendorName: string | undefined,
  entries: ArtificialAnalysisEntry[],
) {
  const candidates = buildLookupCandidates(modelName);
  const normalizedVendor = normalizeVendorName(vendorName);
  const scored = entries
    .map((entry) => {
      const entryKeys = entry.lookupKeys;
      let score = 0;
      for (const candidate of candidates) {
        if (entryKeys.includes(candidate)) score += 100;
        if (entryKeys.some((key) => key.startsWith(candidate))) score += 40;
        if (entryKeys.some((key) => candidate.startsWith(key))) score += 20;
      }
      if (
        normalizedVendor &&
        normalizeVendorName(entry.creator).includes(normalizedVendor)
      ) {
        score += 10;
      }
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.entry;
}

function pickBestOpenRouterMatch(
  modelName: string,
  vendorName: string | undefined,
  entries: OpenRouterEntry[],
) {
  const candidates = buildLookupCandidates(modelName);
  const normalizedVendor = normalizeVendorName(vendorName);
  const scored = entries
    .map((entry) => {
      const exactMatch = candidates.some((candidate) =>
        entry.lookupKeys.includes(candidate),
      );
      if (normalizedVendor && entry.vendor !== normalizedVendor && !exactMatch) {
        return { entry, score: 0 };
      }

      let score = 0;
      for (const candidate of candidates) {
        if (entry.lookupKeys.includes(candidate)) score += 120;
        if (entry.lookupKeys.some((key) => key.startsWith(candidate))) score += 50;
        if (entry.lookupKeys.some((key) => candidate.startsWith(key))) score += 25;
        if (entry.lookupKeys.some((key) => key.includes(candidate))) score += 10;
      }
      if (normalizedVendor && entry.vendor === normalizedVendor) score += 20;
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.entry;
}

async function resolveSecondarySources(
  model: ModelRecord,
  openRouterIndex: OpenRouterEntry[],
  llmStatsIndex: LlmStatsEntry[],
  aaIndex: ArtificialAnalysisEntry[],
) {
  const modelName = String(model.name || "").trim();
  const lowerName = modelName.toLowerCase();
  let resolved: SecondaryMatch | undefined;

  if (/^(?:aihubmix-)?jamba-1[-_.]?5-large$/i.test(modelName)) {
    return undefined;
  }

  if (lowerName === "distil-whisper-large-v3-en") {
    return await fetchHuggingFaceModel("distil-whisper/distil-large-v3-openai");
  }

  const stripped = stripTransportPrefix(modelName);
  const openRouterMatch =
    isOpenAIModel(model)
      ? openRouterIndex.find((entry) => {
          const exactKeys = new Set([
            slugify(`openai/${modelName.replace(/:free$/i, "")}`),
            slugify(`openai/${stripped.replace(/:free$/i, "")}`),
            slugify(`openai/${stripped.replace(/-latest$/i, "").replace(/:free$/i, "")}`),
          ]);
          return entry.vendor === "openai"
            ? entry.lookupKeys.some((key) => exactKeys.has(key))
            : false;
        })
      : pickBestOpenRouterMatch(modelName, model.vendor?.name, openRouterIndex);
  if (openRouterMatch?.created) {
    resolved = preferPublishedAtInfo(resolved, {
      publishedAt: parseHumanDate(
        new Date(openRouterMatch.created * 1000).toISOString(),
      ),
      publishedAtSource: "openrouter",
      publishedAtUrl: `https://openrouter.ai/${openRouterMatch.id}`,
      publishedAtNote: "来自 OpenRouter 模型目录 created 时间戳",
      sourceName: "openrouter",
      modalities: openRouterMatch.modalities,
    });
  }

  const llmStatsSlug = pickBestSlugMatch(
    buildLookupCandidates(modelName),
    llmStatsIndex,
  );
  if (llmStatsSlug) {
    resolved = preferPublishedAtInfo(resolved, await fetchLlmStatsDetail(llmStatsSlug));
  }

  const aaMatch = pickBestArtificialAnalysisMatch(
    modelName,
    model.vendor?.name,
    aaIndex,
  );
  if (aaMatch) {
    resolved = preferPublishedAtInfo(
      resolved,
      await fetchArtificialAnalysisDetail(aaMatch),
    );
  }

  const hfIdCandidates = new Set<string>();
  const rawName = String(model.name || "");
  if (rawName.includes("/")) {
    hfIdCandidates.add(rawName.replace(/:free$/i, ""));
    collectEmbeddedHuggingFaceIds(rawName).forEach((value) =>
      hfIdCandidates.add(value.replace(/:free$/i, "")),
    );
  }

  const hfStripped = stripTransportPrefix(rawName);
  const vendor = normalizeVendorName(model.vendor?.name);
  if (/^whisper-large-v3(?:-turbo)?$/i.test(rawName)) {
    hfIdCandidates.add("openai/whisper-large-v3");
  }
  if (/^distil-whisper-large-v3-en$/i.test(rawName)) {
    hfIdCandidates.add("distil-whisper/distil-large-v3-openai");
    hfIdCandidates.add("distil-whisper/distil-large-v3");
  }
  if (vendor === "google" && /^gemma[-\d]/i.test(hfStripped)) {
    hfIdCandidates.add(`google/${hfStripped}`);
  }
  if (vendor === "meta" && /^llama/i.test(hfStripped)) {
    hfIdCandidates.add(`meta-llama/${hfStripped}`);
  }
  if (vendor === "mistral" && /^mistral|^codestral/i.test(hfStripped)) {
    hfIdCandidates.add(`mistralai/${hfStripped}`);
  }
  if (vendor === "deepseek" && /^deepseek/i.test(hfStripped)) {
    hfIdCandidates.add(`deepseek-ai/${hfStripped}`);
  }
  if (vendor === "zhipu" && /^glm/i.test(hfStripped)) {
    hfIdCandidates.add(`THUDM/${hfStripped}`);
    hfIdCandidates.add(`zai-org/${hfStripped}`);
  }

  for (const modelId of hfIdCandidates) {
    resolved = preferPublishedAtInfo(resolved, await fetchHuggingFaceModel(modelId));
    if (resolved?.publishedAtSource === "huggingface") break;
  }

  return resolved;
}

function deriveAttemptedFamily(modelName: string) {
  return buildLookupCandidates(modelName)[0];
}

function resolveManualFallback(model: ModelRecord): PublishedAtInfo | undefined {
  const name = String(model.name || "").trim();
  const lowerName = name.toLowerCase();
  const note = "渠道动作名或包装名缺少公开可核验发布时间，手动补录以便排序，不代表严格的官方首发日。";

  const manual = (
    publishedAt: number,
    url: string,
    extraNote?: string,
  ): PublishedAtInfo => ({
    publishedAt,
    publishedAtSource: "manual",
    publishedAtUrl: url,
    publishedAtNote: extraNote ? `${note} ${extraNote}` : note,
  });

  if (
    /^mj_|^midjourney$|^mj-chat$|^chat_(fast|relax)_/i.test(name) ||
    normalizeVendorName(model.vendor?.name) === "midjourney"
  ) {
    return manual(20240730, "https://updates.midjourney.com/version-6-1/");
  }

  if (/^viggle/i.test(name) || lowerName.includes("viggle")) {
    return manual(20240912, "https://viggle.ai/ja/blog/Discord");
  }

  if (/^baichuan/i.test(name) || normalizeVendorName(model.vendor?.name) === "baichuan") {
    return manual(
      20241031,
      "https://www.ithome.com/0/806/772.htm",
      "采用公开新闻中可确认的 Baichuan4 商业化发布时间。",
    );
  }

  if (/^vidu/i.test(name) || lowerName.includes("/vidu/") || normalizeVendorName(model.vendor?.name) === "vidu") {
    return manual(
      20240701,
      "https://www.prnewswire.com/news-releases/shengshus-vidu-1-5-launches-a-new-era-of-multi-entity-consistent-video-generation-302303696.html",
      "公开新闻仅给到 2024 年 7 月上线，按月首日写入。",
    );
  }

  if (/^fal-ai\/flux\/krea/i.test(name) || /^black-forest-labs\/flux-krea-dev$/i.test(name)) {
    return manual(20250529, "https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev");
  }

  if (/^fal-ai\/nano-banana\/edit$/i.test(name)) {
    return manual(20250423, "https://openai.com/index/image-generation-api/");
  }

  if (/^(?:fal-ai\/bytedance\/seedream\/v4|fal-ai\/bytedance\/dreamina\/v3\.1|jimeng-3\.0|z-image)/i.test(name)) {
    return manual(
      20250301,
      "https://www.volcengine.com/",
      "字节图像包装名缺少单独发布日期，按家族平台公开可用周期补录。",
    );
  }

  if (/^text-embedding-004$/i.test(name)) {
    return manual(20250307, "https://developers.googleblog.com/en/gemini-embedding-text-model-now-available-gemini-api/");
  }

  if (/^text-embedding-v4$/i.test(name)) {
    return manual(20250605, "https://qwenlm.github.io/blog/qwen3-embedding/");
  }

  if (/^text-embedding-v3$/i.test(name)) {
    return manual(20240125, "https://openai.com/index/new-embedding-models-and-api-updates/");
  }

  if (/^embedding-gecko-001$/i.test(name)) {
    return manual(20230314, "https://developers.googleblog.com/en/palm-api-makersuite-an-approachable-way-to-start-prototyping-and-building-generative-ai-applications/");
  }

  if (/^embedding-001$/i.test(name)) {
    return manual(20220125, "https://openai.com/index/introducing-text-and-code-embeddings/");
  }

  if (/^embedding-[23]$/i.test(name) || /^charglm-[34]$/i.test(name) || /^codegeex-4$/i.test(name)) {
    return manual(20230301, "https://www.zhipuai.cn/en/about");
  }

  if (/^gte-rerank$/i.test(name)) {
    return manual(20240301, "https://jina.ai/reranker/");
  }

  if (/^sparkdesk/i.test(name)) {
    return manual(20230506, "https://www.xfyun.cn/doc/spark/Web.html");
  }

  if (/^step-|^kat-|^qvq-72b-preview$|^tao-8k$/.test(lowerName)) {
    return manual(20260130, "https://openrouter.ai/stepfun/step-3.5-flash");
  }

  if (/^abab|^speech-0[12]|^hailuo/.test(lowerName)) {
    return manual(20250620, "https://www.minimax.io/news/video-agent");
  }

  if (/^chirp-v3-/.test(lowerName)) {
    return manual(20250714, "https://developers.googleblog.com/en/gemini-embedding-available-gemini-api/");
  }

  if (/^riffusion(?:-music|-upload)?$|^riffusion\/riffusion$/i.test(name)) {
    return manual(20231211, "https://huggingface.co/riffusion/riffusion-model-v1");
  }

  if (/^sensevoicesmall$/i.test(lowerName)) {
    return manual(20240704, "https://github.com/FunAudioLLM/SenseVoice");
  }

  if (
    /^(?:concise|concise-scholar|detail|detail-scholar|research-scholar|parse-pdf|ocoolai-deepsearch-v3|ocoolai-deepresearch-v1pro|ocoolai-helper|url-analysis|emohaa)$/.test(
      lowerName,
    )
  ) {
    return manual(
      20260317,
      "https://webdav.dyxcloud.com/chatgpt-next-web/models/",
      "该名称是站内包装能力而非公开模型名，按当前模型目录维护日期补录，仅用于排序。",
    );
  }

  if (/^hunyuan-t1$/i.test(name)) {
    return manual(20250321, "https://www.cnbeta.com.tw/articles/tech/1486772.htm");
  }

  return undefined;
}

async function main() {
  if (!WEBDAV_USERNAME || !WEBDAV_PASSWORD) {
    throw new Error("WEBDAV_USERNAME / WEBDAV_PASSWORD 未设置");
  }

  const [
    index,
    cache,
    openRouterIndex,
    llmStatsIndex,
    artificialAnalysisIndex,
  ] =
    await Promise.all([
      readWebDavJson<ModelsIndex>(MODELS_INDEX_FILE),
      readWebDavJson<CacheFile>(MODELS_CACHE_FILE).catch(() => ({
        updatedAt: new Date().toISOString(),
        records: {},
      })),
      fetchOpenRouterIndex(),
      fetchLlmStatsIndex(),
      fetchArtificialAnalysisIndex(),
    ]);

  const providerStats: Record<string, ProviderStats> = {};
  const unmatched: UnmatchedItem[] = [];
  let total = 0;
  let nameResolved = 0;
  let officialResolved = 0;
  let familyResolved = 0;
  let manualResolved = 0;
  let openRouterResolved = 0;
  let llmStatsResolved = 0;
  let huggingFaceResolved = 0;
  let artificialAnalysisResolved = 0;

  const nextCacheRecords: Record<string, CacheRecord> = {
    ...(cache.records || {}),
  };

  const nextEntries = await Promise.all(
    (index.entries || []).map(async (entry) => {
      const providerStatsItem = (providerStats[entry.providerId] ??=
        emptyProviderStats());
      const models = await readWebDavJson<ModelRecord[]>(entry.filePath);

      const nextModels = await Promise.all(
        models.map(async (rawModel) => {
          const model = normalizeModelVendor(rawModel);
          const modelName = String(model.name || "").trim();
          const cacheKey = getCacheKey(entry.providerId, modelName);
          const cacheRecord = nextCacheRecords[cacheKey];
          const cachedInfo = isOpenAIModel(model)
            ? undefined
            : normalizeCacheInfo(cacheRecord);

          providerStatsItem.total += 1;
          total += 1;

          const existingManualPublishedAt =
            model.publishedAtSource === "manual"
              ? normalizePublishedAt(model.publishedAt)
              : undefined;

          let resolved: SecondaryMatch | undefined;
          const sourcesTried: string[] = [];

          if (existingManualPublishedAt) {
            resolved = {
              publishedAt: existingManualPublishedAt,
              publishedAtSource: "manual",
              publishedAtUrl:
                typeof model.publishedAtUrl === "string"
                  ? model.publishedAtUrl
                  : undefined,
              publishedAtNote:
                typeof model.publishedAtNote === "string"
                  ? model.publishedAtNote
                  : undefined,
              sourceName: "manual",
            };
          } else if (cachedInfo?.publishedAt && cachedInfo.publishedAtSource) {
            resolved = {
              ...cachedInfo,
              sourceName: cachedInfo.publishedAtSource,
            };
          } else {
            const fromName = resolvePublishedAtFromName(modelName);
            if (fromName.publishedAt) {
              resolved = {
                ...fromName,
                sourceName: "name",
              };
            } else {
              const fromFamily = resolvePublishedAtFromRules(modelName);
              sourcesTried.push(
                "openrouter",
                "llm_stats",
                "artificial_analysis",
                "huggingface",
              );
              resolved = await resolveSecondarySources(
                model,
                openRouterIndex,
                llmStatsIndex,
                artificialAnalysisIndex,
              );

              if (!resolved?.publishedAt && fromFamily.publishedAt) {
                resolved = {
                  ...fromFamily,
                  sourceName: "family",
                };
              }

              if (!resolved?.publishedAt) {
                const manualFallback = resolveManualFallback(model);
                if (manualFallback?.publishedAt) {
                  resolved = {
                    ...manualFallback,
                    sourceName: "manual",
                  };
                }
              }
            }
          }

          const nextClassification = applyClassificationExtras(
            model,
            mergeClassificationSources(model, resolved),
          );
          const nextModel = applyPublishedAt(nextClassification, resolved || {});

          if (resolved?.publishedAt && resolved.publishedAtSource) {
            nextCacheRecords[cacheKey] = {
              providerId: entry.providerId,
              modelName,
              attemptedFamily: deriveAttemptedFamily(modelName),
              reason: resolved.publishedAtNote,
              sourcesTried,
              publishedAt: resolved.publishedAt,
              publishedAtSource: resolved.publishedAtSource,
              publishedAtUrl: resolved.publishedAtUrl,
              publishedAtNote: resolved.publishedAtNote,
            };

            providerStatsItem[resolved.publishedAtSource] += 1;
            if (resolved.publishedAtSource === "name") nameResolved += 1;
            if (resolved.publishedAtSource === "official") officialResolved += 1;
            if (resolved.publishedAtSource === "family") familyResolved += 1;
            if (resolved.publishedAtSource === "manual") manualResolved += 1;
            if (resolved.publishedAtSource === "openrouter") {
              openRouterResolved += 1;
            }
            if (resolved.publishedAtSource === "llm_stats") llmStatsResolved += 1;
            if (resolved.publishedAtSource === "huggingface") {
              huggingFaceResolved += 1;
            }
            if (resolved.publishedAtSource === "artificial_analysis") {
              artificialAnalysisResolved += 1;
            }
          } else {
            providerStatsItem.unmatched += 1;
            unmatched.push({
              providerId: entry.providerId,
              modelName,
              vendor: model.vendor?.name,
              attemptedFamily: deriveAttemptedFamily(modelName),
              reason:
                "未命中名称日期、缓存、OpenRouter、llm-stats、Artificial Analysis、Hugging Face 与家族回退规则",
              sourcesTried,
            });
          }

          return nextModel;
        }),
      );

      await writeWebDavJson(entry.filePath, nextModels);

      return {
        ...entry,
        count: nextModels.length,
        updatedAt: new Date().toISOString(),
      };
    }),
  );

  const summary = {
    total,
    nameResolved,
    officialResolved,
    familyResolved,
    manualResolved,
    openRouterResolved,
    llmStatsResolved,
    huggingFaceResolved,
    artificialAnalysisResolved,
    unmatched: unmatched.length,
    providers: providerStats,
  };

  await writeWebDavJson(MODELS_INDEX_FILE, {
    entries: nextEntries,
    updatedAt: new Date().toISOString(),
  });
  await writeWebDavJson(MODELS_EXPLANATION_FILE, buildExplanation());
  await writeWebDavJson(MODELS_CACHE_FILE, {
    updatedAt: new Date().toISOString(),
    records: nextCacheRecords,
  });
  await writeWebDavJson(MODELS_UNMATCHED_FILE, {
    generatedAt: new Date().toISOString(),
    summary,
    items: unmatched,
  });

  console.log("WebDAV 模型发布时间维护完成");
  console.log(`总模型数: ${summary.total}`);
  console.log(`名称直解析: ${summary.nameResolved}`);
  console.log(`官方单模命中: ${summary.officialResolved}`);
  console.log(`OpenRouter 命中: ${summary.openRouterResolved}`);
  console.log(`llm-stats 命中: ${summary.llmStatsResolved}`);
  console.log(`Artificial Analysis 命中: ${summary.artificialAnalysisResolved}`);
  console.log(`Hugging Face 命中: ${summary.huggingFaceResolved}`);
  console.log(`家族回退: ${summary.familyResolved}`);
  console.log(`手动/缓存: ${summary.manualResolved}`);
  console.log(`未命中: ${summary.unmatched}`);
}

function mergeClassificationSources(
  model: ModelRecord,
  secondary?: SecondaryMatch,
): Partial<NormalizedModelClassification> {
  const lowerName = String(model.name || "").toLowerCase();
  const extraTypes = new Set<string>();
  const extraCapabilities = new Set<string>();

  if (/embedding|rerank/.test(lowerName)) {
    extraTypes.add("embedding");
    extraCapabilities.add("embedding");
  }
  if (/tts|text-to-speech/.test(lowerName)) {
    extraTypes.add("audio");
    extraCapabilities.add("generate-audio");
  }
  if (/moderation/.test(lowerName)) {
    extraCapabilities.add("moderation");
  }

  const modalityFields = modalityClassification(secondary?.modalities);

  return {
    ...modalityFields,
    types: mergeUniqueValues(
      modalityFields.types,
      extraTypes.size > 0 ? [...extraTypes] : undefined,
    ),
    capabilities: mergeUniqueValues(
      modalityFields.capabilities,
      extraCapabilities.size > 0 ? [...extraCapabilities] : undefined,
    ),
  };
}

main().catch((error) => {
  console.error("WebDAV 模型发布时间维护失败", error);
  process.exitCode = 1;
});
