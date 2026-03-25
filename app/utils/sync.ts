import {
  ChatMessage,
  ChatSession,
  useAccessStore,
  useAppConfig,
  useChatStore,
  useModelCacheStore,
  usePluginStore,
  useUpdateStore,
} from "../store";
import { LLMModel } from "../client/api";
import { merge } from "lodash-es";
import { useMaskStore } from "../store/mask";
import { usePromptStore } from "../store/prompt";
import { useSdStore } from "../store/sd";
import { ServiceProvider, StoreKey } from "../constant";
import {
  getMessageTime,
  getSessionCreatedAt,
  getSessionMessages,
  mergeSessionMessages,
  sortSessionsByCreatedAt,
} from "./chat-session-merge";
export { SYNC_STORE_KEYS } from "./sync-store-keys";

function isSyncDebugLoggingEnabled() {
  if (process.env.NODE_ENV === "test") {
    return false;
  }

  try {
    return (
      globalThis.localStorage?.getItem("debug-sync-logs") === "1" ||
      process.env.NEXT_PUBLIC_DEBUG_SYNC_LOGS === "1"
    );
  } catch {
    return process.env.NEXT_PUBLIC_DEBUG_SYNC_LOGS === "1";
  }
}

function logSyncDebug(message: string, payload?: unknown) {
  if (!isSyncDebugLoggingEnabled()) {
    return;
  }
  if (payload === undefined) {
    console.log(message);
    return;
  }
  console.log(message, payload);
}

type NonFunctionKeys<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? never : K;
}[keyof T];
type NonFunctionFields<T> = Pick<T, NonFunctionKeys<T>>;

export function getNonFunctionFileds<T extends object>(obj: T) {
  const ret: any = {};

  Object.entries(obj).map(([k, v]) => {
    if (typeof v !== "function") {
      ret[k] = v;
    }
  });

  return ret as NonFunctionFields<T>;
}

export type GetStoreState<T> = T extends { getState: () => infer U }
  ? NonFunctionFields<U>
  : never;

const LocalStateSetters = {
  [StoreKey.Chat]: useChatStore.setState,
  [StoreKey.Plugin]: usePluginStore.setState,
  [StoreKey.Access]: useAccessStore.setState,
  [StoreKey.Config]: useAppConfig.setState,
  [StoreKey.ModelCache]: useModelCacheStore.setState,
  [StoreKey.Mask]: useMaskStore.setState,
  [StoreKey.Prompt]: usePromptStore.setState,
  [StoreKey.Update]: useUpdateStore.setState,
  [StoreKey.SdList]: useSdStore.setState,
} as const;

const LocalStateGetters = {
  [StoreKey.Chat]: () => getNonFunctionFileds(useChatStore.getState()),
  [StoreKey.Plugin]: () => getNonFunctionFileds(usePluginStore.getState()),
  [StoreKey.Access]: () => getNonFunctionFileds(useAccessStore.getState()),
  [StoreKey.Config]: () => {
    const config = getNonFunctionFileds(useAppConfig.getState());
    // 排除 sidebarWidth 和 tightBorder，不参与同步（本地UI偏好设置）
    const { sidebarWidth, tightBorder, ...configToSync } = config as any;
    return configToSync;
  },
  [StoreKey.ModelCache]: () =>
    getNonFunctionFileds(useModelCacheStore.getState()),
  [StoreKey.Mask]: () => getNonFunctionFileds(useMaskStore.getState()),
  [StoreKey.Prompt]: () => getNonFunctionFileds(usePromptStore.getState()),
  [StoreKey.Update]: () => getNonFunctionFileds(useUpdateStore.getState()),
  [StoreKey.SdList]: () => getNonFunctionFileds(useSdStore.getState()),
} as const;

export type AppState = {
  [k in keyof typeof LocalStateGetters]: ReturnType<
    (typeof LocalStateGetters)[k]
  >;
};

type Merger<T extends keyof AppState, U = AppState[T]> = (
  localState: U,
  remoteState: U,
) => U;

type StateMerger = {
  [K in keyof AppState]: Merger<K>;
};

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getManagedProviderIdsFromProfiles(
  profiles: Array<{ provider: ServiceProvider; name: string }> = [],
) {
  return new Set(
    profiles.map((profile) =>
      profile.provider === ServiceProvider.Custom
        ? `custom_${profile.name}`.toLowerCase()
        : String(profile.provider).toLowerCase(),
    ),
  );
}

