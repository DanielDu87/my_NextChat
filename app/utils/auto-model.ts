import type { LLMModel } from "../client/api";
import type { ServiceProvider } from "../constant";
import type { AutoModelSeriesKey } from "../store/config";
import { AIHUBMIX_PREFERRED_OPENAI_CHAT_MODEL_NAME } from "./model";

const CUSTOM_SERVICE_PROVIDER = "Custom";

type SortableModelLike = {
  name?: string;
  publishedAt?: number;
  sorted?: number;
  order?: number;
};

type AccessProfileLike = {
  name: string;
  provider: ServiceProvider;
  enabled: boolean;
  baseUrl?: string;
};

export type AutoModelCandidate = {
  series: AutoModelSeriesKey;
  model: string;
  providerName: ServiceProvider;
  providerId: string;
  displayName: string;
  providerDisplayName: string;
};

type AutoModelInput = Omit<LLMModel, "provider"> & {
  provider?: LLMModel["provider"];
};

const SERIES_LABELS: Record<AutoModelSeriesKey, string> = {
  gpt: "GPT系列",
  deepseek: "DeepSeek系列",
  doubao: "豆包系列",
};

const SERIES_ORDER: AutoModelSeriesKey[] = ["gpt", "deepseek", "doubao"];
const autoModelCandidateCache = new WeakMap<
  AutoModelInput[],
  Map<string, AutoModelCandidate[]>
>();

export const AUTO_MODEL_WHITELIST = [
  "gpt",
  "llm",
  "chat",
  "chatbot",
  "instruct",
  "instruction",
  "dialog",
  "conversation",
  "language-model",
  "large-language-model",
  "text-generation",
  "text-gen",
  "text2text",
  "completion",
  "prompt",
  "reasoning",
  "reasoner",
  "qa",
  "question-answering",
  "summarization",
  "translation",
  "nlp",
  "natural-language",
  "claude",
  "gemini",
  "llama",
  "qwen",
  "mistral",
  "mixtral",
  "deepseek",
  "doubao",
  "command-r",
  "ernie",
  "chatglm",
  "spark",
  "yi",
  "baichuan",
  "internlm",
] as const;

export const AUTO_MODEL_BLACKLIST = [
  "image",
  "vision",
  "visual",
  "diffusion",
  "stable-diffusion",
  "sd",
  "sdxl",
  "dalle",
  "dall-e",
  "imagen",
  "midjourney",
  "seedream",
  "seedance",
  "jimeng",
  "inpainting",
  "outpainting",
  "super-resolution",
  "upscaler",
  "pixel",
  "pixelcnn",
  "vae",
  "vq-vae",
  "gan",
  "stylegan",
  "cyclegan",
  "3d",
  "nerf",
  "gaussian",
  "gaussian-splatting",
  "3dgs",
  "mesh",
  "point-cloud",
  "spatial",
  "scene",
  "cnn",
  "resnet",
  "vgg",
  "yolo",
  "ssd",
  "r-cnn",
  "rcnn",
  "detection",
  "segmentation",
  "sam",
  "mask",
  "vit",
  "pose",
  "keypoint",
  "video",
  "text-to-video",
  "video-generation",
  "animation",
  "motion",
  "frame",
  "interpolation",
  "tracking",
  "realtime",
  "i2v",
  "v2v",
  "veo",
  "sora",
  "runway",
  "pika",
  "gen-3",
  "audio",
  "speech",
  "voice",
  "vocal",
  "tts",
  "stt",
  "asr",
  "music",
  "sound",
  "whisper",
  "voice-cloning",
  "transcribe",
  "transcription",
  "vocoder",
  "hifi-gan",
  "wave",
  "wavenet",
  "spectrogram",
  "midi",
  "melody",
  "embedding",
  "embeddings",
  "embed",
  "embedder",
  "feature-extraction",
  "representation",
  "vector",
  "vectorization",
  "dense-retrieval",
  "sentence-transformer",
  "sbert",
  "bge",
  "e5",
  "gte",
  "nomic-embed",
  "rank",
  "ranking",
  "ranker",
  "rerank",
  "reranker",
  "sort",
  "sorting",
  "cross-encoder",
  "reward-model",
  "colbert",
  "score",
  "scorer",
  "similarity",
  "semantic-similarity",
  "semantic-search",
  "bi-encoder",
  "dual-encoder",
  "contrastive",
  "nli",
  "retrieval",
  "retriever",
  "classifier",
  "classification",
  "sentiment",
  "ner",
  "recommendation",
  "ctr",
  "prediction",
  "forecasting",
  "regression",
  "agent",
  "tool-use",
  "function-calling",
  "robotics",
  "embodied",
  "control",
  "navigation",
  "workflow",
  "automation",
  "code",
  "coding",
  "codex",
  "copilot",
  "programming",
  "dev",
  "codegen",
  "coder",
  "moderation",
  "guard",
  "safety",
  "detector",
  "research",
  "search",
  "multimodal",
  "vision-language",
  "vlm",
  "omni",
  "audio-visual",
  "cross-modal",
  "pro",
] as const;

