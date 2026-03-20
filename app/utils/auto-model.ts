import { LLMModel } from "../client/api";
import { ServiceProvider } from "../constant";
import { comparePublishedAt } from "./model-published-at";
import { AutoModelSeriesKey } from "../store/config";

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

const NON_CHAT_NAME_PATTERN =
  /(research|realtime|audio|transcribe|tts|speech|embedding|moderation|image|video|search|omni-moderation|whisper|dall-e|dalle)/i;

const EXCLUDED_NAME_PATTERN = /(research|(?:^|[-_.])(pro)(?:$|[-_.]))/i;

export function getAutoModelSeriesLabel(series: AutoModelSeriesKey) {
  return SERIES_LABELS[series];
}

export function normalizeAutoModelSeries(
  series: AutoModelSeriesKey[] | undefined,
): AutoModelSeriesKey[] {
  const set = new Set<AutoModelSeriesKey>((series || []).filter(Boolean));
  return SERIES_ORDER.filter((item) => set.has(item));
}

function getProviderIdFromProfile(profile: AccessProfileLike) {
  return profile.provider === ServiceProvider.Custom
    ? `custom_${profile.name}`.toLowerCase()
    : String(profile.provider).toLowerCase();
}

function isModelUsable(model: AutoModelInput) {
  if (!model.available) return false;
  const category = String(model.category || "").toLowerCase();
  const categories = Array.isArray(model.categories)
    ? model.categories.map((item) => String(item).toLowerCase())
    : [];
  if (
    category === "image" ||
    category === "video" ||
    categories.includes("image") ||
    categories.includes("video")
  ) {
    return false;
  }
  return true;
}

function matchModelSeries(
  model: AutoModelInput,
): AutoModelSeriesKey | undefined {
  const text = `${model.name} ${model.displayName || ""} ${
    model.vendor?.name || ""
  } ${model.provider?.providerName || ""}`.toLowerCase();

  if (
    text.includes("doubao") ||
    text.includes("bytedance") ||
    text.includes("字节")
  ) {
    return "doubao";
  }

  if (text.includes("deepseek") || text.includes("deep-seek")) {
    return "deepseek";
  }

  if (
    text.includes("gpt") ||
    text.includes("chatgpt") ||
    text.includes("openai") ||
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

function isEligibleSeriesModel(
  model: AutoModelInput,
  series: AutoModelSeriesKey,
) {
  if (!isModelUsable(model)) return false;
  if (matchModelSeries(model) !== series) return false;
  if (NON_CHAT_NAME_PATTERN.test(model.name)) return false;
  if (EXCLUDED_NAME_PATTERN.test(model.name)) return false;
  return true;
}

function pickLatestSeriesModels(
  models: AutoModelInput[],
  series: AutoModelSeriesKey,
) {
  const seriesModels = models
    .filter((model) => isEligibleSeriesModel(model, series))
    .slice()
    .sort((a, b) => comparePublishedAt(a, b));

  const latestMain = seriesModels.find((model) => !isMiniModel(model));
  const latestMini = seriesModels.find((model) => isMiniModel(model));

  return {
    latestModelNames: [latestMain?.name, latestMini?.name].filter(
      Boolean,
    ) as string[],
    seriesModels,
  };
}

export function buildAutoModelCandidates(
  allModels: AutoModelInput[],
  profiles: AccessProfileLike[],
  enabledSeries: AutoModelSeriesKey[],
): AutoModelCandidate[] {
  const normalizedSeries = normalizeAutoModelSeries(enabledSeries);
  if (normalizedSeries.length === 0) return [];

  const enabledProfiles = profiles.filter(
    (profile) =>
      profile.enabled &&
      (profile.provider !== ServiceProvider.Custom || !!profile.baseUrl),
  );
  const providerIdSet = new Set(
    enabledProfiles.map((profile) => getProviderIdFromProfile(profile)),
  );
  const providerDisplayNameMap = new Map(
    enabledProfiles.map((profile) => [
      getProviderIdFromProfile(profile),
      profile.name || profile.provider,
    ]),
  );
  const candidates: AutoModelCandidate[] = [];
  const seen = new Set<string>();

  normalizedSeries.forEach((series) => {
    const { latestModelNames, seriesModels } = pickLatestSeriesModels(
      allModels,
      series,
    );

    latestModelNames.forEach((modelName) => {
      seriesModels
        .filter((item) => item.name === modelName)
        .forEach((model) => {
          const providerId = String(model.provider?.id || "").toLowerCase();
          const providerName = model.provider?.providerName as
            | ServiceProvider
            | undefined;

          if (!providerId || !providerName || !providerIdSet.has(providerId)) {
            return;
          }

          const key = `${series}:${model.name}:${providerId}`;
          if (seen.has(key)) return;
          seen.add(key);
          candidates.push({
            series,
            model: model.name,
            providerName,
            providerId,
            displayName: model.displayName || model.name,
            providerDisplayName:
              providerDisplayNameMap.get(providerId) || String(providerName),
          });
        });
    });
  });

  return candidates;
}
