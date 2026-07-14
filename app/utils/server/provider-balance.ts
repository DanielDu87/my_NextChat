import {
  appendAuthQueryParam,
  buildAuthHeaders,
  parseExtraHeaders,
  type ApiProfileAuthType,
} from "@/app/utils/model-fetch-common";

// YutoAPI 检测（cn.gptapi.asia / gptapi.asia）
function isYutoApiUrl(baseUrl?: string) {
  if (!baseUrl) return false;
  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === "cn.gptapi.asia" || hostname === "gptapi.asia";
  } catch {
    return false;
  }
}

// CherryIN 检测（open.cherryin.net）
function isCherryINUrl(baseUrl?: string) {
  if (!baseUrl) return false;
  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === "open.cherryin.net" || hostname === "cherryin.net";
  } catch {
    return false;
  }
}

function isOpenRouterUrl(baseUrl?: string) {
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).hostname === "openrouter.ai";
  } catch {
    return false;
  }
}

function isQingchenUrl(baseUrl?: string) {
  if (!baseUrl) return false;
  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === "gpt.qt.cool" || hostname.endsWith(".gpt.qt.cool");
  } catch {
    return false;
  }
}

// 解析 YutoAPI 格式的 Key（API_Key|User_ID）
function parseYutoApiKey(apiKey: string) {
  const parts = apiKey.split("|");
  if (parts.length >= 2) {
    return {
      token: parts[0],
      userId: parts[1],
    };
  }
  return { token: apiKey, userId: "" };
}

type BalanceProfile = {
  baseUrl?: string;
  apiKey?: string;
  apiKeyGroups?: Record<string, string>;
  multiKeyGroupOrder?: string[];
  authType?: string;
  authQueryParam?: string;
  extraHeaders?: string;
  // 缓存的成功路径（上次查询成功的路径）
  cachedPath?: string;
  cachedBaseUrl?: string;
  cachedAuthType?: string;
  // 自定义 URL 专用：只查询此路径，不再探测其他路径
  customUrlOnly?: boolean;
  signal?: AbortSignal;
};

export type ProviderBalanceResult = {
  value: number;
  currency: string;
  queriedAt: number;
  attempts?: ProviderBalanceAttempt[];
  cachedPath?: string;
  cachedBaseUrl?: string;
  cachedAuthType?: string;
};

