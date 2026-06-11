export type ModelFetchKeySource = {
  apiKey?: string;
  modelFetchApiKey?: string;
  apiKeyGroups?: Record<string, string>;
  multiKeyGroupOrder?: string[];
};

function normalizeSecret(value: unknown) {
  return String(value || "").trim();
}

export function getModelFetchApiKeyCandidates(source: ModelFetchKeySource) {
  const groups = source.apiKeyGroups || {};
  const orderedGroupKeys = [
    ...(source.multiKeyGroupOrder || []),
    ...Object.keys(groups),
  ].filter((group, index, all) => group && all.indexOf(group) === index);

  const candidates = [
    source.modelFetchApiKey,
    source.apiKey,
    ...orderedGroupKeys.map((group) => groups[group]),
  ]
    .map(normalizeSecret)
    .filter(Boolean);

  return [...new Set(candidates)];
}

function normalizeModelBaseUrl(baseUrl: string) {
  const normalizedBaseUrl = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  return normalizedBaseUrl.replace(/\/v1$/i, "");
}

function getHostname(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isAiHubMixModelBaseUrl(baseUrl?: string) {
  return getHostname(baseUrl || "") === "aihubmix.com";
}

export function isYutoModelBaseUrl(baseUrl?: string) {
  return ["cn.gptapi.asia", "gptapi.asia"].includes(getHostname(baseUrl || ""));
}

export function isOcoolModelBaseUrl(baseUrl?: string) {
  return [
    "api.ocoolai.com",
    "one.ocoolai.com",
    "ocoolai.com",
    "one.ooo.cool",
  ].includes(getHostname(baseUrl || ""));
}

export function isToApisModelBaseUrl(baseUrl?: string) {
  return ["toapis.com", "www.toapis.com"].includes(getHostname(baseUrl || ""));
}

export const MODEL_FETCH_UPSTREAM_PATHS = [
  // OpenAI 官方和大多数 OpenAI-compatible 网关
  "/api/v1/models",
  "/models",
  "/v1/models",
  "/api/models",
  // 聚合商/计费型网关常见模型价格接口
  "/api/pricing",
  "/pricing",
  // Ocoolai / OneAPI 派生接口
  "/api/user/available_model",
  "/api/user/available_models",
  "/api/user/available_models_by_groups",
  "/api/user/available-models-by-groups",
  "/available_model",
  "/available_models",
  // 本地和开源 OpenAI-compatible 服务
  "/api/tags",
  "/v1/internal/model/list",
  "/internal/model/list",
  // 常见网关/面板命名
  "/api/v1/model/list",
  "/v1/model/list",
  "/api/model/list",
  "/model/list",
  "/api/v1/models/list",
  "/v1/models/list",
  "/api/models/list",
  "/models/list",
  "/api/v1/model/info",
  "/v1/model/info",
  "/api/model/info",
  "/model/info",
  // Azure / VMware 等兼容层
  "/openai/models",
  "/api/v1/compatibility/openai/v1/models",
] as const;

export const MODEL_FETCH_FIXED_UPSTREAM_URLS = [
  "https://one.ocoolai.com/api/user/available_models_by_groups",
] as const;

export const MODEL_FETCH_FIXED_PROXY_CANDIDATES = [
  {
    url: "/api/ocoolai/available-models-by-groups",
    upstreamUrl: "https://one.ocoolai.com/api/user/available_models_by_groups",
  },
] as const;

export function buildUpstreamModelFetchCandidateUrls(baseUrl: string) {
  const baseWithoutV1 = normalizeModelBaseUrl(baseUrl);
  return [
    ...MODEL_FETCH_UPSTREAM_PATHS.map((path) => `${baseWithoutV1}${path}`),
    ...MODEL_FETCH_FIXED_UPSTREAM_URLS,
  ].filter((url, index, all) => url && all.indexOf(url) === index);
}

export function buildProxyModelFetchCandidates(baseUrl?: string) {
  const candidates: Array<{
    url: string;
    upstreamPath: string;
    note?: string;
  }> = MODEL_FETCH_UPSTREAM_PATHS.map((path) => ({
    url: `/api/proxy${path}`,
    upstreamPath: path,
  }));
  candidates.push(
    ...MODEL_FETCH_FIXED_PROXY_CANDIDATES.map((candidate) => ({
      url: candidate.url,
      upstreamPath: candidate.upstreamUrl,
      note: "Ocoolai 固定分组模型接口",
    })),
  );

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}

export function isLocalModelProxyBaseUrl(baseUrl?: string) {
  if (!baseUrl) return false;
  if (baseUrl.startsWith("/api/")) return true;
  try {
    const url = new URL(baseUrl);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function buildModelFetchCandidateUrls(baseUrl: string) {
  return buildUpstreamModelFetchCandidateUrls(baseUrl);
}

export function buildProxyModelFetchCandidateUrls(baseUrl?: string) {
  return buildProxyModelFetchCandidates(baseUrl).map(
    (candidate) => candidate.url,
  );
}
