import {
  FETCH_COMMIT_URL,
  FETCH_TAG_URL,
  ModelProvider,
  ServiceProvider,
  StoreKey,
} from "../constant";
import {
  findCustomBalanceQueryRule,
  type CustomBalanceQueryRule,
} from "../config/custom-balance";
import { getClientConfig } from "../config/client";
import { createPersistStore } from "../utils/store";
import { clientUpdate } from "../utils";
import { withSyncUserHeaders } from "../utils/sync-user-client";
import ChatGptIcon from "../icons/chatgpt.png";
import Locale from "../locales";
import { ClientApi, getClientApi } from "../client/api";
import { useAccessStore } from "./access";

const ONE_MINUTE = 60 * 1000;
const BALANCE_REFRESH_INTERVAL = 60 * 1000;
const isApp = !!getClientConfig()?.isApp;
const inflightBalanceQueries = new Map<string, Promise<void>>();

export type BalanceSnapshot = {
  used: number;
  total: number;
  remaining: number;
  metricType?: "currency" | "requests" | "tokens";
  displayValue?: number;
  displayLabel?: string;
  exactUsed?: number;
  exactTotal?: number;
  exactRemaining?: number;
  updatedAt: number;
  provider: ServiceProvider;
  profileId?: string;
  profileName?: string;
};

export type BalanceAwareProfile = {
  id?: string;
  name: string;
  provider: ServiceProvider;
  baseUrl: string;
  apiKey: string;
  balanceQueryUrl?: string;
  balanceQueryApiKey?: string;
  balanceQueryField?: string;
  modelFetchApiKey?: string;
};

type ActiveCustomProfile = BalanceAwareProfile | undefined;

export function buildBalanceCacheKey(
  provider: ServiceProvider,
  profile?: { id?: string; name?: string },
) {
  if (
    provider === ServiceProvider.Custom ||
    provider === ServiceProvider.Local
  ) {
    const prefix = provider === ServiceProvider.Local ? "local" : "custom";
    const profileId = String(profile?.id || "").trim();
    if (profileId) {
      return `${prefix}:${profileId}`;
    }

    const profileName = String(profile?.name || "")
      .trim()
      .toLowerCase();
    return profileName ? `${prefix}-name:${profileName}` : `${prefix}:default`;
  }

  return `provider:${provider}`;
}

function isMissingCustomProviderConfigError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("未找到已启用的 Custom 供应商配置");
}

function isExpectedCustomBalanceError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalizedMessage = message.toLowerCase();

  return [
    "未找到已启用的 custom 供应商配置",
    "access token 无效",
    "api key",
    "401",
    "403",
    "无权",
    "未授权",
    "unauthorized",
    "forbidden",
    "invalid token",
    "invalid api key",
  ].some(
    (pattern) =>
      message.includes(pattern) || normalizedMessage.includes(pattern),
  );
}

function logBalanceQueryStart(payload: Record<string, unknown>) {
  console.log("[Balance] 开始查询余额", payload);
}

function logBalanceQueryResult(payload: Record<string, unknown>) {
  console.log("[Balance] 查询结果", payload);
}

function formatVersionDate(t: string) {
  const d = new Date(+t);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();

  return [
    year.toString(),
    month.toString().padStart(2, "0"),
    day.toString().padStart(2, "0"),
  ].join("");
}

type VersionType = "date" | "tag";

async function getVersion(type: VersionType) {
  if (type === "date") {
    const data = (await (await fetch(FETCH_COMMIT_URL)).json()) as {
      commit: {
        author: { name: string; date: string };
      };
      sha: string;
    }[];
    const remoteCommitTime = data[0].commit.author.date;
    const remoteId = new Date(remoteCommitTime).getTime().toString();
    return remoteId;
  } else if (type === "tag") {
    const data = (await (await fetch(FETCH_TAG_URL)).json()) as {
      commit: { sha: string; url: string };
      name: string;
    }[];
    return data.at(0)?.name;
  }
}

