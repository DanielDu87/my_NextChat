import {
  ChatSession,
  useAccessStore,
  useAppConfig,
  useChatStore,
  usePluginStore,
  useUpdateStore,
} from "../store";
import { LLMModel } from "../client/api";
import { useMaskStore } from "../store/mask";
import { usePromptStore } from "../store/prompt";
import { useSdStore } from "../store/sd";
import { StoreKey } from "../constant";
import { merge } from "./merge";
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
    // 合并 models：只增不减，取并集
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

    // 合并后的 models
    const mergedModels = [...modelMap.values()];

    // 其他字段用时间戳比较合并
    const baseResult = mergeWithUpdate(localState, remoteState);
    baseResult.models = mergedModels;

    return baseResult;
  },
  [StoreKey.Access]: (localState, remoteState) => {
    // 双向合并 apiProfiles：
    // - 本地有、远程没有的 → 保留
    // - 远程有、本地没有的 → 添加
    // - 都有的 → 保留本地运行态字段，以 config.models 为真实模型来源

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
          ...localProfile,
          ...remoteProfile,
          cachedModels: localProfile.cachedModels ?? "",
          modelCount: localProfile.modelCount ?? 0,
        });
      } else {
        // 本地独有：直接保留
        mergedProfiles.push(localProfile);
      }
    });

    // 添加远程独有的 profile
    remoteProfileMap.forEach((profile, id) => {
      if (!localProfileMap.has(id)) {
        mergedProfiles.push(profile);
      }
    });

    // 先保存合并后的 apiProfiles
    const savedProfiles = mergedProfiles;
    const savedUpdateTime = Date.now();

    // 合并其他字段（排除 apiProfiles 和 lastUpdateTime）
    const remoteCopy = { ...remoteState };
    delete (remoteCopy as any).apiProfiles;
    delete (remoteCopy as any).lastUpdateTime;
    merge(localState, remoteCopy);

    // 恢复 apiProfiles 和 lastUpdateTime
    localState.apiProfiles = savedProfiles;
    localState.lastUpdateTime = savedUpdateTime;

    return localState;
  },
  [StoreKey.Update]: (localState, remoteState) => {
    return mergeWithUpdate(localState, remoteState);
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
