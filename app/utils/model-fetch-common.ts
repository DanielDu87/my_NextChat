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

// 候选模型接口大量不存在；短超时让失败路径尽快让位给下一个候选。
export const MODEL_FETCH_REQUEST_TIMEOUT_MS = 5_000;
export const MODEL_FETCH_SINGLE_ROUTE_TIMEOUT_MS = 15_000;
export const MODEL_FETCH_ROUTE_REVALIDATE_MS = 24 * 60 * 60_000;

export type ModelFetchRouteEntry<TEntry, TCandidate> = {
  entry: TEntry;
  cachedCandidate?: TCandidate;
};

export type ModelFetchRouteResult<TEntry, TCandidate, TResult> = {
  entry: TEntry;
  candidate: TCandidate;
  result: TResult;
  fromCache: boolean;
};

/**
 * 通用的模型路径探测调度器：每个凭据先复用自己的缓存路径，只有未命中的
 * 凭据才按候选路径逐轮并发探测；单个凭据成功后立即退出后续轮次。
 */
export async function fetchModelRoutesFast<TEntry, TCandidate, TResult>(
  routes: Array<ModelFetchRouteEntry<TEntry, TCandidate>>,
  candidates: TCandidate[],
  fetchCandidate: (
    entry: TEntry,
    candidate: TCandidate,
    context: {
      fromCache: boolean;
      candidateIndex: number;
      candidateTotal: number;
    },
  ) => Promise<TResult>,
  getCandidateKey: (candidate: TCandidate) => string = (candidate) =>
    String(candidate),
  options?: {
    getResultScore?: (result: TResult) => number;
    acceptCachedResult?: (entry: TEntry, result: TResult) => boolean;
    discoveryBatchSize?: number;
  },
) {
  const results: Array<ModelFetchRouteResult<TEntry, TCandidate, TResult>> = [];
  const cachedFailureReasons = new Map<string, number>();
  let cachedRejectedResultCount = 0;
  let unresolved = routes.map((route, index) => ({ ...route, index }));

  const cachedAttempts = await Promise.all(
    unresolved.map(async (route) => {
      if (route.cachedCandidate === undefined) return null;
      try {
        const result = await fetchCandidate(
          route.entry,
          route.cachedCandidate,
          {
            fromCache: true,
            candidateIndex: 0,
            candidateTotal: 1,
          },
        );
        if (
          options?.acceptCachedResult &&
          !options.acceptCachedResult(route.entry, result)
        ) {
          cachedRejectedResultCount += 1;
          return null;
        }
        return { route, result };
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : String(error || "未知错误");
        cachedFailureReasons.set(
          reason,
          (cachedFailureReasons.get(reason) || 0) + 1,
        );
        return null;
      }
    }),
  );
  const cachedSuccessIndexes = new Set<number>();
  cachedAttempts.forEach((attempt) => {
    if (!attempt) return;
    cachedSuccessIndexes.add(attempt.route.index);
    results.push({
      entry: attempt.route.entry,
      candidate: attempt.route.cachedCandidate!,
      result: attempt.result,
      fromCache: true,
    });
  });
  unresolved = unresolved.filter(
    (route) => !cachedSuccessIndexes.has(route.index),
  );

  const fallbackCandidates = candidates.filter(
    (candidate, index, all) =>
      all.findIndex(
        (item) => getCandidateKey(item) === getCandidateKey(candidate),
      ) === index,
  );

  const bestFallbacks = new Map<
    number,
    ModelFetchRouteResult<TEntry, TCandidate, TResult>
  >();
  const batchSize = Math.max(1, options?.discoveryBatchSize || 8);
  for (
    let batchStart = 0;
    batchStart < fallbackCandidates.length && unresolved.length > 0;
    batchStart += batchSize
  ) {
    const batch = fallbackCandidates.slice(batchStart, batchStart + batchSize);
    const wave = await Promise.all(
      batch.flatMap((candidate, batchIndex) =>
        unresolved.map(async (route) => {
          if (
            route.cachedCandidate !== undefined &&
            getCandidateKey(route.cachedCandidate) ===
              getCandidateKey(candidate)
          ) {
            return null;
          }
          try {
            const result = await fetchCandidate(route.entry, candidate, {
              fromCache: false,
              candidateIndex: batchStart + batchIndex,
              candidateTotal: fallbackCandidates.length,
            });
            return { route, candidate, result };
          } catch {
            return null;
          }
        }),
      ),
    );
    wave.forEach((attempt) => {
      if (!attempt) return;
      const previous = bestFallbacks.get(attempt.route.index);
      const score = options?.getResultScore?.(attempt.result) || 0;
      const previousScore = previous
        ? options?.getResultScore?.(previous.result) || 0
        : -1;
      if (!previous || score > previousScore) {
        bestFallbacks.set(attempt.route.index, {
          entry: attempt.route.entry,
          candidate: attempt.candidate,
          result: attempt.result,
          fromCache: false,
        });
      }
    });
  }

  results.push(...bestFallbacks.values());
  unresolved = unresolved.filter((route) => !bestFallbacks.has(route.index));

  return {
    results,
    unresolvedEntries: unresolved.map((route) => route.entry),
    cachedFailureReasons: [...cachedFailureReasons].map(([reason, count]) => ({
      reason,
      count,
    })),
    cachedRejectedResultCount,
  };
}

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
  // OpenAI 官方和兼容网关（优先尝试）
  "/v1/models",
  "/models",
  "/api/v1/models",
  "/api/models",
  // 带查询参数的模型列表
  "/v1/models?limit=1000",
  "/v1/models?page_size=1000",
  "/v1/models?limit=500",
  "/v1/models?limit=100",
  "/v1beta/models",
  "/v1/models:list",
  "/v2/models",
  "/api/v2/models",
  // OpenRouter / 聚合商
  "/api/v1/endpoints",
  "/api/pricing",
  "/pricing",
  "/v1/providers",
  "/api/v1/providers",
  // OneAPI / Ocoolai / 兼容接口
  "/api/user/available_model",
  "/api/user/available_models",
  "/api/user/available_models_by_groups",
  "/api/user/available-models-by-groups",
  "/api/user/available-models",
  "/available_model",
  "/available_models",
  // 本地模型服务
  "/api/tags",
  "/v1/internal/model/list",
  "/internal/model/list",
  "/v1/models/list",
  "/api/v1/models/list",
  "/models/list",
  "/api/models/list",
  // 常见网关/面板
  "/api/v1/model/list",
  "/v1/model/list",
  "/api/model/list",
  "/model/list",
  "/api/models/info",
  "/v1/models/info",
  "/v1/models/openai",
  // Azure / VMware
  "/openai/models",
  "/api/v1/compatibility/openai/v1/models",
  // 其他常见路径
  "/api/v1/llms",
  "/v1/llms",
  "/api/llms",
  "/llms",
  "/v1/chat/models",
  "/api/v1/chat/models",
  "/chat/models",
  "/api/chat/models",
  // Claude / Anthropic 兼容
  "/v1/models?type=chat",
  "/v1/models?type=text",
  // 本地部署 / Ollama / LM Studio
  "/api/models?limit=999",
  "/v1/models?expand[]=name",
  "/v1/models?detail=true",
  // 兼容格式
  "/api/v1/models/openai",
  "/v1/openai/models",
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
  const paths = [
    ...parseListConfig(customPaths),
    ...MODEL_FETCH_UPSTREAM_PATHS,
  ];
  return paths
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

export function replaceUrlQueryParam(
  url: string,
  paramName: string,
  paramValue: string,
) {
  if (!url) return url;
  try {
    const isAbsolute = /^https?:\/\//i.test(url);
    const dummyBase = "http://dummy-base.local";
    const parsed = new URL(url, dummyBase);
    parsed.searchParams.set(paramName, paramValue);
    if (isAbsolute) {
      return parsed.toString();
    } else {
      return parsed.pathname + parsed.search;
    }
  } catch {
    return url;
  }
}