export function getAutoModelSeriesLabel(series: AutoModelSeriesKey) {
  return SERIES_LABELS[series];
}

export function normalizeAutoModelSeries(
  series: AutoModelSeriesKey[] | undefined,
): AutoModelSeriesKey[] {
  const set = new Set<AutoModelSeriesKey>((series || []).filter(Boolean));
  const selected = SERIES_ORDER.find((item) => set.has(item));
  return selected ? [selected] : [];
}

function getProviderIdFromProfile(profile: AccessProfileLike) {
  return profile.provider === CUSTOM_SERVICE_PROVIDER
    ? `custom_${profile.name}`.toLowerCase()
    : String(profile.provider).toLowerCase();
}

function isAiHubMixProviderId(providerId: string | undefined) {
  return String(providerId || "").toLowerCase() === "custom_aihubmix";
}

function buildAutoModelCandidateCacheKey(
  profiles: AccessProfileLike[],
  enabledSeries: AutoModelSeriesKey[],
) {
  return [
    normalizeAutoModelSeries(enabledSeries).join(","),
    profiles
      .map((profile) =>
        [
          profile.name,
          profile.provider,
          profile.enabled ? "1" : "0",
          profile.baseUrl ? "1" : "0",
        ].join(":"),
      )
      .join("|"),
  ].join("::");
}

function normalizeKeywordText(text: string) {
  return text.toLowerCase().trim();
}

