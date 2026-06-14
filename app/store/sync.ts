import { getClientConfig } from "../config/client";
import { ServiceProvider, StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";
import {
  AppState,
  GetStoreState,
  getLocalAppState,
  getNonFunctionFileds,
  mergeAppState,
  mergeStoreState,
  setLocalAppState,
  setLocalStoreState,
  stripConfigLocalModelFields,
} from "../utils/sync";
import { downloadAs, readFromFile } from "../utils";
import {
  AUTO_SYNC_STORE_KEYS,
  MODEL_SYNC_STORE_KEYS,
  parseStoreStatePayload,
  type SyncStoreKey,
  stringifyPersistedStoreState,
  SYNC_STORE_KEYS,
} from "../utils/sync-store-keys";
import {
  buildChatIndexPayload,
  buildChatStateFromIndex,
  createChatIndexEntryMap,
  getSyncableChatSessions,
  shouldSyncChatSession,
  type ChatIndexSessionEntry,
} from "../utils/chat-sync";
import { INITIAL_HYDRATED_RECENT_SESSION_LIMIT } from "../utils/chat-persist-storage";
import {
  getChatGlobalClearAtFromState,
  getDeletedSessionTimestampsFromState,
  isEffectivelyEmptyRemoteChatState,
} from "../utils/chat-sync-state";
import { getSessionMessages } from "../utils/chat-session-merge";
import { getPersistedChatSession } from "../utils/chat-persist-storage";
import { showToast } from "../components/ui-lib";
import Locale from "../locales";
import { ChatControllerPool } from "../client/controller";
import { createSyncClient, ProviderType } from "../utils/cloud";
import { useAppConfig } from "./config";
import { normalizeAccessStateDerivedFields, useAccessStore } from "./access";
import { useAuthStore } from "./auth";
import type { StoreSnapshotMeta } from "../utils/cloud/database";
import {
  buildSessionSummaries,
  buildSessionSummary,
  CHAT_DELETE_UI_GUARD_UNTIL_KEY,
  ChatSessionSummary,
  createEmptySession,
  useChatStore,
} from "./chat";
import { logger } from "../utils/logger";
import { rebuildManagedModelsFromCache } from "../utils/managed-model-rebuild";
import { isPerfFeatureEnabled, logPerfSummary, nowMs } from "../utils/perf";
import {
  AUTO_SYNC_CHANNEL_NAME,
  CHAT_SYNC_HINT_KEY,
  CHAT_SYNC_UPDATED_MESSAGE_TYPE,
  buildChatSyncHint,
  getOrCreateAutoSyncTabId,
} from "../utils/sync-tab-coordination";
import {
  isManualDatabaseSyncActive,
  getManualDatabaseSyncGeneration,
} from "../utils/manual-sync-guard";
import {
  normalizeMultiKeyGroups,
  shouldAutoEnableMultiKey,
} from "../utils/multi-key";

import {
  buildCustomModelSyncDiffBetween,
  buildCustomModelSyncDiffFromLastSnapshot,
  consumeRecentModelSyncDiff,
  saveCustomModelSyncSnapshot,
  type ModelSyncPlatformDiff,
} from "../utils/model-sync-diff";

type DatabaseCacheMeta = Record<
  string,
  {
    updatedAt: string;
    checksum: string;
    sizeBytes: number;
    validatedAt: number;
  }
>;

type SyncBackupState = Pick<
  SyncStore,
  "provider" | "database" | "lastSyncTime" | "lastProvider"
>;

type PlaceholderChatSession = Record<string, unknown> & {
  _syncPlaceholder?: boolean;
  id?: string;
  topic?: string;
  createdAt?: number;
  lastUpdate?: number;
  messages?: unknown[];
};

type BackupState = AppState & {
  [StoreKey.Sync]?: SyncBackupState;
};

const isApp = !!getClientConfig()?.isApp;
export type SyncStore = GetStoreState<typeof useSyncStore>;
const LOG_SEPARATOR = "=".repeat(5);
let syncInFlight: Promise<void> | null = null;
let queuedSyncKeys = new Set<SyncStoreKey>();
let syncInFlightManual = false;
let lastKnownChatSessionSnapshot = new Map<string, string>();
let lastKnownCustomModelsSnapshot = "";
const RETRYABLE_DB_SYNC_ERROR = /\[DB Sync\] (404|408|5\d{2})\b/;
// 网络级错误（连接关闭、超时、DNS 失败等），这些也应该触发重试
const RETRYABLE_NETWORK_ERROR =
  /Failed to fetch|NetworkError|ERR_CONNECTION|net::ERR_|Load failed|abort|timeout/i;
let lastMissingApiKeyWarningKey = "";
let lastRemoteChatMetaCheckAt = 0;
const syncConsoleDedupMap = new Map<string, number>();

function formatSyncLogTimestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

function isChatDeleteUiGuardActive() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const guardUntil = Number(
      window.sessionStorage.getItem(CHAT_DELETE_UI_GUARD_UNTIL_KEY) || 0,
    );
    return Number.isFinite(guardUntil) && guardUntil > Date.now();
  } catch {
    return false;
  }
}

function syncConsole(
  level: "log" | "info" | "warn" | "error",
  message: string,
  payload?: unknown,
) {
  const dedupKey = `${level}|${message}|${
    payload === undefined ? "" : JSON.stringify(payload)
  }`;
  const now = Date.now();
  const lastDedupAt = syncConsoleDedupMap.get(dedupKey) || 0;
  if (level !== "warn" && level !== "error" && now - lastDedupAt < 1500) {
    return;
  }
  syncConsoleDedupMap.set(dedupKey, now);

  const prefixedMessage = `${formatSyncLogTimestamp()} ${message}`;
  if (payload === undefined) {
    console[level](prefixedMessage);
    return;
  }
  console[level](prefixedMessage, payload);
}

function logSyncSectionTitle(title: string) {
  syncConsole("log", `===== 💾 ${title} =====`);
}

function shouldStopAutoSyncForManualSync(
  options: { manual?: boolean } | undefined,
  startedManualGeneration: number,
) {
  return (
    !options?.manual &&
    isManualDatabaseSyncActive() &&
    getManualDatabaseSyncGeneration() !== startedManualGeneration
  );
}

function emitChatSyncHint() {
  if (typeof window === "undefined") {
    return;
  }

  const tabId = getOrCreateAutoSyncTabId(window.sessionStorage);
  const hint = buildChatSyncHint(tabId);

  try {
    window.localStorage.setItem(CHAT_SYNC_HINT_KEY, JSON.stringify(hint));
  } catch (error) {
    logSyncDebug("[Sync] ⚠️ 写入聊天同步 hint 失败", error);
  }

  if (typeof BroadcastChannel === "undefined") {
    return;
  }

  try {
    const channel = new BroadcastChannel(AUTO_SYNC_CHANNEL_NAME);
    channel.postMessage({
      type: CHAT_SYNC_UPDATED_MESSAGE_TYPE,
      ...hint,
    });
    channel.close();
  } catch (error) {
    logSyncDebug("[Sync] ⚠️ 广播聊天同步 hint 失败", error);
  }
}

export async function waitForSyncIdle() {
  while (syncInFlight || queuedSyncKeys.size > 0) {
    const currentSync = syncInFlight;
    if (currentSync) {
      try {
        await currentSync;
      } catch {
        // 仅等待同步过程结束，不在这里向上抛错。
      }
      continue;
    }

    await Promise.resolve();
  }
}

export async function waitForSyncIdleSafely(options?: { timeoutMs?: number }) {
  const timeoutMs = Math.max(0, options?.timeoutMs ?? 8000);
  const startedAt = Date.now();

  while (syncInFlight || queuedSyncKeys.size > 0) {
    if (Date.now() - startedAt >= timeoutMs) {
      return false;
    }

    const currentSync = syncInFlight;
    if (currentSync) {
      try {
        await Promise.race([
          currentSync,
          new Promise<void>((resolve) => setTimeout(resolve, 120)),
        ]);
      } catch {
        // 仅等待同步过程结束，不在这里向上抛错。
      }
      continue;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 120));
  }

  return true;
}

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
  syncConsole("log", message, payload);
}

function warnSyncDebug(message: string, payload?: unknown) {
  if (!isSyncDebugLoggingEnabled()) {
    return;
  }
  syncConsole("warn", message, payload);
}

function getLocalStoreLastUpdateTime(state: unknown) {
  if (!isObjectLike(state)) {
    return 0;
  }

  const nextValue = Number(state.lastUpdateTime);
  return Number.isFinite(nextValue) ? nextValue : 0;
}

function shouldSkipSyncByChecksum(params: {
  key: SyncStoreKey;
  localStoreState: unknown;
  remoteMetaMap: Map<SyncStoreKey, StoreSnapshotMeta>;
  databaseCacheMeta: DatabaseCacheMeta;
  lastSyncTime: number;
}) {
  if (!isPerfFeatureEnabled("PERF_ENABLE_SYNC_CHECKSUM_SKIP")) {
    return false;
  }

  // Chat 首开/新标签页经常只有本地空白占位会话，不能仅凭 checksum
  // 直接跳过，否则远端历史会话不会被重新拉回到当前页内存。
  if (params.key === StoreKey.Chat) {
    return false;
  }

  const remoteMeta = params.remoteMetaMap.get(params.key);
  const cachedMeta = params.databaseCacheMeta[params.key];
  if (!remoteMeta || !cachedMeta) {
    return false;
  }

  const localLastUpdateTime = getLocalStoreLastUpdateTime(
    params.localStoreState,
  );
  if (localLastUpdateTime > params.lastSyncTime) {
    return false;
  }

  return (
    remoteMeta.updatedAt === cachedMeta.updatedAt &&
    remoteMeta.checksum === cachedMeta.checksum
  );
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildSyncBackupState(syncState: SyncStore): SyncBackupState {
  const state = getNonFunctionFileds(syncState) as SyncStore;

  return {
    provider: state.provider,
    database: state.database,
    lastSyncTime: state.lastSyncTime,
    lastProvider: state.lastProvider,
  };
}

function parseSyncBackupState(
  value: unknown,
  currentState: SyncStore,
): Partial<SyncBackupState> | null {
  if (!isObjectLike(value)) {
    return null;
  }

  const nextState: Partial<SyncBackupState> = {};

  if (
    typeof value.provider === "string" &&
    Object.values(ProviderType).includes(value.provider as ProviderType)
  ) {
    nextState.provider = value.provider as ProviderType;
  }

  if (isObjectLike(value.database)) {
    nextState.database = {
      ...currentState.database,
      ...value.database,
      cacheMeta: isObjectLike(value.database.cacheMeta)
        ? (value.database.cacheMeta as DatabaseCacheMeta)
        : currentState.database.cacheMeta,
      lastMetaSyncTime:
        typeof value.database.lastMetaSyncTime === "number"
          ? value.database.lastMetaSyncTime
          : currentState.database.lastMetaSyncTime,
    };
  }

  if (typeof value.lastSyncTime === "number") {
    nextState.lastSyncTime = value.lastSyncTime;
  }

  if (typeof value.lastProvider === "string") {
    nextState.lastProvider = value.lastProvider;
  }

  return nextState;
}

export function buildBackupState(
  appState: AppState,
  syncState: SyncStore,
): BackupState {
  return {
    ...appState,
    [StoreKey.Sync]: buildSyncBackupState(syncState),
  };
}

// 防抖同步相关
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let debounceTaskKeys: SyncStoreKey[] = [];
const DEFAULT_DEBOUNCE_DELAY = 1000;
const SYNC_DEBOUNCE_KEY = "nextchat_sync_debounce";
const CHAT_SYNC_COOLDOWN_MS = 500;
let lastChatSyncCompletedAt = 0;

type PendingDebounceSyncTask = {
  keys: SyncStoreKey[];
  scheduledAt: number;
};

const STORE_DISPLAY_NAMES: Record<SyncStoreKey, string> = {
  [StoreKey.Chat]: "会话",
  [StoreKey.Plugin]: "插件",
  [StoreKey.Access]: "API配置",
  [StoreKey.Config]: "模型与设置",
  [StoreKey.Prompt]: "提示词",
  [StoreKey.Update]: "应用更新状态",
  [StoreKey.DrawList]: "绘图记录",
};

function countCustomModelEntries(customModels?: string) {
  return String(customModels || "")
    .split(",")
    .map((model) => model.trim())
    .filter((model) => model.startsWith("+")).length;
}

function getStoreSummary(key: SyncStoreKey, state: any) {
  switch (key) {
    case StoreKey.Chat:
      return getChatStoreSummary(state);
    case StoreKey.Plugin:
      return `${Object.keys(state?.plugins ?? {}).length} 个插件`;
    case StoreKey.Access:
      return `${
        Array.isArray(state?.apiProfiles) ? state.apiProfiles.length : 0
      } 个API配置`;
    case StoreKey.Config:
      return `${countCustomModelEntries(state?.customModels)} 个模型`;
    case StoreKey.Prompt:
      return `${Object.keys(state?.prompts ?? {}).length} 个提示词`;
    case StoreKey.Update:
      return `${state?.lastUpdateTime ? 1 : 0} 条应用更新状态`;
    case StoreKey.DrawList:
      return `${Array.isArray(state?.draw) ? state.draw.length : 0} 条绘图记录`;
    default:
      return "0 项";
  }
}

function countNonEmptyString(value: unknown) {
  return String(value || "").trim() ? 1 : 0;
}

function countNonEmptyGroupKeys(groups: unknown) {
  if (!groups || typeof groups !== "object" || Array.isArray(groups)) {
    return 0;
  }

  return Object.values(groups as Record<string, unknown>).filter((value) =>
    String(value || "").trim(),
  ).length;
}

function logAccessProfileSyncSummary(state: any) {
  const profiles = Array.isArray(state?.apiProfiles) ? state.apiProfiles : [];

  console.log(`[Sync] ✅ 已同步API配置: ${profiles.length} 个`);

  profiles.forEach((profile: any) => {
    const normalizedGroups = normalizeMultiKeyGroups(
      profile?.apiKeyGroups,
      profile,
    );
    const hasGroupKeys = countNonEmptyGroupKeys(normalizedGroups) > 0;
    const multiKeyEnabled = shouldAutoEnableMultiKey({
      ...profile,
      apiKeyGroups: normalizedGroups,
      multiKeyEnabled: hasGroupKeys ? true : profile?.multiKeyEnabled,
    });
    const normalKeyCount = countNonEmptyString(profile?.apiKey);
    const groupKeyCount = multiKeyEnabled
      ? countNonEmptyGroupKeys(normalizedGroups)
      : 0;
    const requestKeyCount = multiKeyEnabled
      ? groupKeyCount + normalKeyCount
      : normalKeyCount;
    const profileName = String(profile?.name || profile?.id || "未命名配置");

    console.log(
      `[Sync]   ${profileName}: ${requestKeyCount}个key${
        multiKeyEnabled ? "（多key）" : ""
      }`,
    );
  });
}

function getChatStoreSummary(state: any) {
  const totalCount = Array.isArray(state?.sessions) ? state.sessions.length : 0;
  const syncableCount = buildChatIndexPayload(state || {}).sessions.length;

  if (totalCount === syncableCount) {
    return `${totalCount} 个会话`;
  }

  return `${totalCount} 个会话（可同步 ${syncableCount} 个）`;
}

function isSyncStoreKey(key: unknown): key is SyncStoreKey {
  return SYNC_STORE_KEYS.includes(key as SyncStoreKey);
}

function normalizeSyncKeys(keys?: SyncStoreKey[]) {
  const normalized = (keys || [...SYNC_STORE_KEYS]).filter(isSyncStoreKey);
  return normalized.length > 0 ? normalized : [...SYNC_STORE_KEYS];
}

function readPendingDebounceTask(): PendingDebounceSyncTask | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(SYNC_DEBOUNCE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PendingDebounceSyncTask>;
    if (
      !Array.isArray(parsed.keys) ||
      typeof parsed.scheduledAt !== "number" ||
      !Number.isFinite(parsed.scheduledAt)
    ) {
      localStorage.removeItem(SYNC_DEBOUNCE_KEY);
      return null;
    }

    return {
      keys: normalizeSyncKeys(parsed.keys as SyncStoreKey[]),
      scheduledAt: parsed.scheduledAt,
    };
  } catch {
    localStorage.removeItem(SYNC_DEBOUNCE_KEY);
    return null;
  }
}