const STORE_SYNC_STRATEGIES: Record<keyof AppState, string> = {
  [StoreKey.Chat]: "双向合并",
  [StoreKey.Plugin]: "双向合并",
  [StoreKey.Access]: "按 profile 合并，派生字段以云端为准",
  [StoreKey.Config]: "模型双向合并，其他配置本地覆盖云端",
  [StoreKey.ModelCache]: "按 profile 合并，较新的缓存优先",
  [StoreKey.Mask]: "双向合并",
  [StoreKey.Prompt]: "双向合并",
  [StoreKey.Update]: "云端覆盖本地",
  [StoreKey.SdList]: "双向合并",
};

function markMergedUpdateTime(
  localUpdateTime?: number,
  remoteUpdateTime?: number,
) {
  return Math.max(localUpdateTime ?? 0, remoteUpdateTime ?? 0, Date.now());
}

// we merge remote state to local state
const MergeStates: StateMerger = {
  [StoreKey.Chat]: (localState, remoteState) => {
    const localSessions = Array.isArray(localState.sessions)
      ? localState.sessions
      : [];
    const remoteSessions = Array.isArray(remoteState.sessions)
      ? remoteState.sessions
      : [];

    localState.sessions = localSessions;
    remoteState.sessions = remoteSessions;

    // 使用 Map 存储会话，便于查找和更新
    const sessionMap = new Map<string, ChatSession>();
    const debugLoggingEnabled = isSyncDebugLoggingEnabled();
    const MAX_DEBUG_SESSION_IDS = 10;
    const currentSessionId =
      localState.sessions?.[localState.currentSessionIndex]?.id ?? "";
    const localSessionCount = localSessions.length;
    const remoteSessionCount = remoteSessions.length;
    let adoptedRemoteCount = 0;
    let keptLocalCount = 0;
    let mergedSameTimestampCount = 0;
    let localEmptySessionCount = 0;
    let remoteEmptySessionCount = 0;
    const adoptedRemoteEmptySessionIds: string[] = [];
    const keptLocalEmptySessionIds: string[] = [];
    const mergedSameTimestampEmptySessionIds: string[] = [];

    if (debugLoggingEnabled) {
      localEmptySessionCount = localSessions.filter(
        (session) => getSessionMessages(session).length === 0,
      ).length;
      remoteEmptySessionCount = remoteSessions.filter(
        (session) => getSessionMessages(session).length === 0,
      ).length;
    }

    // 先添加本地会话
    localSessions.forEach((s) => sessionMap.set(s.id, s));

    // 遍历远程会话，以 lastUpdate 最新的为准
    remoteSessions.forEach((remoteSession) => {
      const localSession = sessionMap.get(remoteSession.id);
      const remoteUpdateTime = new Date(remoteSession.lastUpdate).getTime();
      const localUpdateTime = localSession
        ? new Date(localSession.lastUpdate).getTime()
        : 0;

      // 如果远程更新时间更新，或者本地没有该会话，使用远程的
      if (!localSession || remoteUpdateTime > localUpdateTime) {
        remoteSession.createdAt = localSession
          ? Math.min(
              getSessionCreatedAt(localSession),
              getSessionCreatedAt(remoteSession),
            )
          : getSessionCreatedAt(remoteSession);
        sessionMap.set(remoteSession.id, remoteSession);
        adoptedRemoteCount += 1;
        if (
          debugLoggingEnabled &&
          getSessionMessages(remoteSession).length === 0
        ) {
          adoptedRemoteEmptySessionIds.push(remoteSession.id);
        }
        if (debugLoggingEnabled) {
          logSyncDebug("[Sync] 📥 使用远程会话（更新）:", {
            id: remoteSession.id,
            topic: remoteSession.topic,
            remoteTime: new Date(remoteUpdateTime).toLocaleString(),
            localTime: localSession
              ? new Date(localUpdateTime).toLocaleString()
              : "不存在",
          });
        }
      } else if (remoteUpdateTime < localUpdateTime) {
        if (debugLoggingEnabled) {
          logSyncDebug("[Sync] 📤 保留本地会话（更新）:", {
            id: remoteSession.id,
            topic: localSession.topic,
            localTime: new Date(localUpdateTime).toLocaleString(),
            remoteTime: new Date(remoteUpdateTime).toLocaleString(),
          });
        }
        keptLocalCount += 1;
        localSession.createdAt =
          localSession.createdAt || getSessionCreatedAt(localSession);
        if (
          debugLoggingEnabled &&
          getSessionMessages(localSession).length === 0
        ) {
          keptLocalEmptySessionIds.push(localSession.id);
        }
      } else {
        // 更新时间相同，合并消息（保留两边独有的消息）
        if (localSession) {
          const mergedMessages = mergeSessionMessages(
            localSession,
            remoteSession,
          );
          remoteSession.messages = mergedMessages;
          remoteSession.createdAt = Math.min(
            getSessionCreatedAt(localSession),
            getSessionCreatedAt(remoteSession),
          );

          const mergedSession =
            mergedMessages === getSessionMessages(localSession) &&
            remoteSession.createdAt === getSessionCreatedAt(localSession)
              ? localSession
              : remoteSession;
          sessionMap.set(remoteSession.id, mergedSession);
          mergedSameTimestampCount += 1;
          if (
            debugLoggingEnabled &&
            getSessionMessages(mergedSession).length === 0
          ) {
            mergedSameTimestampEmptySessionIds.push(remoteSession.id);
          }
        }
      }
    });

    // 转换回数组并按 createdAt 降序排序，lastUpdate 仅用于同步新旧判断
    localState.sessions = sortSessionsByCreatedAt(
      Array.from(sessionMap.values()),
    );

    console.log("[mergeChat] 同步合并完成", {
      currentSessionId,
      sessionsCount: localState.sessions.length,
      currentSessionIndex: localState.currentSessionIndex,
      firstSession: localState.sessions[0]?.id,
    });

    // 清理多余的空会话，只保留一个
    // 默认主题可能是 "新的聊天"（中文）或 "New Chat"（英文）
    const isEmptyDefaultSession = (session: any) =>
      (!session.topic ||
        session.topic === "新的聊天" ||
        session.topic === "New Chat") &&
      getSessionMessages(session).length === 0 &&
      !session.memoryPrompt;

    const emptySessions = localState.sessions.filter(isEmptyDefaultSession);

    if (emptySessions.length > 1) {
      console.log("[mergeChat] 发现多个空会话，开始清理", {
        emptySessionsCount: emptySessions.length,
      });

      // 优先保留当前选中的空会话，如果没有则保留最新的（第一个）
      const preservedEmptySession =
        emptySessions.find((s: any) => s.id === currentSessionId) ||
        emptySessions[0];

      localState.sessions = localState.sessions.filter(
        (session: any) =>
          !isEmptyDefaultSession(session) ||
          session.id === preservedEmptySession.id,
      );

      console.log("[mergeChat] 清理完成", {
        sessionsCount: localState.sessions.length,
        preservedEmptySession: preservedEmptySession.id,
      });
    }

    if (currentSessionId) {
      const nextIndex = localState.sessions.findIndex(
        (session) => session.id === currentSessionId,
      );
      console.log("[mergeChat] 查找当前会话", {
        currentSessionId,
        nextIndex,
        found: nextIndex >= 0,
      });
      if (nextIndex >= 0) {
        localState.currentSessionIndex = nextIndex;
        console.log("[mergeChat] 更新 currentSessionIndex 为", nextIndex);
      } else {
        console.log(
          "[mergeChat] 当前会话未找到，保持索引",
          localState.currentSessionIndex,
        );
      }
    }

    if (debugLoggingEnabled) {
      logSyncDebug("[Sync] 📊 会话合并完成:", {
        localSessionCount,
        remoteSessionCount,
        localEmptySessionCount,
        remoteEmptySessionCount,
        adoptedRemoteCount,
        keptLocalCount,
        mergedSameTimestampCount,
        mergedSessionCount: localState.sessions.length,
      });
      if (adoptedRemoteEmptySessionIds.length > 0) {
        logSyncDebug("[Sync] 📝 已接收远端空会话:", {
          count: adoptedRemoteEmptySessionIds.length,
          ids: adoptedRemoteEmptySessionIds.slice(0, MAX_DEBUG_SESSION_IDS),
          truncated:
            adoptedRemoteEmptySessionIds.length > MAX_DEBUG_SESSION_IDS,
        });
      }
      if (keptLocalEmptySessionIds.length > 0) {
        logSyncDebug("[Sync] 📝 保留本地空会话:", {
          count: keptLocalEmptySessionIds.length,
          ids: keptLocalEmptySessionIds.slice(0, MAX_DEBUG_SESSION_IDS),
          truncated: keptLocalEmptySessionIds.length > MAX_DEBUG_SESSION_IDS,
        });
      }
      if (mergedSameTimestampEmptySessionIds.length > 0) {
        logSyncDebug("[Sync] 📝 同时间戳空会话已合并:", {
          count: mergedSameTimestampEmptySessionIds.length,
          ids: mergedSameTimestampEmptySessionIds.slice(
            0,
            MAX_DEBUG_SESSION_IDS,
          ),
          truncated:
            mergedSameTimestampEmptySessionIds.length > MAX_DEBUG_SESSION_IDS,
        });
      }
    }
    return localState;
  },
  [StoreKey.Prompt]: (localState, remoteState) => {
    localState.prompts = {
      ...remoteState.prompts,
      ...localState.prompts,
    };
    return localState;
  },
  [StoreKey.Plugin]: (localState, remoteState) => {
    localState.plugins = {
      ...remoteState.plugins,
      ...localState.plugins,
    };
    return localState;
  },
  [StoreKey.Mask]: (localState, remoteState) => {
    localState.masks = {
      ...remoteState.masks,
      ...localState.masks,
    };
    return localState;
  },
  [StoreKey.Config]: (localState, remoteState) => {
    // 策略：
    // - 当前管理的供应商模型以本地为准，避免云端历史模型回流
    // - 其他模型保留双向合并
    // - 其他配置字段以本地为准
    const localModels = localState.models || [];
    const remoteModels = remoteState.models || [];
    const managedProviderIds = getManagedProviderIdsFromProfiles(
      useAccessStore.getState().apiProfiles || [],
    );

    const modelMap = new Map<string, LLMModel>();

    // 先添加本地所有模型
    localModels.forEach((m: LLMModel) => {
      const key = `${m.name}@${m.provider?.id}`;
      modelMap.set(key, m);
    });

    // 添加远程独有的模型（如果 key 不同则视为新增）
    remoteModels.forEach((m: LLMModel) => {
      const providerId = String(m.provider?.id || "").toLowerCase();
      if (managedProviderIds.has(providerId)) {
        return;
      }
      const key = `${m.name}@${m.provider?.id}`;
      if (!modelMap.has(key)) {
        modelMap.set(key, m);
      } else {
        // 同名模型：如果本地不可用但远程可用，更新为可用
        const existing = modelMap.get(key)!;
        if (!existing.available && m.available) {
          modelMap.set(key, { ...existing, available: true });
        }
      }
    });

    const mergedModels = [...modelMap.values()];
    const mergedState = {
      ...remoteState,
      ...localState,
      models: mergedModels,
      lastUpdate: markMergedUpdateTime(
        Number((localState as any).lastUpdate),
        Number((remoteState as any).lastUpdate),
      ),
    };

    Object.assign(localState, mergedState);
    return localState;
  },
  [StoreKey.Access]: (localState, remoteState) => {
    // 策略：
    // - profile 主配置双向合并，本地用户编辑字段优先
    // - 模型缓存已迁移到独立 store，这里不再主导 cachedModels/modelCount

    const localProfileMap = new Map(
      (localState.apiProfiles || []).map((p) => [p.id, p]),
    );
    const remoteProfileMap = new Map(
      (remoteState.apiProfiles || []).map((p) => [p.id, p]),
    );

    const mergedProfiles: typeof localState.apiProfiles = [];

    // 处理本地有的 profile
    localProfileMap.forEach((localProfile, id) => {
      const remoteProfile = remoteProfileMap.get(id);
      if (remoteProfile) {
        mergedProfiles.push({
          ...remoteProfile,
          ...localProfile,
        });
      } else {
        mergedProfiles.push(localProfile);
      }
    });

    // 添加远程独有的 profile
    remoteProfileMap.forEach((profile, id) => {
      if (!localProfileMap.has(id)) {
        mergedProfiles.push(profile);
      }
    });

    const mergedState = {
      ...remoteState,
      ...localState,
      apiProfiles: mergedProfiles,
      lastUpdateTime: markMergedUpdateTime(
        localState.lastUpdateTime,
        remoteState.lastUpdateTime,
      ),
    };

    Object.assign(localState, mergedState);

    return localState;
  },
  [StoreKey.ModelCache]: (localState, remoteState) => {
    const mergedProfiles = { ...(remoteState.profiles || {}) };

    Object.entries(localState.profiles || {}).forEach(
      ([profileId, profile]) => {
        const remoteProfile = mergedProfiles[profileId];
        if (!remoteProfile) {
          mergedProfiles[profileId] = profile;
          return;
        }

        mergedProfiles[profileId] =
          (profile.updatedAt || 0) >= (remoteProfile.updatedAt || 0)
            ? profile
            : remoteProfile;
      },
    );

    localState.profiles = mergedProfiles;
    return localState;
  },
  [StoreKey.Update]: (localState, remoteState) => {
    // 策略：更新状态属于控制面数据，以云端为准。
    const mergedState = {
      ...localState,
      ...remoteState,
      lastUpdateTime: markMergedUpdateTime(
        localState.lastUpdateTime,
        remoteState.lastUpdateTime,
      ),
    };
    Object.assign(localState, mergedState);
    return localState;
  },
  [StoreKey.SdList]: (localState, remoteState) => {
    const localDrawMap = new Map(
      (localState.draw || []).map((item: any) => [item.id, item]),
    );
    const remoteDrawMap = new Map(
      (remoteState.draw || []).map((item: any) => [item.id, item]),
    );

    const mergedDraw = [...remoteDrawMap.values()];
    localDrawMap.forEach((item, id) => {
      if (!remoteDrawMap.has(id)) {
        mergedDraw.push(item);
        return;
      }

      const remoteItem = remoteDrawMap.get(id);
      const localStatus = String(item?.status ?? "");
      const remoteStatus = String(remoteItem?.status ?? "");
      const shouldPreferLocal =
        remoteStatus === "running" && localStatus !== "running";
      if (shouldPreferLocal) {
        const index = mergedDraw.findIndex((draw: any) => draw.id === id);
        if (index >= 0) mergedDraw[index] = item;
      }
    });

    localState.draw = mergedDraw;
    localState.currentId = Math.max(
      Number(localState.currentId || 0),
      Number(remoteState.currentId || 0),
    );
    if (!localState.currentModel && remoteState.currentModel) {
      localState.currentModel = remoteState.currentModel;
    }
    if (!localState.currentParams && remoteState.currentParams) {
      localState.currentParams = remoteState.currentParams;
    }
    return localState;
  },
};