function getActiveCustomProfile() {
  const accessStore = useAccessStore.getState();
  return accessStore.apiProfiles.find(
    (profile) =>
      profile.enabled &&
      profile.provider === ServiceProvider.Custom &&
      !!profile.baseUrl &&
      !!profile.apiKey,
  ) as BalanceAwareProfile | undefined;
}

function normalizeCustomBaseUrl(baseUrl: string) {
  const normalizedBaseUrl = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  return normalizedBaseUrl.startsWith("http")
    ? normalizedBaseUrl
    : `https://${normalizedBaseUrl}`;
}

function getBalanceQueryApiKey(
  rule: CustomBalanceQueryRule,
  profile?: ActiveCustomProfile,
) {
  const profileModelFetchApiKey = String(
    profile?.modelFetchApiKey || "",
  ).trim();
  if (rule.mode === "ocoolai" && profileModelFetchApiKey) {
    return profileModelFetchApiKey;
  }

  const profileApiKey = String(profile?.balanceQueryApiKey || "").trim();
  if (profileApiKey) {
    return profileApiKey;
  }

  if (rule.apiKey) {
    return String(rule.apiKey).trim();
  }

  return String(
    profile?.apiKey ||
      profileModelFetchApiKey ||
      getActiveCustomProfile()?.apiKey ||
      "",
  ).trim();
}

function getBalanceQueryField(
  rule: CustomBalanceQueryRule,
  profile?: ActiveCustomProfile,
) {
  const profileField = String(profile?.balanceQueryField || "").trim();
  if (profileField) {
    return profileField;
  }

  return String(rule.field || "").trim();
}

function getBalanceQueryUrl(
  rule: CustomBalanceQueryRule,
  profile?: ActiveCustomProfile,
) {
  const requestUrl = String(profile?.balanceQueryUrl || rule.url || "").trim();
  if (!requestUrl) return "";
  return requestUrl.startsWith("http") ? requestUrl : `https://${requestUrl}`;
}

function getBalanceQueryBaseUrl(
  rule: CustomBalanceQueryRule,
  profile?: ActiveCustomProfile,
) {
  return normalizeCustomBaseUrl(
    profile?.balanceQueryUrl || rule.url || "",
  ).replace(/\/(?:api(?:\/v1)?\/)?user\/self$/i, "");
}

function getBalanceQueryApiBaseUrl(
  rule: CustomBalanceQueryRule,
  profile?: ActiveCustomProfile,
) {
  const requestBaseUrl = getBalanceQueryBaseUrl(rule, profile);
  return /\/v1$/i.test(requestBaseUrl)
    ? requestBaseUrl
    : `${requestBaseUrl}/v1`;
}

function getValueByPath(payload: unknown, path: string) {
  if (!path) return undefined;

  return path
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce<unknown>((current, key) => {
      if (current && typeof current === "object" && key in current) {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, payload);
}

function getRequiredCustomBalanceRule(profile?: ActiveCustomProfile) {
  const activeCustomProfile = profile || getActiveCustomProfile();

  if (!activeCustomProfile) {
    throw new Error("未找到已启用的 Custom 供应商配置");
  }

  const rule = findCustomBalanceQueryRule(activeCustomProfile);

  if (!rule) {
    throw new Error(
      `未找到 ${activeCustomProfile.name} 的余额查询规则，请在 app/config/custom-balance.ts 中配置`,
    );
  }

  return rule;
}

async function queryJsonCustomUsage(
  rule: CustomBalanceQueryRule,
  profile?: ActiveCustomProfile,
) {
  const requestUrl = getBalanceQueryUrl(rule, profile);
  const fieldPath = getBalanceQueryField(rule, profile);
  const authKey = getBalanceQueryApiKey(rule, profile);

  if (!requestUrl || !fieldPath || !authKey) {
    throw new Error("余额查询 URL、API Key 或字段路径未配置");
  }

  const res = await fetch(requestUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${authKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`自定义余额查询失败: ${res.status}`);
  }

  const json = (await res.json()) as unknown;
  const rawValue = getValueByPath(json, fieldPath);
  const total = Number(rawValue);

  if (!Number.isFinite(total)) {
    throw new Error(`未找到可用的余额字段: ${fieldPath}`);
  }

  return {
    used: 0,
    total,
  };
}

async function queryAihubMixUsage(
  rule: CustomBalanceQueryRule,
  profile?: ActiveCustomProfile,
) {
  const requestBaseUrl = getBalanceQueryBaseUrl(rule, profile);

  const res = await fetch(`${requestBaseUrl}/api/user/self`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getBalanceQueryApiKey(rule, profile)}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`AihubMix 余额查询失败: ${res.status}`);
  }

  const json = (await res.json()) as {
    success?: boolean;
    message?: string;
    data?: {
      quota?: number;
      used_quota?: number;
    };
  };

  if (json.success === false) {
    throw new Error(json.message || "AihubMix 余额查询失败");
  }

  const quota = Number(json.data?.quota || 0);
  const total = quota / 500000;

  return { used: 0, total };
}

