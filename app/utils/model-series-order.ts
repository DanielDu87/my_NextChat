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

type ModelNameToken =
  | { type: "number"; value: number }
  | { type: "text"; value: string };

function tokenizeModelName(modelName: string): ModelNameToken[] {
  return Array.from(
    modelName.toLowerCase().matchAll(/\d+|[\p{L}]+/gu),
    ([value]) =>
      /^\d+$/.test(value)
        ? { type: "number" as const, value: Number(value) }
        : { type: "text" as const, value },
  );
}

/**
 * 模型名按自然分段逐项比较：文字逐字符升序，处于相同位置的数字降序。
 * 因此 claude-3-7 会排在 claude-3-5 前，alpha 会排在 beta 前，
 * 且第二段、第三段文字或数字都不会被第一段相同值掩盖。
 */
function compareTokenizedModelNames(leftName: string, rightName: string) {
  const leftTokens = tokenizeModelName(leftName);
  const rightTokens = tokenizeModelName(rightName);
  const length = Math.max(leftTokens.length, rightTokens.length);

  for (let index = 0; index < length; index += 1) {
    const left = leftTokens[index];
    const right = rightTokens[index];
    if (!left || !right) {
      if (!left && right?.type === "number") return 1;
      if (!right && left?.type === "number") return -1;
      return left ? 1 : right ? -1 : 0;
    }

    if (left.type === "number" && right.type === "number") {
      const numberDiff = right.value - left.value;
      if (numberDiff !== 0) return numberDiff;
      continue;
    }

    if (left.type === "text" && right.type === "text") {
      const textDiff = modelNameCollator.compare(left.value, right.value);
      if (textDiff !== 0) return textDiff;
      continue;
    }

    // 同一文字前缀下，直接以版本号开始的标准模型排在附加文字系列之前。
    return left.type === "number" ? -1 : 1;
  }

  return modelNameCollator.compare(leftName, rightName);
}

export function compareModelsWithinSeries(
  left: ModelSeriesOrderLike,
  right: ModelSeriesOrderLike,
) {
  const leftName = getModelName(left);
  const rightName = getModelName(right);
  return compareTokenizedModelNames(leftName, rightName);
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
