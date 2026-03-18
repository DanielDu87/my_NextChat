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
import { SYNC_STORE_KEYS } from "../utils/sync-store-keys";
import { showToast } from "../components/ui-lib";
import Locale from "../locales";
import { createSyncClient, ProviderType } from "../utils/cloud";
import { useAppConfig } from "./config";

export interface WebDavConfig {
  server: string;
  username: string;
  password: string;
}

const isApp = !!getClientConfig()?.isApp;
export type SyncStore = GetStoreState<typeof useSyncStore>;

const DEFAULT_SYNC_STATE = {
  provider: ProviderType.Database,
  useProxy: true,
  proxyUrl: "/api/webdav", // 旧同步代理路径，仅兼容历史配置

  database: {},

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

    async sync() {
      console.log("[Sync] 🔄 开始同步...");

      const provider = get().provider;
      const config = get()[provider];
      const client = this.getClient() as any;

      // 需要同步的 store 类型
      const storeKeys = [...SYNC_STORE_KEYS];

      console.log(
        `[Sync] 📋 准备同步 ${storeKeys.length} 个数据块:`,
        storeKeys.join(", "),
      );

      // 保存本地 UI 偏好设置
      const appConfig = useAppConfig.getState();
      const localSidebarWidth = localStorage.getItem("sidebarWidth");
      const localTightBorder = appConfig.tightBorder;

      try {
        const localState = getLocalAppState();
        const remoteState = JSON.parse(JSON.stringify(localState)) as AppState;

        for (const key of storeKeys) {
          try {
            const remoteDataText = await client.get(key);

            if (!remoteDataText || remoteDataText === "") {
              console.log(`[Sync] 📤 ${key}: 远程为空，正在上传本地数据...`);
              await client.set(
                key,
                JSON.stringify(localState[key as keyof AppState]),
              );
              console.log(`[Sync] ✅ ${key}: 本地数据已上传`);
            } else {
              remoteState[key as keyof AppState] = JSON.parse(remoteDataText);
              console.log(`[Sync] 📥 ${key}: 已下载远程数据，待统一合并`);
            }
          } catch (e) {
            console.error(`[Sync] ❌ ${key} 同步失败:`, e);
          }
        }

        mergeAppState(localState, remoteState);
        setLocalAppState(localState);

        for (const key of storeKeys) {
          await client.set(
            key,
            JSON.stringify(localState[key as keyof AppState]),
          );
          console.log(`[Sync] ✅ ${key}: 合并完成并上传`);
        }

        // 恢复本地 UI 偏好设置
        if (localSidebarWidth && appConfig.setSidebarWidth) {
          appConfig.setSidebarWidth(parseInt(localSidebarWidth));
        }
        if (localTightBorder !== undefined) {
          useAppConfig.setState({ tightBorder: localTightBorder });
        }

        console.log("[Sync] ✅ 同步完成");
      } catch (e) {
        console.error("[Sync] ❌ 同步失败:", e);
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
    version: 1.3,

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

      return newState as any;
    },
  },
);
