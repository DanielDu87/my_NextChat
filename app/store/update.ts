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
import ChatGptIcon from "../icons/chatgpt.png";
import Locale from "../locales";
import { ClientApi, getClientApi } from "../client/api";
import { useAccessStore } from "./access";

const ONE_MINUTE = 60 * 1000;
const isApp = !!getClientConfig()?.isApp;

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
  );
}

function normalizeCustomBaseUrl(baseUrl: string) {
  const normalizedBaseUrl = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  return normalizedBaseUrl.startsWith("http")
    ? normalizedBaseUrl
    : `https://${normalizedBaseUrl}`;
}

function getBalanceQueryApiKey(rule: CustomBalanceQueryRule) {
  return String(rule.apiKey || "").trim();
}

function getBalanceQueryField(rule: CustomBalanceQueryRule) {
  return String(rule.field || "").trim();
}

function getBalanceQueryUrl(rule: CustomBalanceQueryRule) {
  const requestUrl = String(rule.url || "").trim();
  if (!requestUrl) return "";
  return requestUrl.startsWith("http") ? requestUrl : `https://${requestUrl}`;
}

function getBalanceQueryBaseUrl(rule: CustomBalanceQueryRule) {
  return normalizeCustomBaseUrl(rule.url || "");
}

function getBalanceQueryApiBaseUrl(rule: CustomBalanceQueryRule) {
  const requestBaseUrl = getBalanceQueryBaseUrl(rule);
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

function getRequiredCustomBalanceRule() {
  const activeCustomProfile = getActiveCustomProfile();

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

async function queryJsonCustomUsage(rule: CustomBalanceQueryRule) {
  const requestUrl = getBalanceQueryUrl(rule);
  const fieldPath = getBalanceQueryField(rule);
  const authKey = getBalanceQueryApiKey(rule);

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
    total: Math.round(total * 100) / 100,
  };
}

async function queryAihubMixUsage(rule: CustomBalanceQueryRule) {
  const requestBaseUrl = getBalanceQueryBaseUrl(rule);

  const res = await fetch(`${requestBaseUrl}/api/user/self`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getBalanceQueryApiKey(rule)}`,
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
  const total = Math.round((quota / 500000) * 100) / 100;

  return { used: 0, total };
}

async function queryOcoolaiUsage(rule: CustomBalanceQueryRule) {
  const requestBaseUrl = getBalanceQueryBaseUrl(rule);
  const res = await fetch(`${requestBaseUrl}/api/user/self`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getBalanceQueryApiKey(rule)}`,
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
  const total = Math.round((quota / 500000) * 100) / 100;

  return { used: 0, total };
}

async function queryToApisUsage(rule: CustomBalanceQueryRule) {
  const requestBaseUrl = getBalanceQueryApiBaseUrl(rule);
  const res = await fetch(`${requestBaseUrl}/user/balance`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getBalanceQueryApiKey(rule)}`,
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

  const total = Math.round(Number(json.remain_balance || 0) * 100) / 100;

  return { used: 0, total };
}

async function queryOpenAICompatibleCustomUsage(rule: CustomBalanceQueryRule) {
  const requestBaseUrl = getBalanceQueryApiBaseUrl(rule);
  const now = new Date();
  const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0",
  )}-01`;
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const endDate = `${tomorrow.getFullYear()}-${String(
    tomorrow.getMonth() + 1,
  ).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  const authKey = getBalanceQueryApiKey(rule);

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
    used: Math.round(Number(usageJson.total_usage || 0)) / 100,
    total: Math.round(Number(subscriptionJson.hard_limit_usd || 0) * 100) / 100,
  };
}

export const useUpdateStore = createPersistStore(
  {
    versionType: "tag" as VersionType,
    lastUpdate: 0,
    version: "unknown",
    remoteVersion: "",
    used: 0,
    subscription: 0,

    lastUpdateUsage: 0,
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
    ) {
      const overOneMinute = Date.now() - get().lastUpdateUsage >= ONE_MINUTE;
      if (!overOneMinute && !force) return;

      set(() => ({
        lastUpdateUsage: Date.now(),
      }));

      try {
        let usage: { used: number; total: number } | undefined;
        if (provider === ServiceProvider.Custom) {
          const rule = getRequiredCustomBalanceRule();
          switch (rule.mode) {
            case "json":
              usage = await queryJsonCustomUsage(rule);
              break;
            case "aihubmix":
              usage = await queryAihubMixUsage(rule);
              break;
            case "ocoolai":
              usage = await queryOcoolaiUsage(rule);
              break;
            case "toapis":
              usage = await queryToApisUsage(rule);
              break;
            case "openai-compatible":
              usage = await queryOpenAICompatibleCustomUsage(rule);
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

        if (usage) {
          const { used, total } = usage;
          set(() => ({
            used,
            subscription: total,
          }));
        }
      } catch (e) {
        console.error((e as Error).message);
      }
    },
  }),
  {
    name: StoreKey.Update,
    version: 1,
  },
);
