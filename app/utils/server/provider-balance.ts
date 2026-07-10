import {
  appendAuthQueryParam,
  buildAuthHeaders,
  parseExtraHeaders,
  type ApiProfileAuthType,
} from "@/app/utils/model-fetch-common";
import { isAiHubMixUrl } from "@/app/utils/aihubmix";

type BalanceProfile = {
  baseUrl?: string;
  apiKey?: string;
  apiKeyGroups?: Record<string, string>;
  multiKeyGroupOrder?: string[];
  authType?: string;
  authQueryParam?: string;
  extraHeaders?: string;
};

export type ProviderBalanceResult = {
  value: number;
  currency: string;
  queriedAt: number;
  attempts?: ProviderBalanceAttempt[];
};

export type ProviderBalanceAttempt = {
  keyIndex: number;
  authType: string;
  baseUrl: string;
  path: string;
  status?: number;
  ok: boolean;
  reason?: string;
};

export class ProviderBalanceQueryError extends Error {
  attempts: ProviderBalanceAttempt[];

  constructor(message: string, attempts: ProviderBalanceAttempt[]) {
    super(message);
    this.name = "ProviderBalanceQueryError";
    this.attempts = attempts;
  }
}

const BALANCE_PATH_PREFIXES = [
  "",
  "api",
  "v1",
  "api/v1",
  "v1/api",
  "auth",
  "api/auth",
  "v1/auth",
  "api/v1/auth",
] as const;

const BALANCE_PRIORITY_PATHS = [
  "api/user/self",
  "api/v1/user/self",
  "api/user/token",
  "api/v1/user/token",
  "api/user/dashboard",
  "api/v1/user/dashboard",
  "api/token",
  "api/v1/token",
  "v1/token/quota",
  "api/v1/token/quota",
  "token/quota",
  "api/token/quota",
  "v1/user/balance",
  "api/v1/user/balance",
  "user/balance",
  "api/user/balance",
  "v1/user/credits",
  "api/v1/user/credits",
  "v1/user/quota",
  "api/v1/user/quota",
] as const;

const BALANCE_PATH_RESOURCES = [
  "pricing",
  "prices",
  "price",
  "credits",
  "credit",
  "credit_grants",
  "balance",
  "balances",
  "billing",
  "billing/usage",
  "billing/subscription",
  "billing/credit_grants",
  "dashboard/billing/usage",
  "dashboard/billing/subscription",
  "dashboard/billing/credit_grants",
  "subscription",
  "subscriptions",
  "usage",
  "quota",
  "quotas",
  "token",
  "tokens",
  "token/summary",
  "token/credit_summary",
  "token/balance",
  "token/quota",
  "token/quotas",
  "token/usage",
  "self",
  "me",
  "profile",
  "account",
  "account/info",
  "account/balance",
  "account/balances",
  "account/credit",
  "account/credits",
  "account/quota",
  "account/usage",
  "user",
  "user/self",
  "user/me",
  "user/info",
  "user/profile",
  "user/account",
  "user/balance",
  "user/balances",
  "user/credit",
  "user/credits",
  "user/quota",
  "user/usage",
  "user/token",
  "user/dashboard",
  "user/models",
  "user/self/groups",
  "user/subscription",
  "organization/credits",
  "organizations/credits",
] as const;

function buildBalancePaths() {
  const paths = BALANCE_PATH_PREFIXES.flatMap((prefix) =>
    BALANCE_PATH_RESOURCES.map((resource) =>
      [prefix, resource].filter(Boolean).join("/"),
    ),
  );

  return [...new Set([...BALANCE_PRIORITY_PATHS, ...paths])];
}

const BALANCE_PATHS = buildBalancePaths();
const BALANCE_QUERY_BATCH_SIZE = 4;
const BALANCE_MAX_ATTEMPTS_PER_KEY = 240;
const BALANCE_QUERY_MAX_ROUNDS = 3;
const BALANCE_QUERY_RETRY_DELAYS_MS = [800, 2_000] as const;

const YUTO_BASE_URLS = [
  "https://cn.gptapi.asia",
  "https://gptapi.asia",
  "https://api.yutoai.net",
  "https://yutoai.net",
] as const;

