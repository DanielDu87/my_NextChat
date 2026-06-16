import type { ChatMessage, ChatSession } from "../store/chat";
import { useChatStore } from "../store/chat";
import { useAccessStore } from "../store/access";
import { useAppConfig } from "../store/config";
import { useModelCacheStore } from "../store/model-cache";
import {
  applyBuiltinPluginDefaults,
  FunctionToolService,
  prunePlugins,
  usePluginStore,
} from "../store/plugin";
import { useUpdateStore } from "../store/update";
import { useDrawStore } from "../store/draw";
import { DEFAULT_CONFIG } from "../store/config";
import { normalizeAccessStateDerivedFields } from "../store/access";
import { LLMModel } from "../client/api";
import merge from "lodash-es/merge";
import { usePromptStore } from "../store/prompt";
import { DEFAULT_SIDEBAR_WIDTH, ServiceProvider, StoreKey } from "../constant";
import {
  getMessageTime,
  getSessionCreatedAt,
  getSessionMessages,
  mergeSessionMessages,
  sortSessionsByCreatedAt,
} from "./chat-session-merge";
import { runWithImmediateStoreSyncPausedSync } from "./store";
import {
  dedupeAccessProfiles,
  isLegacyGeneratedCustomProviderId,
  pruneLegacyGeneratedCustomModels,
} from "./access-profiles";
import {
  MULTI_KEY_GROUP_IDS,
  normalizeMultiKeyGroups,
  shouldAutoEnableMultiKey,
} from "./multi-key";
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

function formatSyncLogTimestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

function formatSyncUpdatedAt(updatedAt: number) {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return "无";
  }

  return new Date(updatedAt).toISOString();
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

export function stripConfigLocalModelFields<T extends Record<string, any>>(
  config: T,
) {
  const { models, ...configToSync } = config;
  void models;
  return configToSync as Omit<T, "models">;
}

function getEnabledProfileId(profiles: Array<Record<string, any>>) {
  return String(profiles.find((profile) => profile?.enabled)?.id || "");
}

export type GetStoreState<T> = T extends { getState: () => infer U }
  ? NonFunctionFields<U>
  : never;

const LocalStateSetters = {
  [StoreKey.Chat]: ((state: any) =>
    useChatStore.setState(state)) as typeof useChatStore.setState,
  [StoreKey.Plugin]: usePluginStore.setState,
  [StoreKey.Access]: useAccessStore.setState,
  [StoreKey.Config]: useAppConfig.setState,
  [StoreKey.ModelCache]: useModelCacheStore.setState,
  [StoreKey.Prompt]: usePromptStore.setState,
  [StoreKey.Update]: useUpdateStore.setState,
  [StoreKey.DrawList]: ((state: any) =>
    useDrawStore.setState(state)) as typeof useDrawStore.setState,
} as const;

const LocalStateGetters = {
  [StoreKey.Chat]: () => getNonFunctionFileds(useChatStore.getState()),
  [StoreKey.Plugin]: () => {
    const pluginState = getNonFunctionFileds(usePluginStore.getState()) as any;
    return {
      ...pluginState,
      plugins: prunePlugins(pluginState.plugins, pluginState.deletedPluginIds),
    };
  },
  [StoreKey.Access]: () => {
    const access = getNonFunctionFileds(useAccessStore.getState()) as any;
    return {
      ...access,
      apiProfiles: dedupeAccessProfiles(access.apiProfiles || []).map(
        stripProfileModelCacheFields,
      ),
    };
  },
  [StoreKey.Config]: () => {
    const config = getNonFunctionFileds(useAppConfig.getState());
    return stripConfigLocalModelFields(config as any);
  },
  [StoreKey.ModelCache]: () =>
    getNonFunctionFileds(useModelCacheStore.getState()),
  [StoreKey.Prompt]: () => getNonFunctionFileds(usePromptStore.getState()),
  [StoreKey.Update]: () => getNonFunctionFileds(useUpdateStore.getState()),
  [StoreKey.DrawList]: () =>
    normalizeDrawSyncState(getNonFunctionFileds(useDrawStore.getState())),
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
    models: Array.isArray(useAppConfig.getState().models)
      ? useAppConfig.getState().models
      : [],
    modelConfig: {
      ...((state as Record<string, any>).modelConfig || {}),
      webSearch: true,
    },
  } as T;
}

