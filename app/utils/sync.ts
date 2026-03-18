import {
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
import { StoreKey } from "../constant";
export { SYNC_STORE_KEYS } from "./sync-store-keys";

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
  [StoreKey.ModelCache]: () => getNonFunctionFileds(useModelCacheStore.getState()),
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
    // merge sessions
    const localSessions: Record<string, ChatSession> = {};
    localState.sessions.forEach((s) => (localSessions[s.id] = s));

    remoteState.sessions.forEach((remoteSession) => {
      // skip empty chats
      if (remoteSession.messages.length === 0) return;

      const localSession = localSessions[remoteSession.id];
      if (!localSession) {
        // if remote session is new, just merge it
        localState.sessions.push(remoteSession);
      } else {
        // if both have the same session id, merge the messages
        const localMessageIds = new Set(localSession.messages.map((v) => v.id));
        remoteSession.messages.forEach((m) => {
          if (!localMessageIds.has(m.id)) {
            localSession.messages.push(m);
          }
        });

        // sort local messages with date field in asc order
        localSession.messages.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
      }
    });

    // sort local sessions with date field in desc order
    localState.sessions.sort(
      (a, b) =>
        new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime(),
    );

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
    // 策略：模型双向合并，其他配置字段以本地为准。
    const localModels = localState.models || [];
    const remoteModels = remoteState.models || [];

    const modelMap = new Map<string, LLMModel>();

    // 先添加本地所有模型
    localModels.forEach((m: LLMModel) => {
      const key = `${m.name}@${m.provider?.id}`;
      modelMap.set(key, m);
    });

    // 添加远程独有的模型（如果 key 不同则视为新增）
    remoteModels.forEach((m: LLMModel) => {
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

    Object.entries(localState.profiles || {}).forEach(([profileId, profile]) => {
      const remoteProfile = mergedProfiles[profileId];
      if (!remoteProfile) {
        mergedProfiles[profileId] = profile;
        return;
      }

      mergedProfiles[profileId] =
        (profile.updatedAt || 0) >= (remoteProfile.updatedAt || 0)
          ? profile
          : remoteProfile;
    });

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

export function mergeAppState(localState: AppState, remoteState: AppState) {
  Object.keys(localState).forEach(<T extends keyof AppState>(k: string) => {
    const key = k as T;
    const localStoreState = localState[key];
    const remoteStoreState = remoteState[key];
    MergeStates[key](localStoreState, remoteStoreState);
  });

  return localState;
}

export function mergeStoreState<T extends keyof AppState>(
  key: T,
  localState: AppState[T],
  remoteState: AppState[T],
) {
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