function tokenizeKeywordText(text: string) {
  return normalizeKeywordText(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasKeyword(text: string, keyword: string) {
  const normalizedText = normalizeKeywordText(text);
  const normalizedKeyword = normalizeKeywordText(keyword);

  if (
    normalizedKeyword.includes("-") ||
    normalizedKeyword.includes(" ") ||
    /\d/.test(normalizedKeyword)
  ) {
    return normalizedText.includes(normalizedKeyword);
  }

  const tokens = tokenizeKeywordText(normalizedText);
  return tokens.includes(normalizedKeyword);
}

function hasAnyKeyword(text: string, keywords: readonly string[]) {
  return keywords.some((keyword) => hasKeyword(text, keyword));
}

function isModelUsable(model: AutoModelInput) {
  return !!model.available;
}

function matchModelSeries(
  model: AutoModelInput,
): AutoModelSeriesKey | undefined {
  const nameText = `${model.name} ${model.displayName || ""}`.toLowerCase();
  const vendorText = `${model.vendor?.name || ""}`.toLowerCase();
  const providerText = `${model.provider?.providerName || ""}`.toLowerCase();
  const combinedText = `${nameText} ${vendorText} ${providerText}`;

  if (nameText.includes("aihubmix")) {
    return undefined;
  }

  if (
    vendorText.includes("bytedance") ||
    vendorText.includes("doubao") ||
    vendorText.includes("字节")
  ) {
    return "doubao";
  }

  if (vendorText.includes("deepseek") || vendorText.includes("deep-seek")) {
    return "deepseek";
  }

  if (
    vendorText.includes("openai") ||
    vendorText.includes("chatgpt") ||
    providerText.includes("openai")
  ) {
    return "gpt";
  }

  if (
    combinedText.includes("doubao") ||
    combinedText.includes("bytedance") ||
    combinedText.includes("字节")
  ) {
    return "doubao";
  }

  if (combinedText.includes("deepseek") || combinedText.includes("deep-seek")) {
    return "deepseek";
  }

  if (
    combinedText.includes("gpt") ||
    combinedText.includes("chatgpt") ||
    combinedText.includes("openai") ||
    /^o[1345](?:$|[^a-z])/i.test(model.name)
  ) {
    return "gpt";
  }

  return undefined;
}

function isMiniModel(model: AutoModelInput) {
  return (
    /\bmini\b/i.test(model.name) ||
    /\bmini\b/i.test(String(model.displayName || ""))
  );
}

function isLiteModel(model: AutoModelInput) {
  return (
    /\blite\b/i.test(model.name) ||
    /\blite\b/i.test(String(model.displayName || ""))
  );
}

function isNanoModel(model: AutoModelInput) {
  return (
    /\bnano\b/i.test(model.name) ||
    /\bnano\b/i.test(String(model.displayName || ""))
  );
}

type OfficialGptModelInfo = {
  major: number;
  minor: number;
  tier: "main" | "mini" | "nano";
};

type OfficialDeepSeekModelInfo = {
  family: "v" | "chat" | "reasoner" | "r1";
  major: number;
  minor: number;
};

type OfficialDoubaoModelInfo = {
  family: "seed-main" | "seed-mini" | "legacy-lite";
  major: number;
  minor: number;
};

function parseOfficialGptModel(name: string): OfficialGptModelInfo | undefined {
  const match = name
    .toLowerCase()
    .match(
      /^gpt-(\d+)(?:\.(\d+))?(?:-(mini|nano))?(?:-(?:20\d{2}-\d{2}-\d{2}|\d{6}|\d{8}))?$/,
    );
  if (!match) return undefined;

  return {
    major: Number(match[1] || 0),
    minor: Number(match[2] || 0),
    tier: (match[3] as "mini" | "nano" | undefined) || "main",
  };
}

function parseOfficialDeepSeekModel(
  name: string,
): OfficialDeepSeekModelInfo | undefined {
  const normalized = name.toLowerCase();

  if (
    normalized.includes("/") ||
    normalized.includes(":") ||
    normalized.includes("ocr") ||
    normalized.includes("vl") ||
    normalized.includes("vision") ||
    normalized.includes("distill") ||
    normalized.includes("chimera") ||
    normalized.includes("zero") ||
    normalized.includes("speciale") ||
    normalized.includes("fast") ||
    normalized.includes("think") ||
    normalized.includes("thinking") ||
    normalized.includes("terminus") ||
    normalized.includes("exp") ||
    normalized.includes("search") ||
    normalized.startsWith("azure-") ||
    normalized.startsWith("alicloud-") ||
    normalized.startsWith("daocloud-") ||
    normalized.startsWith("cc-") ||
    normalized.startsWith("mai-")
  ) {
    return undefined;
  }

  const vMatch = normalized.match(
    /^deepseek-v(\d+)(?:\.(\d+))?(?:-(?:20\d{2}-\d{2}-\d{2}|\d{6}|\d{8}))?$/,
  );
  if (vMatch) {
    return {
      family: "v",
      major: Number(vMatch[1] || 0),
      minor: Number(vMatch[2] || 0),
    };
  }

  const chatMatch = normalized.match(
    /^deepseek-chat(?:-(?:20\d{2}-\d{2}-\d{2}|\d{4}|\d{6}|\d{8}))?$/,
  );
  if (chatMatch) {
    return {
      family: "chat",
      major: 0,
      minor: 0,
    };
  }

  const reasonerMatch = normalized.match(
    /^deepseek-reasoner(?:-(?:20\d{2}-\d{2}-\d{2}|\d{4}|\d{6}|\d{8}))?$/,
  );
  if (reasonerMatch) {
    return {
      family: "reasoner",
      major: 0,
      minor: 0,
    };
  }

  const r1Match = normalized.match(
    /^deepseek-r1(?:-(?:20\d{2}-\d{2}-\d{2}|\d{4}|\d{6}|\d{8}))?$/,
  );
  if (r1Match) {
    return {
      family: "r1",
      major: 1,
      minor: 0,
    };
  }

  return undefined;
}

function parseOfficialDoubaoModel(
  name: string,
): OfficialDoubaoModelInfo | undefined {
  const normalized = name.toLowerCase();

  if (
    normalized.includes("seededit") ||
    normalized.includes("flash") ||
    normalized.includes("thinking") ||
    normalized.includes("nothinking")
  ) {
    return undefined;
  }

  const seedMatch = normalized.match(
    /^doubao[-_.\/\s]*seed[-_.\/\s]*(\d+)(?:[-_.\/\s]+(\d+))?(?:[-_.\/\s]+(lite|mini))?(?:[-_.](?:20\d{2}[-_.]?(?:0[1-9]|1[0-2])[-_.]?(?:0[1-9]|[12]\d|3[01])|\d{6}|\d{8}))?$/i,
  );
  if (seedMatch) {
    const tier = (seedMatch[3] || "").toLowerCase();
    return {
      family: tier === "mini" ? "seed-mini" : "seed-main",
      major: Number(seedMatch[1] || 0),
      minor: Number(seedMatch[2] || 0),
    };
  }

  if (/^doubao[-_.]?lite(?:[-_.].+)?$/i.test(name)) {
    return {
      family: "legacy-lite",
      major: 0,
      minor: 0,
    };
  }

  if (/^doubao[-_.]?1[-_.]?5[-_.]?lite(?:[-_.].+)?$/i.test(name)) {
    return {
      family: "legacy-lite",
      major: 0,
      minor: 0,
    };
  }

  return undefined;
}

function getModelKeywordText(model: AutoModelInput) {
  return `${model.name} ${model.displayName || ""}`;
}

function isStrictDoubaoModel(model: AutoModelInput) {
  const text = getModelKeywordText(model).toLowerCase();
  return text.includes("doubao");
}

export function isAutoModelNameAllowed(model: AutoModelInput) {
  const text = getModelKeywordText(model);
  const whitelistMatched =
    hasAnyKeyword(text, AUTO_MODEL_WHITELIST) || !!matchModelSeries(model);
  return whitelistMatched && !hasAnyKeyword(text, AUTO_MODEL_BLACKLIST);
}

export function matchAutoModelSeries(
  model: AutoModelInput,
): AutoModelSeriesKey | undefined {
  return matchModelSeries(model);
}

function normalizeSnapshotAlias(name: string) {
  return name
    .toLowerCase()
    .replace(
      /(?:[-_.](?:20\d{2}[-_.]?(?:0[1-9]|1[0-2])[-_.]?(?:0[1-9]|[12]\d|3[01])|\d{6}|\d{8}))+/g,
      "",
    )
    .replace(/[-_.]+$/g, "");
}

function hasSnapshotDateSuffix(name: string) {
  return /(?:[-_.](?:20\d{2}[-_.]?(?:0[1-9]|1[0-2])[-_.]?(?:0[1-9]|[12]\d|3[01])|\d{6}|\d{8}))+$/i.test(
    name,
  );
}

function comparePublishedAt(
  left?: SortableModelLike,
  right?: SortableModelLike,
) {
  const leftPublishedAt = left?.publishedAt ?? 0;
  const rightPublishedAt = right?.publishedAt ?? 0;
  if (rightPublishedAt !== leftPublishedAt) {
    return rightPublishedAt - leftPublishedAt;
  }

  const leftSorted = left?.order ?? left?.sorted ?? Number.MAX_SAFE_INTEGER;
  const rightSorted = right?.order ?? right?.sorted ?? Number.MAX_SAFE_INTEGER;
  if (leftSorted !== rightSorted) {
    return leftSorted - rightSorted;
  }

  return String(left?.name || "").localeCompare(String(right?.name || ""));
}

function getDoubaoSeedVersion(name: string) {
  const match = name
    .toLowerCase()
    .match(/\bdoubao[-_.\/\s]*seed[-_.\/\s]*(\d+)(?:[-_.\/\s]+(\d+))?\b/);
  if (!match) return undefined;
  return {
    major: Number(match[1] || 0),
    minor: Number(match[2] || 0),
  };
}

function getDoubaoAutoTier(name: string) {
  const normalized = name.toLowerCase();
  if (!normalized.includes("doubao")) return 0;
  if (
    /\bdoubao[-_.\/\s]*seed[-_.\/\s]*(\d+)(?:[-_.\/\s]+(\d+))?[-_.\/\s]+mini\b/i.test(
      normalized,
    )
  ) {
    return 3;
  }
  if (
    /\bdoubao[-_.\/\s]*seed[-_.\/\s]*(\d+)(?:[-_.\/\s]+(\d+))?[-_.\/\s]+lite\b/i.test(
      normalized,
    )
  ) {
    return 4;
  }
  if (
    /\bdoubao[-_.\/\s]*seed[-_.\/\s]*(\d+)(?:[-_.\/\s]+(\d+))?\b/i.test(
      normalized,
    )
  ) {
    return 2;
  }
  if (normalized.includes("doubao-lite")) {
    return 1;
  }
  return 0;
}

function compareAutoModelPriority(a: AutoModelInput, b: AutoModelInput) {
  const aDoubaoTier = getDoubaoAutoTier(a.name);
  const bDoubaoTier = getDoubaoAutoTier(b.name);
  if (aDoubaoTier !== 0 || bDoubaoTier !== 0) {
    const tierDiff = bDoubaoTier - aDoubaoTier;
    if (tierDiff !== 0) {
      return tierDiff;
    }
  }

  const aDoubaoVersion = getDoubaoSeedVersion(a.name);
  const bDoubaoVersion = getDoubaoSeedVersion(b.name);
  if (aDoubaoVersion && bDoubaoVersion) {
    const majorDiff = bDoubaoVersion.major - aDoubaoVersion.major;
    if (majorDiff !== 0) {
      return majorDiff;
    }

    const minorDiff = bDoubaoVersion.minor - aDoubaoVersion.minor;
    if (minorDiff !== 0) {
      return minorDiff;
    }
  }

  const aPublishedAt = a.publishedAt ?? 0;
  const bPublishedAt = b.publishedAt ?? 0;
  const publishedDiff = bPublishedAt - aPublishedAt;
  if (publishedDiff !== 0) {
    return publishedDiff;
  }

  const aBase = normalizeSnapshotAlias(a.name);
  const bBase = normalizeSnapshotAlias(b.name);
  if (aBase === bBase) {
    const aSnapshot = hasSnapshotDateSuffix(a.name);
    const bSnapshot = hasSnapshotDateSuffix(b.name);
    if (aSnapshot !== bSnapshot) {
      return aSnapshot ? 1 : -1;
    }
  }

  return 0;
}

function isEligibleSeriesModel(
  model: AutoModelInput,
  series: AutoModelSeriesKey,
) {
  if (!isModelUsable(model)) return false;
  if (
    `${model.name} ${model.displayName || ""}`
      .toLowerCase()
      .includes("aihubmix")
  ) {
    return false;
  }
  if (matchModelSeries(model) !== series) return false;
  if (!isAutoModelNameAllowed(model)) return false;
  if (series === "gpt" && !parseOfficialGptModel(model.name)) return false;
  if (series === "deepseek" && !parseOfficialDeepSeekModel(model.name)) {
    return false;
  }
  if (
    series === "doubao" &&
    (!isStrictDoubaoModel(model) || !parseOfficialDoubaoModel(model.name))
  ) {
    return false;
  }
  return true;
}

function pickLatestSeriesModels(
  models: AutoModelInput[],
  series: AutoModelSeriesKey,
) {
  const sortModels = (items: AutoModelInput[]) =>
    items.slice().sort((a, b) => {
      const priorityDiff = compareAutoModelPriority(a, b);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return comparePublishedAt(a, b);
    });

  const seriesModels = sortModels(
    models.filter((model) => isEligibleSeriesModel(model, series)),
  );

  const pickLatestBy = (matcher: (model: AutoModelInput) => boolean) =>
    sortModels(seriesModels.filter(matcher))[0];
  const pickOrderedBy = (matcher: (model: AutoModelInput) => boolean) =>
    sortModels(seriesModels.filter(matcher));

  if (series === "gpt") {
    const officialSeriesModels = seriesModels
      .map((model) => ({
        model,
        info: parseOfficialGptModel(model.name),
      }))
      .filter(
        (
          item,
        ): item is {
          model: AutoModelInput;
          info: OfficialGptModelInfo;
        } => !!item.info,
      );

    if (officialSeriesModels.length === 0) {
      return {
        latestModels: [],
        seriesModels,
      };
    }

    const latestVersion = officialSeriesModels
      .map((item) => item.info)
      .sort((a, b) => {
        if (b.major !== a.major) {
          return b.major - a.major;
        }
        return b.minor - a.minor;
      })[0];

    const sameVersionModels = officialSeriesModels
      .filter(
        ({ info }) =>
          info.major === latestVersion.major &&
          info.minor === latestVersion.minor,
      )
      .map(({ model }) => model);

    const latestMain = sortModels(
      sameVersionModels.filter(
        (model) => parseOfficialGptModel(model.name)?.tier === "main",
      ),
    )[0];
    const latestMini = sortModels(
      sameVersionModels.filter(
        (model) => parseOfficialGptModel(model.name)?.tier === "mini",
      ),
    )[0];
    const latestNano = sortModels(
      sameVersionModels.filter(
        (model) => parseOfficialGptModel(model.name)?.tier === "nano",
      ),
    )[0];

    return {
      latestModels: [latestMain, latestMini, latestNano].filter(
        Boolean,
      ) as AutoModelInput[],
      seriesModels,
    };
  }

  if (series === "deepseek") {
    const officialSeriesModels = seriesModels
      .map((model) => ({
        model,
        info: parseOfficialDeepSeekModel(model.name),
      }))
      .filter(
        (
          item,
        ): item is {
          model: AutoModelInput;
          info: OfficialDeepSeekModelInfo;
        } => !!item.info,
      );

    if (officialSeriesModels.length === 0) {
      return {
        latestModels: [],
        seriesModels,
      };
    }

    const versionModels = officialSeriesModels
      .filter(({ info }) => info.family === "v")
      .sort((a, b) => {
        if (b.info.major !== a.info.major) {
          return b.info.major - a.info.major;
        }
        if (b.info.minor !== a.info.minor) {
          return b.info.minor - a.info.minor;
        }
        return comparePublishedAt(a.model, b.model);
      });

    const latestVersion = versionModels[0]?.info;
    const latestVersionModel = latestVersion
      ? sortModels(
          versionModels
            .filter(
              ({ info }) =>
                info.major === latestVersion.major &&
                info.minor === latestVersion.minor,
            )
            .map(({ model }) => model),
        )[0]
      : undefined;

    const latestChat = sortModels(
      officialSeriesModels
        .filter(({ info }) => info.family === "chat")
        .map(({ model }) => model),
    )[0];
    const latestReasoner = sortModels(
      officialSeriesModels
        .filter(({ info }) => info.family === "reasoner")
        .map(({ model }) => model),
    )[0];
    const latestR1 = sortModels(
      officialSeriesModels
        .filter(({ info }) => info.family === "r1")
        .map(({ model }) => model),
    )[0];

    return {
      latestModels: [
        latestVersionModel,
        latestChat,
        latestReasoner,
        latestR1,
      ].filter(Boolean) as AutoModelInput[],
      seriesModels,
    };
  }

  const shouldTreatLiteAsMain = series === "doubao";

  const mainMatcher = (model: AutoModelInput) =>
    !isMiniModel(model) &&
    !isNanoModel(model) &&
    (shouldTreatLiteAsMain || !isLiteModel(model));
  const miniMatcher = (model: AutoModelInput) => isMiniModel(model);
  const liteMatcher = (model: AutoModelInput) => isLiteModel(model);
  const nanoMatcher = (model: AutoModelInput) => isNanoModel(model);

  const latestMain = pickLatestBy(mainMatcher);
  const latestMini = pickLatestBy(miniMatcher);
  const latestLite = shouldTreatLiteAsMain
    ? undefined
    : pickLatestBy(liteMatcher);
  const latestNano = pickLatestBy(nanoMatcher);

  if (series === "doubao") {
    const orderedMain = pickOrderedBy(mainMatcher);
    const orderedMini = pickOrderedBy(miniMatcher);

    return {
      latestModels: [...orderedMain, ...orderedMini],
      seriesModels,
    };
  }

  return {
    latestModels: [latestMain, latestMini, latestLite, latestNano].filter(
      Boolean,
    ) as AutoModelInput[],
    seriesModels,
  };
}

function pickPreferredOpenAIAutoModels(
  models: AutoModelInput[],
  providerId: string,
) {
  const { latestModels } = pickLatestSeriesModels(models, "gpt");

  if (isAiHubMixProviderId(providerId)) {
    const preferred = models.find(
      (model) =>
        isModelUsable(model) &&
        model.name === AIHUBMIX_PREFERRED_OPENAI_CHAT_MODEL_NAME,
    );

    return preferred ? [preferred] : [];
  }

  return latestModels.slice(0, 1);
}

export function buildAutoModelCandidates(
  allModels: AutoModelInput[],
  profiles: AccessProfileLike[],
  enabledSeries: AutoModelSeriesKey[],
): AutoModelCandidate[] {
  const normalizedSeries = normalizeAutoModelSeries(enabledSeries);
  if (normalizedSeries.length === 0) return [];

  const cacheKey = buildAutoModelCandidateCacheKey(profiles, normalizedSeries);
  const cachedByModels = autoModelCandidateCache.get(allModels);
  const cachedCandidates = cachedByModels?.get(cacheKey);
  if (cachedCandidates) {
    return cachedCandidates;
  }

  const activeProfiles = profiles.filter(
    (profile) =>
      profile.provider !== CUSTOM_SERVICE_PROVIDER || !!profile.baseUrl,
  );
  const candidates: AutoModelCandidate[] = [];
  const seen = new Set<string>();

  activeProfiles.forEach((profile) => {
    const providerId = getProviderIdFromProfile(profile);
    const providerModels = allModels.filter(
      (model) => String(model.provider?.id || "").toLowerCase() === providerId,
    );

    normalizedSeries.forEach((series) => {
      const latestModels =
        series === "gpt"
          ? pickPreferredOpenAIAutoModels(providerModels, providerId)
          : pickLatestSeriesModels(providerModels, series).latestModels;

      latestModels.forEach((model) => {
        const modelProviderId = String(model.provider?.id || "").toLowerCase();
        const providerName = model.provider?.providerName as
          | ServiceProvider
          | undefined;

        if (
          !modelProviderId ||
          !providerName ||
          modelProviderId !== providerId
        ) {
          return;
        }

        const key = `${series}:${model.name}:${modelProviderId}`;
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push({
          series,
          model: model.name,
          providerName,
          providerId: modelProviderId,
          displayName: model.displayName || model.name,
          providerDisplayName: profile.name || String(providerName),
        });
      });
    });
  });

  if (cachedByModels) {
    cachedByModels.set(cacheKey, candidates);
  } else {
    autoModelCandidateCache.set(allModels, new Map([[cacheKey, candidates]]));
  }

  return candidates;
}