function resetPluginToolCache() {
  FunctionToolService.tools = {};
  console.log("[Sync] 🔌 插件工具缓存已刷新");
}

function getPluginConfigUpdatedAt(plugin: any) {
  return (
    Number(plugin?.configUpdatedAt) ||
    Number(plugin?.enabledUpdatedAt) ||
    Number(plugin?.createdAt) ||
    0
  );
}

function mergePluginSecretFields(
  basePlugin: any,
  localPlugin: any,
  remotePlugin: any,
) {
  const localAuthToken = String(localPlugin?.authToken || "").trim();
  const remoteAuthToken = String(remotePlugin?.authToken || "").trim();

  if (localAuthToken || remoteAuthToken) {
    basePlugin.authToken = localAuthToken || remoteAuthToken;
  } else {
    delete basePlugin.authToken;
  }

  const localAuthHeader = String(localPlugin?.authHeader || "").trim();
  const remoteAuthHeader = String(remotePlugin?.authHeader || "").trim();
  if (localAuthHeader || remoteAuthHeader) {
    basePlugin.authHeader = localAuthHeader || remoteAuthHeader;
  }

  return basePlugin;
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
] as const;

function preserveLocalSecret<T extends Record<string, any>>(
  localState: T | undefined,
  remoteState: T | undefined,
  key: (typeof ACCESS_SECRET_FIELD_KEYS)[number],
  preferRemote: boolean,
) {
  const localValue = String(localState?.[key] || "").trim();
  const remoteValue = String(remoteState?.[key] || "").trim();
  if (preferRemote) {
    return remoteValue || localValue || "";
  }

  return Object.prototype.hasOwnProperty.call(localState || {}, key)
    ? localValue
    : remoteValue || "";
}

function mergeApiKeyGroups(
  localGroups: Record<string, string>,
  remoteGroups: Record<string, string>,
  preferRemote: boolean,
) {
  const primaryGroups = preferRemote ? remoteGroups : localGroups;
  const fallbackGroups = preferRemote ? localGroups : remoteGroups;
  const mergedGroupKeys = new Set([
    ...Object.keys(primaryGroups),
    ...Object.keys(fallbackGroups),
  ]);

  return Object.fromEntries(
    [...mergedGroupKeys].map((groupKey) => [
      groupKey,
      Object.prototype.hasOwnProperty.call(primaryGroups, groupKey)
        ? String(primaryGroups[groupKey] || "").trim()
        : String(fallbackGroups[groupKey] || "").trim(),
    ]),
  );
}

function hasNonEmptyGroupKey(groups: Record<string, string> | undefined) {
  return Object.values(groups || {}).some((value) =>
    String(value || "").trim(),
  );
}

function normalizeMergedAccessProfile<T extends Record<string, any>>(
  profile: T,
) {
  const normalizedGroups = normalizeMultiKeyGroups(
    profile.apiKeyGroups,
    profile,
  );
  const hasGroupKeys = hasNonEmptyGroupKey(normalizedGroups);
  const multiKeyEnabled = shouldAutoEnableMultiKey({
    ...profile,
    apiKeyGroups: normalizedGroups,
    multiKeyEnabled: hasGroupKeys ? true : profile.multiKeyEnabled,
  });

  if (!multiKeyEnabled) {
    return profile;
  }

  return {
    ...profile,
    multiKeyEnabled: true,
    apiKeyGroups: normalizedGroups,
    multiKeyGroupOrder: [...MULTI_KEY_GROUP_IDS],
  };
}