function writePendingDebounceTask(task: PendingDebounceSyncTask) {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(SYNC_DEBOUNCE_KEY, JSON.stringify(task));
}

function clearPendingDebounceTask() {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.removeItem(SYNC_DEBOUNCE_KEY);
}

function mergePendingSyncKeys(keys: SyncStoreKey[]) {
  return normalizeSyncKeys([...(debounceTaskKeys || []), ...keys]);
}

function formatSyncResultMessage(params: {
  summary: string;
  status: "downloaded" | "uploaded" | "merged" | "skipped";
  remoteSummary?: string;
}) {
  if (params.status === "skipped") {
    return params.summary;
  }

  if (params.remoteSummary) {
    return `${params.summary}，远端 ${params.remoteSummary}`;
  }

  return params.summary;
}

function parseSyncCount(key: SyncStoreKey, summary?: string) {
  const text = String(summary || "");

  if (key === StoreKey.Chat) {
    const matched = text.match(/(\d+) 个会话(?:（可同步 (\d+) 个）)?/);
    const total = Number(matched?.[1] || 0);
    return {
      total,
      synced: Number(matched?.[2] || matched?.[1] || 0),
    };
  }

  const matched = text.match(/(\d+)/);
  const total = Number(matched?.[1] || 0);
  return { total, synced: total };
}

function formatModelNameList(names: string[]) {
  return names.length > 0 ? names.join("、") : "无";
}

function getSyncProfileProviderId(profile: {
  provider?: ServiceProvider;
  name?: string;
}) {
  if (profile.provider === ServiceProvider.Custom) {
    return `custom_${profile.name || ""}`.toLowerCase();
  }
  if (profile.provider === ServiceProvider.Local) {
    return `${String(profile.provider).toLowerCase()}_${
      profile.name || ""
    }`.toLowerCase();
  }
  return String(profile.provider || "").toLowerCase();
}

function getModelSyncProviderNameMap() {
  const profiles = (useAccessStore.getState().apiProfiles || []) as Array<{
    provider?: ServiceProvider;
    name?: string;
  }>;
  return new Map(
    profiles.map((profile) => [
      getSyncProfileProviderId(profile),
      String(profile.name || profile.provider || ""),
    ]),
  );
}

function resolveModelSyncProviderName(providerId: string) {
  return getModelSyncProviderNameMap().get(String(providerId).toLowerCase());
}

function captureCustomModelSyncDiff(state: any, fallbackPreviousState?: any) {
  const snapshotDiff = buildCustomModelSyncDiffFromLastSnapshot(
    String(state?.customModels || ""),
    resolveModelSyncProviderName,
  );
  if (snapshotDiff.length > 0 || !fallbackPreviousState) {
    return snapshotDiff;
  }

  return buildCustomModelSyncDiffBetween(
    String(fallbackPreviousState?.customModels || ""),
    String(state?.customModels || ""),
    resolveModelSyncProviderName,
  );
}

function saveCustomModelSnapshotAfterSync(state: any) {
  saveCustomModelSyncSnapshot(
    String(state?.customModels || ""),
    resolveModelSyncProviderName,
  );
}

function syncModelSelectionToLocalStorage(state: any) {
  const modelConfig = state?.modelConfig;
  if (!modelConfig) return;
  const model = String(modelConfig.model || "").trim();
  const providerName = String(modelConfig.providerName || "").trim();
  if (!model || !providerName) return;
  const providerId = String(
    modelConfig.providerId || providerName.toLowerCase(),
  ).trim();
  const matchedProfile = (useAccessStore.getState().apiProfiles || []).find(
    (profile) => getSyncProfileProviderId(profile as any) === providerId,
  );
  const providerDisplayName =
    matchedProfile?.name || matchedProfile?.provider || providerName;
  const prevSelection = localStorage.getItem("nextchat:last-model-selection");
  const prevProvider = localStorage.getItem("nextchat:model-selector-provider");
  const nextSelection = `${model}@${providerId}`;
  const selectionChanged =
    prevSelection !== nextSelection || prevProvider !== providerDisplayName;
  if (selectionChanged) {
    console.log(
      `[Sync] 🔄 模型选择本地缓存已同步：模型 ${
        prevSelection || "空"
      } → ${nextSelection}；供应商 ${
        prevProvider || "空"
      } → ${providerDisplayName}`,
    );
  }
  try {
    localStorage.setItem("nextchat:last-model-selection", nextSelection);
    localStorage.setItem(
      "nextchat:model-selector-provider",
      providerDisplayName,
    );
  } catch (_) {}
}

function applySyncedModelSelectionToAccess(state: any) {
  const providerId = String(state?.modelConfig?.providerId || "")
    .trim()
    .toLowerCase();
  if (!providerId) return;

  const accessState = useAccessStore.getState() as any;
  const matchedProfile = (accessState.apiProfiles || []).find(
    (profile: any) => getSyncProfileProviderId(profile) === providerId,
  );
  if (!matchedProfile) return;

  const nextAccessState = normalizeAccessStateDerivedFields({
    ...accessState,
    useCustomConfig: true,
    provider: matchedProfile.provider || accessState.provider,
    profileSelectionUpdatedAt: Math.max(
      Number(accessState.profileSelectionUpdatedAt) || 0,
      Number(state?.modelSelectionUpdatedAt) || Date.now(),
    ),
    apiProfiles: (accessState.apiProfiles || []).map((profile: any) => ({
      ...profile,
      enabled: profile.id === matchedProfile.id,
    })),
  });

  useAccessStore.setState(nextAccessState as any);
}

