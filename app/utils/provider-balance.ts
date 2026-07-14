import { safeLocalStorage } from "./safe-local-storage";

export type ProviderBalanceSnapshot = {
  value: number;
  currency: string;
  queriedAt: number;
};

export type ProviderBalanceProfile = {
  profileId: string;
  profileName: string;
  baseUrl: string;
  hasManagementKey: boolean;
  maskedManagementKey: string;
  managementKey: string;
  balance: ProviderBalanceSnapshot | null;
  lastError: string;
  customBalanceUrl?: string;
  cachedPath?: string;
  cachedBaseUrl?: string;
  // New-API-User 格式支持
  useNewApiUserFormat?: boolean;
  newApiUserId?: string;
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

const PROVIDER_BALANCE_API_PATH = "/api/db/provider-balance";
const PROVIDER_BALANCE_PROFILES_CACHE_KEY =
  "nextchat:provider-balance-profiles:v1";
let balanceRequestSequence = 0;

export function hasExplicitProviderBalancePath(value?: string) {
  const trimmedValue = String(value || "").trim();
  if (!trimmedValue) return false;
  try {
    const url = new URL(trimmedValue);
    return Boolean(url.pathname.replace(/^\/+|\/+$/g, ""));
  } catch {
    return Boolean(trimmedValue.split(/[?#]/, 1)[0].replace(/^\/+|\/+$/g, ""));
  }
}

export function resolveProviderBalanceQueryTarget(
  value: string,
  fallbackBaseUrl: string,
) {
  const trimmedValue = String(value || "").trim();
  if (!trimmedValue) {
    return {
      baseUrl: fallbackBaseUrl,
      path: "",
      hasExplicitPath: false,
    };
  }
  if (/^https?:\/\//i.test(trimmedValue)) {
    try {
      const url = new URL(trimmedValue);
      const path = `${url.pathname.replace(/^\//, "")}${url.search}`;
      return {
        baseUrl: url.origin,
        path,
        hasExplicitPath: hasExplicitProviderBalancePath(path),
      };
    } catch {
      // 交给相对路径分支，以数据库 Base URL 继续校验和查询。
    }
  }
  const path = trimmedValue.replace(/^\//, "");
  return {
    baseUrl: fallbackBaseUrl,
    path,
    hasExplicitPath: hasExplicitProviderBalancePath(path),
  };
}

type CachedProviderBalanceProfile = Pick<
  ProviderBalanceProfile,
  "profileId" | "profileName" | "baseUrl" | "hasManagementKey" | "balance"
>;

function normalizeCachedBalance(
  value: unknown,
): ProviderBalanceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const balance = value as Partial<ProviderBalanceSnapshot>;
  if (!Number.isFinite(balance.value) || !Number.isFinite(balance.queriedAt)) {
    return null;
  }
  return {
    value: Number(balance.value),
    currency: typeof balance.currency === "string" ? balance.currency : "USD",
    queriedAt: Number(balance.queriedAt),
  };
}

function toCachedProfile(
  profile: ProviderBalanceProfile,
): CachedProviderBalanceProfile {
  return {
    profileId: profile.profileId,
    profileName: profile.profileName,
    baseUrl: profile.baseUrl,
    hasManagementKey: profile.hasManagementKey,
    balance: normalizeCachedBalance(profile.balance),
  };
}

function fromCachedProfile(value: unknown): ProviderBalanceProfile | null {
  if (!value || typeof value !== "object") return null;
  const profile = value as Partial<CachedProviderBalanceProfile>;
  if (!profile.profileId || typeof profile.profileId !== "string") return null;
  return {
    profileId: profile.profileId,
    profileName:
      typeof profile.profileName === "string" && profile.profileName
        ? profile.profileName
        : profile.profileId,
    baseUrl: typeof profile.baseUrl === "string" ? profile.baseUrl : "",
    hasManagementKey: profile.hasManagementKey === true,
    maskedManagementKey: "",
    managementKey: "",
    balance: normalizeCachedBalance(profile.balance),
    lastError: "",
    customBalanceUrl: "",
    cachedPath: "",
    cachedBaseUrl: "",
    useNewApiUserFormat: false,
    newApiUserId: "",
  };
}

export function readCachedProviderBalanceProfiles(): ProviderBalanceProfile[] {
  try {
    const raw = safeLocalStorage().getItem(PROVIDER_BALANCE_PROFILES_CACHE_KEY);
    const values = raw ? JSON.parse(raw) : [];
    return Array.isArray(values)
      ? values
          .map(fromCachedProfile)
          .filter((profile): profile is ProviderBalanceProfile =>
            Boolean(profile),
          )
      : [];
  } catch {
    return [];
  }
}

export function cacheProviderBalanceProfiles(
  profiles: ProviderBalanceProfile[],
) {
  const sanitizedProfiles = profiles
    .filter((profile) => Boolean(profile.profileId))
    .map(toCachedProfile);
  safeLocalStorage().setItem(
    PROVIDER_BALANCE_PROFILES_CACHE_KEY,
    JSON.stringify(sanitizedProfiles),
  );
}

export function readCachedProviderBalance(
  profileId: string,
  providerName?: string,
) {
  const profiles = readCachedProviderBalanceProfiles();
  const exact = profiles.find((profile) => profile.profileId === profileId);
  if (exact) return exact.balance;
  const normalizedName = String(providerName || "")
    .trim()
    .toLocaleLowerCase();
  if (normalizedName) {
    const namedBalance = profiles.find(
      (profile) =>
        profile.profileName.trim().toLocaleLowerCase() === normalizedName,
    )?.balance;
    if (namedBalance) return namedBalance;
  }
  if (!profileId) return null;
  try {
    const legacyValue = JSON.parse(
      safeLocalStorage().getItem(
        `nextchat:provider-balance:shared:${profileId}`,
      ) || "null",
    );
    return normalizeCachedBalance(legacyValue);
  } catch {
    return null;
  }
}

export function cacheProviderBalance(
  profileId: string,
  balance: ProviderBalanceSnapshot | null,
  providerName?: string,
) {
  if (!profileId) return;
  const profiles = readCachedProviderBalanceProfiles();
  const existingIndex = profiles.findIndex(
    (profile) => profile.profileId === profileId,
  );
  const existing = existingIndex >= 0 ? profiles[existingIndex] : null;
  const nextProfile: ProviderBalanceProfile = {
    ...(existing || {
      profileId,
      profileName: providerName || profileId,
      baseUrl: "",
      hasManagementKey: false,
      maskedManagementKey: "",
      managementKey: "",
      lastError: "",
    }),
    profileId,
    profileName: providerName || existing?.profileName || profileId,
    balance: normalizeCachedBalance(balance),
  };
  if (existingIndex >= 0) {
    profiles[existingIndex] = nextProfile;
  } else {
    profiles.push(nextProfile);
  }
  cacheProviderBalanceProfiles(profiles);
}

function createBalanceRequestContext(action: string, profileId?: string) {
  balanceRequestSequence += 1;
  return {
    requestId: `balance-${Date.now()}-${balanceRequestSequence}`,
    action,
    profileId: profileId || "",
    requestPath: PROVIDER_BALANCE_API_PATH,
    startedAt: Date.now(),
  };
}

function logBalanceAttempts(attempts: ProviderBalanceAttempt[]) {
  if (attempts.length === 0) {
    return;
  }
  const okCount = attempts.filter((a) => a?.ok === true).length;
  const failCount = attempts.length - okCount;
  // 按 key 分组统计
  const keyGroups = attempts.reduce(
    (acc, a) => {
      const keyLabel = `key ${(a.keyIndex || 0) + 1}/${a.keyTotal || 1}`;
      if (!acc[keyLabel]) {
        acc[keyLabel] = { ok: 0, fail: 0 };
      }
      if (a.ok) {
        acc[keyLabel].ok++;
      } else {
        acc[keyLabel].fail++;
      }
      return acc;
    },
    {} as Record<string, { ok: number; fail: number }>,
  );
  const keySummary = Object.entries(keyGroups)
    .map(([key, { ok, fail }]) => `${key}: 成功${ok} 失败${fail}`)
    .join(", ");
  console.log(
    `[Provider Balance] 上游尝试 ${attempts.length} 次：成功 ${okCount}，失败 ${failCount}（${keySummary}）`,
  );
}

const BALANCE_ERROR_MESSAGES: Record<string, string> = {
  balance_profile_incomplete:
    "余额查询配置不完整，请检查 Base URL 和管理 API Key",
  balance_auth_failed: "余额查询鉴权失败，请检查管理 API Key 是否有效或已过期",
  balance_rate_limited: "余额查询触发上游限流，请稍后重试或减少批量查询",
  balance_not_supported:
    "未找到可用的余额查询路径，请确认该供应商支持余额接口或填写管理 API Key",
  missing_profile_id: "缺少配置 ID",
  missing_new_api_user_id: "New-API-User 模式需要填写 User ID",
  provider_not_found: "未找到对应 API 配置",
  query_failed: "余额查询失败",
};

export function getProviderBalanceErrorMessage(
  error: unknown,
  fallback = "余额查询失败",
) {
  const message = error instanceof Error ? error.message : String(error || "");
  return BALANCE_ERROR_MESSAGES[message] || message || fallback;
}

export class ProviderBalanceRequestError extends Error {
  attempts: ProviderBalanceAttempt[];
  balance?: ProviderBalanceSnapshot | null;

  constructor(
    message: string,
    attempts: ProviderBalanceAttempt[] = [],
    balance?: ProviderBalanceSnapshot | null,
  ) {
    super(message);
    this.name = "ProviderBalanceRequestError";
    this.attempts = attempts;
    this.balance = balance;
  }
}

type ProviderBalanceApiPayload = {
  ok?: boolean;
  error?: string;
  profiles?: unknown;
  balance?: unknown;
  attempts?: unknown;
};

async function readResponsePayload(response: Response) {
  return response
    .json()
    .catch(() => null) as Promise<ProviderBalanceApiPayload | null>;
}

export async function loadProviderBalanceProfiles(signal?: AbortSignal) {
  const context = createBalanceRequestContext("load-profiles");
  const response = await fetch(PROVIDER_BALANCE_API_PATH, {
    cache: "no-store",
    signal,
  });
  const payload = await readResponsePayload(response);
  if (!response.ok || payload?.ok !== true) {
    console.error("[Provider Balance] 读取余额配置失败", {
      ...context,
      durationMs: Date.now() - context.startedAt,
      httpStatus: response.status,
      response: payload,
    });
    throw new Error(payload?.error || "load_failed");
  }
  const profiles = (
    Array.isArray(payload.profiles) ? payload.profiles : []
  ) as ProviderBalanceProfile[];
  return profiles;
}

export async function resolveProviderBalanceProfileId(
  profileId: string,
  providerName?: string,
  signal?: AbortSignal,
) {
  if (!profileId && !providerName) return "";

  const profiles = await loadProviderBalanceProfiles(signal);
  const exactProfile = profiles.find(
    (profile) => profile.profileId === profileId,
  );
  if (exactProfile) return exactProfile.profileId;

  const normalizedProviderName = String(providerName || "")
    .trim()
    .toLocaleLowerCase();
  if (!normalizedProviderName) return "";

  return (
    profiles.find(
      (profile) =>
        String(profile.profileName || "")
          .trim()
          .toLocaleLowerCase() === normalizedProviderName,
    )?.profileId || ""
  );
}

export async function loadProviderBalance(
  profileId: string,
  signal?: AbortSignal,
) {
  if (!profileId) return null;
  const context = createBalanceRequestContext("load-balance", profileId);
  const response = await fetch(
    `${PROVIDER_BALANCE_API_PATH}?profileId=${encodeURIComponent(profileId)}`,
    { cache: "no-store", signal },
  );
  const payload = await readResponsePayload(response);
  if (!response.ok || payload?.ok !== true) {
    console.error("[Provider Balance] 读取数据库余额失败", {
      ...context,
      durationMs: Date.now() - context.startedAt,
      httpStatus: response.status,
      response: payload,
    });
    throw new Error(payload?.error || "load_failed");
  }
  const balance = payload.balance as ProviderBalanceSnapshot | null;
  return Number.isFinite(balance?.value) ? balance : null;
}

export async function saveProviderBalanceConfig(
  profileId: string,
  payload: {
    managementKey?: string;
    customBalanceUrl?: string;
    useNewApiUserFormat?: boolean;
    newApiUserId?: string;
  },
) {
  const context = createBalanceRequestContext("save-balance-config", profileId);
  const response = await fetch(PROVIDER_BALANCE_API_PATH, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId, ...payload }),
  });
  const resPayload = await readResponsePayload(response);
  if (!response.ok || resPayload?.ok !== true) {
    console.error("[Provider Balance] 余额配置保存失败", {
      ...context,
      durationMs: Date.now() - context.startedAt,
      httpStatus: response.status,
      response: resPayload,
    });
    throw new Error(resPayload?.error || "save_failed");
  }
}

export async function queryProviderBalanceProfile(
  profileId: string,
  options?: {
    signal?: AbortSignal;
    source?: string;
    providerName?: string;
    logSuccess?: boolean;
  },
) {
  const context = {
    ...createBalanceRequestContext("query-balance", profileId),
    source: options?.source || "unknown",
    providerName: options?.providerName || profileId,
  };
  let response: Response;
  try {
    response = await fetch(PROVIDER_BALANCE_API_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        profileId,
      }),
      signal: options?.signal,
    });
  } catch (error) {
    const isAborted =
      options?.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError");
    if (isAborted) {
      console.debug(
        `[Provider Balance] ⏹️ ${context.providerName} 余额请求已取消`,
      );
      throw error;
    }
    console.error("[Provider Balance] 余额请求未完成", {
      ...context,
      durationMs: Date.now() - context.startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const payload = await readResponsePayload(response);
  const attempts = Array.isArray(payload?.attempts) ? payload.attempts : [];
  if (!response.ok || payload?.ok !== true) {
    console.error(
      `[Provider Balance] ❌ 供应商 ${context.providerName} 余额查询失败：${
        payload?.error || "query_failed"
      }`,
    );
    logBalanceAttempts(attempts);
    // 从响应中提取可能的余额数据
    let fallbackBalance: ProviderBalanceSnapshot | undefined;
    if (payload && typeof payload === "object" && "balance" in payload) {
      fallbackBalance = payload.balance as ProviderBalanceSnapshot;
    }
    throw new ProviderBalanceRequestError(
      payload?.error || "query_failed",
      attempts,
      fallbackBalance,
    );
  }
  const balance = payload.balance as ProviderBalanceSnapshot;
  if (!Number.isFinite(balance?.value)) {
    console.error(
      `[Provider Balance] ❌ 供应商 ${context.providerName} 返回结果缺少有效余额`,
    );
    logBalanceAttempts(attempts);
    throw new ProviderBalanceRequestError("query_failed", attempts);
  }
  if (options?.logSuccess !== false) {
    const formattedBalance =
      balance.value === -1 ? "无限" : `$${balance.value.toFixed(2)}`;
    const durationMs = Date.now() - context.startedAt;
    console.log(
      `[Provider Balance] ✅ 供应商 ${context.providerName}：${formattedBalance}（${durationMs}ms）`,
    );
  }
  return {
    balance,
    attempts,
    cachedPath: (payload as any).cachedPath,
    cachedBaseUrl: (payload as any).cachedBaseUrl,
  };
}
