import { getClientConfig } from "../config/client";
import { STORAGE_KEY, StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";
import {
  AppState,
  GetStoreState,
  getLocalAppState,
  mergeAppState,
  setLocalAppState,
} from "../utils/sync";
import { downloadAs, readFromFile } from "../utils";
import {
  parseStoreStatePayload,
  stringifyPersistedStoreState,
  SYNC_STORE_KEYS,
} from "../utils/sync-store-keys";
import { showToast } from "../components/ui-lib";
import Locale from "../locales";
import { createSyncClient, ProviderType } from "../utils/cloud";
import { useAppConfig } from "./config";
import type { StoreSnapshotMeta } from "../utils/cloud/database";

export interface WebDavConfig {
  server: string;
  username: string;
  password: string;
}

type DatabaseCacheMeta = Record<
  string,
  {
    updatedAt: string;
    checksum: string;
    sizeBytes: number;
    validatedAt: number;
  }
>;

const isApp = !!getClientConfig()?.isApp;
export type SyncStore = GetStoreState<typeof useSyncStore>;
const LOG_SEPARATOR = "=".repeat(50);

const STORE_DISPLAY_NAMES: Record<(typeof SYNC_STORE_KEYS)[number], string> = {
  [StoreKey.Chat]: "会话",
  [StoreKey.Plugin]: "插件",
  [StoreKey.Access]: "设置",
  [StoreKey.Config]: "模型",
  [StoreKey.Mask]: "面具",
  [StoreKey.Prompt]: "提示词",
  [StoreKey.Update]: "更新",
  [StoreKey.SdList]: "绘图",
};

function getStoreSummary(key: (typeof SYNC_STORE_KEYS)[number], state: any) {
  switch (key) {
    case StoreKey.Chat:
      return `${
        Array.isArray(state?.sessions) ? state.sessions.length : 0
      } 个会话`;
    case StoreKey.Plugin:
      return `${Object.keys(state?.plugins ?? {}).length} 个插件`;
    case StoreKey.Access:
      return `${
        Array.isArray(state?.apiProfiles) ? state.apiProfiles.length : 0
      } 个配置`;
    case StoreKey.Config:
      return `${Array.isArray(state?.models) ? state.models.length : 0} 个模型`;
    case StoreKey.Mask:
      return `${Object.keys(state?.masks ?? {}).length} 个面具`;
    case StoreKey.Prompt:
      return `${Object.keys(state?.prompts ?? {}).length} 个提示词`;
    case StoreKey.Update:
      return `${state?.lastUpdateTime ? 1 : 0} 条更新状态`;
    case StoreKey.SdList:
      return `${Array.isArray(state?.draw) ? state.draw.length : 0} 条绘图记录`;
    default:
      return "0 项";
  }
}

const DEFAULT_SYNC_STATE = {
  provider: ProviderType.Database,
  useProxy: true,
  proxyUrl: "/api/webdav", // 旧同步代理路径，仅兼容历史配置

  database: {
    cacheMeta: {} as DatabaseCacheMeta,
    lastMetaSyncTime: 0,
  },

  webdav: {
    endpoint: "",
    username: "",
    password: "",
  },

  upstash: {
    endpoint: "",
    username: STORAGE_KEY,
    apiKey: "",
  },

  lastSyncTime: 0,
  lastProvider: "",
};

export const useSyncStore = createPersistStore(
  DEFAULT_SYNC_STATE,
  (set, get) => ({
    cloudSync() {
      const config = get()[get().provider];
      return Object.values(config).every((c) => c.toString().length > 0);
    },

    markSyncTime() {
      set({ lastSyncTime: Date.now(), lastProvider: get().provider });
    },

    export() {
      const state = getLocalAppState();
      const datePart = isApp
        ? `${new Date().toLocaleDateString().replace(/\//g, "_")} ${new Date()
            .toLocaleTimeString()
            .replace(/:/g, "_")}`
        : new Date().toLocaleString();

      const fileName = `Backup-${datePart}.json`;
      downloadAs(JSON.stringify(state), fileName);
    },

    async import() {
      const rawContent = await readFromFile();

      try {
        const remoteState = JSON.parse(rawContent) as AppState;
        const localState = getLocalAppState();
        mergeAppState(localState, remoteState);
        setLocalAppState(localState);
        location.reload();
      } catch (e) {
        console.error("[Import]", e);
        showToast(Locale.Settings.Sync.ImportFailed);
      }
    },

    getClient() {
      const provider = get().provider;
      const client = createSyncClient(provider, get());
      return client;
    },

    updateDatabaseMeta(metas: StoreSnapshotMeta[]) {
      const nextMeta = { ...get().database.cacheMeta };
      const validatedAt = Date.now();

      metas.forEach((meta) => {
        nextMeta[meta.key] = {
          updatedAt: meta.updatedAt,
          checksum: meta.checksum,
          sizeBytes: meta.sizeBytes,
          validatedAt,
        };
      });

      set({
        database: {
          ...get().database,
          cacheMeta: nextMeta,
          lastMetaSyncTime: validatedAt,
        },
      });
    },

    async sync() {
      console.log("[Sync] 🔄 开始同步...");

      const provider = get().provider;
      const config = get()[provider];
      const client = this.getClient() as any;

      // 需要同步的 store 类型
      const storeKeys = [...SYNC_STORE_KEYS];

      console.log(`[Sync] 📋 准备同步 ${storeKeys.length} 个数据块`);

      // 保存本地 UI 偏好设置
      const appConfig = useAppConfig.getState();
      const localSidebarWidth = localStorage.getItem("sidebarWidth");
      const localTightBorder = appConfig.tightBorder;

      try {
        const localState = getLocalAppState();
        const remoteState = JSON.parse(JSON.stringify(localState)) as AppState;

        const syncResults: Array<{
          key: (typeof SYNC_STORE_KEYS)[number];
          name: string;
          summary: string;
          status: "downloaded" | "uploaded" | "merged";
        }> = [];

        for (const key of storeKeys) {
          try {
            const displayName = STORE_DISPLAY_NAMES[key];
            console.log(`[Sync] 📋 正在同步${displayName}...`);
            const remoteDataText = await client.get(key);

            if (!remoteDataText || remoteDataText === "") {
              await client.set(
                key,
                stringifyPersistedStoreState(key, localState[key]),
              );
              const summary = getStoreSummary(key, localState[key]);
              syncResults.push({
                key,
                name: displayName,
                summary,
                status: "uploaded",
              });
              console.log(
                `[Sync] ✅ ${displayName}同步完成，已上传 ${summary}`,
              );
              console.log(LOG_SEPARATOR);
            } else {
              const parsedRemoteState = parseStoreStatePayload(remoteDataText);
              remoteState[key as keyof AppState] = parsedRemoteState;
              const summary = getStoreSummary(key, parsedRemoteState);
              syncResults.push({
                key,
                name: displayName,
                summary,
                status: "downloaded",
              });
              console.log(`[Sync] ✅ ${displayName}读取完成，远端 ${summary}`);
              console.log(LOG_SEPARATOR);
            }
          } catch (e) {
            console.error(`[Sync] ❌ ${STORE_DISPLAY_NAMES[key]}同步失败:`, e);
            console.log(LOG_SEPARATOR);
          }
        }

        mergeAppState(localState, remoteState);
        setLocalAppState(localState);

        for (const key of storeKeys) {
          await client.set(
            key,
            stringifyPersistedStoreState(key, localState[key]),
          );
          const displayName = STORE_DISPLAY_NAMES[key];
          const summary = getStoreSummary(key, localState[key]);
          const result = syncResults.find((item) => item.key === key);
          if (result) {
            result.summary = summary;
            result.status = "merged";
          } else {
            syncResults.push({
              key,
              name: displayName,
              summary,
              status: "merged",
            });
          }
          console.log(`[Sync] ✅ ${displayName}同步完成，合并后 ${summary}`);
          console.log(LOG_SEPARATOR);
        }

        // 恢复本地 UI 偏好设置
        if (localSidebarWidth && appConfig.setSidebarWidth) {
          appConfig.setSidebarWidth(parseInt(localSidebarWidth));
        }
        if (localTightBorder !== undefined) {
          useAppConfig.setState({ tightBorder: localTightBorder });
        }

        console.log("[Sync] 📊 数据同步汇总");
        syncResults.forEach((item) => {
          console.log(`[Sync] - ${item.name}: ${item.summary}`);
        });
        console.log("[Sync] ✅ 同步完成");
        console.log(LOG_SEPARATOR);
      } catch (e) {
        console.error("[Sync] ❌ 同步失败:", e);
        console.log(LOG_SEPARATOR);
        throw e;
      }

      this.markSyncTime();
    },

    async check() {
      const client = this.getClient();
      return await client.check();
    },
  }),
  {
    name: StoreKey.Sync,
    version: 1.4,

    migrate(persistedState, version) {
      const newState = persistedState as typeof DEFAULT_SYNC_STATE;

      if (version < 1.1) {
        newState.upstash.username = STORAGE_KEY;
      }

      if (version < 1.2) {
        if (
          (persistedState as typeof DEFAULT_SYNC_STATE).proxyUrl ===
          "/api/cors/"
        ) {
          newState.proxyUrl = "";
        }
      }

      if (version < 1.3) {
        newState.provider = ProviderType.Database;
      }

      if (version < 1.4) {
        newState.database = {
          cacheMeta: {},
          lastMetaSyncTime: 0,
        };
      }

      return newState as any;
    },
  },
);
