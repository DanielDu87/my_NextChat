import {
  ChatMessage,
  ChatSession,
  getLocalOnlyAppConfig,
  useAccessStore,
  useAppConfig,
  useChatStore,
  useModelCacheStore,
  usePluginStore,
  useUpdateStore,
} from "../store";
import { DEFAULT_CONFIG } from "../store/config";
import { normalizeAccessStateDerivedFields } from "../store/access";
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
import { runWithImmediateStoreSyncPausedSync } from "./store";
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

function stripProfileModelCacheFields<T extends Record<string, any>>(
  profile: T,
) {
  const { cachedModels, modelCount, ...rest } = profile;
  void cachedModels;
  void modelCount;
  return rest as Omit<T, "cachedModels" | "modelCount">;
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
  [StoreKey.Access]: () => {
    const access = getNonFunctionFileds(useAccessStore.getState()) as any;
    return {
      ...access,
      apiProfiles: (access.apiProfiles || []).map(stripProfileModelCacheFields),
    };
  },
  [StoreKey.Config]: () => {
    const config = getNonFunctionFileds(useAppConfig.getState());
    // 排除本地 UI 偏好，models 纳入同步以便跨浏览器共享已添加模型
    const { theme, sidebarWidth, tightBorder, ...configToSync } = config as any;
    return configToSync;
  },
  [StoreKey.ModelCache]: () =>
    getNonFunctionFileds(useModelCacheStore.getState()),
  [StoreKey.Mask]: () => getNonFunctionFileds(useMaskStore.getState()),
  [StoreKey.Prompt]: () => getNonFunctionFileds(usePromptStore.getState()),
  [StoreKey.Update]: () => getNonFunctionFileds(useUpdateStore.getState()),
  [StoreKey.SdList]: () => getNonFunctionFileds(useSdStore.getState()),
} as const;

function normalizeImportedConfigState<T>(state: T): T {
  if (
    !isObjectLike(state) ||
    !isObjectLike((state as Record<string, unknown>).modelConfig)
  ) {
    return state;
  }

  return {
    ...state,
    modelConfig: {
      ...((state as Record<string, any>).modelConfig || {}),
      webSearch: true,
    },
  } as T;
}

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
        : profile.provider === ServiceProvider.Local
        ? `${String(profile.provider).toLowerCase()}_${
            profile.name
          }`.toLowerCase()
        : String(profile.provider).toLowerCase(),
    ),
  );
}

function hasNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNonEmptyRecord(value: unknown) {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length > 0
  );
}

const ACCESS_SECRET_FIELD_KEYS = [
  "customApiKey",
  "openaiApiKey",
  "azureApiKey",
  "googleApiKey",
  "anthropicApiKey",
  "baiduApiKey",
  "baiduSecretKey",
  "bytedanceApiKey",
  "alibabaApiKey",
  "moonshotApiKey",
  "stabilityApiKey",
  "tencentSecretKey",
  "tencentSecretId",
  "iflytekApiKey",
  "iflytekApiSecret",
  "deepseekApiKey",
  "xaiApiKey",
  "chatglmApiKey",
  "siliconflowApiKey",
  "ai302ApiKey",
  "localApiKey",
  "apiKey",
  "modelFetchApiKey",
  "balanceQueryApiKey",
] as const;

function preserveLocalSecret<T extends Record<string, any>>(
  localState: T | undefined,
  remoteState: T | undefined,
  key: (typeof ACCESS_SECRET_FIELD_KEYS)[number],
) {
  const localValue = String(localState?.[key] || "").trim();
  const remoteValue = String(remoteState?.[key] || "").trim();
  return remoteValue || localValue || "";
}

