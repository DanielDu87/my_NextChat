import { getClientConfig } from "../config/client";
import { STORAGE_KEY, StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";
import {
  AppState,
  getLocalAppState,
  GetStoreState,
  mergeAppState,
  setLocalAppState,
} from "../utils/sync";
import { downloadAs, readFromFile } from "../utils";
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
  provider: ProviderType.WebDAV,
  useProxy: true,
  proxyUrl: "/api/webdav", // 使用 WebDAV 代理路径

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
      const provider = get().provider;
      const config = get()[provider];
      const client = this.getClient() as any;

      // 需要同步的 store 类型
      const storeKeys: StoreKey[] = [
        StoreKey.Chat,
        StoreKey.Access,
        StoreKey.Config,
        StoreKey.Mask,
        StoreKey.Prompt,
      ];

      // 保存本地 UI 偏好设置
      const appConfig = useAppConfig.getState();
      const localSidebarWidth = localStorage.getItem("sidebarWidth");
      const localTightBorder = appConfig.tightBorder;

      try {
        // 检查是否有旧的备份数据需要迁移
        if (client.getLegacy && client.deleteLegacy) {
          const legacyData = await client.getLegacy();
          if (legacyData && legacyData !== "") {
            console.log("[Sync] 检测到旧备份数据，开始迁移...");
            try {
              const parsedLegacy = JSON.parse(legacyData) as AppState;

              // 将旧数据分别存储到新文件
              for (const key of storeKeys) {
                const storeData = (parsedLegacy as any)[key];
                if (storeData) {
                  await client.set(key, JSON.stringify(storeData));
                }
              }

              // 删除旧备份文件
              await client.deleteLegacy();
              console.log("[Sync] 旧数据迁移完成");
            } catch (e) {
              console.error("[Sync] 迁移旧数据失败", e);
            }
          }
        }

        // 分文件同步：分别处理每个 store
        for (const key of storeKeys) {
          try {
            // 获取本地该 store 的状态
            const localStoreGetter: any = {
              [StoreKey.Chat]: () => {
                const state = require("../store/chat").useChatStore.getState();
                return { ...state };
              },
              [StoreKey.Access]: () => {
                const state =
                  require("../store/access").useAccessStore.getState();
                return { ...state };
              },
              [StoreKey.Config]: () => {
                const fullState =
                  require("../store/config").useAppConfig.getState();
                const { sidebarWidth, tightBorder, ...state } =
                  fullState as any;
                return state;
              },
              [StoreKey.Mask]: () => {
                const state = require("../store/mask").useMaskStore.getState();
                return { ...state };
              },
              [StoreKey.Prompt]: () => {
                const state =
                  require("../store/prompt").usePromptStore.getState();
                return { ...state };
              },
            };

            const getter = (localStoreGetter as Record<string, () => any>)[key];
            if (!getter) continue;
            const localStoreData = getter();

            // 获取远程该 store 的数据
            const remoteDataText = await client.get(key);

            if (!remoteDataText || remoteDataText === "") {
              // 远程没有数据，上传本地数据
              await client.set(key, JSON.stringify(localStoreData));
              console.log(`[Sync] ${key}: 远程为空，已上传本地数据`);
            } else {
              // 远程有数据，进行合并
              const remoteStoreData = JSON.parse(remoteDataText);

              // 使用对应的合并策略
              const mergeFunc = (
                {
                  [StoreKey.Chat]: (local: any, remote: any) => {
                    const localSessions: Record<string, any> = {};
                    local.sessions?.forEach(
                      (s: any) => (localSessions[s.id] = s),
                    );

                    remote.sessions?.forEach((remoteSession: any) => {
                      if (remoteSession.messages?.length === 0) return;

                      const localSession = localSessions[remoteSession.id];
                      if (!localSession) {
                        local.sessions = local.sessions || [];
                        local.sessions.push(remoteSession);
                      } else {
                        const localMessageIds = new Set(
                          localSession.messages.map((v: any) => v.id),
                        );
                        remoteSession.messages?.forEach((m: any) => {
                          if (!localMessageIds.has(m.id)) {
                            localSession.messages.push(m);
                          }
                        });
                      }
                    });

                    local.sessions?.sort(
                      (a: any, b: any) =>
                        new Date(b.lastUpdate).getTime() -
                        new Date(a.lastUpdate).getTime(),
                    );
                  },
                  [StoreKey.Access]: (local: any, remote: any) => {
                    const localProfileMap = new Map(
                      (local.apiProfiles || []).map((p: any) => [p.id, p]),
                    );
                    const remoteProfileMap = new Map(
                      (remote.apiProfiles || []).map((p: any) => [p.id, p]),
                    );

                    const mergedProfiles = [...(local.apiProfiles || [])];
                    remoteProfileMap.forEach((profile: any) => {
                      if (!localProfileMap.has(profile.id)) {
                        mergedProfiles.push(profile);
                      }
                    });

                    local.apiProfiles = mergedProfiles;
                    local.lastUpdateTime = Date.now();

                    // 合并其他字段
                    const remoteCopy = { ...remote };
                    delete (remoteCopy as any).apiProfiles;
                    delete (remoteCopy as any).lastUpdateTime;
                    Object.assign(local, remoteCopy);
                  },
                  [StoreKey.Config]: (local: any, remote: any) => {
                    const localTime = local.lastUpdateTime ?? 0;
                    const remoteTime = remote.lastUpdateTime ?? 0;

                    if (remoteTime > localTime) {
                      Object.assign(local, remote);
                    }
                    local.lastUpdateTime = Date.now();
                  },
                  [StoreKey.Mask]: (local: any, remote: any) => {
                    local.masks = { ...remote.masks, ...local.masks };
                  },
                  [StoreKey.Prompt]: (local: any, remote: any) => {
                    local.prompts = { ...remote.prompts, ...local.prompts };
                  },
                } as Record<string, (local: any, remote: any) => void>
              )[key];

              mergeFunc(localStoreData, remoteStoreData);

              // 应用合并后的数据到本地 store
              const storeSetter = (
                {
                  [StoreKey.Chat]: () =>
                    require("../store/chat").useChatStore.setState(
                      localStoreData,
                    ),
                  [StoreKey.Access]: () =>
                    require("../store/access").useAccessStore.setState(
                      localStoreData,
                    ),
                  [StoreKey.Config]: () =>
                    require("../store/config").useAppConfig.setState(
                      localStoreData,
                    ),
                  [StoreKey.Mask]: () =>
                    require("../store/mask").useMaskStore.setState(
                      localStoreData,
                    ),
                  [StoreKey.Prompt]: () =>
                    require("../store/prompt").usePromptStore.setState(
                      localStoreData,
                    ),
                } as Record<string, () => void>
              )[key];

              storeSetter?.();

              // 上传合并后的数据
              await client.set(key, JSON.stringify(localStoreData));
              console.log(`[Sync] ${key}: 合并完成并上传`);
            }
          } catch (e) {
            console.error(`[Sync] ${key} 同步失败:`, e);
          }
        }

        // 恢复本地 UI 偏好设置
        if (localSidebarWidth && appConfig.setSidebarWidth) {
          appConfig.setSidebarWidth(parseInt(localSidebarWidth));
        }
        if (localTightBorder !== undefined) {
          useAppConfig.setState({ tightBorder: localTightBorder });
        }
      } catch (e) {
        console.log("[Sync] failed", e);
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
    version: 1.2,

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

      return newState as any;
    },
  },
);
