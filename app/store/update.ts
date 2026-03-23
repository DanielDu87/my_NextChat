import {
  FETCH_COMMIT_URL,
  FETCH_TAG_URL,
  ModelProvider,
  ServiceProvider,
  StoreKey,
} from "../constant";
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

function getCustomBalanceQueryApiKey(profile: {
  apiKey: string;
  balanceQueryApiKey?: string;
}) {
  return profile.balanceQueryApiKey || profile.apiKey;
}

async function queryAihubMixUsage() {
  const activeCustomProfile = getActiveCustomProfile();

  if (!activeCustomProfile) {
    throw new Error("未找到已启用的 Custom 供应商配置");
  }

  const requestBaseUrl = normalizeCustomBaseUrl(activeCustomProfile.baseUrl);

  const res = await fetch(`${requestBaseUrl}/api/user/self`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getCustomBalanceQueryApiKey(
        activeCustomProfile,
      )}`,
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

async function queryOcoolaiUsage() {
  const activeCustomProfile = getActiveCustomProfile();

  if (!activeCustomProfile) {
    throw new Error("未找到已启用的 Custom 供应商配置");
  }

  const requestBaseUrl = normalizeCustomBaseUrl(activeCustomProfile.baseUrl);
  const res = await fetch(`${requestBaseUrl}/api/user/self`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getCustomBalanceQueryApiKey(
        activeCustomProfile,
      )}`,
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

async function queryToApisUsage() {
  const activeCustomProfile = getActiveCustomProfile();

  if (!activeCustomProfile) {
    throw new Error("未找到已启用的 Custom 供应商配置");
  }

  const requestBaseUrl = `${normalizeCustomBaseUrl(
    activeCustomProfile.baseUrl,
  )}/v1`;
  const res = await fetch(`${requestBaseUrl}/user/balance`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getCustomBalanceQueryApiKey(
        activeCustomProfile,
      )}`,
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

async function queryOpenAICompatibleCustomUsage() {
  const activeCustomProfile = getActiveCustomProfile();

  if (!activeCustomProfile) {
    throw new Error("未找到已启用的 Custom 供应商配置");
  }

  const requestBaseUrl = `${normalizeCustomBaseUrl(
    activeCustomProfile.baseUrl,
  )}/v1`;
  const now = new Date();
  const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0",
  )}-01`;
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const endDate = `${tomorrow.getFullYear()}-${String(
    tomorrow.getMonth() + 1,
  ).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  const authKey = getCustomBalanceQueryApiKey(activeCustomProfile);

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
        let usage;
        const activeCustomProfile = getActiveCustomProfile();
        const isAihubMixCustom =
          provider === ServiceProvider.Custom &&
          /(^|\.)aihubmix\.com$/i.test(
            (() => {
              try {
                return new URL(activeCustomProfile?.baseUrl || "").hostname;
              } catch {
                return "";
              }
            })(),
          );
        const isOcoolaiCustom =
          provider === ServiceProvider.Custom &&
          /(^|\.)one\.ooo\.cool$/i.test(
            (() => {
              try {
                return new URL(activeCustomProfile?.baseUrl || "").hostname;
              } catch {
                return "";
              }
            })(),
          );
        const isToApisCustom =
          provider === ServiceProvider.Custom &&
          /(^|\.)toapis\.com$/i.test(
            (() => {
              try {
                return new URL(activeCustomProfile?.baseUrl || "").hostname;
              } catch {
                return "";
              }
            })(),
          );

        if (isAihubMixCustom) {
          usage = await queryAihubMixUsage();
        } else if (isOcoolaiCustom) {
          usage = await queryOcoolaiUsage();
        } else if (isToApisCustom) {
          usage = await queryToApisUsage();
        } else if (provider === ServiceProvider.Custom) {
          usage = await queryOpenAICompatibleCustomUsage();
        } else {
          const api =
            provider === ServiceProvider.OpenAI
              ? new ClientApi(ModelProvider.GPT)
              : getClientApi(provider);
          usage = await api.llm.usage();
        }

        if (usage) {
          set(() => ({
            used: usage.used,
            subscription: usage.total,
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