function isDefaultBootstrapProfile(profile: Record<string, any>) {
  return (
    String(profile?.id || "") === "default_aihubmix_profile" &&
    String(profile?.name || "") === "AihubMix" &&
    String(profile?.provider || "") === ServiceProvider.Custom &&
    String(profile?.baseUrl || "") === "https://aihubmix.com" &&
    !hasNonEmptyString(profile?.apiKey) &&
    !hasNonEmptyString(profile?.modelFetchApiKey) &&
    !hasNonEmptyString(profile?.balanceQueryApiKey) &&
    !hasNonEmptyString(profile?.balanceQueryUrl) &&
    !hasNonEmptyString(profile?.balanceQueryField) &&
    !hasNonEmptyString(profile?.cachedModels) &&
    !Number(profile?.modelCount || 0) &&
    !hasNonEmptyRecord(profile?.apiKeyGroups)
  );
}

function hasMeaningfulAccessProfiles(profiles: unknown) {
  if (!Array.isArray(profiles)) {
    return false;
  }

  return profiles.some((profile) => {
    if (!isObjectLike(profile)) {
      return false;
    }

    if (isDefaultBootstrapProfile(profile)) {
      return false;
    }

    return (
      hasNonEmptyString(profile.id) ||
      hasNonEmptyString(profile.name) ||
      hasNonEmptyString(profile.baseUrl) ||
      hasNonEmptyString(profile.apiKey) ||
      hasNonEmptyString(profile.modelFetchApiKey) ||
      hasNonEmptyString(profile.balanceQueryApiKey) ||
      hasNonEmptyString(profile.balanceQueryUrl) ||
      hasNonEmptyString(profile.balanceQueryField) ||
      hasNonEmptyString(profile.cachedModels) ||
      Number(profile.modelCount || 0) > 0 ||
      hasNonEmptyRecord(profile.apiKeyGroups)
    );
  });
}

export function hasMeaningfulConfigState(state: Record<string, any>) {
  // models 不参与同步，不作为"有意义"的判断依据
  // providerName 默认值是 ServiceProvider.Custom，必须排除以避免本地总被判为有意义
  const defaultModel = DEFAULT_CONFIG.modelConfig.model;
  return (
    Number(state?.lastUpdateTime || 0) > 0 ||
    hasNonEmptyString(state?.customModels) ||
    (Array.isArray(state?.autoModelSeries) &&
      state.autoModelSeries.length > 0) ||
    (hasNonEmptyString(state?.modelConfig?.model) &&
      state.modelConfig.model !== defaultModel) ||
    (hasNonEmptyString(state?.modelConfig?.providerName) &&
      state.modelConfig.providerName !== ServiceProvider.Custom)
  );
}

export function hasMeaningfulAccessState(state: Record<string, any>) {
  const defaultModel = DEFAULT_CONFIG.modelConfig.model;
  return (
    Number(state?.lastUpdateTime || 0) > 0 ||
    hasMeaningfulAccessProfiles(state?.apiProfiles) ||
    (hasNonEmptyString(state?.defaultModel) &&
      state.defaultModel !== defaultModel) ||
    hasNonEmptyString(state?.customModels) ||
    hasNonEmptyString(state?.visionModels) ||
    hasNonEmptyString(state?.openaiApiKey) ||
    hasNonEmptyString(state?.googleApiKey) ||
    hasNonEmptyString(state?.anthropicApiKey) ||
    hasNonEmptyString(state?.azureApiKey) ||
    hasNonEmptyString(state?.baiduApiKey) ||
    hasNonEmptyString(state?.baiduSecretKey) ||
    hasNonEmptyString(state?.bytedanceApiKey) ||
    hasNonEmptyString(state?.alibabaApiKey) ||
    hasNonEmptyString(state?.moonshotApiKey) ||
    hasNonEmptyString(state?.stabilityApiKey) ||
    hasNonEmptyString(state?.tencentSecretId) ||
    hasNonEmptyString(state?.tencentSecretKey) ||
    hasNonEmptyString(state?.iflytekApiKey) ||
    hasNonEmptyString(state?.iflytekApiSecret) ||
    hasNonEmptyString(state?.deepseekApiKey) ||
    hasNonEmptyString(state?.xaiApiKey) ||
    hasNonEmptyString(state?.chatglmApiKey) ||
    hasNonEmptyString(state?.siliconflowApiKey) ||
    hasNonEmptyString(state?.ai302ApiKey) ||
    hasNonEmptyString(state?.customApiKey) ||
    hasNonEmptyString(state?.localApiKey)
  );
}