async function queryOcoolaiUsage(
  rule: CustomBalanceQueryRule,
  profile?: ActiveCustomProfile,
) {
  const requestBaseUrl = getBalanceQueryBaseUrl(rule, profile);
  const res = await fetch(`${requestBaseUrl}/api/user/self`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getBalanceQueryApiKey(rule, profile)}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Ocoolai 余额查询失败: ${res.status}`);
  }

  const json = (await res.json()) as {
    success?: boolean;
    message?: string;
    data?: {
      quota?: number;
    };
  };

  if (json.success === false) {
    throw new Error(json.message || "Ocoolai 余额查询失败");
  }

  const quota = Number(json.data?.quota || 0);
  const total = quota / 500000;

  return { used: 0, total };
}

async function queryToApisUsage(
  rule: CustomBalanceQueryRule,
  profile?: ActiveCustomProfile,
) {
  const requestBaseUrl = getBalanceQueryApiBaseUrl(rule, profile);
  const res = await fetch(`${requestBaseUrl}/user/balance`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getBalanceQueryApiKey(rule, profile)}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`ToAPIs 余额查询失败: ${res.status}`);
  }

  const json = (await res.json()) as {
    success?: boolean;
    remain_balance?: number;
  };

  if (json.success === false) {
    throw new Error("ToAPIs 余额查询失败");
  }

  const total = Number(json.remain_balance || 0);

  return { used: 0, total };
}

async function queryOpenAICompatibleCustomUsage(
  rule: CustomBalanceQueryRule,
  profile?: ActiveCustomProfile,
) {
  const requestBaseUrl = getBalanceQueryApiBaseUrl(rule, profile);
  const now = new Date();
  const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0",
  )}-01`;
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const endDate = `${tomorrow.getFullYear()}-${String(
    tomorrow.getMonth() + 1,
  ).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  const authKey = getBalanceQueryApiKey(rule, profile);

  const [used, subs] = await Promise.all([
    fetch(
      `${requestBaseUrl}/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      },
    ),
    fetch(`${requestBaseUrl}/dashboard/billing/subscription`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    }),
  ]);

  if (!used.ok || !subs.ok) {
    throw new Error("Custom OpenAI 兼容余额查询失败");
  }

  const usageJson = (await used.json()) as {
    total_usage?: number;
  };
  const subscriptionJson = (await subs.json()) as {
    hard_limit_usd?: number;
  };

  return {
    used: Number(usageJson.total_usage || 0) / 100,
    total: Number(subscriptionJson.hard_limit_usd || 0),
  };
}

export function getCustomProfileBalanceRefreshDelay(
  profile?: Pick<BalanceAwareProfile, "name">,
) {
  const normalizedName = String(profile?.name || "")
    .trim()
    .toLowerCase();
  if (normalizedName === "aihubmix") {
    return 6000;
  }
  if (normalizedName === "yutoapi" || normalizedName === "toapis") {
    return 0;
  }
  return null;
}