function logOverallSyncSummary(
  results: Array<{
    key: SyncStoreKey;
    name: string;
    summary: string;
    status: "downloaded" | "uploaded" | "merged" | "skipped";
    remoteSummary?: string;
    modelDiffs?: ModelSyncPlatformDiff[];
  }>,
) {
  const summaryKeys = [StoreKey.Access, StoreKey.Config, StoreKey.Chat];
  const preferredResults = summaryKeys
    .map((key) => results.find((item) => item.key === key))
    .filter(Boolean) as typeof results;
  const summaryResults =
    preferredResults.length > 0 ? preferredResults : results;

  if (summaryResults.length === 0) {
    return;
  }

  summaryResults.forEach((item) => {
    const local = parseSyncCount(item.key, item.summary);
    const remote = parseSyncCount(item.key, item.remoteSummary ?? item.summary);
    if (item.key === StoreKey.Config) {
      const currentCustomModels =
        (useAppConfig.getState() as any).customModels || "";
      const afterEntries = currentCustomModels
        .split(",")
        .map((m: string) => m.trim())
        .filter((m: string) => m.startsWith("+"))
        .map((m: string) => m.slice(1));
      const afterCount = afterEntries.length;

      // 按供应商统计
      const providerCounts = new Map<string, number>();
      afterEntries.forEach((m: string) => {
        const atIdx = m.lastIndexOf("@");
        const prov =
          atIdx > 0
            ? m.substring(atIdx + 1).replace(/^custom_/, "")
            : "unknown";
        providerCounts.set(prov, (providerCounts.get(prov) || 0) + 1);
      });

      if (lastKnownCustomModelsSnapshot === "") {
        lastKnownCustomModelsSnapshot = currentCustomModels;
        console.log(`[Sync] ✅ 已同步模型: ${afterCount} 个`);
        if (afterCount > 0) {
          Array.from(providerCounts.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .forEach(([p, c]) => {
              console.log(`[Sync]   ${p}: ${c}个`);
            });
        }
        return;
      }

      const beforeEntries = lastKnownCustomModelsSnapshot
        .split(",")
        .map((m: string) => m.trim())
        .filter((m: string) => m.startsWith("+"))
        .map((m: string) => m.slice(1));
      const beforeSet = new Set<string>(beforeEntries);
      const afterSet = new Set<string>(afterEntries);
      const added = afterEntries.filter((n: string) => !beforeSet.has(n));
      const deleted = beforeEntries.filter((n: string) => !afterSet.has(n));

      // 输出新增的模型
      added.forEach((m: string) => {
        const atIdx = m.lastIndexOf("@");
        const name = atIdx > 0 ? m.substring(0, atIdx) : m;
        const provider =
          atIdx > 0 ? m.substring(atIdx + 1).replace(/^custom_/, "") : "";
        console.log(`[Sync] ➕ ${name}@${provider}`);
      });
      // 输出删除的模型
      deleted.forEach((m: string) => {
        const atIdx = m.lastIndexOf("@");
        const name = atIdx > 0 ? m.substring(0, atIdx) : m;
        const provider =
          atIdx > 0 ? m.substring(atIdx + 1).replace(/^custom_/, "") : "";
        console.log(`[Sync] ➖ ${name}@${provider}`);
      });

      if (added.length > 0 || deleted.length > 0) {
        console.log(
          `[Sync] ✅ 已同步模型: 新增 ${added.length} 个，删除 ${deleted.length} 个，当前共 ${afterCount} 个`,
        );
      } else {
        console.log(`[Sync] ✅ 已同步模型: 无变化，当前共 ${afterCount} 个`);
      }
      // 分行显示各供应商
      if (afterCount > 0) {
        Array.from(providerCounts.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .forEach(([p, c]) => {
            console.log(`[Sync]   ${p}: ${c}个`);
          });
      }

      lastKnownCustomModelsSnapshot = currentCustomModels;
      return;
    }
    if (item.key === StoreKey.Chat) {
      // 计算会话的 diff（新增/删除）
      const currentSessionSnapshot = buildChatSessionLogSnapshot();
      if (lastKnownChatSessionSnapshot.size === 0) {
        lastKnownChatSessionSnapshot = currentSessionSnapshot;
        console.log(
          `[Sync] ✅ 已同步会话: 本地 ${local.total} 个，远端 ${remote.total} 个，已同步 ${local.synced} 个`,
        );
        return;
      }
      const beforeIds = new Set(lastKnownChatSessionSnapshot.keys());
      const afterIds = new Set(currentSessionSnapshot.keys());
      const added = [...afterIds].filter((id) => !beforeIds.has(id));
      const deleted = [...beforeIds].filter((id) => !afterIds.has(id));
      const addedLabels = added.map(
        (id) => currentSessionSnapshot.get(id) || formatSyncedSessionLabel(id),
      );
      const deletedLabels = deleted.map(
        (id) =>
          lastKnownChatSessionSnapshot.get(id) || formatSyncedSessionLabel(id),
      );

      if (added.length > 0 || deleted.length > 0) {
        console.log(
          `[Sync] ✅ 已同步会话: 本地 ${local.total} 个，远端 ${remote.total} 个，本次新增 ${added.length} 个，删除 ${deleted.length} 个`,
        );
        if (added.length > 0) {
          console.log(
            `[Sync] ➕ 新增会话: ${formatLimitedSessionLabels(addedLabels)}`,
          );
        }
        if (deleted.length > 0) {
          console.log(
            `[Sync] ➖ 删除会话: ${formatLimitedSessionLabels(deletedLabels)}`,
          );
        }
      } else {
        console.log(
          `[Sync] ✅ 已同步会话: 本地 ${local.total} 个，远端 ${remote.total} 个，已同步 ${local.synced} 个`,
        );
      }
      // 更新快照
      lastKnownChatSessionSnapshot = currentSessionSnapshot;
      return;
    }
    console.log(
      `[Sync] ✅ 已同步${item.name}: 本地 ${local.total} 个，远端 ${remote.total} 个，已同步 ${local.synced} 个`,
    );
  });

  // 在模型统计后显示每个用户的对话数量
  const authState = useAuthStore.getState();
  if (authState.user?.role !== "admin") {
    return;
  }
  fetch("/api/admin/users", {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => {
      if (payload?.ok && Array.isArray(payload.users)) {
        const usersWithChats = payload.users.filter(
          (u: any) => (u.conversationCount ?? 0) > 0,
        );
        if (usersWithChats.length > 0) {
          const total = usersWithChats.reduce(
            (sum: number, u: any) => sum + (u.conversationCount ?? 0),
            0,
          );
          console.log(`[Sync] ✅ 已同步对话: ${total} 个`);
          usersWithChats
            .sort((a: any, b: any) =>
              (a.displayName || a.username).localeCompare(
                b.displayName || b.username,
              ),
            )
            .forEach((u: any) => {
              console.log(
                `[Sync]   ${u.displayName || u.username}: ${
                  u.conversationCount
                }个`,
              );
            });
        }
      }
    })
    .catch(() => {});
}

function formatSyncedSessionLabel(sessionId: string, topic?: unknown) {
  const normalizedTopic = String(topic || "").trim() || "未命名对话";
  return `${normalizedTopic}（ID: ${sessionId}）`;
}

function buildChatSessionLogSnapshot() {
  const chatState = useChatStore.getState() as any;
  const summaries = Array.isArray(chatState?.sessionSummaries)
    ? chatState.sessionSummaries
    : [];
  const summaryMap = new Map<string, any>(
    summaries
      .filter((summary: any) => summary?.id)
      .map((summary: any) => [String(summary.id), summary]),
  );
  const sessions = Array.isArray(chatState?.sessions) ? chatState.sessions : [];

  return new Map<string, string>(
    sessions
      .filter((session: any) => session?.id)
      .map((session: any) => {
        const sessionId = String(session.id);
        const summary = summaryMap.get(sessionId);
        return [
          sessionId,
          formatSyncedSessionLabel(sessionId, session.topic || summary?.topic),
        ];
      }),
  );
}

function formatLimitedSessionLabels(labels: string[]) {
  const visibleLabels = labels.slice(0, 5).join("、");
  return `${visibleLabels}${labels.length > 5 ? ` 等${labels.length}个` : ""}`;
}

function measureJsonBytes(value: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}

function getEnabledAccessProfile() {
  const accessState = useAccessStore.getState() as Record<string, any>;
  const profiles = Array.isArray(accessState.apiProfiles)
    ? accessState.apiProfiles
    : [];

  return (
    profiles.find((profile) => profile?.enabled) ||
    profiles.find(
      (profile) =>
        profile?.provider === ServiceProvider.Custom &&
        String(profile?.baseUrl || "").trim() ===
          String(accessState.customUrl || "").trim(),
    ) ||
    null
  );
}

function resolveEffectiveAccessApiKey(profile: Record<string, any> | null) {
  if (!profile) {
    return "";
  }

  const accessState = useAccessStore.getState() as Record<string, any>;

  switch (profile.provider) {
    case ServiceProvider.Custom:
      return String(profile.apiKey || accessState.customApiKey || "").trim();
    case ServiceProvider.Local:
      return String(profile.apiKey || accessState.localApiKey || "").trim();
    case ServiceProvider.OpenAI:
      return String(profile.apiKey || accessState.openaiApiKey || "").trim();
    case ServiceProvider.Azure:
      return String(profile.apiKey || accessState.azureApiKey || "").trim();
    case ServiceProvider.Google:
      return String(profile.apiKey || accessState.googleApiKey || "").trim();
    case ServiceProvider.Anthropic:
      return String(profile.apiKey || accessState.anthropicApiKey || "").trim();
    case ServiceProvider.Baidu:
      return String(profile.apiKey || accessState.baiduApiKey || "").trim();
    case ServiceProvider.ByteDance:
      return String(profile.apiKey || accessState.bytedanceApiKey || "").trim();
    case ServiceProvider.Alibaba:
      return String(profile.apiKey || accessState.alibabaApiKey || "").trim();
    case ServiceProvider.Moonshot:
      return String(profile.apiKey || accessState.moonshotApiKey || "").trim();
    case ServiceProvider.Stability:
      return String(profile.apiKey || accessState.stabilityApiKey || "").trim();
    case ServiceProvider.Iflytek:
      return String(profile.apiKey || accessState.iflytekApiKey || "").trim();
    case ServiceProvider.XAI:
      return String(profile.apiKey || accessState.xaiApiKey || "").trim();
    case ServiceProvider.ChatGLM:
      return String(profile.apiKey || accessState.chatglmApiKey || "").trim();
    case ServiceProvider.DeepSeek:
      return String(profile.apiKey || accessState.deepseekApiKey || "").trim();
    case ServiceProvider.SiliconFlow:
      return String(
        profile.apiKey || accessState.siliconflowApiKey || "",
      ).trim();
    case ServiceProvider["302.AI"]:
      return String(profile.apiKey || accessState.ai302ApiKey || "").trim();
    default:
      return "";
  }
}

function warnMissingRecoveredApiKey() {
  const profile = getEnabledAccessProfile();
  const effectiveApiKey = resolveEffectiveAccessApiKey(profile);
  if (!profile || effectiveApiKey) {
    return;
  }

  const warningKey = `${String(profile.provider || "")}:${String(
    profile.id || profile.name || "",
  )}`;
  if (lastMissingApiKeyWarningKey === warningKey) {
    return;
  }
  lastMissingApiKeyWarningKey = warningKey;

  const profileName = String(profile.name || "当前配置");
  const message = `${profileName} 只恢复了公开配置，云端没有聊天密钥，请到 API 配置页重新保存`;
  syncConsole("warn", `[Sync] ⚠️ ${message}`);
  showToast(message, undefined, 6000);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }

  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function buildMetaMap(
  metas: StoreSnapshotMeta[] = [],
): Map<SyncStoreKey, StoreSnapshotMeta> {
  return new Map(
    metas.map((meta) => [meta.key as SyncStoreKey, meta] as const),
  );
}

function normalizeMergedChatState(chatState: any) {
  const rawSessions = Array.isArray(chatState?.sessions)
    ? chatState.sessions
    : [];
  const selectedId = String(chatState?.selectedSessionId || "");

  // 构建远端索引和 summary 的查找表，用于判断占位符
  const existingSummaries = Array.isArray(chatState?.sessionSummaries)
    ? chatState.sessionSummaries
    : [];
  const existingSummaryMap = new Map<string, any>(
    existingSummaries
      .filter((s: any) => s?.id)
      .map((s: any) => [String(s.id), s]),
  );
  const remoteIndexEntries = Array.isArray(chatState?.remoteIndexSessions)
    ? (chatState.remoteIndexSessions as ChatIndexSessionEntry[])
    : [];
  const remoteEntryMap = new Map<string, ChatIndexSessionEntry>(
    remoteIndexEntries.filter((e) => e?.id).map((e) => [String(e.id), e]),
  );

  // 判断是否为占位符（本地 messages 为空，但远端/summary 有数据）
  const isPlaceholder = (session: any) => {
    const msgs = session?.messages;
    if (Array.isArray(msgs) && msgs.length > 0) return false;
    const id = String(session?.id || "");
    // 标记为 _syncPlaceholder 的远端占位符
    if (session?._syncPlaceholder) return true;
    // summary 记录有消息但本地还没加载
    const summary = existingSummaryMap.get(id);
    if (summary && Number(summary.messageCount || 0) > 0) return true;
    // 远端索引记录有消息
    const remoteEntry = remoteEntryMap.get(id);
    if (remoteEntry && Number(remoteEntry.messageCount || 0) > 0) return true;
    return false;
  };

  // 判断对话是否同时有 user 和 assistant 消息
  const hasBothSides = (session: any) => {
    const msgs = session?.messages;
    if (!Array.isArray(msgs) || msgs.length === 0) return false;
    let hasUser = false;
    let hasAssistant = false;
    for (const msg of msgs) {
      if (msg?.role === "user") hasUser = true;
      if (msg?.role === "assistant") hasAssistant = true;
      if (hasUser && hasAssistant) return true;
    }
    return false;
  };

  // 保留规则：有完整消息的 + 占位符（远端有数据但未下载） + 当前选中的空对话 + 唯一一个默认空对话
  let foundDefaultEmpty = false;
  const sessions = rawSessions.filter((session: any) => {
    const sessionId = String(session?.id || "");
    if (hasBothSides(session)) return true;
    if (isPlaceholder(session)) return true;
    if (selectedId && sessionId === selectedId) return true;
    if (isDefaultEmptyChatSession(session) && !foundDefaultEmpty) {
      foundDefaultEmpty = true;
      return true;
    }
    return false;
  });
  if (sessions.length === 0) {
    sessions.push(createEmptySession());
  }
  const preferredSessionId = selectedId;
  const preferredSessionIndex = preferredSessionId
    ? sessions.findIndex((session: any) => session?.id === preferredSessionId)
    : -1;
  const safeIndex =
    preferredSessionIndex >= 0
      ? preferredSessionIndex
      : Math.min(
          Math.max(Number(chatState?.currentSessionIndex) || 0, 0),
          Math.max(sessions.length - 1, 0),
        );
  const hydratedSessionIds = Array.isArray(chatState?.hydratedSessionIds)
    ? chatState.hydratedSessionIds.filter(
        (sessionId: unknown) =>
          typeof sessionId === "string" &&
          sessions.some((session: any) => session?.id === sessionId),
      )
    : sessions
        .filter(
          (session: any) =>
            session?.id &&
            Array.isArray(session?.messages) &&
            session.messages.length > 0,
        )
        .map((session: any) => session.id);
  const sessionSummaries = sessions.map((session: any) => {
    const existingSummary = existingSummaryMap.get(session?.id);
    const remoteIndexEntry = remoteEntryMap.get(String(session?.id || ""));
    const hasMessages =
      Array.isArray(session?.messages) && session.messages.length > 0;

    if (
      !hasMessages &&
      ((existingSummary && Number(existingSummary.messageCount || 0) > 0) ||
        (remoteIndexEntry && Number(remoteIndexEntry.messageCount || 0) > 0))
    ) {
      return {
        ...(existingSummary || {}),
        id: String(
          session?.id || existingSummary?.id || remoteIndexEntry?.id || "",
        ),
        topic:
          session?.topic ||
          existingSummary?.topic ||
          remoteIndexEntry?.topic ||
          "",
        messageCount: Number(
          existingSummary?.messageCount || remoteIndexEntry?.messageCount || 0,
        ),
        createdAt: Number(
          session?.createdAt ||
            existingSummary?.createdAt ||
            remoteIndexEntry?.createdAt ||
            0,
        ),
        displayTime: Number(
          session?.lastUpdate ||
            session?.createdAt ||
            existingSummary?.displayTime ||
            remoteIndexEntry?.lastUpdate ||
            existingSummary?.createdAt ||
            remoteIndexEntry?.createdAt ||
            0,
        ),
        avatar: session?.mask?.avatar || existingSummary?.avatar || "gpt-bot",
        model:
          session?.mask?.modelConfig?.model || existingSummary?.model || "",
        searchText: String(existingSummary?.searchText || ""),
      };
    }

    return buildSessionSummary(session);
  });

  return {
    ...chatState,
    sessions,
    currentSessionIndex: safeIndex,
    selectedSessionId: sessions[safeIndex]?.id || preferredSessionId || "",
    hydratedSessionIds,
    sessionSummaries,
  };
}

function pruneEmptyChatSessionsForDisplay(chatState: any) {
  const sessions = Array.isArray(chatState?.sessions) ? chatState.sessions : [];
  const selectedSessionId = getSelectedChatSessionId(chatState);
  const selectedDefaultEmptySessionId =
    sessions.find(
      (session: any) =>
        String(session?.id || "") === selectedSessionId &&
        isDefaultEmptyChatSession(session),
    )?.id || "";
  let hasKeptDefaultEmptySession = false;
  let selectedIndex = 0;
  const nextSessions = sessions.filter((session: any) => {
    const sessionId = String(session?.id || "");
    const messages = getSessionMessages(session);

    if (messages.length > 0 || isRemoteSessionPlaceholder(session)) {
      return true;
    }

    if (isDefaultEmptyChatSession(session)) {
      const keep = selectedDefaultEmptySessionId
        ? sessionId === selectedDefaultEmptySessionId
        : !hasKeptDefaultEmptySession;
      hasKeptDefaultEmptySession = hasKeptDefaultEmptySession || keep;
      return keep;
    }

    return sessionId && sessionId === selectedSessionId;
  });

  if (nextSessions.length === 0) {
    nextSessions.push(createEmptySession());
  }

  selectedIndex = nextSessions.findIndex(
    (session: any) => String(session?.id || "") === selectedSessionId,
  );
  if (selectedIndex < 0) selectedIndex = 0;

  return {
    ...chatState,
    sessions: nextSessions,
    currentSessionIndex: selectedIndex,
    selectedSessionId: nextSessions[selectedIndex]?.id || "",
    sessionSummaries: buildSessionSummaries(
      nextSessions,
      chatState?.sessionSummaries,
    ),
    hydratedSessionIds: Array.isArray(chatState?.hydratedSessionIds)
      ? chatState.hydratedSessionIds.filter((sessionId: unknown) =>
          nextSessions.some((session: any) => session?.id === sessionId),
        )
      : [],
  };
}

function clonePlainChatState<T>(state: T): T {
  return JSON.parse(JSON.stringify(state || {}));
}

function getSelectedChatSessionId(chatState: any) {
  const sessions = Array.isArray(chatState?.sessions) ? chatState.sessions : [];
  const currentSessionIndex = Math.max(
    0,
    Number(chatState?.currentSessionIndex) || 0,
  );
  return String(
    chatState?.selectedSessionId || sessions[currentSessionIndex]?.id || "",
  );
}

function getChatInteractionSignature(chatState: any) {
  const sessions = Array.isArray(chatState?.sessions) ? chatState.sessions : [];
  return JSON.stringify({
    selectedSessionId: getSelectedChatSessionId(chatState),
    sessions: sessions.map((session: any) => ({
      id: String(session?.id || ""),
      lastUpdate: Number(session?.lastUpdate || 0),
      messageCount: Array.isArray(session?.messages)
        ? session.messages.length
        : Number(session?.messageCount || 0),
    })),
  });
}

function rebaseChatSyncResultOnLiveState(
  mergedStoreState: any,
  syncBaseState: any,
) {
  const liveChatState = getNonFunctionFileds(useChatStore.getState() as any);

  if (
    getChatInteractionSignature(liveChatState) ===
    getChatInteractionSignature(syncBaseState)
  ) {
    return mergedStoreState;
  }

  const rebasedState = mergeStoreState(
    StoreKey.Chat,
    clonePlainChatState(liveChatState),
    clonePlainChatState(mergedStoreState),
  );

  const mergedDeletedSessionTimestamps = mergeDeletedSessionTimestamps(
    getDeletedSessionTimestamps(mergedStoreState),
    getDeletedSessionTimestamps(liveChatState),
    getDeletedSessionTimestamps(rebasedState),
  );

  const normalizedRebasedState = normalizeMergedChatState({
    ...mergedStoreState,
    ...rebasedState,
    remoteIndexSessions: Array.isArray(mergedStoreState?.remoteIndexSessions)
      ? mergedStoreState.remoteIndexSessions
      : [],
    deletedSessionTimestamps: mergedDeletedSessionTimestamps,
  });
  const normalizedAfterDeletes = applyDeletedSessionsToChatState(
    normalizedRebasedState,
    mergedDeletedSessionTimestamps,
  );
  const liveSelectedSessionId = getSelectedChatSessionId(liveChatState);
  const normalizedSessions = Array.isArray(normalizedAfterDeletes.sessions)
    ? normalizedAfterDeletes.sessions
    : [];
  const hasLiveSelectedSession = normalizedSessions.some(
    (session: any) => String(session?.id || "") === liveSelectedSessionId,
  );

  if (liveSelectedSessionId && !hasLiveSelectedSession) {
    const liveSelectedSession = Array.isArray(liveChatState.sessions)
      ? liveChatState.sessions.find(
          (session: any) => String(session?.id || "") === liveSelectedSessionId,
        )
      : undefined;

    if (liveSelectedSession?.id) {
      normalizedAfterDeletes.sessions = [
        liveSelectedSession,
        ...normalizedSessions,
      ];
      normalizedAfterDeletes.currentSessionIndex = 0;
      normalizedAfterDeletes.selectedSessionId = liveSelectedSession.id;
      normalizedAfterDeletes.sessionSummaries = buildSessionSummaries(
        normalizedAfterDeletes.sessions,
        normalizedAfterDeletes.sessionSummaries,
      );
    }
  }

  logSyncDebug("[Sync] 🧭 同步写回前保留当前会话焦点", {
    selectedSessionId: getSelectedChatSessionId(normalizedAfterDeletes),
  });

  return pruneEmptyChatSessionsForDisplay(normalizedAfterDeletes);
}

function buildRemoteSessionPlaceholder(entry: ChatIndexSessionEntry) {
  const session = createEmptySession();
  session.id = entry.id;
  session.topic = String(entry.topic || "");
  session.createdAt = Number(entry.createdAt || entry.lastUpdate || Date.now());
  session.lastUpdate = Number(
    entry.lastUpdate || entry.createdAt || Date.now(),
  );
  session.mask.name = session.topic || session.mask.name;
  return {
    ...session,
    _syncPlaceholder: true,
  } as PlaceholderChatSession;
}

function isRemoteSessionPlaceholder(
  session: unknown,
): session is PlaceholderChatSession {
  return (
    isObjectLike(session) &&
    "_syncPlaceholder" in session &&
    session._syncPlaceholder === true
  );
}

function isDefaultChatTopic(topic: unknown) {
  const normalizedTopic = String(topic || "").trim();
  const localeDefaultTopic = String(Locale.Store?.DefaultTopic || "").trim();

  return (
    !normalizedTopic ||
    normalizedTopic === localeDefaultTopic ||
    normalizedTopic === "新的聊天" ||
    normalizedTopic === "New Chat"
  );
}

function isDefaultEmptyChatSession(session: any) {
  if (!session?.id) {
    return false;
  }

  const messages = getSessionMessages(session);
  return (
    messages.length === 0 &&
    isDefaultChatTopic(session.topic) &&
    !session.memoryPrompt
  );
}

function createSessionSummaryMap(chatState: any) {
  const sessionSummaries = Array.isArray(chatState?.sessionSummaries)
    ? chatState.sessionSummaries
    : [];

  return new Map<string, any>(
    sessionSummaries
      .filter((summary: any) => summary?.id)
      .map((summary: any) => [String(summary.id), summary]),
  );
}

function isLocallyPrunedSession(session: any, summary: any) {
  return (
    !isRemoteSessionPlaceholder(session) &&
    !!session?.id &&
    Array.isArray(session?.messages) &&
    session.messages.length === 0 &&
    Number(summary?.messageCount || 0) > 0
  );
}

function shouldKeepSessionInUploadIndex(
  session: PlaceholderChatSession,
  summary: any,
  remoteEntry: ChatIndexSessionEntry | undefined,
) {
  if (!session?.id || isDefaultEmptyChatSession(session)) {
    return false;
  }

  if (isRemoteSessionPlaceholder(session) && remoteEntry) {
    return true;
  }

  // pruned session 只有远端有记录时才保留在索引里，否则是孤儿会话
  if (isLocallyPrunedSession(session, summary)) {
    return !!remoteEntry;
  }

  return shouldSyncChatSession(session);
}

function buildUploadChatIndexPayload(
  chatState: any,
  remoteEntryMap: Map<string, ChatIndexSessionEntry>,
) {
  const sessions = Array.isArray(chatState?.sessions) ? chatState.sessions : [];
  const summaryMap = createSessionSummaryMap(chatState);
  const currentSessionIndex = Math.max(
    0,
    Number(chatState?.currentSessionIndex) || 0,
  );
  const rawCurrentSessionId = sessions[currentSessionIndex]?.id;
  const currentSessionId =
    typeof rawCurrentSessionId === "string" ? rawCurrentSessionId : "";
  const {
    sessions: _sessions,
    currentSessionIndex: _currentSessionIndex,
    ...rest
  } = chatState ?? {};

  const sessionEntries = sessions
    .filter((session: PlaceholderChatSession) => {
      const sessionId = String(session?.id || "");
      return shouldKeepSessionInUploadIndex(
        session,
        summaryMap.get(sessionId),
        remoteEntryMap.get(sessionId),
      );
    })
    .map((session: PlaceholderChatSession) => {
      const sessionId = String(session.id || "");
      const remoteEntry = remoteEntryMap.get(sessionId);
      const summary = summaryMap.get(sessionId);

      if (isRemoteSessionPlaceholder(session) && remoteEntry) {
        return {
          id: sessionId,
          topic: String(remoteEntry.topic || session.topic || ""),
          createdAt: Number(
            remoteEntry.createdAt || session.createdAt || Date.now(),
          ),
          lastUpdate: Number(
            remoteEntry.lastUpdate || session.lastUpdate || Date.now(),
          ),
          messageCount: Number(remoteEntry.messageCount || 0),
        };
      }

      if (isLocallyPrunedSession(session, summary)) {
        return {
          id: sessionId,
          topic: String(summary?.topic || session.topic || ""),
          createdAt: Number(summary?.createdAt || session.createdAt || 0) || 0,
          lastUpdate:
            Number(
              summary?.displayTime ||
                session.lastUpdate ||
                session.createdAt ||
                0,
            ) || 0,
          messageCount: Number(summary?.messageCount || 0) || 0,
        };
      }

      return {
        id: sessionId,
        topic: String(session.topic || ""),
        createdAt: Number(session.createdAt || 0),
        lastUpdate: Number(session.lastUpdate || 0),
        messageCount: Array.isArray(session.messages)
          ? session.messages.length
          : 0,
      };
    });

  return {
    version: 1 as const,
    state: {
      ...rest,
      currentSessionId,
      sessionIds: sessionEntries.map(
        (entry: ChatIndexSessionEntry) => entry.id,
      ),
    },
    sessions: sessionEntries,
  };
}

function buildUploadableChatSessionMap(chatState: any) {
  const sessions = Array.isArray(chatState?.sessions) ? chatState.sessions : [];
  const summaryMap = createSessionSummaryMap(chatState);
  const sessionMap = new Map<string, Record<string, unknown>>();
  let prunedCount = 0;
  let emptyCount = 0;
  let notSyncableCount = 0;

  sessions.forEach((session: any) => {
    const sessionId = String(session?.id || "");
    if (!sessionId) {
      return;
    }

    if (isLocallyPrunedSession(session, summaryMap.get(sessionId))) {
      prunedCount++;
      return;
    }

    if (isDefaultEmptyChatSession(session)) {
      emptyCount++;
      return;
    }

    if (!shouldSyncChatSession(session)) {
      notSyncableCount++;
      return;
    }

    // 合并后的会话可能从远端占位符继承了 _syncPlaceholder 标记，
    // 但既然已通过消息检查，说明是真实会话，必须剥离该标记以避免上传时被过滤
    if (session._syncPlaceholder) {
      const { _syncPlaceholder, ...cleanSession } = session;
      sessionMap.set(sessionId, cleanSession as Record<string, unknown>);
    } else {
      sessionMap.set(sessionId, session as Record<string, unknown>);
    }
  });

  if (prunedCount > 0 || notSyncableCount > 0) {
    logSyncDebug(
      `[Sync] 🔬 buildUploadableMap 诊断: 总 ${sessions.length}, 可上传 ${sessionMap.size}, 被剪枝 ${prunedCount}, 空会话 ${emptyCount}, 不可同步 ${notSyncableCount}`,
    );
  }

  return sessionMap;
}

function prependLeadingEmptySession(
  chatState: any,
  emptySession: any,
  options?: {
    preferLeadingEmptySession?: boolean;
  },
) {
  if (!emptySession?.id) {
    return chatState;
  }

  const sessions = Array.isArray(chatState?.sessions) ? chatState.sessions : [];
  const currentSessionIndex = Math.max(
    0,
    Number(chatState?.currentSessionIndex) || 0,
  );
  const currentSessionId = sessions[currentSessionIndex]?.id;

  const nextSessions = [
    emptySession,
    ...sessions.filter((session: any) => session?.id !== emptySession.id),
  ];

  // 在新标签页/首开场景中，如果本地原本就聚焦空白会话，则同步后继续保持空白会话聚焦。
  let nextIndex = options?.preferLeadingEmptySession ? 0 : 0;
  if (!options?.preferLeadingEmptySession && currentSessionId) {
    const idx = nextSessions.findIndex((s: any) => s?.id === currentSessionId);
    if (idx >= 0) nextIndex = idx;
  }

  return {
    ...chatState,
    sessions: nextSessions,
    currentSessionIndex: nextIndex,
    selectedSessionId: nextSessions[nextIndex]?.id || "",
  };
}

function findLocalLeadingEmptySession(sessions: any[]) {
  return sessions.find((session: any) => isDefaultEmptyChatSession(session));
}

async function materializeLocalChatState(chatState: any, lightMode = false) {
  const sessions = Array.isArray(chatState?.sessions) ? chatState.sessions : [];
  const sessionSummaries = Array.isArray(chatState?.sessionSummaries)
    ? chatState.sessionSummaries
    : [];
  const selectedSessionId = String(chatState?.selectedSessionId || "");
  const currentSessionId =
    selectedSessionId ||
    String(
      sessions[Math.max(0, Number(chatState?.currentSessionIndex) || 0)]?.id ||
        "",
    );

  let hydratedCount = 0;
  let skippedLightMode = 0;
  let failedHydration: string[] = [];
  const nextSessions = await Promise.all(
    sessions.map(async (session: any) => {
      const summary = sessionSummaries.find(
        (item: any) => item?.id && item.id === session?.id,
      );
      const shouldHydrate =
        session?.id &&
        Array.isArray(session?.messages) &&
        session.messages.length === 0 &&
        Number(summary?.messageCount || 0) > 0;

      if (!shouldHydrate) {
        return session;
      }

      if (lightMode && String(session?.id || "") !== currentSessionId) {
        skippedLightMode++;
        return session;
      }

      const hydrated = await getPersistedChatSession(session.id);
      if (hydrated) {
        hydratedCount++;
        return hydrated;
      }
      failedHydration.push(String(session.id));
      return session;
    }),
  );
  if (!lightMode && (failedHydration.length > 0 || hydratedCount > 0)) {
    logSyncDebug(
      `[Sync] 🔬 materialize 诊断: 总会话 ${sessions.length}, 水合成功 ${hydratedCount}, 水合失败 ${failedHydration.length}, lightMode跳过 ${skippedLightMode}`,
    );
    if (failedHydration.length > 0) {
      logSyncDebug(`[Sync] 🔬 水合失败的会话ID:`, failedHydration.slice(0, 10));
    }
  }

  return {
    ...chatState,
    sessions: nextSessions,
  };
}

function shouldFetchRemoteChatSession(
  localEntry: ChatIndexSessionEntry | undefined,
  remoteEntry: ChatIndexSessionEntry,
) {
  if (!localEntry) {
    return true;
  }

  if (remoteEntry.lastUpdate > localEntry.lastUpdate) {
    return true;
  }

  return (
    remoteEntry.lastUpdate === localEntry.lastUpdate &&
    remoteEntry.messageCount !== localEntry.messageCount
  );
}

function shouldUploadChatSession(
  localEntry: ChatIndexSessionEntry,
  remoteEntry: ChatIndexSessionEntry | undefined,
) {
  if (!remoteEntry) {
    return true;
  }

  if (localEntry.lastUpdate > remoteEntry.lastUpdate) {
    return true;
  }

  return (
    localEntry.lastUpdate === remoteEntry.lastUpdate &&
    localEntry.messageCount !== remoteEntry.messageCount
  );
}

function getChatGlobalClearAt(state: unknown) {
  return getChatGlobalClearAtFromState(state);
}

function getChatSessionLastUpdate(session: unknown) {
  const value =
    isObjectLike(session) && "lastUpdate" in session ? session.lastUpdate : 0;
  const nextValue = Number(value);
  return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 0;
}

function getDeletedSessionTimestamps(state: unknown) {
  return getDeletedSessionTimestampsFromState(state);
}

function mergeDeletedSessionTimestamps(...maps: Array<Record<string, number>>) {
  const merged = {} as Record<string, number>;

  maps.forEach((map) => {
    Object.entries(map).forEach(([sessionId, deletedAt]) => {
      merged[sessionId] = Math.max(merged[sessionId] || 0, deletedAt);
    });
  });

  return merged;
}

function wasChatSessionDeleted(
  sessionId: string | undefined,
  lastUpdate: number,
  deletedSessionTimestamps: Record<string, number>,
) {
  if (!sessionId) {
    return false;
  }

  const deletedAt = deletedSessionTimestamps[sessionId] || 0;
  return deletedAt > 0 && deletedAt >= lastUpdate;
}

function applyDeletedSessionsToChatState(
  state: any,
  deletedSessionTimestamps: Record<string, number>,
) {
  const sessions: Array<Record<string, unknown>> = Array.isArray(
    state?.sessions,
  )
    ? state.sessions
    : [];
  const filteredSessions = sessions.filter(
    (session: Record<string, unknown>) => {
      const sessionId = String(session?.id || "");
      return !wasChatSessionDeleted(
        sessionId,
        getChatSessionLastUpdate(session),
        deletedSessionTimestamps,
      );
    },
  );
  const currentSessionId = sessions[state?.currentSessionIndex ?? 0]?.id ?? "";
  const nextCurrentSessionIndex = currentSessionId
    ? filteredSessions.findIndex(
        (session: Record<string, unknown>) => session?.id === currentSessionId,
      )
    : 0;

  return {
    ...state,
    sessions: filteredSessions,
    currentSessionIndex:
      nextCurrentSessionIndex >= 0 ? nextCurrentSessionIndex : 0,
    deletedSessionTimestamps,
  };
}

function removeChatSessionsFromState(state: any, sessionIds: Set<string>) {
  if (sessionIds.size === 0) {
    return state;
  }

  const sessions = Array.isArray(state?.sessions) ? state.sessions : [];
  const nextSessions = sessions.filter((session: Record<string, unknown>) => {
    const sessionId = String(session?.id || "");
    return !sessionIds.has(sessionId);
  });
  const previousSelectedSessionId = String(
    state?.selectedSessionId ||
      sessions[Math.max(0, Number(state?.currentSessionIndex) || 0)]?.id ||
      "",
  );
  let nextCurrentSessionIndex = previousSelectedSessionId
    ? nextSessions.findIndex(
        (session: Record<string, unknown>) =>
          String(session?.id || "") === previousSelectedSessionId,
      )
    : 0;
  if (nextCurrentSessionIndex < 0) {
    nextCurrentSessionIndex = 0;
  }

  return {
    ...state,
    sessions: nextSessions,
    currentSessionIndex: nextCurrentSessionIndex,
    selectedSessionId: nextSessions[nextCurrentSessionIndex]?.id || "",
    sessionSummaries: Array.isArray(state?.sessionSummaries)
      ? state.sessionSummaries.filter(
          (summary: Record<string, unknown>) =>
            !sessionIds.has(String(summary?.id || "")),
        )
      : state?.sessionSummaries,
    hydratedSessionIds: Array.isArray(state?.hydratedSessionIds)
      ? state.hydratedSessionIds.filter(
          (sessionId: unknown) => !sessionIds.has(String(sessionId || "")),
        )
      : state?.hydratedSessionIds,
    remoteIndexSessions: Array.isArray(state?.remoteIndexSessions)
      ? state.remoteIndexSessions.filter(
          (entry: Record<string, unknown>) =>
            !sessionIds.has(String(entry?.id || "")),
        )
      : state?.remoteIndexSessions,
  };
}

function buildClearedChatState(state: any, clearAt: number) {
  const sessions: Array<Record<string, unknown>> = Array.isArray(
    state?.sessions,
  )
    ? state.sessions
    : [];
  const keptSessions = sessions.filter(
    (session: Record<string, unknown>) =>
      getChatSessionLastUpdate(session) > clearAt,
  );
  const currentSessionId = sessions[state?.currentSessionIndex ?? 0]?.id ?? "";
  const nextCurrentSessionIndex = currentSessionId
    ? keptSessions.findIndex(
        (session: Record<string, unknown>) => session?.id === currentSessionId,
      )
    : 0;

  return {
    ...state,
    sessions: keptSessions,
    currentSessionIndex:
      nextCurrentSessionIndex >= 0 ? nextCurrentSessionIndex : 0,
    globalClearAt: clearAt,
  };
}

async function withRetry<T>(
  task: () => Promise<T>,
  options?: {
    retryable?: (error: unknown) => boolean;
    retries?: number;
    onRetry?: (attempt: number, error: unknown) => void;
  },
) {
  const retries = options?.retries ?? 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await task();
    } catch (error) {
      const canRetry =
        attempt < retries && (options?.retryable?.(error) ?? false);
      if (!canRetry) {
        throw error;
      }
      options?.onRetry?.(attempt + 1, error);
    }
  }

  throw new Error("[Sync] 未知重试状态");
}

const DEFAULT_SYNC_STATE = {
  provider: ProviderType.Database,
  criticalSyncReady: false,
  criticalSyncInProgress: true,

  database: {
    cacheMeta: {} as DatabaseCacheMeta,
    lastMetaSyncTime: 0,
  },

  lastSyncTime: 0,
  lastProvider: "",
};

export const useSyncStore = createPersistStore(
  DEFAULT_SYNC_STATE,
  (set, get) => {
    async function syncChatStore(
      client: {
        getChatIndex?: () => Promise<any>;
        getChatSessions?: (ids: string[]) => Promise<Record<string, unknown>>;
        setChatDelta?: (
          params: {
            index: ReturnType<typeof buildChatIndexPayload>;
            upsertSessions: Array<Record<string, unknown>>;
            deleteSessionIds?: string[];
          },
          expectation?: {
            expectedUpdatedAt?: string;
            expectedChecksum?: string;
            expectedMissing?: boolean;
          },
        ) => Promise<void>;
        set: (key: string, value: string) => Promise<void>;
      },
      localChatState: any,
      chatMeta?: StoreSnapshotMeta,
      options?: {
        downloadOnly?: boolean;
        remoteIndex?: any;
      },
    ) {
      const lightMode = get().criticalSyncInProgress;
      const hasPendingChatRequest = ChatControllerPool.hasPending();
      const downloadOnly = options?.downloadOnly === true;
      logSyncDebug(
        `[Sync] 🔬 syncChatStore 诊断: lightMode=${lightMode}, hasPendingChatRequest=${hasPendingChatRequest}, downloadOnly=${downloadOnly}`,
      );
      const uploadOrMergeStatus: "uploaded" | "merged" = downloadOnly
        ? "merged"
        : "uploaded";
      const materializedLocalChatState = await materializeLocalChatState(
        localChatState,
        lightMode,
      );
      const localSessions = Array.isArray(materializedLocalChatState.sessions)
        ? materializedLocalChatState.sessions
        : [];
      const isBootstrapEmptyLocalChatState =
        localSessions.length === 1 &&
        (() => {
          const session = localSessions[0];
          const topic = String(session?.topic || "");
          const isDefaultTopic =
            !topic || topic === "新的聊天" || topic === "New Chat";
          return (
            isDefaultTopic &&
            getSessionMessages(session).length === 0 &&
            !session?.memoryPrompt
          );
        })();
      const syncableLocalSessions = getSyncableChatSessions(localSessions);
      const localLeadingEmptySession =
        findLocalLeadingEmptySession(localSessions);
      const preferLeadingEmptySession =
        Boolean(localLeadingEmptySession?.id) &&
        String(materializedLocalChatState?.selectedSessionId || "") ===
          String(localLeadingEmptySession?.id || "");
      const remoteIndex =
        options?.remoteIndex ?? (await client.getChatIndex?.());
      const localDeletedSessionTimestamps = getDeletedSessionTimestamps(
        materializedLocalChatState,
      );

      if (!remoteIndex) {
        const localIndex = buildChatIndexPayload(materializedLocalChatState);
        const uploadBytes =
          measureJsonBytes(localIndex) +
          measureJsonBytes(syncableLocalSessions);
        if (hasPendingChatRequest) {
          return {
            remoteSummary: "远端 0 个会话",
            mergedStoreState: normalizeMergedChatState({
              ...materializedLocalChatState,
              remoteIndexSessions: [],
            }),
            mergedSummary: getStoreSummary(
              StoreKey.Chat,
              materializedLocalChatState,
            ),
            status: "merged" as const,
            metrics: {
              downloadedSessionCount: 0,
              downloadedBytes: 0,
              uploadedSessionCount: 0,
              uploadedBytes: 0,
              deletedSessionCount: 0,
            },
          };
        }
        if (!downloadOnly) {
          await client.setChatDelta?.(
            {
              index: localIndex,
              upsertSessions: syncableLocalSessions,
              deleteSessionIds: [],
            },
            {
              expectedMissing: !chatMeta,
              expectedUpdatedAt: chatMeta?.updatedAt,
              expectedChecksum: chatMeta?.checksum,
            },
          );
        }

        return {
          remoteSummary: "远端 0 个会话",
          mergedStoreState: normalizeMergedChatState({
            ...materializedLocalChatState,
            remoteIndexSessions: [],
          }),
          mergedSummary: getStoreSummary(
            StoreKey.Chat,
            materializedLocalChatState,
          ),
          status: uploadOrMergeStatus,
          metrics: {
            downloadedSessionCount: 0,
            downloadedBytes: 0,
            uploadedSessionCount: syncableLocalSessions.length,
            uploadedBytes: uploadBytes,
            deletedSessionCount: 0,
          },
        };
      }

      const localIndex = buildChatIndexPayload(materializedLocalChatState);
      const localEntryMap = createChatIndexEntryMap(localIndex.sessions);
      const remoteDeletedSessionTimestamps = getDeletedSessionTimestamps(
        remoteIndex?.state,
      );
      const mergedDeletedSessionTimestamps = mergeDeletedSessionTimestamps(
        localDeletedSessionTimestamps,
        remoteDeletedSessionTimestamps,
      );
      const remoteEntryMap = createChatIndexEntryMap(
        remoteIndex.sessions || [],
      );

      if (
        remoteEntryMap.size === 0 &&
        isEffectivelyEmptyRemoteChatState(remoteIndex?.state)
      ) {
        const uploadBytes =
          measureJsonBytes(localIndex) +
          measureJsonBytes(syncableLocalSessions);

        if (!downloadOnly) {
          await client.setChatDelta?.(
            {
              index: localIndex,
              upsertSessions: syncableLocalSessions,
              deleteSessionIds: [],
            },
            {
              expectedMissing: !chatMeta,
              expectedUpdatedAt: chatMeta?.updatedAt,
              expectedChecksum: chatMeta?.checksum,
            },
          );
        }

        return {
          remoteSummary: "远端 0 个会话",
          mergedStoreState: normalizeMergedChatState(localChatState),
          mergedSummary: getStoreSummary(StoreKey.Chat, localChatState),
          status: uploadOrMergeStatus,
          metrics: {
            downloadedSessionCount: 0,
            downloadedBytes: 0,
            uploadedSessionCount: syncableLocalSessions.length,
            uploadedBytes: uploadBytes,
            deletedSessionCount: 0,
          },
        };
      }

      const preferredRemoteSessionIds = new Set<string>([
        String(remoteIndex?.state?.currentSessionId || ""),
        ...(lightMode
          ? []
          : Array.isArray(localChatState?.hydratedSessionIds)
          ? localChatState.hydratedSessionIds
          : []),
        ...((remoteIndex.sessions || []) as ChatIndexSessionEntry[])
          .slice(0, lightMode ? 2 : INITIAL_HYDRATED_RECENT_SESSION_LIMIT)
          .map((entry) => entry.id),
      ]);
      const remoteSessionIdsToFetch = (remoteIndex.sessions || [])
        .filter(
          (entry: ChatIndexSessionEntry) =>
            !wasChatSessionDeleted(
              entry.id,
              entry.lastUpdate,
              mergedDeletedSessionTimestamps,
            ),
        )
        .filter((entry: ChatIndexSessionEntry) =>
          shouldFetchRemoteChatSession(localEntryMap.get(entry.id), entry),
        )
        .filter((entry: ChatIndexSessionEntry) =>
          preferredRemoteSessionIds.has(entry.id),
        )
        .map((entry: ChatIndexSessionEntry) => entry.id);
      const remoteSessions = await client.getChatSessions?.(
        remoteSessionIdsToFetch,
      );
      const downloadedBytes =
        measureJsonBytes(
          (remoteIndex.sessions || []).filter((entry: ChatIndexSessionEntry) =>
            remoteSessionIdsToFetch.includes(entry.id),
          ),
        ) + measureJsonBytes(remoteSessions || {});
      const remoteSessionsWithPlaceholders = Object.fromEntries(
        ((remoteIndex.sessions || []) as ChatIndexSessionEntry[])
          .filter(
            (entry) =>
              !wasChatSessionDeleted(
                entry.id,
                entry.lastUpdate,
                mergedDeletedSessionTimestamps,
              ),
          )
          .map((entry) => [
            entry.id,
            remoteSessions?.[entry.id] ?? buildRemoteSessionPlaceholder(entry),
          ]),
      );
      const remotePartialState = buildChatStateFromIndex(
        {
          ...remoteIndex,
          sessions: (remoteIndex.sessions || []).filter(
            (entry: ChatIndexSessionEntry) =>
              !wasChatSessionDeleted(
                entry.id,
                entry.lastUpdate,
                mergedDeletedSessionTimestamps,
              ),
          ),
        },
        remoteSessionsWithPlaceholders,
      );
      const normalizedLocalChatState = applyDeletedSessionsToChatState(
        materializedLocalChatState,
        mergedDeletedSessionTimestamps,
      );
      const normalizedRemoteChatState = applyDeletedSessionsToChatState(
        remotePartialState,
        mergedDeletedSessionTimestamps,
      );

      if (
        isBootstrapEmptyLocalChatState &&
        Array.isArray(normalizedRemoteChatState?.sessions) &&
        normalizedRemoteChatState.sessions.length > 0
      ) {
        const mergedIndex = buildUploadChatIndexPayload(
          normalizedRemoteChatState as any,
          remoteEntryMap,
        );
        const uploadableSessionMap = buildUploadableChatSessionMap(
          normalizedRemoteChatState,
        );
        const upsertSessions = mergedIndex.sessions
          .filter((entry: ChatIndexSessionEntry) =>
            shouldUploadChatSession(entry, remoteEntryMap.get(entry.id)),
          )
          .map((entry: ChatIndexSessionEntry) =>
            uploadableSessionMap.get(entry.id),
          )
          .filter(Boolean)
          .filter((session: unknown) => !isRemoteSessionPlaceholder(session))
          .map(
            (session: unknown) => session as unknown as Record<string, unknown>,
          );

        if (
          !downloadOnly &&
          !hasPendingChatRequest &&
          upsertSessions.length > 0
        ) {
          await client.setChatDelta?.(
            {
              index: mergedIndex,
              upsertSessions,
              deleteSessionIds: [],
            },
            {
              expectedMissing: !chatMeta,
              expectedUpdatedAt: chatMeta?.updatedAt,
              expectedChecksum: chatMeta?.checksum,
            },
          );
        }

        const normalizedMergedStoreState = normalizeMergedChatState(
          prependLeadingEmptySession(
            {
              ...normalizedRemoteChatState,
              remoteIndexSessions: remoteIndex.sessions || [],
              deletedSessionTimestamps: mergedDeletedSessionTimestamps,
            },
            localLeadingEmptySession,
            { preferLeadingEmptySession },
          ),
        );

        return {
          remoteSummary: getStoreSummary(StoreKey.Chat, {
            sessions: remoteIndex.sessions || [],
          }),
          mergedStoreState: normalizedMergedStoreState,
          mergedSummary: getStoreSummary(
            StoreKey.Chat,
            normalizedMergedStoreState,
          ),
          status: "merged" as const,
          metrics: {
            downloadedSessionCount: remoteSessionIdsToFetch.length,
            downloadedBytes,
            uploadedSessionCount: upsertSessions.length,
            uploadedBytes:
              measureJsonBytes(mergedIndex) + measureJsonBytes(upsertSessions),
            deletedSessionCount: 0,
          },
        };
      }

      const localGlobalClearAt = getChatGlobalClearAt(normalizedLocalChatState);
      const remoteGlobalClearAt = getChatGlobalClearAt(
        normalizedRemoteChatState,
      );

      if (remoteGlobalClearAt > localGlobalClearAt) {
        const clearedLocalState = buildClearedChatState(
          normalizedLocalChatState,
          remoteGlobalClearAt,
        );
        const clearedRemoteState = buildClearedChatState(
          normalizedRemoteChatState,
          remoteGlobalClearAt,
        );
        const mergedAfterClear = mergeStoreState(
          StoreKey.Chat,
          clearedLocalState,
          clearedRemoteState,
        );
        const mergedStoreState =
          Array.isArray(mergedAfterClear?.sessions) &&
          mergedAfterClear.sessions.length > 0
            ? mergedAfterClear
            : {
                ...mergedAfterClear,
                sessions: [createEmptySession()],
                currentSessionIndex: 0,
              };
        const mergedIndex = buildUploadChatIndexPayload(
          mergedStoreState,
          remoteEntryMap,
        );
        const allMergedSessionIds = new Set<string>(
          (Array.isArray(mergedStoreState?.sessions)
            ? mergedStoreState.sessions
            : []
          )
            .map((s: any) => String(s?.id || ""))
            .filter(Boolean),
        );
        const uploadableSessionMap =
          buildUploadableChatSessionMap(mergedStoreState);
        const upsertSessions = mergedIndex.sessions
          .filter((entry: ChatIndexSessionEntry) =>
            shouldUploadChatSession(entry, remoteEntryMap.get(entry.id)),
          )
          .map((entry: ChatIndexSessionEntry) =>
            uploadableSessionMap.get(entry.id),
          )
          .filter(Boolean)
          .filter((session: unknown) => !isRemoteSessionPlaceholder(session))
          .map(
            (session: unknown) => session as unknown as Record<string, unknown>,
          );
        const deleteSessionIds = [...remoteEntryMap.keys()].filter(
          (sessionId) =>
            !allMergedSessionIds.has(sessionId) ||
            wasChatSessionDeleted(
              sessionId,
              remoteEntryMap.get(sessionId)?.lastUpdate || 0,
              mergedDeletedSessionTimestamps,
            ),
        );
        const uploadedBytes =
          measureJsonBytes(mergedIndex) + measureJsonBytes(upsertSessions);
        const mergedStoreStateForDisplay = removeChatSessionsFromState(
          mergedStoreState,
          new Set(deleteSessionIds),
        );
        const remoteIndexSessionsForDisplay = (
          (remoteIndex.sessions || []) as ChatIndexSessionEntry[]
        ).filter((entry) => !deleteSessionIds.includes(entry.id));

        if (!downloadOnly && !hasPendingChatRequest) {
          await client.setChatDelta?.(
            {
              index: mergedIndex,
              upsertSessions,
              deleteSessionIds,
            },
            {
              expectedMissing: !chatMeta,
              expectedUpdatedAt: chatMeta?.updatedAt,
              expectedChecksum: chatMeta?.checksum,
            },
          );
        }

        const normalizedMergedStoreState = normalizeMergedChatState(
          prependLeadingEmptySession(
            {
              ...mergedStoreStateForDisplay,
              remoteIndexSessions: remoteIndexSessionsForDisplay,
              deletedSessionTimestamps: mergedDeletedSessionTimestamps,
            },
            localLeadingEmptySession,
            { preferLeadingEmptySession },
          ),
        );

        return {
          remoteSummary: getStoreSummary(StoreKey.Chat, {
            sessions: remoteIndex.sessions || [],
          }),
          mergedStoreState: normalizedMergedStoreState,
          mergedSummary: getStoreSummary(
            StoreKey.Chat,
            normalizedMergedStoreState,
          ),
          status: "merged" as const,
          metrics: {
            downloadedSessionCount: remoteSessionIdsToFetch.length,
            downloadedBytes,
            uploadedSessionCount: hasPendingChatRequest
              ? 0
              : upsertSessions.length,
            uploadedBytes: hasPendingChatRequest ? 0 : uploadedBytes,
            deletedSessionCount: hasPendingChatRequest
              ? 0
              : deleteSessionIds.length,
          },
        };
      }

      const mergedStoreState = mergeStoreState(
        StoreKey.Chat,
        normalizedLocalChatState,
        normalizedRemoteChatState as any,
      );

      // 识别孤儿会话：messages 为空，且本地/远端都没有消息内容。
      // 包含两种情况：
      // 1. 在远端索引有记录但 messageCount=0（曾同步过的空会话）
      // 2. 不在远端索引但在数据库里存在的空会话（通过 deleteSessionIds 清理）
      const mergedSummaryMap = createSessionSummaryMap(mergedStoreState);
      const selectedSessionId = String(
        materializedLocalChatState?.selectedSessionId ||
          materializedLocalChatState?.sessions?.[
            Math.max(
              0,
              Number(materializedLocalChatState?.currentSessionIndex) || 0,
            )
          ]?.id ||
          "",
      );
      const orphanSessionIds = hasPendingChatRequest
        ? new Set<string>()
        : new Set<string>(
            (Array.isArray((mergedStoreState as any)?.sessions)
              ? (mergedStoreState as any).sessions
              : []
            )
              .filter((session: any) => {
                const sessionId = String(session?.id || "");
                if (!sessionId) return false;
                // 当前正在聚焦的会话即使暂时还是空的，也不能在同步里当作孤儿删掉。
                if (sessionId === selectedSessionId) return false;
                const messages = Array.isArray(session?.messages)
                  ? session.messages
                  : [];
                if (messages.length > 0) return false;
                const remoteEntry = remoteEntryMap.get(sessionId);
                const remoteMessageCount = Number(
                  remoteEntry?.messageCount || 0,
                );
                const localSummaryCount = Number(
                  mergedSummaryMap.get(sessionId)?.messageCount || 0,
                );
                // 本地和远端都没有消息内容
                return remoteMessageCount === 0 && localSummaryCount === 0;
              })
              .map((session: any) => String(session.id)),
          );
      if (orphanSessionIds.size > 0) {
        const orphanSessionLabels = [...orphanSessionIds].map((sessionId) => {
          const session = (mergedStoreState as any).sessions?.find(
            (item: any) => String(item?.id || "") === sessionId,
          );
          return formatSyncedSessionLabel(
            sessionId,
            session?.topic || mergedSummaryMap.get(sessionId)?.topic,
          );
        });
        logSyncDebug(
          `[Sync] 🧹 标记远端孤儿会话 ${
            orphanSessionIds.size
          } 个：${formatLimitedSessionLabels(orphanSessionLabels)}`,
        );
      }

      const mergedStoreStateForSync = removeChatSessionsFromState(
        mergedStoreState,
        orphanSessionIds,
      );
      const mergedIndex = buildUploadChatIndexPayload(
        mergedStoreStateForSync as any,
        remoteEntryMap,
      );
      // 删除逻辑需要包含所有会话 ID（含占位符），避免水合失败的远端会话被误删
      const allMergedSessionIds = new Set<string>(
        (Array.isArray((mergedStoreStateForSync as any)?.sessions)
          ? (mergedStoreStateForSync as any).sessions
          : []
        )
          .map((s: any) => String(s?.id || ""))
          .filter(Boolean),
      );
      const uploadableSessionMap = buildUploadableChatSessionMap(
        mergedStoreStateForSync,
      );
      const afterShouldUpload = mergedIndex.sessions.filter(
        (entry: ChatIndexSessionEntry) =>
          shouldUploadChatSession(entry, remoteEntryMap.get(entry.id)),
      );
      const afterMapToSession = afterShouldUpload.map(
        (entry: ChatIndexSessionEntry) => uploadableSessionMap.get(entry.id),
      );
      const afterFilterBoolean = afterMapToSession.filter(Boolean);
      const afterFilterPlaceholder = afterFilterBoolean.filter(
        (session: unknown) => !isRemoteSessionPlaceholder(session),
      );
      const upsertSessions = afterFilterPlaceholder.map(
        (session: unknown) => session as unknown as Record<string, unknown>,
      );
      if (upsertSessions.length === 0 && mergedIndex.sessions.length > 0) {
        logSyncDebug(
          `[Sync] 🔬 过滤链诊断: shouldUpload=${
            afterShouldUpload.length
          }, mapToSession(非null)=${afterMapToSession.filter(Boolean).length}/${
            afterMapToSession.length
          }, filterPlaceholder=${
            afterFilterPlaceholder.length
          }, uploadableMapSize=${uploadableSessionMap.size}`,
        );
        if (
          afterShouldUpload.length > 0 &&
          afterMapToSession.filter(Boolean).length === 0
        ) {
          logSyncDebug(
            `[Sync] 🔬 uploadableMap 缺失的会话:`,
            afterShouldUpload
              .slice(0, 5)
              .map((e: ChatIndexSessionEntry) => e.id),
          );
        }
      }
      const deleteSessionIds = [
        // 远端有但合并后不存在的会话（已删除或孤儿）
        ...[...remoteEntryMap.keys()].filter(
          (sessionId) =>
            !allMergedSessionIds.has(sessionId) ||
            wasChatSessionDeleted(
              sessionId,
              remoteEntryMap.get(sessionId)?.lastUpdate || 0,
              mergedDeletedSessionTimestamps,
            ),
        ),
        // 所有孤儿会话都通知服务端删除（包括不在远端索引里的）
        ...[...orphanSessionIds],
      ];
      const uploadedBytes =
        measureJsonBytes(mergedIndex) + measureJsonBytes(upsertSessions);
      const deletedOrOrphanSessionIds = new Set(deleteSessionIds);
      const remoteIndexSessionsForDisplay = (
        (remoteIndex.sessions || []) as ChatIndexSessionEntry[]
      ).filter((entry) => !deletedOrOrphanSessionIds.has(entry.id));

      logSyncDebug(
        `[Sync] 🔬 上传决策诊断：合并索引会话数=${mergedIndex.sessions.length}，待上传会话数=${upsertSessions.length}，待删除会话数=${deleteSessionIds.length}，远端索引会话数=${remoteEntryMap.size}`,
      );
      if (downloadOnly) {
        logSyncDebug("[Sync] 🔬 跳过上传：当前为仅下载模式");
      } else if (hasPendingChatRequest) {
        syncConsole(
          "warn",
          "[Sync] ⚠️ 跳过上传: hasPendingChatRequest=true（用户正在对话中）",
        );
      } else {
        logSyncDebug(
          `[Sync] 🔬 执行 setChatDelta: 上传 ${upsertSessions.length} 个会话`,
        );
        await client.setChatDelta?.(
          {
            index: mergedIndex,
            upsertSessions,
            deleteSessionIds,
          },
          {
            expectedMissing: !chatMeta,
            expectedUpdatedAt: chatMeta?.updatedAt,
            expectedChecksum: chatMeta?.checksum,
          },
        );
      }

      const normalizedMergedStoreState = normalizeMergedChatState(
        prependLeadingEmptySession(
          {
            ...mergedStoreStateForSync,
            remoteIndexSessions: remoteIndexSessionsForDisplay,
            deletedSessionTimestamps: mergedDeletedSessionTimestamps,
          },
          localLeadingEmptySession,
          { preferLeadingEmptySession },
        ),
      );

      return {
        remoteSummary: getStoreSummary(StoreKey.Chat, {
          sessions: remoteIndex.sessions || [],
        }),
        mergedStoreState: normalizedMergedStoreState,
        mergedSummary: getStoreSummary(
          StoreKey.Chat,
          normalizedMergedStoreState,
        ),
        status: "merged" as const,
        metrics: {
          downloadedSessionCount: remoteSessionIdsToFetch.length,
          downloadedBytes,
          uploadedSessionCount: hasPendingChatRequest
            ? 0
            : upsertSessions.length,
          uploadedBytes: hasPendingChatRequest ? 0 : uploadedBytes,
          deletedSessionCount: hasPendingChatRequest
            ? 0
            : deleteSessionIds.length,
        },
      };
    }

    return {
      cloudSync() {
        return (
          get().provider === ProviderType.Database &&
          !useAuthStore.getState().readOnly
        );
      },

      markSyncTime() {
        set({ lastSyncTime: Date.now(), lastProvider: get().provider });
      },

      export() {
        const state = buildBackupState(getLocalAppState(), get());
        const datePart = isApp
          ? `${new Date().toLocaleDateString().replace(/\//g, "_")} ${new Date()
              .toLocaleTimeString()
              .replace(/:/g, "_")}`
          : new Date().toLocaleString();

        const fileName = `Backup-${datePart}.json`;
        downloadAs(JSON.stringify(state), fileName);
      },

      async import() {
        try {
          const rawContent = await readFromFile();
          const parsedState = JSON.parse(rawContent) as unknown;
          if (!isObjectLike(parsedState)) {
            throw new Error("[Import] 备份文件格式无效");
          }

          const remoteState = parsedState as BackupState;
          const localState = getLocalAppState();
          mergeAppState(localState, remoteState);
          setLocalAppState(localState);

          const importedSyncState = parseSyncBackupState(
            remoteState[StoreKey.Sync],
            get(),
          );
          if (importedSyncState) {
            set(importedSyncState as Partial<SyncStore>);
          }

          location.reload();
        } catch (e) {
          if (
            e instanceof Error &&
            e.message.includes("[File] 用户取消选择文件")
          ) {
            logSyncDebug("[Import] 用户取消选择备份文件");
            return;
          }
          logger.sync.error("[Import]", e);
          showToast(Locale.Settings.Sync.ImportFailed);
        }
      },

      getClient() {
        const provider = get().provider;
        const client = createSyncClient(provider, get());
        return client;
      },

      triggerDebounceSync(
        storeKeys?: SyncStoreKey[],
        options?: { delayMs?: number },
      ) {
        const keysToSync = normalizeSyncKeys(storeKeys);
        const delayMs = Math.max(0, options?.delayMs ?? DEFAULT_DEBOUNCE_DELAY);
        debounceTaskKeys = mergePendingSyncKeys(keysToSync);

        // 清除之前的定时器
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        const MAX_DEBOUNCE_RETRY = 3;
        const DEBOUNCE_RETRY_DELAYS = [2000, 4000, 8000];
        let debounceRetryCount = 0;

        const executeSync = async () => {
          const pendingKeys = normalizeSyncKeys(debounceTaskKeys);
          debounceTaskKeys = [];
          debounceTimer = null;
          clearPendingDebounceTask();

          if (!this.cloudSync()) {
            logSyncDebug("[Sync] 🔕 同步未配置，跳过防抖同步");
            return;
          }

          logSyncDebug("[Sync] 🚀 防抖同步触发", {
            keys: pendingKeys.map((k) => STORE_DISPLAY_NAMES[k]).join(", "),
            retryAttempt:
              debounceRetryCount > 0 ? debounceRetryCount : undefined,
          });

          try {
            await this.sync(pendingKeys);
            debounceRetryCount = 0;
          } catch (error) {
            debounceRetryCount += 1;
            if (debounceRetryCount <= MAX_DEBOUNCE_RETRY) {
              const retryDelay = DEBOUNCE_RETRY_DELAYS[debounceRetryCount - 1];
              logger.sync.error(
                `[Sync] ❌ 防抖同步失败，${retryDelay}ms 后重试 (${debounceRetryCount}/${MAX_DEBOUNCE_RETRY}):`,
                error,
              );
              debounceTaskKeys = mergePendingSyncKeys(pendingKeys);
              debounceTimer = setTimeout(executeSync, retryDelay);
              writePendingDebounceTask({
                keys: debounceTaskKeys,
                scheduledAt: Date.now() + retryDelay,
              });
            } else {
              logger.sync.error(
                `[Sync] ❌ 防抖同步已耗尽重试 (${MAX_DEBOUNCE_RETRY} 次):`,
                error,
              );
              debounceRetryCount = 0;
              writePendingDebounceTask({
                keys: pendingKeys,
                scheduledAt: Date.now(),
              });
            }
          }
        };

        // 设置新的防抖定时器
        debounceTimer = setTimeout(executeSync, delayMs);

        writePendingDebounceTask({
          keys: debounceTaskKeys,
          scheduledAt: Date.now() + delayMs,
        });
      },

      flushPendingDebounceSync(storeKeys?: SyncStoreKey[]) {
        const extraKeys = Array.isArray(storeKeys)
          ? normalizeSyncKeys(storeKeys)
          : [];
        const pendingKeys = mergePendingSyncKeys(extraKeys);
        if (pendingKeys.length === 0) {
          return false;
        }

        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }

        debounceTaskKeys = pendingKeys;
        writePendingDebounceTask({
          keys: pendingKeys,
          scheduledAt: Date.now(),
        });
        return true;
      },

      cancelQueuedAutoSync() {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        debounceTaskKeys = [];
        queuedSyncKeys = new Set<SyncStoreKey>();
        clearPendingDebounceTask();
        logSyncDebug("[Sync] ⏹️ 已取消排队中的自动同步任务");
      },

      async resumePendingDebounceSync(options?: {
        excludeKeys?: SyncStoreKey[];
      }) {
        if (useAuthStore.getState().readOnly) {
          logSyncDebug("[Sync] 🔕 当前为只读查看模式，跳过恢复未完成同步");
          clearPendingDebounceTask();
          return false;
        }

        const pendingTask = readPendingDebounceTask();
        if (!pendingTask) {
          return false;
        }

        const excludedKeys = new Set(options?.excludeKeys || []);
        const resumedKeys = pendingTask.keys.filter(
          (key) => !excludedKeys.has(key),
        );

        if (resumedKeys.length === 0) {
          clearPendingDebounceTask();
          return false;
        }

        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }

        logSyncDebug("[Sync] ♻️ 恢复未完成的防抖同步", {
          keys: resumedKeys.map((k) => STORE_DISPLAY_NAMES[k]).join(", "),
        });

        clearPendingDebounceTask();

        try {
          await this.sync(resumedKeys);
          return true;
        } catch (error) {
          logger.sync.error("[Sync] ❌ 恢复防抖同步失败:", error);
          writePendingDebounceTask({
            keys: resumedKeys,
            scheduledAt: Date.now(),
          });
          throw error;
        }
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

      async sync(
        storeKeys: SyncStoreKey[] = [...SYNC_STORE_KEYS],
        options?: {
          isolateQueue?: boolean;
          force?: boolean;
          broadcastChatHint?: boolean;
          downloadOnlyChat?: boolean;
          skipChatWriteBack?: boolean;
          silentSummary?: boolean;
          manual?: boolean;
        },
      ): Promise<void> {
        if (useAuthStore.getState().readOnly && !options?.downloadOnlyChat) {
          logSyncDebug("[Sync] 🔕 当前为只读查看模式，跳过同步请求");
          return;
        }

        const normalizedStoreKeys = normalizeSyncKeys(storeKeys);
        if (
          !options?.force &&
          normalizedStoreKeys.length === 1 &&
          normalizedStoreKeys[0] === StoreKey.Chat &&
          Date.now() - lastChatSyncCompletedAt < CHAT_SYNC_COOLDOWN_MS
        ) {
          logSyncDebug("[Sync] ⏭️ 会话同步冷却中，跳过重复请求", {
            cooldownMs: CHAT_SYNC_COOLDOWN_MS,
          });
          return;
        }
        if (options?.manual) {
          queuedSyncKeys = new Set<SyncStoreKey>();
          if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          }
          debounceTaskKeys = [];
          clearPendingDebounceTask();
        }

        const targetQueue =
          options?.isolateQueue || options?.manual
            ? new Set<SyncStoreKey>(normalizedStoreKeys)
            : queuedSyncKeys;
        normalizedStoreKeys.forEach((key) => targetQueue.add(key));

        if (syncInFlight) {
          if (options?.manual && !syncInFlightManual) {
            syncConsole(
              "log",
              "[Sync] ⏹️ 保存并同步已接管，正在跳过已有自动同步等待",
            );
            syncInFlight = null;
          } else {
            if (options?.isolateQueue) {
              logSyncDebug(
                "[Sync] ⏳ 已有同步进行中，本次隔离同步等待当前任务结束",
                {
                  keys: normalizedStoreKeys
                    .map((k) => STORE_DISPLAY_NAMES[k])
                    .join(", "),
                },
              );
            }
            logSyncDebug(
              "[Sync] ⏳ 已有同步进行中，已合并到队列等待当前任务完成",
              {
                keys: normalizedStoreKeys
                  .map((k) => STORE_DISPLAY_NAMES[k])
                  .join(", "),
              },
            );
            await syncInFlight;
            if (options?.isolateQueue) {
              return this.sync(normalizedStoreKeys, options);
            }
            return;
          }
        }

        const currentSync = (async () => {
          syncInFlightManual = options?.manual === true;
          const isolatedQueue =
            options?.isolateQueue || options?.manual ? targetQueue : null;
          const startedManualGeneration = getManualDatabaseSyncGeneration();

          while ((isolatedQueue ?? queuedSyncKeys).size > 0) {
            if (
              shouldStopAutoSyncForManualSync(options, startedManualGeneration)
            ) {
              syncConsole("log", "[Sync] ⏹️ 检测到保存并同步，自动同步已终止");
              break;
            }
            const currentStoreKeys = [...(isolatedQueue ?? queuedSyncKeys)];
            if (isolatedQueue) {
              isolatedQueue.clear();
            } else {
              queuedSyncKeys = new Set<SyncStoreKey>();
            }

            const state = getNonFunctionFileds(this) as SyncStore;
            const providerName =
              state.provider === ProviderType.Database
                ? "PostgreSQL 数据库"
                : "云端存储";
            logSyncDebug(`[Sync] 🔄 开始同步到 ${providerName}...`);

            const client = this.getClient() as any;
            const getMetaStartedAt = nowMs();
            const shouldPreFetchChatIndex =
              currentStoreKeys.includes(StoreKey.Chat) &&
              typeof client.getChatIndex === "function";

            const [initialMetas, preFetchedChatIndex] = await Promise.all([
              typeof client.getMeta === "function" &&
              currentStoreKeys.length > 0
                ? client.getMeta(currentStoreKeys)
                : Promise.resolve([]),
              shouldPreFetchChatIndex
                ? client.getChatIndex()
                : Promise.resolve(undefined),
            ]);

            let remoteMetaMap = buildMetaMap(initialMetas);
            logPerfSummary("Sync", {
              selectedKeys: currentStoreKeys,
              getMetaDurationMs: Number(
                (nowMs() - getMetaStartedAt).toFixed(2),
              ),
              preFetchedChatIndex: !!preFetchedChatIndex,
            });

            logSyncDebug(
              `[Sync] 📋 准备同步 ${currentStoreKeys.length} 个数据块`,
            );

            const localAppStateCache = {
              ...getLocalAppState(),
            } as { [K in SyncStoreKey]: AppState[K] };

            const syncRegularStore = async (
              key: SyncStoreKey,
              displayName: string,
              stepLabel: string,
            ) => {
              const isRetryableError = (error: unknown) =>
                error instanceof Error &&
                (RETRYABLE_DB_SYNC_ERROR.test(error.message) ||
                  RETRYABLE_NETWORK_ERROR.test(error.message));
              const fallbackToLatestRemote = async () => {
                const latestRemoteDataText = await withRetry<string>(
                  () => client.get(key),
                  {
                    retries: 1,
                    retryable: isRetryableError,
                  },
                );
                const latestRemoteState = latestRemoteDataText
                  ? parseStoreStatePayload(latestRemoteDataText)
                  : localAppStateCache[key];
                const resolvedStoreState = mergeStoreState(
                  key,
                  localAppStateCache[key],
                  latestRemoteState,
                );

                setLocalStoreState(key, resolvedStoreState);
                localAppStateCache[key] = resolvedStoreState;
                const modelDiffs =
                  key === StoreKey.Config
                    ? captureCustomModelSyncDiff(resolvedStoreState)
                    : undefined;
                if (key === StoreKey.Config) {
                  saveCustomModelSnapshotAfterSync(resolvedStoreState);
                  applySyncedModelSelectionToAccess(resolvedStoreState);
                  syncModelSelectionToLocalStorage(resolvedStoreState);
                }

                return {
                  summary: getStoreSummary(key, resolvedStoreState),
                  status: "merged" as const,
                  remoteSummary: getStoreSummary(key, latestRemoteState),
                  modelDiffs,
                };
              };

              for (let attempt = 0; attempt < 2; attempt += 1) {
                const getPayloadStartedAt = nowMs();
                const remoteDataText = await withRetry<string>(
                  () => client.get(key),
                  {
                    retries: 1,
                    retryable: isRetryableError,
                    onRetry: (retryAttempt, error) => {
                      warnSyncDebug(
                        `[Sync] ⚠️ [${stepLabel}] ${displayName}读取失败，准备第 ${retryAttempt} 次重试:`,
                        error,
                      );
                    },
                  },
                );
                const getPayloadDurationMs = nowMs() - getPayloadStartedAt;

                const currentMeta = remoteMetaMap.get(key);
                if (!remoteDataText || remoteDataText === "") {
                  if (key === StoreKey.Config) {
                    console.log(
                      `[Sync] 🔍 Config远端为空，上传本地状态` +
                        ` | hasMeta=${!!currentMeta}` +
                        ` | localModel=${(localAppStateCache[key] as any)
                          ?.modelConfig?.model}` +
                        ` | localCustomModels=${String(
                          (localAppStateCache[key] as any)?.customModels || "",
                        ).slice(0, 60)}`,
                    );
                  }
                  const localStoreState = localAppStateCache[key];
                  const localStoreStateToPersist =
                    key === StoreKey.Config
                      ? stripConfigLocalModelFields(localStoreState as any)
                      : localStoreState;
                  const stringifyStartedAt = nowMs();
                  const payloadText = stringifyPersistedStoreState(
                    key,
                    localStoreStateToPersist,
                  );
                  const stringifyDurationMs = nowMs() - stringifyStartedAt;
                  try {
                    const modelDiffs =
                      key === StoreKey.Config
                        ? captureCustomModelSyncDiff(localStoreState)
                        : undefined;
                    const writeBackStartedAt = nowMs();
                    await client.set(key, payloadText, {
                      expectedMissing: !currentMeta,
                      expectedUpdatedAt: currentMeta?.updatedAt,
                      expectedChecksum: currentMeta?.checksum,
                    });
                    logPerfSummary("Sync", {
                      key,
                      getPayloadDurationMs: Number(
                        getPayloadDurationMs.toFixed(2),
                      ),
                      stringifyDurationMs: Number(
                        stringifyDurationMs.toFixed(2),
                      ),
                      writeBackDurationMs: Number(
                        (nowMs() - writeBackStartedAt).toFixed(2),
                      ),
                      payloadBytes: payloadText.length,
                    });
                    if (key === StoreKey.Config) {
                      saveCustomModelSnapshotAfterSync(localStoreState);
                    }
                    return {
                      summary: getStoreSummary(key, localStoreState),
                      status: "uploaded" as const,
                      modelDiffs,
                    };
                  } catch (error) {
                    if (
                      attempt === 0 &&
                      error instanceof Error &&
                      /\[DB Sync\] 409\b/.test(error.message) &&
                      typeof client.getMeta === "function"
                    ) {
                      const latestMetas = await client.getMeta([key]);
                      remoteMetaMap = buildMetaMap([
                        ...Array.from(remoteMetaMap.values()).filter(
                          (meta) => meta.key !== key,
                        ),
                        ...latestMetas,
                      ]);
                      continue;
                    }
                    if (
                      error instanceof Error &&
                      /\[DB Sync\] 409\b/.test(error.message)
                    ) {
                      logSyncDebug(
                        `[Sync] ⚠️ [${stepLabel}] ${displayName}发生重复冲突，回退到最新云端数据`,
                      );
                      return fallbackToLatestRemote();
                    }
                    throw error;
                  }

                  continue;
                }

                const parseStartedAt = nowMs();
                const parsedRemoteState =
                  parseStoreStatePayload(remoteDataText);
                const parseDurationMs = nowMs() - parseStartedAt;
                const mergeStartedAt = nowMs();
                const mergedStoreState = mergeStoreState(
                  key,
                  localAppStateCache[key],
                  parsedRemoteState,
                );
                const mergeDurationMs = nowMs() - mergeStartedAt;

                setLocalStoreState(key, mergedStoreState);
                localAppStateCache[key] = mergedStoreState;

                const mergedStoreStateToPersist =
                  key === StoreKey.Config
                    ? stripConfigLocalModelFields(mergedStoreState as any)
                    : mergedStoreState;
                const stringifyStartedAt = nowMs();
                const payloadText = stringifyPersistedStoreState(
                  key,
                  mergedStoreStateToPersist,
                );
                const stringifyDurationMs = nowMs() - stringifyStartedAt;
                try {
                  const modelDiffs =
                    key === StoreKey.Config
                      ? captureCustomModelSyncDiff(
                          mergedStoreState,
                          parsedRemoteState,
                        )
                      : undefined;
                  const writeBackStartedAt = nowMs();
                  await client.set(key, payloadText, {
                    expectedMissing: !currentMeta,
                    expectedUpdatedAt: currentMeta?.updatedAt,
                    expectedChecksum: currentMeta?.checksum,
                  });
                  logPerfSummary("Sync", {
                    key,
                    getPayloadDurationMs: Number(
                      getPayloadDurationMs.toFixed(2),
                    ),
                    parseDurationMs: Number(parseDurationMs.toFixed(2)),
                    mergeDurationMs: Number(mergeDurationMs.toFixed(2)),
                    stringifyDurationMs: Number(stringifyDurationMs.toFixed(2)),
                    writeBackDurationMs: Number(
                      (nowMs() - writeBackStartedAt).toFixed(2),
                    ),
                    payloadBytes: remoteDataText.length,
                  });
                  if (key === StoreKey.Config) {
                    saveCustomModelSnapshotAfterSync(mergedStoreState);
                    applySyncedModelSelectionToAccess(mergedStoreState);
                    syncModelSelectionToLocalStorage(mergedStoreState);
                  }
                  return {
                    summary: getStoreSummary(key, mergedStoreState),
                    status: "merged" as const,
                    remoteSummary: getStoreSummary(key, parsedRemoteState),
                    modelDiffs,
                  };
                } catch (error) {
                  if (
                    attempt === 0 &&
                    error instanceof Error &&
                    /\[DB Sync\] 409\b/.test(error.message) &&
                    typeof client.getMeta === "function"
                  ) {
                    const latestMetas = await client.getMeta([key]);
                    remoteMetaMap = buildMetaMap([
                      ...Array.from(remoteMetaMap.values()).filter(
                        (meta) => meta.key !== key,
                      ),
                      ...latestMetas,
                    ]);
                    continue;
                  }
                  if (
                    error instanceof Error &&
                    /\[DB Sync\] 409\b/.test(error.message)
                  ) {
                    logSyncDebug(
                      `[Sync] ⚠️ [${stepLabel}] ${displayName}发生重复冲突，回退到最新云端数据`,
                    );
                    return fallbackToLatestRemote();
                  }
                  throw error;
                }

                continue;
              }

              throw new Error(`[Sync] ${displayName}冲突重试失败`);
            };

            let chatSyncRetryCount = 0;
            const syncChatStoreWithRetry = async (
              localStoreState: AppState[typeof StoreKey.Chat],
              options?: {
                downloadOnly?: boolean;
                remoteIndex?: any;
              },
            ) => {
              for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                  const retryOptions = { ...options };
                  if (attempt > 0) {
                    retryOptions.remoteIndex = undefined;
                  }
                  if (attempt >= 2) {
                    retryOptions.downloadOnly = true;
                  }
                  return await syncChatStore(
                    client,
                    localStoreState,
                    remoteMetaMap.get(StoreKey.Chat),
                    retryOptions,
                  );
                } catch (error) {
                  if (
                    error instanceof Error &&
                    /\[DB Sync\] 409\b/.test(error.message) &&
                    typeof client.getMeta === "function"
                  ) {
                    if (attempt === 0) {
                      syncConsole(
                        "log",
                        "[Sync] ⚠️ 检测到 409 冲突，正在获取最新元数据重试...",
                      );
                    }
                    const latestMetas = await client.getMeta([StoreKey.Chat]);
                    remoteMetaMap = buildMetaMap([
                      ...Array.from(remoteMetaMap.values()).filter(
                        (meta) => meta.key !== StoreKey.Chat,
                      ),
                      ...latestMetas,
                    ]);
                    chatSyncRetryCount += 1;
                    const backoffMs = Math.min(
                      300 * Math.pow(2, chatSyncRetryCount - 1) +
                        Math.random() * 200,
                      3000,
                    );
                    if (attempt < 2) {
                      syncConsole(
                        "log",
                        `[Sync] 🔄 ${backoffMs}ms 后使用最新元数据重试同步 (${
                          attempt + 1
                        }/3)`,
                      );
                      await new Promise((resolve) =>
                        setTimeout(resolve, backoffMs),
                      );
                      continue;
                    }

                    syncConsole(
                      "log",
                      "[Sync] ℹ️ 会话发生持续冲突，回退为只读拉取远端最新数据",
                    );
                    return await syncChatStore(
                      client,
                      localStoreState,
                      remoteMetaMap.get(StoreKey.Chat),
                      {
                        ...options,
                        downloadOnly: true,
                        remoteIndex: undefined,
                      },
                    );
                  }
                  throw error;
                }
              }

              syncConsole(
                "log",
                "[Sync] ℹ️ 会话冲突重试已耗尽，最终以只读模式拉取",
              );
              return await syncChatStore(
                client,
                localStoreState,
                remoteMetaMap.get(StoreKey.Chat),
                {
                  ...options,
                  downloadOnly: true,
                  remoteIndex: undefined,
                },
              );
            };

            try {
              const syncResults: Array<{
                key: SyncStoreKey;
                name: string;
                summary: string;
                status: "downloaded" | "uploaded" | "merged" | "skipped";
                remoteSummary?: string;
              }> = [];
              const failedKeys: Array<{
                key: SyncStoreKey;
                name: string;
                error: unknown;
              }> = [];

              for (const [index, key] of currentStoreKeys.entries()) {
                if (
                  shouldStopAutoSyncForManualSync(
                    options,
                    startedManualGeneration,
                  )
                ) {
                  syncConsole(
                    "log",
                    "[Sync] ⏹️ 检测到保存并同步，自动同步剩余部分已终止",
                  );
                  break;
                }

                try {
                  const displayName = STORE_DISPLAY_NAMES[key];
                  const stepLabel = `${index + 1}/${currentStoreKeys.length}`;
                  const keySyncStartedAt = nowMs();
                  if (
                    !options?.force &&
                    key === StoreKey.Chat &&
                    Date.now() - lastChatSyncCompletedAt < CHAT_SYNC_COOLDOWN_MS
                  ) {
                    logSyncDebug(
                      `[Sync] ⏭️ [${stepLabel}] ${displayName}冷却中，跳过队列内重复同步`,
                      {
                        cooldownMs: CHAT_SYNC_COOLDOWN_MS,
                      },
                    );
                    continue;
                  }
                  logSyncSectionTitle(`${displayName}同步`);
                  if (key === StoreKey.Config) {
                    syncConsole(
                      "log",
                      `[Sync] 📋 [${stepLabel}] 正在同步模型...`,
                    );
                    syncConsole(
                      "log",
                      `[Sync] 📋 [${stepLabel}] 正在同步设置...`,
                    );
                  } else {
                    syncConsole(
                      "log",
                      `[Sync] 📋 [${stepLabel}] 正在同步${displayName}...`,
                    );
                  }
                  const localStoreState = localAppStateCache[key];

                  if (
                    !options?.force &&
                    shouldSkipSyncByChecksum({
                      key,
                      localStoreState,
                      remoteMetaMap,
                      databaseCacheMeta: get().database.cacheMeta,
                      lastSyncTime: get().lastSyncTime,
                    })
                  ) {
                    syncConsole(
                      "log",
                      `[Sync] ⏭️ [${stepLabel}] ${displayName}跳过: 远端元数据未变化，跳过同步`,
                    );
                    syncResults.push({
                      key,
                      name: displayName,
                      summary: "远端元数据未变化，跳过同步",
                      status: "skipped",
                    });
                    logPerfSummary("Sync", {
                      key,
                      skippedByChecksumCount: 1,
                      durationMs: Number(
                        (nowMs() - keySyncStartedAt).toFixed(2),
                      ),
                    });
                    continue;
                  }

                  if (
                    key === StoreKey.Chat &&
                    typeof client.getChatIndex === "function" &&
                    typeof client.getChatSessions === "function" &&
                    typeof client.setChatDelta === "function"
                  ) {
                    const chatResult = await syncChatStoreWithRetry(
                      localStoreState as AppState[typeof StoreKey.Chat],
                      {
                        downloadOnly: options?.downloadOnlyChat === true,
                        remoteIndex: preFetchedChatIndex,
                      },
                    );
                    syncConsole(
                      "log",
                      `[Sync] ✅ [${stepLabel}] ${displayName}同步完成: ${chatResult.remoteSummary}`,
                    );

                    const appliedChatState = rebaseChatSyncResultOnLiveState(
                      chatResult.mergedStoreState,
                      localStoreState,
                    );
                    syncResults.push({
                      key,
                      name: displayName,
                      summary: getStoreSummary(StoreKey.Chat, appliedChatState),
                      status: chatResult.status,
                      remoteSummary: chatResult.remoteSummary,
                    });

                    if (options?.downloadOnlyChat !== true) {
                      try {
                        const latestRemoteIndex = await client.getChatIndex();
                        const localSyncableCount = buildChatIndexPayload(
                          chatResult.mergedStoreState as any,
                        ).sessions.length;
                        const remoteSyncableCount = Array.isArray(
                          latestRemoteIndex?.sessions,
                        )
                          ? latestRemoteIndex.sessions.length
                          : 0;

                        if (localSyncableCount !== remoteSyncableCount) {
                          syncConsole(
                            "warn",
                            `[Sync] ⚠️ 会话上传后复核不一致: 本地可同步 ${localSyncableCount} 个，远端 ${remoteSyncableCount} 个`,
                          );
                        }
                      } catch (verifyError) {
                        syncConsole(
                          "warn",
                          "[Sync] ⚠️ 会话上传后复核失败:",
                          verifyError,
                        );
                      }
                    }

                    logSyncDebug(
                      `[Sync] 📦 [${stepLabel}] ${displayName}分片统计:`,
                      {
                        下载会话数: chatResult.metrics.downloadedSessionCount,
                        下载体积: formatBytes(
                          chatResult.metrics.downloadedBytes,
                        ),
                        上传会话数: chatResult.metrics.uploadedSessionCount,
                        上传体积: formatBytes(chatResult.metrics.uploadedBytes),
                        删除会话数: chatResult.metrics.deletedSessionCount,
                      },
                    );

                    if (ChatControllerPool.hasPending()) {
                      syncConsole(
                        "warn",
                        "[Sync] ⚠️ 跳过会话写回: hasPendingChatRequest=true（用户正在对话中）",
                      );
                      continue;
                    }

                    if (isChatDeleteUiGuardActive()) {
                      syncConsole(
                        "log",
                        "[Sync] ⏭️ 跳过会话写回: deleteUiGuardActive=true（删除后保持当前 UI）",
                      );
                      continue;
                    }

                    if (options?.skipChatWriteBack === true) {
                      syncConsole(
                        "log",
                        "[Sync] ⏭️ 跳过会话写回: skipChatWriteBack=true（保留当前本地列表）",
                      );
                      continue;
                    }

                    setLocalStoreState(key, appliedChatState as any);
                    localAppStateCache[key] = appliedChatState as any;
                    logPerfSummary("Sync", {
                      key,
                      durationMs: Number(
                        (nowMs() - keySyncStartedAt).toFixed(2),
                      ),
                      downloadedSessionCount:
                        chatResult.metrics.downloadedSessionCount,
                      uploadedSessionCount:
                        chatResult.metrics.uploadedSessionCount,
                    });
                    continue;
                  }

                  const regularResult = await syncRegularStore(
                    key,
                    displayName,
                    stepLabel,
                  );
                  if (regularResult.status === "merged") {
                    if (key === StoreKey.Config) {
                      syncConsole(
                        "log",
                        `[Sync] ✅ [${stepLabel}] 模型同步完成: 远端 ${regularResult.remoteSummary}`,
                      );
                      syncConsole(
                        "log",
                        `[Sync] ✅ [${stepLabel}] 设置同步完成`,
                      );
                    } else if (key === StoreKey.Access) {
                      logAccessProfileSyncSummary(localAppStateCache[key]);
                    } else {
                      syncConsole(
                        "log",
                        `[Sync] ✅ [${stepLabel}] ${displayName}同步完成: 远端 ${regularResult.remoteSummary}`,
                      );
                    }
                    logSyncDebug(LOG_SEPARATOR);
                  } else {
                    if (key === StoreKey.Config) {
                      syncConsole(
                        "log",
                        `[Sync] ✅ [${stepLabel}] 模型同步完成: ${regularResult.summary}`,
                      );
                      syncConsole(
                        "log",
                        `[Sync] ✅ [${stepLabel}] 设置同步完成`,
                      );
                    } else if (key === StoreKey.Access) {
                      logAccessProfileSyncSummary(localAppStateCache[key]);
                    } else {
                      syncConsole(
                        "log",
                        `[Sync] ✅ [${stepLabel}] ${displayName}同步完成: ${regularResult.summary}`,
                      );
                    }
                  }
                  syncResults.push({
                    key,
                    name: displayName,
                    summary: regularResult.summary,
                    status: regularResult.status,
                    remoteSummary:
                      "remoteSummary" in regularResult
                        ? regularResult.remoteSummary
                        : undefined,
                  });
                  logPerfSummary("Sync", {
                    key,
                    durationMs: Number((nowMs() - keySyncStartedAt).toFixed(2)),
                    status: regularResult.status,
                  });
                } catch (e) {
                  failedKeys.push({
                    key,
                    name: STORE_DISPLAY_NAMES[key],
                    error: e,
                  });
                  logger.sync.error(
                    `[Sync] ❌ [${index + 1}/${currentStoreKeys.length}] ${
                      STORE_DISPLAY_NAMES[key]
                    }同步失败:`,
                    e,
                  );
                }
              }

              if (
                shouldStopAutoSyncForManualSync(
                  options,
                  startedManualGeneration,
                )
              ) {
                syncConsole(
                  "log",
                  "[Sync] ⏹️ 保存并同步已接管，自动同步收尾已跳过",
                );
                continue;
              }

              logSyncDebug("[Sync] 📊 数据同步汇总");
              syncResults.forEach((item) => {
                logSyncDebug(`[Sync] - ${item.name}: ${item.summary}`);
              });
              const shouldLogOverallSummary = !(
                options?.silentSummary ||
                (currentStoreKeys.length === 1 &&
                  currentStoreKeys[0] === StoreKey.Chat)
              );
              if (shouldLogOverallSummary) {
                logOverallSyncSummary(syncResults);
              }

              if (failedKeys.length > 0) {
                const failedSummary = failedKeys
                  .map(
                    (item) =>
                      `${item.name}: ${
                        item.error instanceof Error
                          ? item.error.message
                          : String(item.error)
                      }`,
                  )
                  .join(" | ");
                syncConsole(
                  "error",
                  `[Sync] ❌ 本次同步存在失败项: ${failedSummary}`,
                );
                // 不再抛出异常，已成功的 store 数据仍然生效
              }

              logSyncDebug("[Sync] ✅ 同步完成");
              logSyncDebug(LOG_SEPARATOR);

              if (
                typeof client.getMeta === "function" &&
                currentStoreKeys.length > 0
              ) {
                try {
                  logSyncSectionTitle("刷新同步元数据");
                  const latestMetas = await client.getMeta(currentStoreKeys, {
                    timeoutMs: 20000,
                    retries: 0,
                  });
                  this.updateDatabaseMeta(latestMetas);
                  syncConsole("log", "[Sync] ✅ 同步元数据刷新完成");
                } catch (metaError) {
                  syncConsole(
                    "warn",
                    "[Sync] ⚠️ 同步主体已完成，刷新元数据超时或失败，已跳过本次元数据刷新:",
                    metaError,
                  );
                }
              }

              if (
                currentStoreKeys.length === 1 &&
                currentStoreKeys[0] === StoreKey.Chat
              ) {
                lastChatSyncCompletedAt = Date.now();
                if (options?.broadcastChatHint !== false) {
                  emitChatSyncHint();
                }
              }
            } catch (e) {
              syncConsole("error", "[Sync] ❌ 同步失败:", e);
              throw e;
            }

            this.markSyncTime();
          }
        })();
        syncInFlight = currentSync;

        try {
          await currentSync;
        } finally {
          if (syncInFlight === currentSync) {
            syncInFlight = null;
            syncInFlightManual = false;
          }
        }
      },

      async autoSync() {
        if (useAuthStore.getState().readOnly) {
          logSyncDebug("[Sync] 🔕 当前为只读查看模式，跳过自动同步");
          return;
        }
        if (isManualDatabaseSyncActive()) {
          logSyncDebug("[Sync] ⏹️ 保存并同步进行中，跳过自动同步");
          return;
        }

        await this.autoSyncCritical();
        await this.autoSyncDeferred();
      },

      async autoSyncCritical() {
        if (useAuthStore.getState().readOnly) {
          logSyncDebug("[Sync] 🔕 当前为只读查看模式，跳过关键自动同步");
          set({
            criticalSyncReady: true,
            criticalSyncInProgress: false,
          });
          return;
        }
        if (isManualDatabaseSyncActive()) {
          logSyncDebug("[Sync] ⏹️ 保存并同步进行中，跳过关键自动同步");
          set({
            criticalSyncReady: true,
            criticalSyncInProgress: false,
          });
          return;
        }

        set({
          criticalSyncReady: false,
          criticalSyncInProgress: true,
        });

        try {
          // 首屏只等待模型选择和用户已添加模型，完成后立即允许对话。
          // API 配置在后台同步（autoSyncDeferred），不阻塞对话。
          await this.sync([StoreKey.Config], {
            isolateQueue: true,
            force: true,
            broadcastChatHint: false,
          });
          warnMissingRecoveredApiKey();
        } catch (error) {
          syncConsole("error", "[Sync] ❌ 关键数据同步失败:", error);
        } finally {
          // 同步完成后立即解除阻塞，无论成功与否
          set({
            criticalSyncReady: true,
            criticalSyncInProgress: false,
          });
        }
      },

      async syncChatIfRemoteChanged(options?: {
        minIntervalMs?: number;
        source?: string;
      }) {
        if (useAuthStore.getState().readOnly) {
          logSyncDebug("[Sync] 🔕 当前为只读查看模式，尝试 downloadOnly 拉取");
          try {
            await this.sync([StoreKey.Chat], {
              isolateQueue: true,
              force: true,
              downloadOnlyChat: true,
            });
          } catch {
            return false;
          }
          return true;
        }

        const now = Date.now();
        const minIntervalMs = Math.max(0, options?.minIntervalMs ?? 1500);
        if (now - lastRemoteChatMetaCheckAt < minIntervalMs) {
          logSyncDebug("[Sync] ⏭️ 远端聊天元数据检查冷却中，跳过", {
            minIntervalMs,
            source: options?.source || "unknown",
          });
          return false;
        }
        lastRemoteChatMetaCheckAt = now;

        const isRetryable = (error: unknown) =>
          error instanceof Error &&
          (RETRYABLE_DB_SYNC_ERROR.test(error.message) ||
            RETRYABLE_NETWORK_ERROR.test(error.message));

        try {
          const { updatedAt } = await withRetry(
            async () => {
              const resp = await fetch("/api/db/chat-updated-at", {
                method: "GET",
                cache: "no-store",
                credentials: "same-origin",
              });
              if (!resp.ok) {
                if (resp.status >= 500 || resp.status === 408) {
                  throw new Error(
                    `[DB Sync] ${resp.status} chat-updated-at 请求失败`,
                  );
                }
                return { updatedAt: null };
              }
              const data = await resp.json();
              if (!data?.ok || !data.updatedAt) {
                return { updatedAt: null };
              }
              return { updatedAt: data.updatedAt as string };
            },
            {
              retries: 3,
              retryable: isRetryable,
              onRetry: (attempt, error) => {
                logSyncDebug(
                  `[Sync] ⚠️ 远端聊天元数据检查重试 ${attempt}/3:`,
                  error,
                );
              },
            },
          );

          if (!updatedAt) {
            return false;
          }

          const cachedMeta = get().database.cacheMeta[StoreKey.Chat];
          const hasChanged = !cachedMeta || cachedMeta.updatedAt !== updatedAt;

          if (!hasChanged) {
            logSyncDebug("[Sync] ⏭️ 远端聊天未变化，跳过差异拉取", {
              source: options?.source || "unknown",
            });
            if (cachedMeta) {
              set((state) => ({
                database: {
                  ...state.database,
                  cacheMeta: {
                    ...state.database.cacheMeta,
                    [StoreKey.Chat]: {
                      ...cachedMeta,
                      updatedAt,
                    },
                  },
                },
              }));
            }
            return false;
          }

          syncConsole("log", "[Sync] 🔄 检测到远端聊天变更，开始拉取", {
            source: options?.source || "unknown",
          });

          await withRetry(
            () =>
              this.sync([StoreKey.Chat], {
                isolateQueue: true,
                force: true,
                broadcastChatHint: false,
                downloadOnlyChat: true,
              }),
            {
              retries: 2,
              retryable: isRetryable,
              onRetry: (attempt, error) => {
                syncConsole(
                  "log",
                  `[Sync] ⚠️ 远端聊天数据拉取重试 ${attempt}/2:`,
                  error,
                );
              },
            },
          );
          return true;
        } catch (error) {
          syncConsole(
            "error",
            "[Sync] ❌ 远端聊天检查失败（已耗尽重试）:",
            error,
          );
          return false;
        }
      },

      async autoSyncDeferred(options?: { includeChat?: boolean }) {
        if (useAuthStore.getState().readOnly) {
          logSyncDebug("[Sync] 🔕 当前为只读查看模式，跳过延后自动同步");
          return;
        }
        if (isManualDatabaseSyncActive()) {
          logSyncDebug("[Sync] ⏹️ 保存并同步进行中，跳过延后自动同步");
          return;
        }

        const includeChat = options?.includeChat ?? true;
        const remainingKeys = AUTO_SYNC_STORE_KEYS.filter(
          (key) =>
            key !== StoreKey.Config && (includeChat || key !== StoreKey.Chat),
        );
        if (remainingKeys.length > 0) {
          await this.sync(remainingKeys, { isolateQueue: true });
        }
      },

      async syncModels() {
        if (useAuthStore.getState().readOnly) {
          logSyncDebug("[Sync] 🔕 当前为只读查看模式，跳过模型同步");
          return;
        }

        set({ criticalSyncReady: false, criticalSyncInProgress: true });

        try {
          const configState = useAppConfig.getState() as any;
          const beforeModel = String(configState.modelConfig?.model || "");
          const beforeProviderId = String(
            configState.modelConfig?.providerId || "",
          );
          const beforeCustomModels = String(configState.customModels || "");
          const beforeCount = countCustomModelEntries(beforeCustomModels);

          console.log(
            `[Sync] 🧩 模型同步开始: 当前 ${beforeModel}@${beforeProviderId.replace(
              /^custom_/,
              "",
            )}, customModels=${beforeCount}个`,
          );

          await this.sync([...MODEL_SYNC_STORE_KEYS], { force: true });

          const afterConfigState = useAppConfig.getState() as any;
          const afterModel = String(afterConfigState.modelConfig?.model || "");
          const afterProviderId = String(
            afterConfigState.modelConfig?.providerId || "",
          );
          const afterCustomModels = String(afterConfigState.customModels || "");
          const afterCount = countCustomModelEntries(afterCustomModels);

          const modelChanged =
            beforeModel !== afterModel || beforeProviderId !== afterProviderId;
          if (modelChanged) {
            console.log(
              `[Sync] 📥 模型选择已从远端同步: ${beforeModel}@${beforeProviderId.replace(
                /^custom_/,
                "",
              )} → ${afterModel}@${afterProviderId.replace(/^custom_/, "")}`,
            );
          }

          const beforeEntries = beforeCustomModels
            .split(",")
            .map((m) => m.trim())
            .filter((m) => m.startsWith("+"))
            .map((m) => m.slice(1));
          const afterEntries = afterCustomModels
            .split(",")
            .map((m) => m.trim())
            .filter((m) => m.startsWith("+"))
            .map((m) => m.slice(1));
          const beforeSet = new Set<string>(beforeEntries);
          const afterSet = new Set<string>(afterEntries);
          const added = afterEntries.filter((n) => !beforeSet.has(n));
          const deleted = beforeEntries.filter((n) => !afterSet.has(n));

          console.log(
            `[Sync] ✅ 模型同步完成: ${
              modelChanged ? "模型已变更" : "模型无变化"
            }, customModels: 新增${added.length} 删除${
              deleted.length
            } 当前${afterCount}个`,
          );
        } finally {
          set({ criticalSyncReady: true, criticalSyncInProgress: false });
        }
      },

      async check() {
        const client = this.getClient();
        return await client.check();
      },
    };
  },
  {
    name: StoreKey.Sync,
    version: 1.5,
    partialize(state) {
      const {
        criticalSyncReady: _criticalSyncReady,
        criticalSyncInProgress: _criticalSyncInProgress,
        ...persistedState
      } = state as any;

      return persistedState;
    },
    merge(persistedState, currentState) {
      return {
        ...(currentState as any),
        ...(persistedState as any),
        criticalSyncReady: false,
        criticalSyncInProgress: true,
      };
    },

    migrate(persistedState, version) {
      const newState = persistedState as typeof DEFAULT_SYNC_STATE;

      if (version < 1.3) {
        newState.provider = ProviderType.Database;
      }

      if (version < 1.4) {
        newState.database = {
          cacheMeta: {},
          lastMetaSyncTime: 0,
        };
      }

      if (version < 1.5) {
        newState.provider = ProviderType.Database;
        newState.lastProvider = ProviderType.Database;
      }

      return newState as any;
    },
  },
);