export type ProviderBalanceAttempt = {
  keyIndex: number;
  keyTotal: number;
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

const BALANCE_PATHS = [
  // YutoAPI (cn.gptapi.asia) 特定路径（优先尝试）
  "api/pricing",
  "api/user/info",
  "api/balance",
  "api/user/balance",
  "api/quota",
  // OpenRouter 特定路径
  "api/v1/users/me",
  "v1/users/me",
  "users/me",
  // 第一组：最常见的路径（不带 api 前缀）
  "user/self",
  "v1/user/self",
  "user/me",
  "v1/user/me",
  "token/quota",
  "v1/token/quota",
  "token/balance",
  "v1/token/balance",
  "balance",
  "v1/balance",
  "user/balance",
  "v1/user/balance",
  "credits",
  "v1/credits",
  "user/credits",
  "v1/user/credits",
  "quota",
  "v1/quota",
  "user/quota",
  "v1/user/quota",
  "self",
  "me",
  "account",
  "account/balance",
  "user",
  "pricing",
  "billing",
  "usage",
  // 补充：通用的 user/info 路径（部分 OpenAI 兼容服务使用）
  "info",
  "v1/info",
  "user/info",
  "v1/user/info",
  // 第二组：带 api 前缀
  "api/user/self",
  "api/v1/user/self",
  "api/user/me",
  "api/v1/user/me",
  "api/token/quota",
  "api/v1/token/quota",
  "api/token/balance",
  "api/v1/token/balance",
  "api/balance",
  "api/v1/balance",
  "api/user/balance",
  "api/v1/user/balance",
  "api/credits",
  "api/v1/credits",
  "api/user/credits",
  "api/v1/user/credits",
  "api/quota",
  "api/v1/quota",
  "api/user/quota",
  "api/v1/user/quota",
  "api/self",
  "api/me",
  "api/account",
  "api/account/balance",
  "api/user",
  "api/pricing",
  "api/billing",
  "api/usage",
  // 第三组：子路径组合
  "account/info",
  "account/balances",
  "account/credit",
  "account/credits",
  "account/quota",
  "account/usage",
  "account/subscription",
  "account/subscription/status",
  "user/info",
  "user/profile",
  "user/account",
  "user/balances",
  "user/credit",
  "user/credits",
  "user/quota",
  "user/usage",
  "user/token",
  "user/dashboard",
  "user/models",
  "user/subscription",
  "user/subscription/status",
  "api/account/info",
  "api/account/balances",
  "api/account/credit",
  "api/account/credits",
  "api/account/quota",
  "api/account/usage",
  "api/account/subscription",
  "api/account/subscription/status",
  "api/user/info",
  "api/user/profile",
  "api/user/account",
  "api/user/balances",
  "api/user/credit",
  "api/user/credits",
  "api/user/quota",
  "api/user/usage",
  "api/user/token",
  "api/user/dashboard",
  "api/user/models",
  "api/user/subscription",
  "api/user/subscription/status",
  // 第四组：特殊路径
  "token",
  "tokens",
  "token/summary",
  "token/credit_summary",
  "token/quotas",
  "token/usage",
  "subscription",
  "subscriptions",
  "subscription/status",
  "pricing",
  "prices",
  "price",
  "credit",
  "credit_grants",
  "billing/usage",
  "billing/subscription",
  "billing/credit_grants",
  "billing/invoice",
  "billing/summary",
  "dashboard",
  "dashboard/billing/usage",
  "dashboard/billing/subscription",
  "dashboard/billing/credit_grants",
  "portal/info",
  "portal/balance",
  "portal/credits",
  "wallet",
  "wallet/balance",
  "wallet/credits",
  "funds",
  "funds/balance",
  "money",
  "money/balance",
  "key/info",
  "key/balance",
  "apikey/info",
  "api_key/info",
  "organization/credits",
  "organizations/credits",
  "organization/balance",
  "organizations/balance",
  "user/self/groups",
  "api/user/self/groups",
];

const BALANCE_QUERY_BATCH_SIZE = 8;
const BALANCE_MAX_ATTEMPTS_PER_KEY = 320;
const BALANCE_QUERY_MAX_ROUNDS = 3;
const BALANCE_QUERY_RETRY_DELAYS_MS = [500, 1_000] as const;
const BALANCE_UPSTREAM_TIMEOUT_MS = 15_000;

type BalanceAuthType = ApiProfileAuthType | "authorization-raw";
type BalanceCandidate = {
  candidateBaseUrl: string;
  path: string;
  authType: BalanceAuthType;
};

function getBalanceRequestSignal(signal?: AbortSignal) {
  const timeoutSignal = AbortSignal.timeout(BALANCE_UPSTREAM_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
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
  keyTotal: number,
  attempts: ProviderBalanceAttempt[],
  signal?: AbortSignal,
  preferredPath?: string,
) {
  const portalBaseUrl = new URL(baseUrl).origin;
  const loginPath = "portal/login";
  const loginResponse = await fetch(`${portalBaseUrl}/${loginPath}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ key: apiKey }),
    signal: getBalanceRequestSignal(signal),
    cache: "no-store",
  });
  const loginBody = (await loginResponse.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const loginOk = loginResponse.ok && Number(loginBody?.code) === 0;
  attempts.push({
    keyIndex,
    keyTotal,
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
  const allPortalQueries = [
    {
      path: "portal/models",
      parse: (data: Record<string, unknown>) =>
        findFirstFiniteNumber(data, ["remainingBalance"]) ?? Number.NaN,
    },
    {
      path: "portal/info",
      parse: (data: Record<string, unknown>) => {
        const total = findFirstFiniteNumber(data, ["balanceUsd"]);
        const used = findFirstFiniteNumber(data, ["usedBalanceUsd"]);
        return total !== null ? Math.max(total - (used ?? 0), 0) : Number.NaN;
      },
    },
  ] as const;
  const normalizedPreferredPath = preferredPath
    ?.replace(/^\/+/, "")
    .split(/[?#]/, 1)[0];
  const portalQueries = normalizedPreferredPath
    ? allPortalQueries.filter((query) => query.path === normalizedPreferredPath)
    : allPortalQueries;
  if (portalQueries.length === 0) return null;
  const values = await Promise.all(
    portalQueries.map(async ({ path, parse }) => {
      try {
        const response = await fetch(`${portalBaseUrl}/${path}`, {
          headers: { Accept: "application/json", Cookie: cookie },
          signal: getBalanceRequestSignal(signal),
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
          keyTotal,
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
          keyTotal,
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
  const successIndex = values.findIndex((value) => value !== null);
  return successIndex >= 0
    ? {
        value: values[successIndex] as number,
        path: portalQueries[successIndex].path,
      }
    : null;
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
  configuredAuthType: BalanceAuthType | undefined,
) {
  // 调整认证类型顺序：优先尝试最可能成功的类型
  // sk-user- 格式的 key 通常需要直接传递（authorization-raw），不是 Bearer token
  const fallbackAuthTypes: BalanceAuthType[] = [
    "api-key", // 优先尝试 x-api-key 方式
    "authorization-raw", // sk-user- 格式的 key 通常直接传递
    "x-api-key",
    "bearer",
    "query-key",
  ];

  return [configuredAuthType, ...fallbackAuthTypes].filter(
    (type, index, all): type is BalanceAuthType =>
      !!type && all.indexOf(type) === index,
  );
}

function buildBalanceBaseUrls(baseUrl: string, rootBaseUrl: string) {
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
  const uniquePaths = [...new Set(BALANCE_PATHS)];
  const primaryBaseUrl = baseUrls[0];
  const primaryAuthType = authTypes[0];
  if (!primaryBaseUrl || !primaryAuthType) return [];
  const priorityPaths = [
    "api/user/self",
    "user/self",
    "v1/user/self",
    "api/user/balance",
    "user/balance",
    "v1/user/balance",
    "api/token/quota",
    "token/quota",
    "api/v1/credits",
    "v1/credits",
  ].filter((path) => uniquePaths.includes(path));
  const priorityCandidates = priorityPaths.flatMap((path) =>
    baseUrls.flatMap((candidateBaseUrl) =>
      authTypes.map((authType) => ({ candidateBaseUrl, path, authType })),
    ),
  );
  const broadPathCoverage = uniquePaths.map((path) => ({
    candidateBaseUrl: primaryBaseUrl,
    path,
    authType: primaryAuthType,
  }));
  const remainingCandidates = authTypes.flatMap((authType) =>
    baseUrls.flatMap((candidateBaseUrl) =>
      uniquePaths.map((path) => ({ candidateBaseUrl, path, authType })),
    ),
  );
  const seen = new Set<string>();
  return [...priorityCandidates, ...broadPathCoverage, ...remainingCandidates]
    .filter((candidate) => {
      const key = `${candidate.candidateBaseUrl}\n${candidate.path}\n${candidate.authType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, BALANCE_MAX_ATTEMPTS_PER_KEY);
}

function findFirstFiniteNumber(
  container: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const candidate = container[key];
    if (
      candidate === null ||
      candidate === undefined ||
      typeof candidate === "boolean" ||
      (typeof candidate === "string" && candidate.trim() === "")
    ) {
      continue;
    }
    const value = Number(candidate);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function normalizeQuotaBalance(value: number) {
  // 兼容两类常见返回：大整数 quota 按 500000 折算，小数/小额 quota 已是余额。
  return Math.abs(value) >= 100_000 ? value / 500_000 : value;
}

export function parseProviderBalanceValue(
  value: unknown,
  balanceField?: string,
): number | null {
  if (
    typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "")
  ) {
    const directValue = Number(value);
    return Number.isFinite(directValue) ? directValue : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  // CherryIN 特殊格式：检查 quota 字段（需要优先检查，避免被 success 检查拦截）
  if (balanceField === "quota") {
    const quota = findFirstFiniteNumber(record, ["quota"]);
    if (quota !== null) return normalizeQuotaBalance(quota);
    // CherryIN 可能有嵌套结构
    if (record.data && typeof record.data === "object") {
      const nestedQuota = findFirstFiniteNumber(
        record.data as Record<string, unknown>,
        ["quota"],
      );
      if (nestedQuota !== null) return normalizeQuotaBalance(nestedQuota);
    }
    return null;
  }

  // YutoAPI 特殊格式：需要检查 success 字段
  if (
    "success" in record &&
    (record.success === false ||
      record.success === 0 ||
      record.success === "false")
  ) {
    return null;
  }

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
    // 处理无限额度的特殊情况
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
      "remain_balance",
      "remain_credits",
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
      // 添加更多常见字段
      "money",
      "fund",
      "funds",
      "allowance",
      "wallet_balance",
      "walletBalance",
      "account_balance",
      "accountBalance",
      "user_balance",
      "userBalance",
      "total_money",
      "totalMoney",
      "current_balance",
      "currentBalance",
      "left_quota",
      "leftQuota",
      "left_balance",
      "leftBalance",
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
          "hard_limit",
          "monthly_limit",
        ],
        [
          "total_usage",
          "monthly_usage_usd",
          "weekly_usage_usd",
          "daily_usage_usd",
          "usage",
        ],
      ],
      [
        ["limit", "quota_limit", "quotaLimit", "total_quota", "totalQuota"],
        ["usage", "used", "quota_used", "quotaUsed", "used_quota", "usedQuota"],
      ],
      // 添加 money/balance - used 计算方式
      [
        ["money", "fund", "funds", "balance", "total_money", "totalMoney"],
        ["used", "used_money", "usedMoney", "spent", "cost"],
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

export async function queryProviderBalance(profile: BalanceProfile): Promise<
  ProviderBalanceResult & {
    cachedPath?: string;
    cachedBaseUrl?: string;
    cachedAuthType?: string;
  }
> {
  const attempts: ProviderBalanceAttempt[] = [];
  const baseUrl = String(profile.baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  const rootBaseUrl = baseUrl.replace(/\/v1$/i, "");
  const groups = profile.apiKeyGroups || {};
  const orderedGroups = [
    ...(profile.multiKeyGroupOrder || []),
    ...Object.keys(groups),
  ].filter((group, index, all) => group && all.indexOf(group) === index);
  const apiKeys = [
    profile.apiKey,
    ...orderedGroups.map((group) => groups[group]),
  ]
    .map((key) => String(key || "").trim())
    .filter((key, index, all) => key && all.indexOf(key) === index);

  if (!/^https?:\/\//i.test(baseUrl) || apiKeys.length === 0) {
    throw new ProviderBalanceQueryError("balance_profile_incomplete", attempts);
  }

  const configuredAuthType = profile.authType as ApiProfileAuthType | undefined;
  const authTypes = buildBalanceAuthTypes(configuredAuthType);
  const baseUrls = buildBalanceBaseUrls(baseUrl, rootBaseUrl);

  for (const [keyIndex, apiKey] of apiKeys.entries()) {
    console.log(
      `[Provider Balance] 🔍 正在尝试第 ${keyIndex + 1}/${
        apiKeys.length
      } 个 key 的余额查询`,
    );

    if (
      isQingchenUrl(baseUrl) &&
      (!profile.customUrlOnly || profile.cachedPath?.startsWith("portal/"))
    ) {
      try {
        const result = await queryQingchenBalance(
          baseUrl,
          apiKey,
          keyIndex,
          apiKeys.length,
          attempts,
          profile.signal,
          profile.cachedPath,
        );
        if (result !== null) {
          return {
            value: result.value,
            currency: "USD",
            queriedAt: Date.now(),
            attempts,
            cachedPath: result.path,
            cachedBaseUrl: new URL(baseUrl).origin,
            cachedAuthType: "portal-session",
          };
        }
      } catch (error) {
        attempts.push({
          keyIndex,
          keyTotal: apiKeys.length,
          authType: "portal-session",
          baseUrl: new URL(baseUrl).origin,
          path: "portal/login",
          ok: false,
          reason: error instanceof Error ? error.message : "request_failed",
        });
      }
      continue;
    }

    if (!profile.customUrlOnly && isOpenRouterUrl(baseUrl)) {
      const openRouterBaseUrl = new URL(baseUrl).origin;
      const openRouterPath = "api/v1/credits";
      try {
        const response = await fetch(`${openRouterBaseUrl}/${openRouterPath}`, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          signal: getBalanceRequestSignal(profile.signal),
          cache: "no-store",
        });
        const responseBody = await response.json().catch(() => null);
        const value = response.ok
          ? parseProviderBalanceValue(responseBody)
          : null;
        attempts.push({
          keyIndex,
          keyTotal: apiKeys.length,
          authType: "bearer",
          baseUrl: openRouterBaseUrl,
          path: openRouterPath,
          status: response.status,
          ok: value !== null,
          reason:
            value !== null
              ? undefined
              : response.ok
              ? "balance_field_missing"
              : "http_error",
        });
        if (value !== null) {
          return {
            value,
            currency: "USD",
            queriedAt: Date.now(),
            attempts,
            cachedPath: openRouterPath,
            cachedBaseUrl: openRouterBaseUrl,
            cachedAuthType: "bearer",
          };
        }
      } catch (error) {
        attempts.push({
          keyIndex,
          keyTotal: apiKeys.length,
          authType: "bearer",
          baseUrl: openRouterBaseUrl,
          path: openRouterPath,
          ok: false,
          reason: error instanceof Error ? error.message : "request_failed",
        });
      }
      continue;
    }

    // YutoAPI 特殊处理：使用 New-API-User Header
    if (!profile.customUrlOnly && isYutoApiUrl(baseUrl)) {
      const yutoKey = parseYutoApiKey(apiKey);
      const yutoBaseUrls = [rootBaseUrl, baseUrl].filter(
        (url, index, all) => url && all.indexOf(url) === index,
      );

      for (const yutoBaseUrl of yutoBaseUrls) {
        const yutoPath = "api/user/self";
        console.log(
          `[Provider Balance] 💡 YutoAPI 模式：${yutoBaseUrl}/${yutoPath}`,
        );
        try {
          const headers: Record<string, string> = {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(yutoKey.userId ? { "New-API-User": yutoKey.userId } : {}),
            Authorization: `Bearer ${yutoKey.token}`,
          };
          const response = await fetch(`${yutoBaseUrl}/${yutoPath}`, {
            headers,
            signal: getBalanceRequestSignal(profile.signal),
            cache: "no-store",
          });
          const responseBody = response.ok
            ? await response.json().catch(() => null)
            : null;
          const value = response.ok
            ? parseProviderBalanceValue(responseBody)
            : null;
          attempts.push({
            keyIndex,
            keyTotal: apiKeys.length,
            authType: "yuto-api",
            baseUrl: yutoBaseUrl,
            path: yutoPath,
            status: response.status,
            ok: value !== null,
            reason:
              value !== null
                ? undefined
                : response.ok
                ? "balance_field_missing"
                : "http_error",
          });
          if (value !== null) {
            console.log(
              `[Provider Balance] ✅ YutoAPI 查询成功: ${yutoBaseUrl}/${yutoPath}`,
            );
            return {
              value,
              currency: "USD",
              queriedAt: Date.now(),
              attempts,
              cachedPath: yutoPath,
              cachedBaseUrl: yutoBaseUrl,
              cachedAuthType: "yuto-api",
            };
          }
        } catch (error) {
          attempts.push({
            keyIndex,
            keyTotal: apiKeys.length,
            authType: "yuto-api",
            baseUrl: yutoBaseUrl,
            path: yutoPath,
            ok: false,
            reason: error instanceof Error ? error.message : "request_failed",
          });
        }
      }
    }

    // CherryIN 特殊处理：使用 New-API-User Header（格式同 YutoAPI）
    if (!profile.customUrlOnly && isCherryINUrl(baseUrl)) {
      const yutoKey = parseYutoApiKey(apiKey);
      const cherryBaseUrls = [rootBaseUrl, baseUrl].filter(
        (url, index, all) => url && all.indexOf(url) === index,
      );

      for (const cherryBaseUrl of cherryBaseUrls) {
        const cherryPath = "api/user/self";
        console.log(
          `[Provider Balance] 💡 CherryIN 模式：${cherryBaseUrl}/${cherryPath}`,
        );
        try {
          const headers: Record<string, string> = {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(yutoKey.userId ? { "New-API-User": yutoKey.userId } : {}),
            Authorization: `Bearer ${yutoKey.token}`,
          };
          const response = await fetch(`${cherryBaseUrl}/${cherryPath}`, {
            headers,
            signal: getBalanceRequestSignal(profile.signal),
            cache: "no-store",
          });
          const responseBody = response.ok
            ? await response.json().catch(() => null)
            : null;
          const value = response.ok
            ? parseProviderBalanceValue(responseBody, "quota")
            : null;
          attempts.push({
            keyIndex,
            keyTotal: apiKeys.length,
            authType: "cherryin-api",
            baseUrl: cherryBaseUrl,
            path: cherryPath,
            status: response.status,
            ok: value !== null,
            reason:
              value !== null
                ? undefined
                : response.ok
                ? "balance_field_missing"
                : "http_error",
          });
          if (value !== null) {
            console.log(
              `[Provider Balance] ✅ CherryIN 查询成功: ${cherryBaseUrl}/${cherryPath}`,
            );
            return {
              value,
              currency: "USD",
              queriedAt: Date.now(),
              attempts,
              cachedPath: cherryPath,
              cachedBaseUrl: cherryBaseUrl,
              cachedAuthType: "cherryin-api",
            };
          }
        } catch (error) {
          attempts.push({
            keyIndex,
            keyTotal: apiKeys.length,
            authType: "cherryin-api",
            baseUrl: cherryBaseUrl,
            path: cherryPath,
            ok: false,
            reason: error instanceof Error ? error.message : "request_failed",
          });
        }
      }
    }

    // 自定义 URL 专用模式：只查询用户填写的路径，但尝试多种 baseUrl 和认证方式组合
    if (profile.customUrlOnly && profile.cachedPath) {
      const cachedPath = profile.cachedPath;
      console.log(
        `[Provider Balance] 💡 自定义 URL 模式：仅查询 ${cachedPath}`,
      );
      // 自定义 URL 模式下尝试多种 baseUrl 组合和认证类型
      const customBaseUrls = buildBalanceBaseUrls(
        profile.cachedBaseUrl || baseUrl,
        profile.cachedBaseUrl
          ? profile.cachedBaseUrl.replace(/\/v1$/i, "")
          : baseUrl.replace(/\/v1$/i, ""),
      );
      const customAuthTypes = buildBalanceAuthTypes(
        (profile.cachedAuthType as BalanceAuthType | undefined) ||
          configuredAuthType,
      );
      const customCandidates: BalanceCandidate[] = customBaseUrls.flatMap(
        (candidateBaseUrl) =>
          customAuthTypes.map((authType) => ({
            candidateBaseUrl,
            path: cachedPath.startsWith("/") ? cachedPath.slice(1) : cachedPath,
            authType,
          })),
      );

      const customValue = await runBalanceCandidateQueue(
        customCandidates,
        async ({ candidateBaseUrl, path, authType }) => {
          const keyParts = apiKey.split("|");
          const actualKey = keyParts[0];
          const newApiUserId = keyParts[1];

          const headers: Record<string, string> = {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...parseExtraHeaders(profile.extraHeaders),
            ...buildBalanceAuthHeaders(actualKey, authType),
            ...(newApiUserId ? { "New-API-User": newApiUserId } : {}),
          };
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
            actualKey,
            authType,
            profile.authQueryParam,
          );
          try {
            const response = await fetch(url, {
              headers,
              signal: getBalanceRequestSignal(profile.signal),
              cache: "no-store",
            });
            if (!response.ok) {
              attempts.push({
                keyIndex,
                keyTotal: apiKeys.length,
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
            const value = parseProviderBalanceValue(responseBody);
            if (value !== null) {
              attempts.push({
                keyIndex,
                keyTotal: apiKeys.length,
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
              keyTotal: apiKeys.length,
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
              keyTotal: apiKeys.length,
              authType,
              baseUrl: attemptBaseUrl,
              path,
              ok: false,
              reason: error instanceof Error ? error.message : "request_failed",
            });
          }
          return null;
        },
      );

      if (customValue !== null) {
        const successAttempt = attempts.find(
          (attempt) => attempt.keyIndex === keyIndex && attempt.ok,
        );
        const usedPath = cachedPath.startsWith("/")
          ? cachedPath
          : `/${cachedPath}`;
        console.log(
          `[Provider Balance] ✅ 自定义 URL 查询成功: ${
            profile.cachedBaseUrl || baseUrl
          }${usedPath}`,
        );
        return {
          value: customValue,
          currency: "USD",
          queriedAt: Date.now(),
          attempts,
          cachedPath: cachedPath,
          cachedBaseUrl: profile.cachedBaseUrl || baseUrl,
          cachedAuthType: successAttempt?.authType,
        };
      }
      console.log(`[Provider Balance] ⚠️ 自定义 URL 查询失败`);
      // 自定义 URL 模式不继续探测其他路径，直接返回失败
      throw new ProviderBalanceQueryError("balance_not_supported", attempts);
    }

    // 如果有缓存路径，优先尝试缓存的路径
    let candidates = buildBalanceCandidates(baseUrls, authTypes);

    // 尝试缓存路径（如果有）
    if (profile.cachedPath && profile.cachedBaseUrl && profile.cachedAuthType) {
      const cachedPath = profile.cachedPath.startsWith("/")
        ? profile.cachedPath
        : `/${profile.cachedPath}`;
      console.log(
        `[Provider Balance] 💡 优先尝试上次成功的缓存路径: ${profile.cachedBaseUrl}${cachedPath} (auth: ${profile.cachedAuthType})`,
      );
      const cachedCandidates: BalanceCandidate[] = [
        {
          candidateBaseUrl: profile.cachedBaseUrl,
          path: profile.cachedPath,
          authType: profile.cachedAuthType as BalanceAuthType,
        },
      ];

      // 先尝试缓存路径
      const cachedValue = await runBalanceCandidateQueue(
        cachedCandidates,
        async ({ candidateBaseUrl, path, authType }) => {
          const keyParts = apiKey.split("|");
          const actualKey = keyParts[0];
          const newApiUserId = keyParts[1];

          const headers: Record<string, string> = {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...parseExtraHeaders(profile.extraHeaders),
            ...buildBalanceAuthHeaders(actualKey, authType),
            ...(newApiUserId ? { "New-API-User": newApiUserId } : {}),
          };
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
            actualKey,
            authType,
            profile.authQueryParam,
          );
          try {
            const response = await fetch(url, {
              headers,
              signal: getBalanceRequestSignal(profile.signal),
              cache: "no-store",
            });
            if (!response.ok) {
              attempts.push({
                keyIndex,
                keyTotal: apiKeys.length,
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
            const value = parseProviderBalanceValue(responseBody);
            if (value !== null) {
              attempts.push({
                keyIndex,
                keyTotal: apiKeys.length,
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
              keyTotal: apiKeys.length,
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
              keyTotal: apiKeys.length,
              authType,
              baseUrl: attemptBaseUrl,
              path,
              ok: false,
              reason: error instanceof Error ? error.message : "request_failed",
            });
          }
          return null;
        },
      );

      if (cachedValue !== null) {
        const cachedPath = profile.cachedPath.startsWith("/")
          ? profile.cachedPath
          : `/${profile.cachedPath}`;
        console.log(
          `[Provider Balance] ✅ 缓存路径查询成功: ${profile.cachedBaseUrl}${cachedPath}`,
        );
        return {
          value: cachedValue,
          currency: "USD",
          queriedAt: Date.now(),
          attempts,
          cachedPath: profile.cachedPath,
          cachedBaseUrl: profile.cachedBaseUrl,
          cachedAuthType: profile.cachedAuthType,
        };
      }
      console.log(`[Provider Balance] ⚠️ 缓存路径查询失败，继续全量探测`);
    }

    const value = await runBalanceCandidateQueue(
      candidates,
      async ({ candidateBaseUrl, path, authType }) => {
        const keyParts = apiKey.split("|");
        const actualKey = keyParts[0];
        const newApiUserId = keyParts[1];

        const headers: Record<string, string> = {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...parseExtraHeaders(profile.extraHeaders),
          ...buildBalanceAuthHeaders(actualKey, authType),
          ...(newApiUserId ? { "New-API-User": newApiUserId } : {}),
        };

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
          actualKey,
          authType,
          profile.authQueryParam,
        );
        try {
          const response = await fetch(url, {
            headers,
            signal: getBalanceRequestSignal(profile.signal),
            cache: "no-store",
          });
          if (!response.ok) {
            attempts.push({
              keyIndex,
              keyTotal: apiKeys.length,
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
          const value = parseProviderBalanceValue(responseBody);
          if (value !== null) {
            attempts.push({
              keyIndex,
              keyTotal: apiKeys.length,
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
            keyTotal: apiKeys.length,
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
            keyTotal: apiKeys.length,
            authType,
            baseUrl: attemptBaseUrl,
            path,
            ok: false,
            reason: error instanceof Error ? error.message : "request_failed",
          });
        }
        return null;
      },
    );
    if (value !== null) {
      // 从 attempts 中找到当前 key 的成功记录
      const successAttempt = attempts.find(
        (a) => a.keyIndex === keyIndex && a.ok === true,
      );
      const successPath = successAttempt?.path;
      const successBaseUrl = successAttempt?.baseUrl;
      // path 可能不带前导 /，需要确保正确拼接
      const fullPath = successPath?.startsWith("/")
        ? successPath
        : `/${successPath}`;
      console.log(
        `[Provider Balance] ✅ 全量探测成功: ${successBaseUrl}${fullPath}`,
      );
      return {
        value,
        currency: "USD",
        queriedAt: Date.now(),
        attempts,
        cachedPath: successPath,
        cachedBaseUrl: successBaseUrl,
        cachedAuthType: successAttempt?.authType,
      };
    }
  }

  if (attempts.some((attempt) => attempt.status === 429)) {
    throw new ProviderBalanceQueryError("balance_rate_limited", attempts);
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
    if (profile.signal?.aborted) {
      throw new DOMException("The balance query was aborted", "AbortError");
    }
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
      if (profile.signal?.aborted) {
        throw new DOMException("The balance query was aborted", "AbortError");
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
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timeoutId);
          reject(
            new DOMException("The balance query was aborted", "AbortError"),
          );
        };
        const timeoutId = setTimeout(() => {
          profile.signal?.removeEventListener("abort", onAbort);
          resolve();
        }, delayMs);
        profile.signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
  }

  throw new ProviderBalanceQueryError(
    "balance_not_supported",
    accumulatedAttempts,
  );
}
