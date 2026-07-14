import { compareModelsForDisplay } from "./model-published-at";

export type ModelSeriesOrderLike = {
  name?: string;
  model?: string;
  displayName?: string;
  publishedAt?: number;
};

const modelNameCollator = new Intl.Collator("zh-CN-u-co-pinyin", {
  usage: "sort",
  sensitivity: "base",
  numeric: true,
});

const MODEL_SERIES_RULES: Array<[string, RegExp]> = [
  ["gpt", /(?:^|[^a-z0-9])(?:chatgpt|gpt)(?:$|[^a-z])/i],
  ["openai-o", /(?:^|[^a-z0-9])o[1345](?:$|[^a-z0-9])/i],
  ["claude", /(?:^|[^a-z0-9])claude(?:$|[^a-z])/i],
  ["gemini", /(?:^|[^a-z0-9])gemini(?:$|[^a-z])/i],
  ["deepseek", /(?:^|[^a-z0-9])deep[-_.]?seek(?:$|[^a-z])/i],
  ["doubao", /(?:^|[^a-z0-9])doubao(?:$|[^a-z])/i],
  ["qwen", /(?:^|[^a-z0-9])qwen(?:$|[^a-z])/i],
  ["llama", /(?:^|[^a-z0-9])llama(?:$|[^a-z])/i],
  ["mistral", /(?:^|[^a-z0-9])mistral(?:$|[^a-z])/i],
  ["mixtral", /(?:^|[^a-z0-9])mixtral(?:$|[^a-z])/i],
  ["command-r", /(?:^|[^a-z0-9])command[-_.]?r(?:$|[^a-z])/i],
  ["ernie", /(?:^|[^a-z0-9])ernie(?:$|[^a-z])/i],
  ["chatglm", /(?:^|[^a-z0-9])chat[-_.]?glm(?:$|[^a-z])/i],
  ["glm", /(?:^|[^a-z0-9])glm(?:$|[^a-z])/i],
  ["spark", /(?:^|[^a-z0-9])spark(?:$|[^a-z])/i],
  ["baichuan", /(?:^|[^a-z0-9])baichuan(?:$|[^a-z])/i],
  ["internlm", /(?:^|[^a-z0-9])intern[-_.]?lm(?:$|[^a-z])/i],
  ["hunyuan", /(?:^|[^a-z0-9])hunyuan(?:$|[^a-z])/i],
  ["moonshot", /(?:^|[^a-z0-9])(?:moonshot|kimi)(?:$|[^a-z])/i],
  ["minimax", /(?:^|[^a-z0-9])minimax(?:$|[^a-z])/i],
];

const GENERIC_SERIES_STOP_WORDS = new Set([
  "api",
  "chat",
  "latest",
  "llm",
  "model",
  "text",
]);

function getModelName(model: ModelSeriesOrderLike) {
  return String(model.name || model.model || "");
}

export function getModelDisplaySeries(model: ModelSeriesOrderLike) {
  const modelName = getModelName(model);
  const seriesText = `${modelName} ${model.displayName || ""}`.toLowerCase();
  for (const [series, pattern] of MODEL_SERIES_RULES) {
    if (pattern.test(seriesText)) {
      return series;
    }
  }

  const baseName = modelName.split(/[/:]/).pop()?.toLowerCase();
  const genericSeries = baseName?.match(/^([a-z][a-z0-9]*)(?=[-_.]|\d)/)?.[1];
  return genericSeries && !GENERIC_SERIES_STOP_WORDS.has(genericSeries)
    ? genericSeries
    : undefined;
}

function getModelSeriesVersion(modelName: string) {
  const versionText = modelName.toLowerCase().match(/\d+(?:\.\d+)*/)?.[0];
  return versionText
    ? versionText.split(".").map((part) => Number(part) || 0)
    : undefined;
}

function compareVersionPartsDescending(left?: number[], right?: number[]) {
  if (!left || !right) {
    return left ? -1 : right ? 1 : 0;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (right[index] || 0) - (left[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function compareModelsWithinSeries(
  left: ModelSeriesOrderLike,
  right: ModelSeriesOrderLike,
) {
  const leftName = getModelName(left);
  const rightName = getModelName(right);
  const leftVersion = getModelSeriesVersion(leftName);
  const rightVersion = getModelSeriesVersion(rightName);
  const versionDiff = compareVersionPartsDescending(leftVersion, rightVersion);
  if (versionDiff !== 0) return versionDiff;

  if (leftVersion && rightVersion) {
    return modelNameCollator.compare(leftName, rightName);
  }

  const publishedAtDiff = compareModelsForDisplay(
    { name: leftName, publishedAt: left.publishedAt },
    { name: rightName, publishedAt: right.publishedAt },
  );
  return publishedAtDiff || modelNameCollator.compare(leftName, rightName);
}

export function compareModelsBySeriesVersion(
  left: ModelSeriesOrderLike,
  right: ModelSeriesOrderLike,
) {
  const leftName = getModelName(left);
  const rightName = getModelName(right);
  const leftSeries = getModelDisplaySeries(left);
  const rightSeries = getModelDisplaySeries(right);
  if (leftSeries !== rightSeries) {
    return modelNameCollator.compare(
      leftSeries || leftName,
      rightSeries || rightName,
    );
  }
  return compareModelsWithinSeries(left, right);
}

export function compareProviderDisplayNames(left: string, right: string) {
  return modelNameCollator.compare(left, right);
}