const TOAPIS_BASE_URLS = [
  "https://toapis.com",
  "https://www.toapis.com",
] as const;

const QINGCHEN_HOSTNAMES = ["gpt.qt.cool"] as const;

type BalanceAuthType = ApiProfileAuthType | "authorization-raw";
type BalanceCandidate = {
  candidateBaseUrl: string;
  path: string;
  authType: BalanceAuthType;
};

function getBaseUrlHostname(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isAiHubMixBalanceBaseUrl(baseUrl: string) {
  return isAiHubMixUrl(baseUrl);
}

function isYutoBalanceBaseUrl(baseUrl: string) {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return YUTO_BASE_URLS.some(
      (yutoUrl) => new URL(yutoUrl).hostname.toLowerCase() === hostname,
    );
  } catch {
    return false;
  }
}

function isToApisBalanceBaseUrl(baseUrl: string) {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return TOAPIS_BASE_URLS.some(
      (toapisUrl) => new URL(toapisUrl).hostname.toLowerCase() === hostname,
    );
  } catch {
    return false;
  }
}

function isQingchenBalanceBaseUrl(baseUrl: string) {
  const hostname = getBaseUrlHostname(baseUrl);
  return QINGCHEN_HOSTNAMES.some(
    (candidate) => hostname === candidate || hostname.endsWith(`.${candidate}`),
  );
}