export function getLocalAppState() {
  const appState = Object.fromEntries(
    Object.entries(LocalStateGetters).map(([key, getter]) => {
      return [key, getter()];
    }),
  ) as AppState;

  return appState;
}

export function setLocalAppState(appState: AppState) {
  Object.entries(LocalStateSetters).forEach(([key, setter]) => {
    setter(appState[key as keyof AppState]);
  });
}

export function setLocalStoreState<T extends keyof AppState>(
  key: T,
  state: AppState[T],
) {
  LocalStateSetters[key](state);
}

export function mergeAppState(localState: AppState, remoteState: AppState) {
  if (!isObjectLike(remoteState)) {
    return localState;
  }

  Object.keys(localState).forEach(<T extends keyof AppState>(k: string) => {
    const key = k as T;
    const localStoreState = localState[key];
    const remoteStoreState = remoteState[key];
    if (!isObjectLike(remoteStoreState)) {
      return;
    }
    MergeStates[key](localStoreState, remoteStoreState);
  });

  return localState;
}

export function mergeStoreState<T extends keyof AppState>(
  key: T,
  localState: AppState[T],
  remoteState: AppState[T],
) {
  if (!isObjectLike(remoteState)) {
    return localState;
  }

  return MergeStates[key](localState, remoteState);
}

/**
 * Merge state with `lastUpdateTime`, older state will be override
 */
export function mergeWithUpdate<T extends { lastUpdateTime?: number }>(
  localState: T,
  remoteState: T,
) {
  const localUpdateTime = localState.lastUpdateTime ?? 0;
  const remoteUpdateTime = remoteState.lastUpdateTime ?? 0;

  if (localUpdateTime < remoteUpdateTime) {
    merge(remoteState, localState);
    return { ...remoteState };
  } else {
    merge(localState, remoteState);
    return { ...localState };
  }
}