export async function queryBalanceSnapshot(
  provider: ServiceProvider,
  profile?: BalanceAwareProfile,
) {
  let usage: { used: number; total: number } | undefined;

  if (provider === ServiceProvider.Custom) {
    const rule = getRequiredCustomBalanceRule(profile);
    switch (rule.mode) {
      case "json":
        usage = await queryJsonCustomUsage(rule, profile);
        break;
      case "aihubmix":
        usage = await queryAihubMixUsage(rule, profile);
        break;
      case "ocoolai":
        usage = await queryOcoolaiUsage(rule, profile);
        break;
      case "toapis":
        usage = await queryToApisUsage(rule, profile);
        break;
      case "openai-compatible":
        usage = await queryOpenAICompatibleCustomUsage(rule, profile);
        break;
      default:
        throw new Error(`不支持的余额查询方式: ${rule.mode}`);
    }
  } else {
    const api =
      provider === ServiceProvider.OpenAI
        ? new ClientApi(ModelProvider.GPT)
        : getClientApi(provider);
    usage = await api.llm.usage();
  }

  if (!usage) {
    return undefined;
  }

  const exactUsed = Math.max(0, Number(usage.used || 0));
  const exactTotal = Math.max(0, Number(usage.total || 0));
  const exactRemaining = Math.max(0, exactTotal - exactUsed);
  return {
    used: exactUsed,
    total: exactTotal,
    remaining: exactRemaining,
    metricType: usage.metricType,
    displayValue:
      typeof usage.displayValue === "number" ? usage.displayValue : undefined,
    displayLabel: usage.displayLabel,
    exactUsed,
    exactTotal,
    exactRemaining,
    updatedAt: Date.now(),
    provider,
    profileId: profile?.id,
    profileName: profile?.name,
  } as BalanceSnapshot;
}

