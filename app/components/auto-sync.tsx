"use client";

import { useEffect } from "react";
import { ChatControllerPool } from "../client/controller";
import { StoreKey, Path } from "../constant";
import { useAppConfig } from "../store/config";
import { useAccessStore } from "../store/access";
import { useModelCacheStore } from "../store/model-cache";
import { useChatStore } from "../store/chat";
import { useDrawStore } from "../store/draw";
import { useSyncStore, setSyncSummarySuppressed } from "../store/sync";
import { useAuthStore } from "../store/auth";
import { showToast } from "./ui-lib";
import {
  hasMeaningfulAccessState,
  hasMeaningfulDrawState,
} from "../utils/sync";
import { readAccessSnapshot } from "../utils/access-snapshot";
import {
  AUTO_SYNC_CHANNEL_NAME,
  AUTO_SYNC_LOCK_KEY,
  AUTO_SYNC_LOCK_TTL_MS,
  CHAT_SYNC_HINT_KEY,
  CHAT_SYNC_UPDATED_MESSAGE_TYPE,
  CONFIG_SYNC_HINT_KEY,
  CONFIG_SYNC_UPDATED_MESSAGE_TYPE,
  buildAutoSyncLock,
  getOrCreateAutoSyncTabId,
  parseChatSyncHint,
  parseConfigSyncHint,
  parseAutoSyncLock,
  shouldAutoSyncLockBeTakenOver,
} from "../utils/sync-tab-coordination";
import { isPerfFeatureEnabled, logPerfSummary, nowMs } from "../utils/perf";
import { isManualDatabaseSyncActive } from "../utils/manual-sync-guard";
import {
  getAutoSyncCriticalStoreKeys,
  getAutoSyncDeferredStoreKeys,
  type AutoSyncScope,
  type SyncStoreKey,
} from "../utils/sync-store-keys";
import { publishStartupChatSyncStatus } from "../utils/chat-startup-loading";
import {
  getCurrentAutoSyncScope,
  getCurrentHashPath,
} from "../utils/startup-sync-scope";
import {
  markRouteSyncBootstrap,
  markRouteSyncStart,
  prepareRouteEntryForSync,
  ROUTE_SYNC_ENTRY_EVENT,
  shouldAutoStartRouteSync,
  shouldSkipAutoSyncByRecentBootstrap,
} from "../utils/route-sync-entry";

let autoSyncEffectActive = false;
const autoSyncLogQueue: Array<{
  level: "log" | "info" | "warn" | "error" | "debug";
  message: string;
  payload?: unknown;
}> = [];
let autoSyncLogFlushScheduled = false;
const autoSyncLogDedupMap = new Map<string, number>();

function getScopeReadyMessage(scope: AutoSyncScope) {
  switch (scope) {
    case "draw":
      return "[AutoSync] ✅ 绘画关键同步完成，页面已可直接绘画";
    case "home":
    case "chat":
      return "[AutoSync] ✅ 关键同步完成，页面已可直接对话";
    case "app":
    default:
      return "[AutoSync] ✅ 关键同步完成，页面已可直接对话";
  }
}

function getScopeDeferredDoneMessage(scope: AutoSyncScope) {
  switch (scope) {
    case "draw":
      return "[AutoSync] ✅ 绘画后台同步完成";
    case "home":
    case "chat":
      return "[AutoSync] ✅ 后台同步完成（含对话记录）";
    case "app":
    default:
      return "[AutoSync] ✅ 后台同步完成（含对话记录）";
  }
}

function isChatLikeScope(scope: AutoSyncScope) {
  return true;
}

function flushAutoSyncLogs() {
  autoSyncLogFlushScheduled = false;
  const logs = autoSyncLogQueue.splice(0, autoSyncLogQueue.length);
  logs.forEach(({ level, message, payload }) => {
    if (payload === undefined) {
      console[level](message);
      return;
    }
    console[level](message, payload);
  });
}

function scheduleAutoSyncLogFlush() {
  if (autoSyncLogFlushScheduled) {
    return;
  }

  autoSyncLogFlushScheduled = true;

  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    (
      window as typeof window & {
        requestIdleCallback: (
          callback: () => void,
          options?: { timeout?: number },
        ) => number;
      }
    ).requestIdleCallback(flushAutoSyncLogs, { timeout: 500 });
    return;
  }

  setTimeout(flushAutoSyncLogs, 0);
}

function formatAutoSyncLogTimestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

function autoSyncConsole(
  level: "log" | "info" | "warn" | "error" | "debug",
  message: string,
  payload?: unknown,
) {
  // 首页控制台只保留数据汇总（[Sync]）；AutoSync 过程日志不再打印。
  // warn/error 仍保留，避免真正同步失败被静默。
  if (level !== "warn" && level !== "error") {
    return;
  }

  const dedupKey = `${level}|${message}|${
    payload === undefined ? "" : JSON.stringify(payload)
  }`;
  const now = Date.now();
  const lastDedupAt = autoSyncLogDedupMap.get(dedupKey) || 0;
  if (level !== "warn" && level !== "error" && now - lastDedupAt < 1500) {
    return;
  }
  autoSyncLogDedupMap.set(dedupKey, now);

  const prefixedMessage = `${formatAutoSyncLogTimestamp()} ${message}`;
  if (level === "warn" || level === "error") {
    if (payload === undefined) {
      console[level](prefixedMessage);
      return;
    }
    console[level](prefixedMessage, payload);
    return;
  }

  autoSyncLogQueue.push({
    level,
    message: prefixedMessage,
    payload,
  });
  scheduleAutoSyncLogFlush();
}