function isDefaultBootstrapProfile(profile: Record<string, any>) {
  return (
    String(profile?.id || "") === "default_aihubmix_profile" &&
    String(profile?.name || "") === "AihubMix" &&
    String(profile?.provider || "") === ServiceProvider.Custom &&
    String(profile?.baseUrl || "") === "https://aihubmix.com" &&
    !hasNonEmptyString(profile?.apiKey) &&
    !hasNonEmptyString(profile?.modelFetchApiKey) &&
    !hasNonEmptyString(profile?.cachedModels) &&
    !Number(profile?.modelCount || 0) &&
    !Boolean(profile?.multiKeyEnabled) &&
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
      hasNonEmptyString(profile.cachedModels) ||
      Number(profile.modelCount || 0) > 0 ||
      Boolean(profile.multiKeyEnabled) ||
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

export function hasMeaningfulDrawState(state: Record<string, any>) {
  return (
    (Array.isArray(state?.draw) &&
      state.draw.some(
        (item) => isObjectLike(item) && item.status !== "running",
      )) ||
    Object.values(state?.providerModels || {}).some(
      (models) => Array.isArray(models) && models.length > 0,
    ) ||
    Object.values(state?.providerCurrentModelMap || {}).some((value) =>
      hasNonEmptyString(value),
    ) ||
    hasNonEmptyString(state?.selectedProvider) ||
    hasNonEmptyString(state?.currentModel?.value)
  );
}

// Draw 中仅调试日志/临时删除墓碑/当前参数保持本地；
// 模型列表、当前模型、供应商选择需要参与云同步，保证多端一致。
const DRAW_LOCAL_ONLY_FIELDS = [
  "deletedTaskIds",
  "currentParams",
  "lastRequestLog",
  "lastResponseLog",
] as const;

function normalizeDrawSyncState<T extends Record<string, any>>(state: T): T {
  const syncState = { ...state };
  for (const field of DRAW_LOCAL_ONLY_FIELDS) {
    delete (syncState as Record<string, unknown>)[field];
  }
  return syncState as T;
}

const STORE_SYNC_STRATEGIES: Record<keyof AppState, string> = {
  [StoreKey.Chat]: "双向合并",
  [StoreKey.Plugin]: "双向合并",
  [StoreKey.Access]: "按 profile 合并，派生字段以云端为准",
  [StoreKey.Config]: "用户添加模型双向合并，其他配置本地覆盖云端",
  [StoreKey.ModelCache]: "按 profile 合并，较新的缓存优先",
  [StoreKey.Prompt]: "双向合并",
  [StoreKey.Update]: "云端覆盖本地",
  [StoreKey.DrawList]: "较新的绘图记录覆盖",
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
    const deletedPluginIds = [
      ...new Set([
        ...((remoteState as any).deletedPluginIds || []),
        ...((localState as any).deletedPluginIds || []),
      ]),
    ];
    const mergedPlugins = {} as Record<string, any>;
    const pluginIds = new Set([
      ...Object.keys(remoteState.plugins || {}),
      ...Object.keys(localState.plugins || {}),
    ]);

    pluginIds.forEach((id) => {
      const localPlugin = (localState.plugins || {})[id] as any;
      const remotePlugin = (remoteState.plugins || {})[id] as any;
      if (!localPlugin || !remotePlugin) {
        const onlyPlugin = localPlugin || remotePlugin;
        if (onlyPlugin) {
          mergedPlugins[id] = onlyPlugin;
        }
        return;
      }

      const localConfigAt = getPluginConfigUpdatedAt(localPlugin);
      const remoteConfigAt = getPluginConfigUpdatedAt(remotePlugin);
      const basePlugin =
        remoteConfigAt > localConfigAt
          ? { ...remotePlugin }
          : { ...localPlugin };
      mergedPlugins[id] = mergePluginSecretFields(
        basePlugin,
        localPlugin,
        remotePlugin,
      );

      const localEnabledAt = Number(localPlugin.enabledUpdatedAt) || 0;
      const remoteEnabledAt = Number(remotePlugin.enabledUpdatedAt) || 0;
      if (remoteEnabledAt > localEnabledAt) {
        mergedPlugins[id].enabled = remotePlugin.enabled;
        mergedPlugins[id].enabledUpdatedAt = remotePlugin.enabledUpdatedAt;
      } else {
        mergedPlugins[id].enabled = localPlugin.enabled;
        mergedPlugins[id].enabledUpdatedAt = localPlugin.enabledUpdatedAt;
      }
    });

    (localState as any).deletedPluginIds = deletedPluginIds;
    localState.plugins = prunePlugins(mergedPlugins, deletedPluginIds);
    Object.values(localState.plugins || {}).forEach((plugin: any) => {
      applyBuiltinPluginDefaults(plugin);
    });
    console.log("[Sync] 🔌 插件配置与启用状态合并", {
      local: Object.fromEntries(
        Object.entries(localState.plugins || {}).map(([id, plugin]: any) => [
          id,
          {
            enabled: plugin?.enabled !== false,
            configUpdatedAt: plugin?.configUpdatedAt,
            hasAuthToken: Boolean(plugin?.authToken),
          },
        ]),
      ),
      remote: Object.fromEntries(
        Object.entries(remoteState.plugins || {}).map(([id, plugin]: any) => [
          id,
          {
            enabled: plugin?.enabled !== false,
            configUpdatedAt: plugin?.configUpdatedAt,
            hasAuthToken: Boolean(plugin?.authToken),
          },
        ]),
      ),
      merged: Object.fromEntries(
        Object.entries(localState.plugins || {}).map(([id, plugin]: any) => [
          id,
          {
            enabled: plugin?.enabled !== false,
            configUpdatedAt: plugin?.configUpdatedAt,
            hasAuthToken: Boolean(plugin?.authToken),
          },
        ]),
      ),
    });
    return localState;
  },
  [StoreKey.Config]: (localState, remoteState) => {
    // 策略：
    // - models 数组是本地临时数据，不参与数据库同步
    // - theme / tightBorder 跟随较新的配置同步
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
    const localCustomModelsStr = pruneLegacyGeneratedCustomModels(
      local.customModels,
    );
    const remoteCustomModelsStr = pruneLegacyGeneratedCustomModels(
      remote.customModels,
    );

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

    console.debug(
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
      } remote=本地临时字段不参与数据库合并`,
    );

    // 整体配置仍以 lastUpdateTime 做基础 spread（temperature 等非关键字段）
    const localUpdate = Number(local.lastUpdateTime) || 0;
    const remoteUpdate = Number(remote.lastUpdateTime) || 0;
    const useRemoteConfig = preferRemoteOnBootstrap
      ? true
      : remoteUpdate > localUpdate;
    const preferredConfig = useRemoteConfig ? remote : local;

    const mergedState = {
      ...(preferRemoteOnBootstrap ? localState : remoteState),
      ...(preferRemoteOnBootstrap ? remoteState : localState),
      theme: preferredConfig.theme ?? currentConfig.theme,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      tightBorder: preferredConfig.tightBorder ?? currentConfig.tightBorder,
      // 供应商全量模型是本地临时数据，不从数据库恢复或合并。
      models: Array.isArray(currentConfig.models) ? currentConfig.models : [],
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

    if (
      isLegacyGeneratedCustomProviderId(
        (mergedState.modelConfig as any)?.providerId,
      )
    ) {
      mergedState.modelConfig = {
        ...mergedState.modelConfig,
        model: "gpt-chat-latest",
        providerName: ServiceProvider.Custom,
        providerId: "custom_aihubmix",
      };
    }

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
    const localSelectionAt =
      Number((localState as Record<string, any>).profileSelectionUpdatedAt) ||
      0;
    const remoteSelectionAt =
      Number((remoteState as Record<string, any>).profileSelectionUpdatedAt) ||
      0;
    const shouldPreferRemoteState =
      !hasMeaningfulAccessState(localState as Record<string, any>) &&
      hasMeaningfulAccessState(remoteState as Record<string, any>);
    const localEnabledProfileId = getEnabledProfileId(localProfiles);
    const remoteEnabledProfileId = getEnabledProfileId(remoteProfiles);
    const useRemoteProfileSelection = shouldPreferRemoteState
      ? true
      : remoteSelectionAt > localSelectionAt
      ? true
      : remoteSelectionAt < localSelectionAt
      ? false
      : !!remoteEnabledProfileId && !localEnabledProfileId;
    const selectedProfileId = useRemoteProfileSelection
      ? remoteEnabledProfileId || localEnabledProfileId
      : localEnabledProfileId || remoteEnabledProfileId;

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
        if (selectedProfileId) {
          mergedProfile.enabled = String(id) === selectedProfileId;
        }

        (["apiKey", "modelFetchApiKey"] as const).forEach((key) => {
          mergedProfile[key] = preserveLocalSecret(
            localProfile as Record<string, any>,
            remoteProfile as Record<string, any>,
            key,
            remoteUpdateTime > localUpdateTime || shouldPreferRemoteState,
          );
        });

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
        mergedProfile.apiKeyGroups = mergeApiKeyGroups(
          localGroups,
          remoteGroups,
          remoteUpdateTime > localUpdateTime || shouldPreferRemoteState,
        );

        mergedProfiles.push(
          normalizeMergedAccessProfile(
            stripProfileModelCacheFields(mergedProfile),
          ) as any,
        );
      } else {
        const nextProfile = { ...(localProfile as any) };
        if (selectedProfileId) {
          nextProfile.enabled = String(id) === selectedProfileId;
        }
        mergedProfiles.push(
          normalizeMergedAccessProfile(
            stripProfileModelCacheFields(nextProfile as any),
          ) as any,
        );
      }
    });

    // 添加远程独有的 profile（仅当远程更新时，避免删除后恢复）
    if (remoteUpdateTime > localUpdateTime || shouldPreferRemoteState) {
      remoteProfileMap.forEach((profile, id) => {
        if (!localProfileMap.has(id)) {
          const nextProfile = { ...(profile as any) };
          if (selectedProfileId) {
            nextProfile.enabled = String(id) === selectedProfileId;
          }
          mergedProfiles.push(
            normalizeMergedAccessProfile(
              stripProfileModelCacheFields(nextProfile),
            ) as any,
          );
        }
      });
    } else if (selectedProfileId && !localProfileMap.has(selectedProfileId)) {
      const selectedRemoteProfile = remoteProfileMap.get(selectedProfileId);
      if (selectedRemoteProfile) {
        mergedProfiles.push(
          normalizeMergedAccessProfile(
            stripProfileModelCacheFields({
              ...selectedRemoteProfile,
              enabled: true,
            } as any),
          ) as any,
        );
      }
    }

    const mergedState = {
      ...(remoteUpdateTime > localUpdateTime || shouldPreferRemoteState
        ? localState
        : remoteState),
      ...(remoteUpdateTime > localUpdateTime || shouldPreferRemoteState
        ? remoteState
        : localState),
      apiProfiles: dedupeAccessProfiles(mergedProfiles as any),
      profileSelectionUpdatedAt: Math.max(localSelectionAt, remoteSelectionAt),
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
        remoteUpdateTime > localUpdateTime || shouldPreferRemoteState,
      );
    });

    normalizeAccessStateDerivedFields(mergedAccessState);
    Object.assign(localState, mergedAccessState);

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
  [StoreKey.DrawList]: (localState, remoteState) => {
    const localUpdateTime = Number(localState.lastUpdateTime || 0);
    const remoteUpdateTime = Number(remoteState.lastUpdateTime || 0);
    const isLocalFresh = localUpdateTime === 0;
    const hasRemoteDraw = hasMeaningfulDrawState(remoteState);
    const localCount = Array.isArray(localState?.draw)
      ? localState.draw.length
      : 0;
    const remoteCount = Array.isArray(remoteState?.draw)
      ? remoteState.draw.length
      : 0;

    // 新设备首次同步：本地从未写过（lastUpdateTime === 0）且远端有数据 → 拉取远端
    // 注意：不能用 hasMeaningfulDrawState(localState) 判断本地是否为空，
    // 因为清空全部或只剩 running 任务时该函数也返回 false，导致已删除项被恢复。
    const useRemote = isLocalFresh && hasRemoteDraw;
    const useRemoteByTime = !useRemote && remoteUpdateTime > localUpdateTime;
    const sourceState = useRemote || useRemoteByTime ? remoteState : localState;
    const localDraw = Array.isArray(localState?.draw) ? localState.draw : [];
    const currentDrawState = useDrawStore.getState() as any;
    const currentDraw = Array.isArray(currentDrawState?.draw)
      ? currentDrawState.draw
      : [];
    const currentFinalizedDrawIds = new Set(
      currentDraw
        .map((item: any) => {
          const id = String(item?.id || "");
          if (!id) return "";
          return item?.status === "running" ? "" : id;
        })
        .filter(Boolean),
    );
    const deletedTaskIds = ((): Record<string, unknown> => {
      if (isObjectLike(currentDrawState?.deletedTaskIds)) {
        return currentDrawState.deletedTaskIds as Record<string, unknown>;
      }
      if (isObjectLike((localState as any)?.deletedTaskIds)) {
        return (localState as any).deletedTaskIds as Record<string, unknown>;
      }
      return {};
    })();
    const sourceDraw = (
      Array.isArray(sourceState?.draw) ? sourceState.draw : []
    ).filter((item: any) => {
      const id = String(item?.id || "");
      if (!id) return true;
      return !deletedTaskIds[id];
    });
    const sourceDrawIds = new Set(
      sourceDraw.map((item: any) => String(item?.id || "")).filter(Boolean),
    );
    const activeLocalDraw = [...currentDraw, ...localDraw].filter(
      (item: any) => {
        const id = String(item?.id || "");
        if (
          !id ||
          deletedTaskIds[id] ||
          currentFinalizedDrawIds.has(id) ||
          item?.status !== "running" ||
          sourceDrawIds.has(id)
        ) {
          return false;
        }
        sourceDrawIds.add(id);
        return true;
      },
    );

    const sourceLabel = sourceState === remoteState ? "远端" : "本地";
    console.log(
      `${formatSyncLogTimestamp()} [Sync] 🔀 合并绘图记录\n` +
        `  - 本地: ${localCount} 条，更新于 ${formatSyncUpdatedAt(
          localUpdateTime,
        )}\n` +
        `  - 远端: ${remoteCount} 条，更新于 ${formatSyncUpdatedAt(
          remoteUpdateTime,
        )}\n` +
        `  - 使用: ${sourceLabel}`,
    );

    const localPrefs: Record<string, unknown> = {};
    const localStateRecord = localState as Record<string, unknown>;
    const currentDrawRecord = currentDrawState as Record<string, unknown>;
    for (const field of DRAW_LOCAL_ONLY_FIELDS) {
      if (field in currentDrawRecord) {
        localPrefs[field] = currentDrawRecord[field];
        continue;
      }
      if (field in localStateRecord) {
        localPrefs[field] = localStateRecord[field];
      }
    }

    const mergedState = {
      ...sourceState,
      draw:
        activeLocalDraw.length > 0
          ? [...activeLocalDraw, ...sourceDraw]
          : sourceDraw,
      lastUpdateTime: markMergedUpdateTime(localUpdateTime, remoteUpdateTime),
    };

    Object.assign(localState, mergedState, localPrefs);
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
      if (storeKey === StoreKey.Plugin) {
        (setter as any)(appState[storeKey]);
        resetPluginToolCache();
        return;
      }
      (setter as any)(appState[storeKey]);
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
      LocalStateSetters[key](
        normalizeImportedConfigState(
          state as AppState[typeof StoreKey.Config],
        ) as AppState[T],
      );
      return;
    }

    if (key === StoreKey.Plugin) {
      LocalStateSetters[key](state);
      resetPluginToolCache();
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