async function persistBalanceSnapshot(
  key: string,
  snapshot: BalanceSnapshot,
): Promise<void> {
  try {
    const response = await fetch("/api/db/balance", {
      method: "PUT",
      headers: withSyncUserHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        key,
        snapshot,
      }),
    });

    if (!response.ok) {
      const message = await response.text().catch(() => "");
      console.error(
        "[Balance] 保存数据库快照失败",
        response.status,
        response.statusText,
        message,
      );
    }
  } catch (error) {
    console.error(
      "[Balance] 保存数据库快照失败",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export const useUpdateStore = createPersistStore(
  {
    versionType: "tag" as VersionType,
    lastUpdate: 0,
    version: "unknown",
    remoteVersion: "",
    balances: {} as Record<string, BalanceSnapshot>,
    lastUpdateUsageByKey: {} as Record<string, number>,
  },
  (set, get) => ({
    formatVersion(version: string) {
      if (get().versionType === "date") {
        version = formatVersionDate(version);
      }
      return version;
    },

    async getLatestVersion(force = false) {
      const versionType = get().versionType;
      let version =
        versionType === "date"
          ? getClientConfig()?.commitDate
          : getClientConfig()?.version;

      set(() => ({ version }));

      const shouldCheck = Date.now() - get().lastUpdate > 2 * 60 * ONE_MINUTE;
      if (!force && !shouldCheck) return;

      set(() => ({
        lastUpdate: Date.now(),
      }));

      try {
        const remoteId = await getVersion(versionType);
        set(() => ({
          remoteVersion: remoteId,
        }));
        if (window.__TAURI__?.notification && isApp) {
          // Check if notification permission is granted
          await window.__TAURI__?.notification
            .isPermissionGranted()
            .then((granted) => {
              if (!granted) {
                return;
              } else {
                // Request permission to show notifications
                window.__TAURI__?.notification
                  .requestPermission()
                  .then((permission) => {
                    if (permission === "granted") {
                      if (version === remoteId) {
                        // Show a notification using Tauri
                        window.__TAURI__?.notification.sendNotification({
                          title: "NextChat",
                          body: `${Locale.Settings.Update.IsLatest}`,
                          icon: `${ChatGptIcon.src}`,
                          sound: "Default",
                        });
                      } else {
                        const updateMessage =
                          Locale.Settings.Update.FoundUpdate(`${remoteId}`);
                        // Show a notification for the new version using Tauri
                        window.__TAURI__?.notification.sendNotification({
                          title: "NextChat",
                          body: updateMessage,
                          icon: `${ChatGptIcon.src}`,
                          sound: "Default",
                        });
                        clientUpdate();
                      }
                    }
                  });
              }
            });
        }
        console.log("[Got Upstream] ✅ ", remoteId);
      } catch (error) {
        console.error("[Fetch Upstream Commit Id] ❌", error);
      }
    },

    async updateUsage(
      force = false,
      provider: ServiceProvider = ServiceProvider.OpenAI,
      profile?: BalanceAwareProfile,
    ) {
      const activeProfile =
        provider === ServiceProvider.Custom
          ? profile || getActiveCustomProfile()
          : provider === ServiceProvider.Local
          ? profile ||
            useAccessStore
              .getState()
              .apiProfiles.find(
                (item) =>
                  item.enabled && item.provider === ServiceProvider.Local,
              )
          : undefined;
      const cacheKey = buildBalanceCacheKey(provider, activeProfile);
      const lastUpdateUsage = get().lastUpdateUsageByKey[cacheKey] ?? 0;
      const overOneMinute =
        Date.now() - lastUpdateUsage >= BALANCE_REFRESH_INTERVAL;
      if (!overOneMinute && !force) {
        return;
      }

      const inflightQuery = inflightBalanceQueries.get(cacheKey);
      if (inflightQuery) {
        return inflightQuery;
      }

      set(() => ({
        lastUpdateUsageByKey: {
          ...get().lastUpdateUsageByKey,
          [cacheKey]: Date.now(),
        },
      }));

      const startedAt = Date.now();
      logBalanceQueryStart({
        provider,
        cacheKey,
        force,
        profileId: activeProfile?.id,
        profileName: activeProfile?.name,
      });

      const queryPromise = (async () => {
        let errorMessage: string | undefined;

        try {
          const snapshot = await queryBalanceSnapshot(provider, activeProfile);
          if (snapshot) {
            set(() => ({
              balances: {
                ...get().balances,
                [cacheKey]: snapshot,
              },
            }));

            void persistBalanceSnapshot(cacheKey, snapshot);

            logBalanceQueryResult({
              provider,
              cacheKey,
              force,
              profileId: activeProfile?.id,
              profileName: activeProfile?.name,
              used: snapshot.used,
              total: snapshot.total,
              remaining: snapshot.remaining,
              durationMs: Date.now() - startedAt,
              ok: true,
            });
          }
        } catch (e) {
          errorMessage = e instanceof Error ? e.message : String(e);
          logBalanceQueryResult({
            provider,
            cacheKey,
            force,
            profileId: activeProfile?.id,
            profileName: activeProfile?.name,
            durationMs: Date.now() - startedAt,
            ok: false,
            error: errorMessage,
          });
          if (
            provider === ServiceProvider.Custom &&
            isExpectedCustomBalanceError(e)
          ) {
            return;
          }
          console.error(errorMessage);
        } finally {
          inflightBalanceQueries.delete(cacheKey);
        }
      })();

      inflightBalanceQueries.set(cacheKey, queryPromise);
      return queryPromise;
    },

    setBalanceSnapshot(key: string, snapshot: BalanceSnapshot) {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) {
        return;
      }

      set(() => ({
        balances: {
          ...get().balances,
          [normalizedKey]: snapshot,
        },
        lastUpdateUsageByKey: {
          ...get().lastUpdateUsageByKey,
          [normalizedKey]: Math.max(
            get().lastUpdateUsageByKey[normalizedKey] ?? 0,
            Number(snapshot.updatedAt || 0),
          ),
        },
      }));
    },
  }),
  {
    name: StoreKey.Update,
    version: 1,
  },
);