function getResponseCookies(response: Response) {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = headers.getSetCookie?.() || [
    headers.get("set-cookie") || "",
  ];
  return setCookies
    .flatMap((value) => value.split(/,(?=[^;,]+=)/))
    .map((value) => value.split(";", 1)[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function queryQingchenBalance(
  baseUrl: string,
  apiKey: string,
  keyIndex: number,
  attempts: ProviderBalanceAttempt[],
) {
  const portalBaseUrl = `${new URL(baseUrl).origin}`;
  const loginPath = "portal/login";
  const loginResponse = await fetch(`${portalBaseUrl}/${loginPath}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ key: apiKey }),
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  const loginBody = (await loginResponse.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const loginOk = loginResponse.ok && Number(loginBody?.code) === 0;
  attempts.push({
    keyIndex,
    authType: "portal-session",
    baseUrl: portalBaseUrl,
    path: loginPath,
    status: loginResponse.status,
    ok: loginOk,
    reason: loginOk ? undefined : "portal_login_failed",
  });
  if (!loginOk) return null;

  const cookie = getResponseCookies(loginResponse);
  if (!cookie) return null;
  const portalQueries = [
    {
      path: "portal/models",
      parse: (data: Record<string, unknown>) => Number(data.remainingBalance),
    },
    {
      path: "portal/info",
      parse: (data: Record<string, unknown>) => {
        const total = Number(data.balanceUsd);
        const used = Number(data.usedBalanceUsd);
        return Number.isFinite(total)
          ? Math.max(total - (Number.isFinite(used) ? used : 0), 0)
          : Number.NaN;
      },
    },
  ] as const;
  const values = await Promise.all(
    portalQueries.map(async ({ path, parse }) => {
      try {
        const response = await fetch(`${portalBaseUrl}/${path}`, {
          headers: { Accept: "application/json", Cookie: cookie },
          signal: AbortSignal.timeout(5_000),
          cache: "no-store",
        });
        const body = (await response.json().catch(() => null)) as Record<
          string,
          unknown
        > | null;
        const data =
          body && typeof body.data === "object" && body.data
            ? (body.data as Record<string, unknown>)
            : body;
        const value = data ? parse(data) : Number.NaN;
        const hasBalance = response.ok && Number.isFinite(value);
        attempts.push({
          keyIndex,
          authType: "portal-session",
          baseUrl: portalBaseUrl,
          path,
          status: response.status,
          ok: hasBalance,
          reason: hasBalance ? undefined : "balance_field_missing",
        });
        return hasBalance ? value : null;
      } catch (error) {
        attempts.push({
          keyIndex,
          authType: "portal-session",
          baseUrl: portalBaseUrl,
          path,
          ok: false,
          reason: error instanceof Error ? error.message : "request_failed",
        });
        return null;
      }
    }),
  );
  return values.find((value): value is number => value !== null) ?? null;
}

function buildBalanceAuthHeaders(apiKey: string, authType: BalanceAuthType) {
  if (authType === "authorization-raw") {
    return { Authorization: apiKey };
  }
  return buildAuthHeaders(apiKey, authType);
}

function appendBalanceAuthQueryParam(
  url: string,
  apiKey: string,
  authType: BalanceAuthType,
  authQueryParam?: string,
) {
  return authType === "query-key"
    ? appendAuthQueryParam(url, apiKey, authType, authQueryParam)
    : url;
}

function buildBalanceAuthTypes(
  configuredAuthType: ApiProfileAuthType | undefined,
  preferRawAuthorization: boolean,
) {
  const fallbackAuthTypes = preferRawAuthorization
    ? ([
        "authorization-raw",
        "bearer",
        "x-api-key",
        "api-key",
        "query-key",
      ] as const)
    : ([
        "bearer",
        "authorization-raw",
        "x-api-key",
        "api-key",
        "query-key",
      ] as const);

  return [configuredAuthType, ...fallbackAuthTypes].filter(
    (type, index, all): type is BalanceAuthType =>
      !!type && all.indexOf(type) === index,
  );
}

function buildBalanceBaseUrls(baseUrl: string, rootBaseUrl: string) {
  // aihubmix 的候选 URL 在 queryProviderBalance 中根据用户 baseUrl 动态构建，
  // 不再依赖硬编码 AIHUBMIX_MANAGEMENT_BASE_URLS（70366030 修复后已废弃）。
  return [rootBaseUrl, baseUrl].filter(
    (url, index, all) => url && all.indexOf(url) === index,
  );
}

async function runBalanceCandidateQueue(
  candidates: BalanceCandidate[],
  query: (candidate: BalanceCandidate) => Promise<number | null>,
) {
  for (
    let index = 0;
    index < candidates.length;
    index += BALANCE_QUERY_BATCH_SIZE
  ) {
    const batch = candidates.slice(index, index + BALANCE_QUERY_BATCH_SIZE);
    const results = await Promise.all(batch.map(query));
    const value = results.find((item): item is number => item !== null);
    if (value !== undefined) {
      return value;
    }
  }
  return null;
}

function buildBalanceCandidates(
  baseUrls: string[],
  authTypes: BalanceAuthType[],
) {
  return BALANCE_PATHS.flatMap((path) =>
    baseUrls.flatMap((candidateBaseUrl) =>
      authTypes.map((authType) => ({ candidateBaseUrl, path, authType })),
    ),
  ).slice(0, BALANCE_MAX_ATTEMPTS_PER_KEY);
}

function findFirstFiniteNumber(
  container: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = Number(container[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function normalizeQuotaBalance(value: number) {
  // 兼容两类常见返回：大整数 quota 按 500000 折算，小数/小额 quota 已是余额。
  return Math.abs(value) >= 100_000 ? value / 500_000 : value;
}

export function parseProviderBalanceValue(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const containers: Record<string, unknown>[] = [];
  const visit = (item: unknown, depth: number) => {
    if (!item || typeof item !== "object" || depth > 4) {
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child) => visit(child, depth + 1));
      return;
    }
    const container = item as Record<string, unknown>;
    containers.push(container);
    [
      "data",
      "result",
      "user",
      "account",
      "subscription",
      "usage",
      "balance_infos",
      "balanceInfos",
    ].forEach((key) => visit(container[key], depth + 1));
  };
  visit(record, 0);

  for (const container of containers) {
    // 处理 ToAPIs 无限额度的特殊情况
    if (container.unlimited_quota === true) {
      // 使用一个特殊的大数表示无限额度，避免 Infinity 序列化问题
      return -1;
    }

    const quotaBalance = findFirstFiniteNumber(container, [
      "quota",
      "remain_quota",
      "remainQuota",
      "remaining_quota",
      "remainingQuota",
      "token_quota",
      "tokenQuota",
    ]);
    if (quotaBalance !== null) {
      return normalizeQuotaBalance(quotaBalance);
    }

    const remaining = findFirstFiniteNumber(container, [
      // ToAPIs 特有字段
      "remain_balance",
      "remain_credits",
      // 通用字段
      "balance",
      "remaining_balance",
      "remainingBalance",
      "remaining_credit",
      "remainingCredit",
      "remaining_amount",
      "remainingAmount",
      "remaining_quota",
      "remainingQuota",
      "credit",
      "credits",
      "available",
      "total_balance",
      "totalBalance",
      "topped_up_balance",
      "toppedUpBalance",
      "granted_balance",
      "grantedBalance",
      "total_available",
      "totalAvailable",
      "available_credit",
      "availableCredit",
      "cash_balance",
      "cashBalance",
    ]);
    if (remaining !== null) {
      return remaining;
    }

    const amountPairs = [
      [
        ["total_amount", "totalAmount", "total", "amount_total", "amountTotal"],
        ["used_amount", "usedAmount", "used", "amount_used", "amountUsed"],
      ],
      [
        ["total_credits", "totalCredits", "total_granted", "totalGranted"],
        ["total_usage", "totalUsage", "total_used", "totalUsed", "used"],
      ],
      [
        [
          "hard_limit_usd",
          "monthly_limit_usd",
          "weekly_limit_usd",
          "daily_limit_usd",
        ],
        [
          "total_usage",
          "monthly_usage_usd",
          "weekly_usage_usd",
          "daily_usage_usd",
        ],
      ],
      [
        ["limit", "quota_limit", "quotaLimit", "total_quota", "totalQuota"],
        ["usage", "used", "quota_used", "quotaUsed", "used_quota", "usedQuota"],
      ],
    ] as const;

    for (const [totalKeys, usedKeys] of amountPairs) {
      const total = findFirstFiniteNumber(container, [...totalKeys]);
      const used = findFirstFiniteNumber(container, [...usedKeys]);
      if (total !== null && used !== null) {
        return Math.max(total - used, 0);
      }
    }
  }
  return null;
}

export async function queryProviderBalance(
  profile: BalanceProfile,
): Promise<ProviderBalanceResult> {
  const attempts: ProviderBalanceAttempt[] = [];
  let yutoUpstreamError = "";
  const baseUrl = String(profile.baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  const rootBaseUrl = baseUrl.replace(/\/v1$/i, "");
  const groups = profile.apiKeyGroups || {};
  const isYuto = isYutoBalanceBaseUrl(baseUrl);
  const isQingchen = isQingchenBalanceBaseUrl(baseUrl);
  const orderedGroups = [
    ...(profile.multiKeyGroupOrder || []),
    ...Object.keys(groups),
  ].filter((group, index, all) => group && all.indexOf(group) === index);
  let apiKeys = [profile.apiKey, ...orderedGroups.map((group) => groups[group])]
    .map((key) => String(key || "").trim())
    .filter((key, index, all) => key && all.indexOf(key) === index);

  // Yuto 必须使用页面保存的管理 Key 格式：apiKey|userId
  if (isYuto) {
    // 只保留符合 yuto 格式的 key
    apiKeys = apiKeys.filter((key) => key.includes("|"));
    if (apiKeys.length === 0) {
      throw new ProviderBalanceQueryError(
        "Yuto 管理 API Key 格式不正确，请使用 API_Key|User_ID",
        attempts,
      );
    }
  }

  if (!/^https?:\/\//i.test(baseUrl) || apiKeys.length === 0) {
    throw new ProviderBalanceQueryError("balance_profile_incomplete", attempts);
  }

  // 通用供应商查询逻辑
  const configuredAuthType = profile.authType as ApiProfileAuthType | undefined;
  const isAiHubMixProfile = isAiHubMixBalanceBaseUrl(baseUrl);
  const authTypes = buildBalanceAuthTypes(
    configuredAuthType,
    isAiHubMixProfile,
  );
  const baseUrls = buildBalanceBaseUrls(baseUrl, rootBaseUrl);

  for (const [keyIndex, apiKeyRaw] of apiKeys.entries()) {
    // 解析 yuto 的特殊格式：apiKey|userId
    let apiKey = apiKeyRaw;
    let yutoUserId: string | null = null;
    const isAiHubMix = isAiHubMixBalanceBaseUrl(baseUrl);

    if (isYuto && apiKeyRaw.includes("|")) {
      const parts = apiKeyRaw.split("|");
      apiKey = parts[0].trim();
      yutoUserId = parts.slice(1).join("|").trim();
    }

    if (isQingchen) {
      try {
        const value = await queryQingchenBalance(
          baseUrl,
          apiKey,
          keyIndex,
          attempts,
        );
        if (value !== null) {
          return { value, currency: "USD", queriedAt: Date.now(), attempts };
        }
      } catch (error) {
        attempts.push({
          keyIndex,
          authType: "portal-session",
          baseUrl: new URL(baseUrl).origin,
          path: "portal/info",
          ok: false,
          reason: error instanceof Error ? error.message : "request_failed",
        });
      }
      continue;
    }

    // 对于已知的服务提供商，使用固定路径，避免盲目尝试触发限流
    let candidates: BalanceCandidate[];
    const isToApis = isToApisBalanceBaseUrl(baseUrl);
    if (isYuto) {
      // Yuto: 只使用最可能的配置，减少请求次数
      // 使用用户配置的 baseUrl，只尝试 bearer token 方式
      candidates = [
        {
          candidateBaseUrl: baseUrl,
          path: "api/user/self",
          authType: "bearer" as const,
        },
      ];
    } else if (isAiHubMix) {
      // AiHubMix 系列（含 api.inferera.com 等镜像）使用 Manage Key + Bearer 访问 api/user/self。
      // 必须基于用户配置的 baseUrl 查询：镜像站点的 Manage Key 与官方域名不互通，
      // 且部分部署环境（如本服务器）无法访问 aihubmix.com 官方域名，只能访问镜像。
      // 官方域名不强制注入，用户若配置官方域名则 baseUrl 本身即覆盖。
      const aihubmixBaseUrls = [rootBaseUrl, baseUrl].filter(
        (url, index, all) => url && all.indexOf(url) === index,
      );
      candidates = aihubmixBaseUrls.flatMap((candidateBaseUrl) =>
        (["bearer", "authorization-raw"] as const).map((authType) => ({
          candidateBaseUrl,
          path: "api/user/self",
          authType,
        })),
      );
    } else if (isToApis) {
      // ToAPIs: 只使用文档中明确的路径
      candidates = TOAPIS_BASE_URLS.flatMap((toapisUrl) => [
        {
          candidateBaseUrl: toapisUrl,
          path: "v1/user/balance",
          authType: "bearer" as const,
        },
        {
          candidateBaseUrl: toapisUrl,
          path: "user/balance",
          authType: "bearer" as const,
        },
      ]);
    } else {
      // 其他服务提供商使用常规的候选路径
      candidates = buildBalanceCandidates(baseUrls, authTypes);
    }

    const value = await runBalanceCandidateQueue(
      candidates,
      async ({ candidateBaseUrl, path, authType }) => {
        const headers: Record<string, string> = {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...parseExtraHeaders(profile.extraHeaders),
          ...buildBalanceAuthHeaders(apiKey, authType),
        };

        // 添加 yuto 特殊的 Header
        if (isYuto && yutoUserId) {
          headers["New-API-User"] = yutoUserId;
        }

        const attemptBaseUrl = (() => {
          try {
            const url = new URL(candidateBaseUrl);
            return `${url.protocol}//${url.host}`;
          } catch {
            return candidateBaseUrl;
          }
        })();
        const url = appendBalanceAuthQueryParam(
          `${candidateBaseUrl}/${path}`,
          apiKey,
          authType,
          profile.authQueryParam,
        );
        try {
          const response = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(5_000),
            cache: "no-store",
          });
          if (!response.ok) {
            attempts.push({
              keyIndex,
              authType,
              baseUrl: attemptBaseUrl,
              path,
              status: response.status,
              ok: false,
              reason: "http_error",
            });
            return null;
          }
          const responseBody = await response.json();
          if (
            isYuto &&
            responseBody &&
            typeof responseBody === "object" &&
            (responseBody as Record<string, unknown>).success === false
          ) {
            yutoUpstreamError = String(
              (responseBody as Record<string, unknown>).message ||
                "Yuto 余额查询失败",
            );
          }
          const value = parseProviderBalanceValue(responseBody);
          if (value !== null) {
            attempts.push({
              keyIndex,
              authType,
              baseUrl: attemptBaseUrl,
              path,
              status: response.status,
              ok: true,
            });
            return value;
          }
          attempts.push({
            keyIndex,
            authType,
            baseUrl: attemptBaseUrl,
            path,
            status: response.status,
            ok: false,
            reason: "balance_field_missing",
          });
        } catch (error) {
          attempts.push({
            keyIndex,
            authType,
            baseUrl: attemptBaseUrl,
            path,
            ok: false,
            reason: error instanceof Error ? error.message : "request_failed",
          });
          // 单条链路失败时继续尝试其他路径、认证方式和 API Key。
        }
        return null;
      },
    );
    if (value !== null) {
      return { value, currency: "USD", queriedAt: Date.now(), attempts };
    }
  }

  if (attempts.some((attempt) => attempt.status === 429)) {
    throw new ProviderBalanceQueryError("balance_rate_limited", attempts);
  }

  if (yutoUpstreamError) {
    throw new ProviderBalanceQueryError(yutoUpstreamError, attempts);
  }

  const hasReadableResponse = attempts.some(
    (attempt) =>
      attempt.status === 200 && attempt.reason === "balance_field_missing",
  );
  if (
    !hasReadableResponse &&
    attempts.some((attempt) => attempt.status === 401 || attempt.status === 403)
  ) {
    throw new ProviderBalanceQueryError("balance_auth_failed", attempts);
  }

  throw new ProviderBalanceQueryError("balance_not_supported", attempts);
}

