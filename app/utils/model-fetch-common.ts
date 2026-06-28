export type ModelFetchKeySource = {
  apiKey?: string;
  modelFetchApiKey?: string;
  apiKeyGroups?: Record<string, string>;
  multiKeyGroupOrder?: string[];
};

export type ApiProfileAuthType =
  | "bearer"
  | "x-api-key"
  | "api-key"
  | "x-goog-api-key"
  | "query-key"
  | "none";

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
  return ["aihubmix.com", "api.inferera.com"].includes(
    getHostname(baseUrl || ""),
  );
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
  // Anthropic / Cohere / Google 等原生模型列表常见路径
  "/v1/models?limit=1000",
  "/v1/models?page_size=1000",
  "/v1beta/models",
  "/v1/models:list",
  // OpenRouter endpoint 详情和聚合商/计费型网关常见接口
  "/api/v1/endpoints",
  "/api/pricing",
  "/pricing",
  // Ocoolai / OneAPI 派生接口
  "/api/user/available_model",
  "/api/user/available_models",
  "/api/user/available_models_by_groups",
  "/api/user/available-models-by-groups",
  "/api/user/available-models",
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

export function parseListConfig(value?: string | string[]) {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[\n,]/)
        .map((item) => item.trim());
  return rawItems
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) =>
      item.startsWith("/") || item.startsWith("http") ? item : `/${item}`,
    )
    .filter((item, index, all) => all.indexOf(item) === index);
}

export function parseExtraHeaders(value?: string | Record<string, string>) {
  if (!value) return {} as Record<string, string>;
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, headerValue]) => [
          key.trim(),
          String(headerValue || "").trim(),
        ])
        .filter(([key, headerValue]) => key && headerValue),
    );
  }

  const text = String(value || "").trim();
  if (!text) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parseExtraHeaders(parsed as Record<string, string>);
    }
  } catch {
    // 允许使用每行 `Header: value` 的轻量格式。
  }

  return Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(":");
        if (separator < 0) return ["", ""];
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim(),
        ];
      })
      .filter(([key, headerValue]) => key && headerValue),
  );
}

export function getAuthHeaderForType(authType?: ApiProfileAuthType) {
  switch (authType || "bearer") {
    case "x-api-key":
      return "x-api-key";
    case "api-key":
      return "api-key";
    case "x-goog-api-key":
      return "x-goog-api-key";
    case "none":
    case "query-key":
      return "";
    case "bearer":
    default:
      return "Authorization";
  }
}

export function buildAuthHeaders(
  apiKey?: string,
  authType?: ApiProfileAuthType,
) {
  const key = normalizeSecret(apiKey);
  const headerName = getAuthHeaderForType(authType);
  if (!key || !headerName) return {} as Record<string, string>;
  return {
    [headerName]: authType === "bearer" || !authType ? `Bearer ${key}` : key,
  };
}

export function appendAuthQueryParam(
  url: string,
  apiKey?: string,
  authType?: ApiProfileAuthType,
  authQueryParam?: string,
) {
  const key = normalizeSecret(apiKey);
  if ((authType || "bearer") !== "query-key" || !key) return url;
  const param = String(authQueryParam || "key").trim() || "key";
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}${encodeURIComponent(param)}=${encodeURIComponent(
    key,
  )}`;
}

export function getAuthorizationCandidates(
  apiKeys: string[],
  authType?: ApiProfileAuthType,
) {
  if ((authType || "bearer") === "query-key") return apiKeys;
  const headerName = getAuthHeaderForType(authType);
  if (!headerName) return [];
  return apiKeys.map((key) =>
    authType === "bearer" || !authType ? `Bearer ${key}` : key,
  );
}

export function buildUpstreamModelFetchCandidateUrls(
  baseUrl: string,
  customPaths?: string | string[],
) {
  const baseWithoutV1 = normalizeModelBaseUrl(baseUrl);
  return [...parseListConfig(customPaths), ...MODEL_FETCH_UPSTREAM_PATHS]
    .map((path) => (path.startsWith("http") ? path : `${baseWithoutV1}${path}`))
    .filter((url, index, all) => url && all.indexOf(url) === index);
}

export function buildProxyModelFetchCandidates(
  baseUrl?: string,
  customPaths?: string | string[],
) {
  const paths = [
    ...parseListConfig(customPaths),
    ...MODEL_FETCH_UPSTREAM_PATHS,
  ];
  const candidates: Array<{
    url: string;
    upstreamPath: string;
    note?: string;
  }> = paths.map((path) => ({
    url: path.startsWith("http")
      ? `/api/proxy${new URL(path).pathname}${new URL(path).search}`
      : `/api/proxy${path}`,
    upstreamPath: path,
  }));
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

export function buildModelFetchCandidateUrls(
  baseUrl: string,
  customPaths?: string | string[],
) {
  return buildUpstreamModelFetchCandidateUrls(baseUrl, customPaths);
}

export function buildProxyModelFetchCandidateUrls(
  baseUrl?: string,
  customPaths?: string | string[],
) {
  return buildProxyModelFetchCandidates(baseUrl, customPaths).map(
    (candidate) => candidate.url,
  );
}