export function hasMeaningfulModelCacheState(state: Record<string, any>) {
  return Object.values(state?.profiles || {}).some((profile) => {
    if (!isObjectLike(profile)) {
      return false;
    }

    return (
      hasNonEmptyString(profile.cachedModels) ||
      Number(profile.modelCount || 0) > 0 ||
      Number(profile.updatedAt || 0) > 0 ||
      hasNonEmptyString(profile.lastError)
    );
  });
}

function hasMeaningfulSdState(state: Record<string, any>) {
  return (
    Number(state?.lastUpdateTime || 0) > 0 ||
    Number(state?.currentId || 0) > 0 ||
    (Array.isArray(state?.draw) && state.draw.length > 0)
  );
}

const STORE_SYNC_STRATEGIES: Record<keyof AppState, string> = {
  [StoreKey.Chat]: "双向合并",
  [StoreKey.Plugin]: "双向合并",
  [StoreKey.Access]: "按 profile 合并，派生字段以云端为准",
  [StoreKey.Config]: "用户添加模型双向合并，其他配置本地覆盖云端",
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

function mergeModelArrays(localModels: any[], remoteModels: any[]): any[] {
  const local = Array.isArray(localModels) ? localModels : [];
  const remote = Array.isArray(remoteModels) ? remoteModels : [];
  if (remote.length === 0) return local;
  if (local.length === 0) return remote;
  const seen = new Set<string>();
  const merged: any[] = [];
  for (const m of local) {
    const key = `${m.name}||${String(m.provider?.id || "").toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(m);
    }
  }
  for (const m of remote) {
    const key = `${m.name}||${String(m.provider?.id || "").toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(m);
    }
  }
  return merged;
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
      String(localState.selectedSessionId || "") ||
      localState.sessions?.[localState.currentSessionIndex]?.id ||
      "";
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

    logSyncDebug("[mergeChat] 同步合并完成", {
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
      logSyncDebug("[mergeChat] 发现多个空会话，开始清理", {
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

      logSyncDebug("[mergeChat] 清理完成", {
        sessionsCount: localState.sessions.length,
        preservedEmptySession: preservedEmptySession.id,
      });
    }

    if (currentSessionId) {
      const nextIndex = localState.sessions.findIndex(
        (session) => session.id === currentSessionId,
      );
      logSyncDebug("[mergeChat] 查找当前会话", {
        currentSessionId,
        nextIndex,
        found: nextIndex >= 0,
      });
      if (nextIndex >= 0) {
        localState.currentSessionIndex = nextIndex;
        (localState as any).selectedSessionId =
          localState.sessions[nextIndex]?.id || "";
        logSyncDebug("[mergeChat] 更新 currentSessionIndex 为", nextIndex);
      } else {
        logSyncDebug(
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
    // - models 数组参与同步：本地已加载则保留本地，否则用远端（跨浏览器共享已添加模型）
    // - theme / sidebarWidth / tightBorder 始终以当前本地 UI 偏好为准
    // - customModels / autoModelSeries / modelConfig.model+providerName
    //   各自按字段级时间戳独立判定胜方，互不干扰
    // - modelConfig 其他字段（temperature/top_p/max_tokens 等）保留"远端补全本地缺失"
    const currentConfig = useAppConfig.getState();
    const preferRemoteOnBootstrap =
      !hasMeaningfulConfigState(localState as Record<string, any>) &&
      hasMeaningfulConfigState(remoteState as Record<string, any>);

    const local = localState as Record<string, any>;
    const remote = remoteState as Record<string, any>;

    // 字段级时间戳：各字段独立判定谁更新
    const localCustomModelsAt = Number(local.customModelsUpdatedAt) || 0;
    const remoteCustomModelsAt = Number(remote.customModelsUpdatedAt) || 0;
    const localCustomModelsStr = String(local.customModels ?? "");
    const remoteCustomModelsStr = String(remote.customModels ?? "");

    const localAutoSeriesAt = Number(local.autoModelSeriesUpdatedAt) || 0;
    const remoteAutoSeriesAt = Number(remote.autoModelSeriesUpdatedAt) || 0;
    const localAutoSeriesArr = Array.isArray(local.autoModelSeries)
      ? local.autoModelSeries
      : [];
    const remoteAutoSeriesArr = Array.isArray(remote.autoModelSeries)
      ? remote.autoModelSeries
      : [];
    // 时间戳相同（含双 0）时，倾向有内容的一边，避免空数组覆盖远端已选自动模式
    const useRemoteAutoSeries = preferRemoteOnBootstrap
      ? true
      : remoteAutoSeriesAt > localAutoSeriesAt
      ? true
      : remoteAutoSeriesAt < localAutoSeriesAt
      ? false
      : remoteAutoSeriesArr.length > 0 && localAutoSeriesArr.length === 0;

    const localModelSelAt = Number(local.modelSelectionUpdatedAt) || 0;
    const remoteModelSelAt = Number(remote.modelSelectionUpdatedAt) || 0;
    const defaultPlaceholderModel = DEFAULT_CONFIG.modelConfig.model;
    const localHasMeaningfulModel =
      hasNonEmptyString(local.modelConfig?.model) &&
      local.modelConfig?.model !== defaultPlaceholderModel;
    const remoteHasMeaningfulModel =
      hasNonEmptyString(remote.modelConfig?.model) &&
      remote.modelConfig?.model !== defaultPlaceholderModel;
    // 时间戳相同（含双 0）时，倾向已设置具体模型的一边
    const useRemoteModelSelection = preferRemoteOnBootstrap
      ? true
      : remoteModelSelAt > localModelSelAt
      ? true
      : remoteModelSelAt < localModelSelAt
      ? false
      : remoteHasMeaningfulModel && !localHasMeaningfulModel;

    console.log(
      `[Sync] 🔍 Config合并: model=${
        useRemoteModelSelection ? "远端" : "本地"
      }(${
        useRemoteModelSelection
          ? remote.modelConfig?.model
          : local.modelConfig?.model
      }) | autoSeries=${
        useRemoteAutoSeries ? "远端" : "本地"
      } | models: local=${
        Array.isArray(currentConfig.models) ? currentConfig.models.length : 0
      } remote=${Array.isArray(remote.models) ? remote.models.length : "无"}`,
    );

    // 整体配置仍以 lastUpdateTime 做基础 spread（temperature 等非关键字段）
    const localUpdate = Number(local.lastUpdateTime) || 0;
    const remoteUpdate = Number(remote.lastUpdateTime) || 0;

    const mergedState = {
      ...(preferRemoteOnBootstrap ? localState : remoteState),
      ...(preferRemoteOnBootstrap ? remoteState : localState),
      // 始终保持本地 UI 偏好
      theme: currentConfig.theme,
      sidebarWidth: currentConfig.sidebarWidth,
      tightBorder: currentConfig.tightBorder,
      // models：双方合并取并集，不删除任何一方的模型
      models: mergeModelArrays(currentConfig.models, remote.models),
      // customModels：以最新时间戳为准，支持删除
      customModels:
        remoteCustomModelsAt > localCustomModelsAt
          ? remoteCustomModelsStr
          : remoteCustomModelsAt < localCustomModelsAt
          ? localCustomModelsStr
          : remoteCustomModelsStr.length > localCustomModelsStr.length
          ? remoteCustomModelsStr
          : localCustomModelsStr,
      customModelsUpdatedAt: Math.max(
        localCustomModelsAt,
        remoteCustomModelsAt,
      ),
      autoModelSeries: useRemoteAutoSeries
        ? Array.isArray(remote.autoModelSeries)
          ? [...remote.autoModelSeries]
          : []
        : Array.isArray(local.autoModelSeries)
        ? [...local.autoModelSeries]
        : [],
      autoModelSeriesUpdatedAt: Math.max(localAutoSeriesAt, remoteAutoSeriesAt),
      modelConfig: {
        ...((preferRemoteOnBootstrap ? localState : remoteState) as any)
          .modelConfig,
        ...((preferRemoteOnBootstrap ? remoteState : localState) as any)
          .modelConfig,
        model: useRemoteModelSelection
          ? remote.modelConfig?.model ?? local.modelConfig?.model
          : local.modelConfig?.model ?? remote.modelConfig?.model,
        providerName: useRemoteModelSelection
          ? remote.modelConfig?.providerName ?? local.modelConfig?.providerName
          : local.modelConfig?.providerName ?? remote.modelConfig?.providerName,
        providerId: useRemoteModelSelection
          ? remote.modelConfig?.providerId ?? local.modelConfig?.providerId
          : local.modelConfig?.providerId ?? remote.modelConfig?.providerId,
      },
      modelSelectionUpdatedAt: Math.max(localModelSelAt, remoteModelSelAt),
      lastUpdateTime: markMergedUpdateTime(localUpdate, remoteUpdate),
    };

    Object.assign(localState, mergedState);
    return localState;
  },
  [StoreKey.Access]: (localState, remoteState) => {
    // 策略：
    // - profile 主配置双向合并，本地用户编辑字段优先
    // - 模型缓存已迁移到独立 store，这里不再主导 cachedModels/modelCount
    // - 如果本地更新时间更新，不自动恢复远程独有的 profile（避免删除后恢复）

    const localProfiles = (localState.apiProfiles || []) as Array<
      Record<string, any>
    >;
    const remoteProfiles = (remoteState.apiProfiles || []) as Array<
      Record<string, any>
    >;
    const localProfileMap = new Map(localProfiles.map((p) => [p.id, p]));
    const remoteProfileMap = new Map(remoteProfiles.map((p) => [p.id, p]));

    const mergedProfiles: typeof localState.apiProfiles = [];
    const localUpdateTime = localState.lastUpdateTime || 0;
    const remoteUpdateTime = remoteState.lastUpdateTime || 0;
    const shouldPreferRemoteState =
      !hasMeaningfulAccessState(localState as Record<string, any>) &&
      hasMeaningfulAccessState(remoteState as Record<string, any>);

    // 处理本地有的 profile
    localProfileMap.forEach((localProfile, id) => {
      const remoteProfile = remoteProfileMap.get(id);
      if (remoteProfile) {
        const mergedProfile = {
          ...(remoteUpdateTime > localUpdateTime || shouldPreferRemoteState
            ? localProfile
            : remoteProfile),
          ...(remoteUpdateTime > localUpdateTime || shouldPreferRemoteState
            ? remoteProfile
            : localProfile),
        } as Record<string, any>;

        (["apiKey", "modelFetchApiKey", "balanceQueryApiKey"] as const).forEach(
          (key) => {
            mergedProfile[key] = preserveLocalSecret(
              localProfile as Record<string, any>,
              remoteProfile as Record<string, any>,
              key,
            );
          },
        );

        const localGroups =
          localProfile?.apiKeyGroups &&
          typeof localProfile.apiKeyGroups === "object"
            ? (localProfile.apiKeyGroups as Record<string, string>)
            : {};
        const remoteGroups =
          remoteProfile?.apiKeyGroups &&
          typeof remoteProfile.apiKeyGroups === "object"
            ? (remoteProfile.apiKeyGroups as Record<string, string>)
            : {};
        const mergedGroupKeys = new Set([
          ...Object.keys(localGroups),
          ...Object.keys(remoteGroups),
        ]);
        mergedProfile.apiKeyGroups = Object.fromEntries(
          [...mergedGroupKeys].map((groupKey) => [
            groupKey,
            String(
              remoteGroups[groupKey] || localGroups[groupKey] || "",
            ).trim(),
          ]),
        );

        mergedProfiles.push(stripProfileModelCacheFields(mergedProfile) as any);
      } else {
        mergedProfiles.push(
          stripProfileModelCacheFields(localProfile as any) as any,
        );
      }
    });

    // 添加远程独有的 profile（仅当远程更新时，避免删除后恢复）
    if (remoteUpdateTime > localUpdateTime || shouldPreferRemoteState) {
      remoteProfileMap.forEach((profile, id) => {
        if (!localProfileMap.has(id)) {
          mergedProfiles.push(
            stripProfileModelCacheFields(profile as any) as any,
          );
        }
      });
    }

    const mergedState = {
      ...(remoteUpdateTime > localUpdateTime || shouldPreferRemoteState
        ? localState
        : remoteState),
      ...(remoteUpdateTime > localUpdateTime || shouldPreferRemoteState
        ? remoteState
        : localState),
      apiProfiles: mergedProfiles,
      lastUpdateTime: markMergedUpdateTime(
        localState.lastUpdateTime,
        remoteState.lastUpdateTime,
      ),
    };

    const mergedAccessState = mergedState as Record<string, any>;
    ACCESS_SECRET_FIELD_KEYS.forEach((key) => {
      mergedAccessState[key] = preserveLocalSecret(
        localState as Record<string, any>,
        remoteState as Record<string, any>,
        key,
      );
    });

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
    const preferRemoteOnBootstrap =
      !hasMeaningfulSdState(localState as Record<string, any>) &&
      hasMeaningfulSdState(remoteState as Record<string, any>);

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
    localState.currentId = preferRemoteOnBootstrap
      ? Number(remoteState.currentId || 0)
      : Math.max(
          Number(localState.currentId || 0),
          Number(remoteState.currentId || 0),
        );
    if (preferRemoteOnBootstrap && remoteState.currentModel) {
      localState.currentModel = remoteState.currentModel;
    } else if (!localState.currentModel && remoteState.currentModel) {
      localState.currentModel = remoteState.currentModel;
    }
    if (preferRemoteOnBootstrap && remoteState.currentParams) {
      localState.currentParams = remoteState.currentParams;
    } else if (!localState.currentParams && remoteState.currentParams) {
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
  runWithImmediateStoreSyncPausedSync(() => {
    Object.entries(LocalStateSetters).forEach(([key, setter]) => {
      const storeKey = key as keyof AppState;
      if (storeKey === StoreKey.Access) {
        setter(
          normalizeAccessStateDerivedFields(
            appState[storeKey] as AppState[typeof StoreKey.Access],
          ) as AppState[keyof AppState],
        );
        return;
      }
      if (storeKey === StoreKey.Config) {
        setter(
          normalizeImportedConfigState(
            appState[storeKey],
          ) as AppState[keyof AppState],
        );
        return;
      }
      setter(appState[storeKey]);
    });
  });
}

export function setLocalStoreState<T extends keyof AppState>(
  key: T,
  state: AppState[T],
) {
  runWithImmediateStoreSyncPausedSync(() => {
    if (key === StoreKey.Access) {
      LocalStateSetters[key](
        normalizeAccessStateDerivedFields(
          state as AppState[typeof StoreKey.Access],
        ) as AppState[T],
      );
      return;
    }

    if (key === StoreKey.Config) {
      LocalStateSetters[key]({
        ...normalizeImportedConfigState(
          state as AppState[typeof StoreKey.Config],
        ),
        ...getLocalOnlyAppConfig(),
      } as AppState[T]);
      return;
    }

    LocalStateSetters[key](state);
  });
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