function shouldRetryProviderBalanceQuery(error: ProviderBalanceQueryError) {
  if (
    error.message === "balance_profile_incomplete" ||
    error.message === "balance_auth_failed" ||
    error.attempts.length === 0
  ) {
    return false;
  }

  return error.attempts.some((attempt) => {
    if (attempt.status === undefined) return true;
    if ([408, 425, 429].includes(attempt.status)) return true;
    if (attempt.status >= 500) return true;
    return attempt.status === 200 && attempt.reason === "balance_field_missing";
  });
}

/**
 * 对可恢复失败沿用同一套 baseUrl/path/auth 候选队列重试。
 * 明确的配置、鉴权或稳定 4xx 错误不重试，避免无意义地请求上游。
 */
export async function queryProviderBalanceWithRetry(
  profile: BalanceProfile,
): Promise<ProviderBalanceResult> {
  const accumulatedAttempts: ProviderBalanceAttempt[] = [];

  for (let round = 1; round <= BALANCE_QUERY_MAX_ROUNDS; round += 1) {
    try {
      const result = await queryProviderBalance(profile);
      if (accumulatedAttempts.length > 0) {
        console.info("[Provider Balance] 按原路径重试后查询成功", {
          round,
          previousAttemptCount: accumulatedAttempts.length,
          successAttemptCount: result.attempts?.length || 0,
        });
      }
      return {
        ...result,
        attempts: [...accumulatedAttempts, ...(result.attempts || [])],
      };
    } catch (error) {
      if (!(error instanceof ProviderBalanceQueryError)) {
        throw error;
      }

      accumulatedAttempts.push(...error.attempts);
      const retryable = shouldRetryProviderBalanceQuery(error);
      const hasNextRound = round < BALANCE_QUERY_MAX_ROUNDS;
      if (!retryable || !hasNextRound) {
        throw new ProviderBalanceQueryError(error.message, accumulatedAttempts);
      }

      const delayMs = BALANCE_QUERY_RETRY_DELAYS_MS[round - 1] || 1_000;
      console.warn("[Provider Balance] 上游查询暂时失败，按原路径重试", {
        round,
        nextRound: round + 1,
        maxRounds: BALANCE_QUERY_MAX_ROUNDS,
        delayMs,
        reason: error.message,
        roundAttemptCount: error.attempts.length,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new ProviderBalanceQueryError(
    "balance_not_supported",
    accumulatedAttempts,
  );
}