function autoSyncDebug(message: string, payload?: unknown) {
  void message;
  void payload;
}

function scheduleDeferredSyncTask(
  task: () => void,
  options: {
    visibleDelayMs: number;
    hiddenDelayMs: number;
  },
) {
  const delayMs = document.hidden
    ? options.hiddenDelayMs
    : options.visibleDelayMs;

  // 使用可取消的 timeout，路由切换时能立即关闭旧页面后台同步。
  const timer = setTimeout(task, delayMs);
  return () => clearTimeout(timer);
}

export default function AutoSync() {
  const authUser = useAuthStore((state) => state.user);
  const authInitialized = useAuthStore((state) => state.initialized);

  const ensureRemoteBootstrapState = async (
    scope: AutoSyncScope,
    options?: { abortSignal?: AbortSignal; silentSummary?: boolean },
  ) => {
    const syncStore = useSyncStore.getState();
    const client = syncStore.getClient() as any;
    if (typeof client.getMeta !== "function") {
      return false;
    }

    const bootstrapKeys: SyncStoreKey[] =
      scope === "draw" ? [StoreKey.DrawList] : [StoreKey.Access, StoreKey.Chat];
    let metas: any[] = [];
    try {
      metas = await client.getMeta(bootstrapKeys, {
        timeoutMs: 60000,
        retries: 1,
        signal: options?.abortSignal,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /^\[(DB Sync|Sync)\] aborted\b/.test(error.message)
      ) {
        return false;
      }
      autoSyncConsole(
        "warn",
        "[AutoSync] ⚠️ 远端初始化元数据检查失败，稍后可通过后台同步再次补齐:",
        error,
      );
      return false;
    }
    const remoteMetaKeys = new Set(
      (metas || []).map((meta: { key: string }) => meta.key),
    );
    const missingStoreKeys: SyncStoreKey[] =
      scope === "draw"
        ? bootstrapKeys.filter((key) => !remoteMetaKeys.has(key))
        : ([StoreKey.Access] as SyncStoreKey[]).filter(
            (key) => !remoteMetaKeys.has(key),
          );

    const localStateByKey: Partial<Record<StoreKey, Record<string, any>>> = {
      [StoreKey.DrawList]: useDrawStore.getState() as Record<string, any>,
      [StoreKey.Access]: useAccessStore.getState() as Record<string, any>,
      [StoreKey.Chat]: useChatStore.getState() as Record<string, any>,
    };

    const hasLocalBootstrapData = (key: StoreKey) => {
      const localState = localStateByKey[key] || {};
      switch (key) {
        case StoreKey.Access:
          return hasMeaningfulAccessState(localState);
        case StoreKey.DrawList:
          return hasMeaningfulDrawState(localState);
        case StoreKey.Chat:
          return Array.isArray((localState as any)?.sessions)
            ? (localState as any).sessions.length > 0
            : false;
        default:
          return false;
      }
    };
    const uploadableMissingStoreKeys: SyncStoreKey[] = missingStoreKeys.filter(
      (key) => hasLocalBootstrapData(key),
    );

    if (
      missingStoreKeys.length > 0 &&
      uploadableMissingStoreKeys.length === 0
    ) {
      autoSyncConsole(
        "log",
        `[AutoSync] ℹ️ 云端缺少初始化配置(${missingStoreKeys.join(
          ", ",
        )})，但本地也暂无可上传数据，跳过初始化上传`,
      );
    } else if (uploadableMissingStoreKeys.length > 0) {
      autoSyncConsole(
        "log",
        `[AutoSync] ☁️ 检测到云端缺少初始化配置(${missingStoreKeys.join(
          ", ",
        )})，开始上传本地配置`,
      );
      await syncStore.sync(uploadableMissingStoreKeys, {
        isolateQueue: true,
        force: true,
        abortSignal: options?.abortSignal,
        silentSummary: options?.silentSummary,
      });
      showToast(
        `检测到云端缺少初始化配置，已自动上传本地数据：${missingStoreKeys.join(
          ", ",
        )}`,
      );
    }

    return uploadableMissingStoreKeys.length > 0;
  };

  useEffect(() => {
    if (!authInitialized || !authUser) {
      return;
    }

    if (autoSyncEffectActive) {
      autoSyncConsole("log", "[AutoSync] ⏭️ 已存在自动同步实例，跳过重复挂载");
      return;
    }
    autoSyncEffectActive = true;

    const sessionStorage =
      typeof window !== "undefined" ? window.sessionStorage : null;
    const tabId = getOrCreateAutoSyncTabId(sessionStorage);
    const localStorage =
      typeof window !== "undefined" ? window.localStorage : null;
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(AUTO_SYNC_CHANNEL_NAME)
        : null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let hasCompletedAutoSync = false;
    let autoSyncInProgress = false;
    let lastForegroundSyncAt = 0;
    let lastExternalChatHintAt = 0;
    let hasRestoredModelsFromHydratedCache = false;
    let chatMetaPollTimer: ReturnType<typeof setInterval> | null = null;
    let chatMetaPollIdleCallbackId: number | null = null;
    let deferredFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelDeferredSyncTask: (() => void) | null = null;
    let autoSyncCancelledByManualSync = false;
    // 路由变化不再 abort 同步（参见 handleRouteChangeRestart 注释），
    // 保留变量仅为不影响 shouldCancelAutoSync / getAutoSyncCancelMessage 既有签名。
    let autoSyncCancelledByRouteChange = false;
    let activeRoutePath = getCurrentHashPath();
    let syncAbortController: AbortController | null = null;
    let startAutoSync = () => {};
    const isAbortError = (error: unknown) =>
      error instanceof Error &&
      /^\[(DB Sync|Sync)\] aborted\b/.test(error.message);

    const shouldCancelForManualSync = () => {
      if (!isManualDatabaseSyncActive()) {
        return false;
      }
      autoSyncCancelledByManualSync = true;
      hasCompletedAutoSync = true;
      syncAbortController?.abort();
      syncAbortController = null;
      return true;
    };

    const normalizePath = (p: string) => p.replace(/\/+$/, "") || "/";
    // 桌面端首页是 `/`，移动端首页会立即进入 `/chat`。两者以及其他聊天入口
    // 都属于首开同步汇总页，否则移动端会清空并静默掉模型、用户和对话输出。
    const shouldShowStartupSummary = (path: string) => {
      const normalizedPath = normalizePath(path);
      return (
        normalizedPath === Path.Home ||
        normalizedPath === Path.Chat ||
        normalizedPath === Path.NewChat ||
        normalizedPath === Path.SearchChat ||
        /^\/chat\/[^/]+$/.test(normalizedPath)
      );
    };
    // 不再因页面切换打断同步：路由变化时让当前 sync 自然完成即可，
    // 由 handleRouteChangeRestart 在新路径上重新调度。保留该函数是为了
    // 让 shouldCancelAutoSync 调用点继续按原签名工作，避免大范围改动。
    const shouldCancelForRouteChange = (expectedPath: string) => {
      const actualPath = normalizePath(getCurrentHashPath());
      const normalizedExpectedPath = normalizePath(expectedPath);
      if (actualPath === normalizedExpectedPath) {
        return false;
      }
      // 路径不匹配的「保持当前同步继续」属于常规信息，不再每次切路径都打一遍。
      // 想观察时打开 Verbose 即可看到。
      autoSyncConsole(
        "debug",
        `[AutoSync] ℹ️ 检测到页面切换（期望路径: ${normalizedExpectedPath}, 实际路径: ${actualPath}），保持当前同步继续`,
      );
      return false;
    };

    const shouldCancelAutoSync = (expectedPath: string) =>
      shouldCancelForManualSync() || shouldCancelForRouteChange(expectedPath);

    const getAutoSyncCancelMessage = (phase: string) => {
      if (autoSyncCancelledByManualSync) {
        return `[AutoSync] ⏹️ 保存并同步已接管，${phase}终止`;
      }
      if (autoSyncCancelledByRouteChange) {
        return `[AutoSync] ⏹️ 检测到页面切换，${phase}终止`;
      }
      return `[AutoSync] ⏹️ ${phase}已取消`;
    };

    const writeLock = () => {
      if (!localStorage) {
        return false;
      }

      const lock = buildAutoSyncLock(tabId);
      localStorage.setItem(AUTO_SYNC_LOCK_KEY, JSON.stringify(lock));
      const confirmedLock = parseAutoSyncLock(
        localStorage.getItem(AUTO_SYNC_LOCK_KEY),
      );

      return confirmedLock?.owner === tabId;
    };

    const acquireLock = () => {
      if (!localStorage) {
        return true;
      }

      const now = Date.now();
      const currentLock = parseAutoSyncLock(
        localStorage.getItem(AUTO_SYNC_LOCK_KEY),
      );
      if (!shouldAutoSyncLockBeTakenOver(currentLock, tabId, now)) {
        return false;
      }

      return writeLock();
    };

    const refreshLock = () => {
      if (!localStorage) {
        return;
      }

      const currentLock = parseAutoSyncLock(
        localStorage.getItem(AUTO_SYNC_LOCK_KEY),
      );
      if (currentLock?.owner !== tabId) {
        return;
      }

      localStorage.setItem(
        AUTO_SYNC_LOCK_KEY,
        JSON.stringify(buildAutoSyncLock(tabId)),
      );
    };

    const releaseLock = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (chatMetaPollTimer) {
        clearInterval(chatMetaPollTimer);
        chatMetaPollTimer = null;
      }

      if (!localStorage) {
        try {
          channel?.postMessage({ type: "auto-sync-finished", owner: tabId });
        } catch {}
        return;
      }

      const currentLock = parseAutoSyncLock(
        localStorage.getItem(AUTO_SYNC_LOCK_KEY),
      );
      if (currentLock?.owner === tabId) {
        localStorage.removeItem(AUTO_SYNC_LOCK_KEY);
      }

      try {
        channel?.postMessage({ type: "auto-sync-finished", owner: tabId });
      } catch {}
    };

    const clearRetryTimer = () => {
      if (!retryTimer) {
        return;
      }
      clearTimeout(retryTimer);
      retryTimer = null;
    };

    const triggerExternalChatSync = (source: string) => {
      if (!isChatLikeScope(getCurrentAutoSyncScope())) {
        return;
      }
      if (!authInitialized || !authUser || autoSyncInProgress) {
        return;
      }
      const expectedPath = activeRoutePath;
      if (shouldCancelAutoSync(expectedPath)) {
        return;
      }

      const now = Date.now();
      if (now - lastExternalChatHintAt < 300) {
        return;
      }
      lastExternalChatHintAt = now;

      const syncStore = useSyncStore.getState() as any;
      void Promise.resolve()
        .then(() =>
          syncStore.resumePendingDebounceSync?.({
            excludeKeys: [StoreKey.Config],
            silentSummary: !shouldShowStartupSummary(activeRoutePath),
          }),
        )
        .then(() => {
          if (shouldCancelAutoSync(expectedPath)) {
            return undefined;
          }
        })
        .then(() =>
          syncStore.syncChatIfRemoteChanged?.({
            source,
            minIntervalMs: 0,
            silentSummary: !shouldShowStartupSummary(activeRoutePath),
          }),
        )
        .catch((error: unknown) => {
          autoSyncConsole(
            "error",
            "[AutoSync] ❌ 外部聊天变更同步失败:",
            error,
          );
        });
    };

    const scheduleChatMetaPollSync = () => {
      if (chatMetaPollIdleCallbackId !== null) {
        return;
      }

      const run = () => {
        chatMetaPollIdleCallbackId = null;
        triggerExternalChatSync(
          document.hidden ? "poll-hidden" : "poll-visible",
        );
      };

      if ("requestIdleCallback" in window) {
        chatMetaPollIdleCallbackId = (
          window as typeof window & {
            requestIdleCallback: (callback: () => void) => number;
          }
        ).requestIdleCallback(run);
        return;
      }

      // 不支持 requestIdleCallback 的浏览器也不能在 interval 回调中直接进入
      // 同步链；先让当前任务结束，避免 DevTools 报告长时间 interval handler。
      queueMicrotask(run);
    };

    const scheduleRetry = (attemptAutoSync: () => void) => {
      if (retryTimer || hasCompletedAutoSync || autoSyncInProgress) {
        return;
      }
      if (shouldCancelAutoSync(activeRoutePath)) {
        return;
      }

      retryTimer = setTimeout(() => {
        retryTimer = null;
        attemptAutoSync();
      }, AUTO_SYNC_LOCK_TTL_MS + 500);
    };

    // 移除挂载时立即调用的 rebuildManagedModelsFromCache()
    // hydration 完成后（scheduleStart）会调用，数据更完整

    let timer: ReturnType<typeof setTimeout> | null = null;
    let clearHydrationBarrier: (() => void) | null = null;
    const startedAt = nowMs();
    const getHydrationState = () => {
      return {
        sync: Boolean(useSyncStore.getState()._hasHydrated),
        access: Boolean(useAccessStore.getState()._hasHydrated),
        config: Boolean(useAppConfig.getState()._hasHydrated),
        modelCache: Boolean(useModelCacheStore.getState()._hasHydrated),
        chat: Boolean(useChatStore.getState()._hasHydrated),
      };
    };
    const areCriticalStoresHydrated = () => {
      const hydrationState = getHydrationState();
      return (
        hydrationState.sync &&
        hydrationState.access &&
        hydrationState.config &&
        hydrationState.chat
      );
    };

    const restoreLocalCriticalState = () => {
      if (hasRestoredModelsFromHydratedCache || !areCriticalStoresHydrated()) {
        return;
      }

      const restoreStartedAt = nowMs();
      hasRestoredModelsFromHydratedCache = true;
      const accessSnapshot = readAccessSnapshot();
      const currentAccessState = useAccessStore.getState() as Record<
        string,
        any
      >;
      const currentProfiles = Array.isArray(currentAccessState.apiProfiles)
        ? currentAccessState.apiProfiles
        : [];
      const shouldRestoreAccessSnapshot =
        currentProfiles.length <= 1 &&
        currentProfiles.every(
          (profile: Record<string, any>) =>
            String(profile?.id || "") === "default_aihubmix_profile",
        ) &&
        Array.isArray(accessSnapshot?.apiProfiles) &&
        (accessSnapshot?.apiProfiles?.length || 0) > 1;

      if (shouldRestoreAccessSnapshot) {
        useAccessStore.setState({
          ...currentAccessState,
          ...accessSnapshot,
          _hasHydrated: true,
        } as any);
        autoSyncConsole(
          "log",
          `[AutoSync] ♻️ 已从本地快照恢复 API 配置: ${
            accessSnapshot?.apiProfiles.length || 0
          } 个`,
        );
      }
      hasRestoredModelsFromHydratedCache = true;
      logPerfSummary("StartupSync", {
        localCriticalRestoreDurationMs: Number(
          (nowMs() - restoreStartedAt).toFixed(2),
        ),
      });
    };

    const waitForCriticalStoreHydration = async () => {
      if (!isPerfFeatureEnabled("PERF_ENABLE_LIGHT_STARTUP_SYNC")) {
        return {
          timedOut: false,
          pendingStores: [] as string[],
          durationMs: 0,
        };
      }

      const waitStartedAt = nowMs();
      if (areCriticalStoresHydrated()) {
        return {
          timedOut: false,
          pendingStores: [] as string[],
          durationMs: Number((nowMs() - waitStartedAt).toFixed(2)),
        };
      }

      return new Promise<{
        timedOut: boolean;
        pendingStores: string[];
        durationMs: number;
      }>((resolve) => {
        const finish = (timedOut: boolean) => {
          clearHydrationBarrier?.();
          clearHydrationBarrier = null;
          const hydrationState = getHydrationState();
          const pendingStores = Object.entries(hydrationState)
            .filter(
              ([name, hydrated]) =>
                !hydrated &&
                ["sync", "access", "config", "modelCache"].includes(name),
            )
            .map(([name]) => name);

          resolve({
            timedOut,
            pendingStores,
            durationMs: Number((nowMs() - waitStartedAt).toFixed(2)),
          });
        };

        const check = () => {
          restoreLocalCriticalState();
          if (areCriticalStoresHydrated()) {
            finish(false);
          }
        };

        const timeoutId = window.setTimeout(() => finish(true), 5000);
        const unsubscribers = [
          useSyncStore.subscribe(check),
          useAccessStore.subscribe(check),
          useAppConfig.subscribe(check),
          useModelCacheStore.subscribe(check),
        ];

        clearHydrationBarrier = () => {
          window.clearTimeout(timeoutId);
          unsubscribers.forEach((unsubscribe) => unsubscribe());
        };

        check();
      });
    };

    startAutoSync = () => {
      if (!shouldAutoStartRouteSync(activeRoutePath)) {
        return;
      }

      prepareRouteEntryForSync(activeRoutePath, {
        source: "auto-sync-start",
      });
      autoSyncDebug("[AutoSync] ⏰ 延迟时间到，检查同步配置");

      const syncStore = useSyncStore.getState();
      const modelCacheStore = useModelCacheStore.getState();

      autoSyncDebug("[AutoSync] 🔍 检查同步配置:", {
        provider: syncStore.provider,
        cloudSyncResult: syncStore.cloudSync(),
        databaseConfig: syncStore.database,
      });

      // 检查是否已配置同步
      if (!syncStore.provider) {
        autoSyncConsole("log", "[AutoSync] 🔕 没有设置 provider，跳过自动同步");
        return;
      }

      const canSync = syncStore.cloudSync();
      autoSyncDebug("[AutoSync] 🔍 cloudSync() 返回:", canSync);

      if (!canSync) {
        autoSyncConsole("log", "[AutoSync] 🔕 同步未配置，跳过自动同步");
        return;
      }

      // 只在非首页/聊天页直接打开时清空控制台。
      const currentPath =
        typeof window !== "undefined"
          ? window.location.hash.replace(/^#/, "").split("?")[0] ||
            window.location.pathname
          : "";
      const normalizedCurrentPath =
        normalizePath(currentPath) || normalizePath(activeRoutePath);
      const showStartupSummary = shouldShowStartupSummary(
        normalizedCurrentPath,
      );
      if (!showStartupSummary) {
        // 同步动作的后台日志一律静默。
        setSyncSummarySuppressed(true);
      } else {
        // 首页/聊天页：恢复允许打印汇总。
        setSyncSummarySuppressed(false);
      }

      const attemptAutoSync = () => {
        if (hasCompletedAutoSync || autoSyncInProgress) {
          return;
        }
        const syncPath = activeRoutePath;
        if (shouldCancelAutoSync(syncPath)) {
          return;
        }

        if (shouldSkipAutoSyncByRecentBootstrap()) {
          return;
        }
        markRouteSyncBootstrap("auto-sync");

        // 迁移模型缓存
        modelCacheStore.migrateFromAccessProfiles?.();

        if (!acquireLock()) {
          autoSyncConsole(
            "log",
            "[AutoSync] 🔒 其他标签页正在执行自动同步，当前标签页等待锁释放",
          );
          scheduleRetry(attemptAutoSync);
          return;
        }

        clearRetryTimer();
        autoSyncInProgress = true;
        const scope = getCurrentAutoSyncScope();
        syncAbortController?.abort();
        syncAbortController = new AbortController();
        const abortSignal = syncAbortController.signal;
        const criticalSyncStartedAt = nowMs();
        heartbeatTimer = setInterval(
          refreshLock,
          Math.max(1000, AUTO_SYNC_LOCK_TTL_MS / 3),
        );
        markRouteSyncStart(syncPath, "auto-sync");
        // 不再打印「===== 🚀 AutoSync 启动流程开始 =====」和
        // 「===== 🔄 同步检查 | xxx =====」section 标题，
        // 启动阶段没有信息量，污染同步汇总。ready / 错误仍由后续 log 输出。

        Promise.resolve()
          .then(
            () =>
              // 首页与聊天入口输出整体同步汇总；其他页面仍完成同步，
              // 但日志静默，不污染各自页面控制台。
              syncStore.autoSyncCritical?.({
                scope,
                abortSignal,
                silentSummary: !shouldShowStartupSummary(activeRoutePath),
              }) ||
              syncStore.autoSync?.({
                scope,
                abortSignal,
                silentSummary: !shouldShowStartupSummary(activeRoutePath),
              }),
          )
          .catch((error: unknown) => {
            if (isAbortError(error)) {
              return;
            }
            autoSyncConsole(
              "error",
              "[AutoSync] ⚠️ 关键同步失败（不阻止后台同步）:",
              error,
            );
          })
          .then(async () => {
            if (shouldCancelAutoSync(syncPath)) {
              autoSyncConsole("log", getAutoSyncCancelMessage("当前页面同步"));
              return;
            }
            // 不再自动同步全量模型，模型由用户手动添加后按需获取
            // void bootstrapProviderModels();
            hasCompletedAutoSync = true;
            const elapsedMs = nowMs() - criticalSyncStartedAt;
            logPerfSummary("StartupSync", {
              autoSyncCriticalDurationMs: Number(elapsedMs.toFixed(2)),
            });
            // 不再打印「===== ✅ 同步检查完成 | 用时 X 秒 =====」section 标题，
            // perf 摘要已经记录耗时。ready 行保留，作为给前端「页面已可直接对话 / 绘画」的可观察锚点。
            autoSyncConsole("log", getScopeReadyMessage(scope));

            let deferredSyncExecuted = false;
            const deferredSyncTask = () => {
              const deferredScope = getCurrentAutoSyncScope();
              const deferredKeys = getAutoSyncDeferredStoreKeys(deferredScope, {
                includeChat: true,
              });
              if (deferredSyncExecuted) return;
              if (shouldCancelAutoSync(syncPath)) {
                autoSyncConsole("log", getAutoSyncCancelMessage("后台同步"));
                return;
              }
              deferredSyncExecuted = true;
              if (deferredFallbackTimer) {
                clearTimeout(deferredFallbackTimer);
                deferredFallbackTimer = null;
              }

              void (async () => {
                if (shouldCancelAutoSync(syncPath)) {
                  return;
                }
                if (isChatLikeScope(deferredScope) || deferredScope === "app") {
                  publishStartupChatSyncStatus("syncing", channel);
                  try {
                    // 不再打印「[AutoSync] 🔄 后台检查本地与远端会话...」，
                    // 「后台同步」阶段启动没有信息量，最终结果由
                    // getScopeDeferredDoneMessage 在尾部输出。
                    await syncStore.syncChatOnStartup?.({
                      source: "auto-sync-deferred",
                      minIntervalMs: 60_000,
                      abortSignal,
                      silentSummary: !shouldShowStartupSummary(activeRoutePath),
                    });
                    if (shouldCancelAutoSync(syncPath)) {
                      return;
                    }
                    publishStartupChatSyncStatus("done", channel);
                  } catch (uploadError) {
                    publishStartupChatSyncStatus("error", channel);
                    autoSyncConsole(
                      "error",
                      "[AutoSync] ⚠️ 本地会话上传失败:",
                      uploadError,
                    );
                  }
                }

                try {
                  if (shouldCancelAutoSync(syncPath)) {
                    return;
                  }
                  const allowedPendingKeys = Array.from(
                    new Set([
                      ...getAutoSyncCriticalStoreKeys(deferredScope),
                      ...getAutoSyncDeferredStoreKeys(deferredScope, {
                        includeChat: true,
                      }),
                    ]),
                  );
                  const resumed = await syncStore.resumePendingDebounceSync?.({
                    ...(deferredScope === "draw"
                      ? { includeKeys: allowedPendingKeys }
                      : { includeKeys: allowedPendingKeys }),
                    silentSummary: !shouldShowStartupSummary(activeRoutePath),
                  });
                  if (resumed) {
                    autoSyncConsole(
                      "log",
                      "[AutoSync] ♻️ 已补跑未完成的本地同步任务",
                    );
                  }
                } catch (error) {
                  if (isAbortError(error)) {
                    autoSyncConsole(
                      "log",
                      getAutoSyncCancelMessage("后台同步"),
                    );
                    return;
                  }
                  autoSyncConsole(
                    "error",
                    "[AutoSync] ❌ 补跑未完成同步失败:",
                    error,
                  );
                }

                if (shouldCancelAutoSync(syncPath)) {
                  return;
                }
                if (deferredKeys.length === 0) {
                  if (deferredScope === "draw") {
                    autoSyncConsole(
                      "log",
                      "[AutoSync] ✅ 当前页面(draw)已完成绘图关键同步，后台无额外同步任务",
                    );
                  }
                  autoSyncConsole(
                    "log",
                    `[AutoSync] ℹ️ 当前页面(${deferredScope})无额外后台同步任务`,
                  );
                  return;
                }
                // 不再打印「===== 💾 对话与设置后台同步 =====」/「===== 💾 后台同步完成 =====」
                // section 标题，ready 由 getScopeDeferredDoneMessage 单行输出。
                try {
                  await (syncStore.autoSyncDeferred?.({
                    includeChat: false,
                    scope: deferredScope,
                    abortSignal,
                    silentSummary: !shouldShowStartupSummary(activeRoutePath),
                  }) ?? Promise.resolve());
                  if (shouldCancelAutoSync(syncPath)) {
                    return;
                  }
                  autoSyncConsole(
                    "log",
                    getScopeDeferredDoneMessage(deferredScope),
                  );
                } catch (error) {
                  if (isAbortError(error)) {
                    autoSyncConsole(
                      "log",
                      getAutoSyncCancelMessage("后台同步"),
                    );
                    return;
                  }
                  autoSyncConsole(
                    "error",
                    "[AutoSync] ❌ 后台同步失败（含对话记录）:",
                    error,
                  );
                }
              })();

              if (shouldCancelAutoSync(syncPath)) {
                return;
              }
              const ensureRemoteBootstrapStartedAt = nowMs();
              void ensureRemoteBootstrapState(deferredScope, {
                abortSignal,
                silentSummary: !shouldShowStartupSummary(activeRoutePath),
              })
                .then(() => {
                  logPerfSummary("StartupSync", {
                    ensureRemoteBootstrapStateDurationMs: Number(
                      (nowMs() - ensureRemoteBootstrapStartedAt).toFixed(2),
                    ),
                  });
                })
                .catch((error: unknown) => {
                  if (isAbortError(error)) {
                    return;
                  }
                  autoSyncConsole(
                    "error",
                    "[AutoSync] ❌ 远端初始化补齐失败:",
                    error,
                  );
                });
            };

            const deferredVisibleDelayMs = 15000;
            const deferredHiddenDelayMs = 2500;
            const deferredFallbackDelayMs = document.hidden ? 5000 : 20000;
            cancelDeferredSyncTask = scheduleDeferredSyncTask(
              deferredSyncTask,
              {
                visibleDelayMs: deferredVisibleDelayMs,
                hiddenDelayMs: deferredHiddenDelayMs,
              },
            );
            deferredFallbackTimer = setTimeout(
              deferredSyncTask,
              deferredFallbackDelayMs,
            );
          })
          .catch((error: unknown) => {
            autoSyncConsole("error", "[AutoSync] ❌ 同步失败:", error);
          })
          .finally(() => {
            autoSyncInProgress = false;
            if (
              autoSyncCancelledByManualSync ||
              autoSyncCancelledByRouteChange
            ) {
              hasCompletedAutoSync = true;
              clearRetryTimer();
              if (deferredFallbackTimer) {
                clearTimeout(deferredFallbackTimer);
                deferredFallbackTimer = null;
              }
            }
            releaseLock();
          });
      };

      channel?.addEventListener("message", (event: MessageEvent) => {
        if (
          event.data?.type === CHAT_SYNC_UPDATED_MESSAGE_TYPE &&
          event.data?.owner &&
          event.data.owner !== tabId
        ) {
          triggerExternalChatSync("broadcast");
          return;
        }

        if (
          event.data?.type === CONFIG_SYNC_UPDATED_MESSAGE_TYPE &&
          event.data?.owner &&
          event.data.owner !== tabId
        ) {
          if (!shouldCancelAutoSync(activeRoutePath)) {
            const syncStore = useSyncStore.getState() as any;
            syncStore
              .sync?.([StoreKey.Config], {
                force: true,
                silentSummary: !shouldShowStartupSummary(activeRoutePath),
              })
              .catch(() => {});
          }
          return;
        }

        if (
          event.data?.type === "auto-sync-finished" &&
          !hasCompletedAutoSync &&
          !autoSyncInProgress &&
          !autoSyncCancelledByManualSync &&
          !autoSyncCancelledByRouteChange
        ) {
          attemptAutoSync();
        }
      });

      attemptAutoSync();
    };

    void waitForCriticalStoreHydration().then((result) => {
      if (!autoSyncEffectActive) {
        return;
      }

      restoreLocalCriticalState();
      logPerfSummary("StartupSync", {
        hydrationWaitDurationMs: result.durationMs,
        firstInteractiveAt: Number((nowMs() - startedAt).toFixed(2)),
        pendingHydrationStores: result.pendingStores,
        hydrationTimedOut: result.timedOut,
      });

      if (result.timedOut && result.pendingStores.length > 0) {
        autoSyncConsole(
          "log",
          `[AutoSync] ℹ️ 关键 store hydration 等待超时，继续执行首开同步；未完成: ${result.pendingStores.join(
            ", ",
          )}`,
        );
      }

      timer = setTimeout(
        startAutoSync,
        isPerfFeatureEnabled("PERF_ENABLE_LIGHT_STARTUP_SYNC") ? 0 : 80,
      );
    });

    const handleRouteChangeRestart = (event?: Event) => {
      const shouldStartNextSync =
        event instanceof CustomEvent &&
        typeof event.detail?.autoStart === "boolean"
          ? event.detail.autoStart
          : shouldAutoStartRouteSync(getCurrentHashPath());
      const nextPath = normalizePath(
        event instanceof CustomEvent && typeof event.detail?.path === "string"
          ? event.detail.path
          : getCurrentHashPath(),
      );
      if (nextPath === normalizePath(activeRoutePath)) {
        return;
      }

      const previousPath = activeRoutePath;
      // 通用页面切换处理：取消上一页未消费的排队自动同步。
      // 进入首页/聊天入口时必须保留控制台，只有其他页面才清空旧汇总。
      // 进行中的同步（已发出的请求）不在此处中止，仍由各 store 自身的 abortSignal
      // 处理；这里只处理排队中、未真正开始的任务。
      try {
        useSyncStore.getState().cancelQueuedAutoSync();
      } catch {
        // 路由切换快路径下 useSyncStore 可能尚未 hydrate，吞掉错误不影响后续步骤。
      }
      // 移除控制台清除操作，避免清空其他页面已打印的正常日志

      activeRoutePath = nextPath;
      // 路由切换后立即翻转 suppress：离开主页一律静默，
      // 进入主页时恢复。这样可以截断「在主页发起的同步 → 路由切走 → 同步完成仍打印汇总」的尾巴。
      setSyncSummarySuppressed(!shouldShowStartupSummary(nextPath));
      // 降级为 debug：每跳一次页面都打一遍会污染汇总；想观察路径切换时打开 console 的 Verbose 即可。
      autoSyncConsole(
        "debug",
        "[AutoSync] 🔄 页面切换，已在新路径重新调度自动同步",
        {
          from: previousPath,
          to: nextPath,
        },
      );

      if (!shouldStartNextSync) {
        hasCompletedAutoSync = true;
        return;
      }

      timer = setTimeout(
        startAutoSync,
        isPerfFeatureEnabled("PERF_ENABLE_LIGHT_STARTUP_SYNC") ? 0 : 80,
      );
    };

    const triggerForegroundChatSync = () => {
      if (!isChatLikeScope(getCurrentAutoSyncScope())) {
        return;
      }
      // 手机浏览器或 PWA 从主屏幕回到前台时，正在进行的模型请求
      // 继续由原控制器持有；此时不启动聊天合并，避免覆盖流式本地状态。
      if (ChatControllerPool.hasPending()) {
        return;
      }
      if (
        !authInitialized ||
        !authUser ||
        document.hidden ||
        autoSyncInProgress ||
        !hasCompletedAutoSync ||
        autoSyncCancelledByManualSync ||
        autoSyncCancelledByRouteChange
      ) {
        return;
      }

      const now = Date.now();
      if (now - lastForegroundSyncAt < 3000) {
        return;
      }
      lastForegroundSyncAt = now;

      const syncStore = useSyncStore.getState();
      void Promise.resolve()
        .then(() => {
          if (isManualDatabaseSyncActive()) {
            return undefined;
          }
          return syncStore.resumePendingDebounceSync?.({
            excludeKeys: [StoreKey.Config],
            silentSummary: !shouldShowStartupSummary(activeRoutePath),
          });
        })
        .then(() =>
          (syncStore as any).syncChatIfRemoteChanged?.({
            source: "foreground",
            minIntervalMs: 0,
            silentSummary: !shouldShowStartupSummary(activeRoutePath),
          }),
        )
        .catch((error: unknown) => {
          autoSyncConsole(
            "error",
            "[AutoSync] ❌ 前台快速聊天同步失败:",
            error,
          );
        });
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        triggerForegroundChatSync();
      }
    };

    const handleWindowFocus = () => {
      triggerForegroundChatSync();
    };

    const handlePageHide = () => {
      if (!isChatLikeScope(getCurrentAutoSyncScope())) {
        return;
      }
      const syncStore = useSyncStore.getState() as any;
      syncStore.flushPendingDebounceSync?.([StoreKey.Chat]);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== CHAT_SYNC_HINT_KEY) {
        if (event.key === CONFIG_SYNC_HINT_KEY && event.newValue) {
          const hint = parseConfigSyncHint(event.newValue);
          if (
            hint &&
            hint.owner !== tabId &&
            !shouldCancelAutoSync(activeRoutePath)
          ) {
            const syncStore = useSyncStore.getState() as any;
            syncStore
              .sync?.([StoreKey.Config], {
                force: true,
                silentSummary: !shouldShowStartupSummary(activeRoutePath),
              })
              .catch(() => {});
          }
        }
        return;
      }

      const hint = parseChatSyncHint(event.newValue);
      if (!hint || hint.owner === tabId) {
        return;
      }

      triggerExternalChatSync("storage");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("popstate", handleRouteChangeRestart);
    window.addEventListener(ROUTE_SYNC_ENTRY_EVENT, handleRouteChangeRestart);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("storage", handleStorage);

    chatMetaPollTimer = setInterval(() => {
      if (!isChatLikeScope(getCurrentAutoSyncScope())) {
        return;
      }
      if (autoSyncInProgress || !hasCompletedAutoSync) {
        return;
      }
      const now = Date.now();
      if (now - startedAt < 15000 || now - lastExternalChatHintAt < 15000) {
        return;
      }

      scheduleChatMetaPollSync();
    }, 15000);

    return () => {
      autoSyncEffectActive = false;
      if (timer) {
        clearTimeout(timer);
      }
      if (deferredFallbackTimer) {
        clearTimeout(deferredFallbackTimer);
      }
      if (cancelDeferredSyncTask) {
        cancelDeferredSyncTask();
        cancelDeferredSyncTask = null;
      }
      if (chatMetaPollTimer) {
        clearInterval(chatMetaPollTimer);
      }
      if (
        chatMetaPollIdleCallbackId !== null &&
        "cancelIdleCallback" in window
      ) {
        window.cancelIdleCallback(chatMetaPollIdleCallbackId);
        chatMetaPollIdleCallbackId = null;
      }
      syncAbortController?.abort();
      syncAbortController = null;
      clearHydrationBarrier?.();
      clearHydrationBarrier = null;
      clearRetryTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("popstate", handleRouteChangeRestart);
      window.removeEventListener(
        ROUTE_SYNC_ENTRY_EVENT,
        handleRouteChangeRestart,
      );
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("storage", handleStorage);
      releaseLock();
      channel?.close();
    };
    // 仅在客户端初始化后执行一次自动同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authInitialized, authUser]);

  return null;
}
