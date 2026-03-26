import { getClientConfig } from "../config/client";
import { StoreKey } from "../constant";
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
  createChatSessionMap,
  getSyncableChatSessions,
  type ChatIndexSessionEntry,
} from "../utils/chat-sync";
import { INITIAL_HYDRATED_RECENT_SESSION_LIMIT } from "../utils/chat-persist-storage";
import {
  getChatGlobalClearAtFromState,
  getDeletedSessionTimestampsFromState,
  isEffectivelyEmptyRemoteChatState,
} from "../utils/chat-sync-state";
import { getPersistedChatSession } from "../utils/chat-persist-storage";
import { showToast } from "../components/ui-lib";
import Locale from "../locales";
import { createSyncClient, ProviderType } from "../utils/cloud";
import { useAppConfig } from "./config";
import type { StoreSnapshotMeta } from "../utils/cloud/database";
import {
  buildSessionSummaries,
  buildSessionSummary,
  ChatSessionSummary,
  createEmptySession,
} from "./chat";

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
const LOG_SEPARATOR = "=".repeat(30);
let syncInFlight: Promise<void> | null = null;
let queuedSyncKeys = new Set<SyncStoreKey>();
const RETRYABLE_DB_SYNC_ERROR = /\[DB Sync\] (404|408|5\d{2})\b/;

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

function warnSyncDebug(message: string, payload?: unknown) {
  if (!isSyncDebugLoggingEnabled()) {
    return;
  }
  if (payload === undefined) {
    console.warn(message);
    return;
  }
  console.warn(message, payload);
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
const DEBOUNCE_DELAY = 3000; // 3秒防抖
const SYNC_DEBOUNCE_KEY = "nextchat_sync_debounce";

type PendingDebounceSyncTask = {
  keys: SyncStoreKey[];
  scheduledAt: number;
};

const STORE_DISPLAY_NAMES: Record<SyncStoreKey, string> = {
  [StoreKey.Chat]: "会话",
  [StoreKey.Plugin]: "插件",
  [StoreKey.Access]: "设置",
  [StoreKey.Config]: "模型",
  [StoreKey.ModelCache]: "模型缓存",
  [StoreKey.Mask]: "面具",
  [StoreKey.Prompt]: "提示词",
  [StoreKey.Update]: "应用更新状态",
  [StoreKey.SdList]: "绘图",
};

function getStoreSummary(key: SyncStoreKey, state: any) {
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
      } 个API配置`;
    case StoreKey.Config:
      return `${Array.isArray(state?.models) ? state.models.length : 0} 个模型`;
    case StoreKey.ModelCache:
      return `${Object.keys(state?.profiles ?? {}).length} 个平台缓存`;
    case StoreKey.Mask:
      return `${Object.keys(state?.masks ?? {}).length} 个面具`;
    case StoreKey.Prompt:
      return `${Object.keys(state?.prompts ?? {}).length} 个提示词`;
    case StoreKey.Update:
      return `${state?.lastUpdateTime ? 1 : 0} 条应用更新状态`;
    case StoreKey.SdList:
      return `${Array.isArray(state?.draw) ? state.draw.length : 0} 条绘图记录`;
    default:
      return "0 项";
  }
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

function measureJsonBytes(value: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
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

function buildMetaMap(metas: StoreSnapshotMeta[] = []) {
  return new Map(metas.map((meta) => [meta.key, meta] as const));
}

function normalizeMergedChatState(chatState: any) {
  const sessions = Array.isArray(chatState?.sessions) ? chatState.sessions : [];
  const safeIndex = Math.min(
    Math.max(Number(chatState?.currentSessionIndex) || 0, 0),
    Math.max(sessions.length - 1, 0),
  );
  const existingSummaries = Array.isArray(chatState?.sessionSummaries)
    ? chatState.sessionSummaries
    : [];
  const existingSummaryMap = new Map<string, ChatSessionSummary>(
    existingSummaries
      .filter((summary: any) => summary?.id)
      .map((summary: any) => [summary.id, summary as ChatSessionSummary]),
  );
  const remoteIndexEntryMap = createChatIndexEntryMap(
    Array.isArray(chatState?.remoteIndexSessions)
      ? (chatState.remoteIndexSessions as ChatIndexSessionEntry[])
      : [],
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
    const remoteIndexEntry = remoteIndexEntryMap.get(String(session?.id || ""));
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
    hydratedSessionIds,
    sessionSummaries,
  };
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

function buildUploadChatIndexPayload(
  chatState: any,
  remoteEntryMap: Map<string, ChatIndexSessionEntry>,
) {
  const sessions = Array.isArray(chatState?.sessions) ? chatState.sessions : [];
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
    .filter((session: PlaceholderChatSession) => session?.id)
    .map((session: PlaceholderChatSession) => {
      const sessionId = String(session.id || "");
      const remoteEntry = remoteEntryMap.get(sessionId);

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

async function materializeLocalChatState(chatState: any) {
  const sessions = Array.isArray(chatState?.sessions) ? chatState.sessions : [];
  const sessionSummaries = Array.isArray(chatState?.sessionSummaries)
    ? chatState.sessionSummaries
    : [];

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

      return (await getPersistedChatSession(session.id)) || session;
    }),
  );

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
    ) {
      const materializedLocalChatState =
        await materializeLocalChatState(localChatState);
      const localSessions = Array.isArray(materializedLocalChatState.sessions)
        ? materializedLocalChatState.sessions
        : [];
      const syncableLocalSessions = getSyncableChatSessions(localSessions);
      const remoteIndex = await client.getChatIndex?.();
      const localDeletedSessionTimestamps = getDeletedSessionTimestamps(
        materializedLocalChatState,
      );

      if (!remoteIndex) {
        const localIndex = buildChatIndexPayload(materializedLocalChatState);
        const uploadBytes =
          measureJsonBytes(localIndex) +
          measureJsonBytes(syncableLocalSessions);
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
          status: "uploaded" as const,
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

        return {
          remoteSummary: "远端 0 个会话",
          mergedStoreState: normalizeMergedChatState(localChatState),
          mergedSummary: getStoreSummary(StoreKey.Chat, localChatState),
          status: "uploaded" as const,
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
        ...(Array.isArray(localChatState?.hydratedSessionIds)
          ? localChatState.hydratedSessionIds
          : []),
        ...((remoteIndex.sessions || []) as ChatIndexSessionEntry[])
          .slice(0, INITIAL_HYDRATED_RECENT_SESSION_LIMIT)
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
        localChatState,
        mergedDeletedSessionTimestamps,
      );
      const normalizedRemoteChatState = applyDeletedSessionsToChatState(
        remotePartialState,
        mergedDeletedSessionTimestamps,
      );
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
        const mergedSessionMap = createChatSessionMap(
          Array.isArray(mergedStoreState?.sessions)
            ? mergedStoreState.sessions
            : [],
        );
        const upsertSessions = mergedIndex.sessions
          .filter((entry: ChatIndexSessionEntry) =>
            shouldUploadChatSession(entry, remoteEntryMap.get(entry.id)),
          )
          .map((entry: ChatIndexSessionEntry) => mergedSessionMap.get(entry.id))
          .filter(Boolean)
          .filter((session: unknown) => !isRemoteSessionPlaceholder(session))
          .map(
            (session: unknown) => session as unknown as Record<string, unknown>,
          );
        const deleteSessionIds = [...remoteEntryMap.keys()].filter(
          (sessionId) =>
            !mergedSessionMap.has(sessionId) ||
            wasChatSessionDeleted(
              sessionId,
              remoteEntryMap.get(sessionId)?.lastUpdate || 0,
              mergedDeletedSessionTimestamps,
            ),
        );
        const uploadedBytes =
          measureJsonBytes(mergedIndex) + measureJsonBytes(upsertSessions);

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

        const normalizedMergedStoreState = normalizeMergedChatState({
          ...mergedStoreState,
          remoteIndexSessions: remoteIndex.sessions || [],
          deletedSessionTimestamps: {},
        });

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
            uploadedBytes,
            deletedSessionCount: deleteSessionIds.length,
          },
        };
      }

      const mergedStoreState = mergeStoreState(
        StoreKey.Chat,
        normalizedLocalChatState,
        normalizedRemoteChatState as any,
      );
      const mergedIndex = buildUploadChatIndexPayload(
        mergedStoreState as any,
        remoteEntryMap,
      );
      const mergedSessionMap = createChatSessionMap(
        Array.isArray((mergedStoreState as any)?.sessions)
          ? (mergedStoreState as any).sessions
          : [],
      );
      const upsertSessions = mergedIndex.sessions
        .filter((entry: ChatIndexSessionEntry) =>
          shouldUploadChatSession(entry, remoteEntryMap.get(entry.id)),
        )
        .map((entry: ChatIndexSessionEntry) => mergedSessionMap.get(entry.id))
        .filter(Boolean)
        .filter((session: unknown) => !isRemoteSessionPlaceholder(session))
        .map(
          (session: unknown) => session as unknown as Record<string, unknown>,
        );
      const deleteSessionIds = [...remoteEntryMap.keys()].filter(
        (sessionId) =>
          !mergedSessionMap.has(sessionId) ||
          wasChatSessionDeleted(
            sessionId,
            remoteEntryMap.get(sessionId)?.lastUpdate || 0,
            mergedDeletedSessionTimestamps,
          ),
      );
      const uploadedBytes =
        measureJsonBytes(mergedIndex) + measureJsonBytes(upsertSessions);

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

      const normalizedMergedStoreState = normalizeMergedChatState({
        ...mergedStoreState,
        remoteIndexSessions: remoteIndex.sessions || [],
        deletedSessionTimestamps: {},
      });

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
          uploadedBytes,
          deletedSessionCount: deleteSessionIds.length,
        },
      };
    }

    return {
      cloudSync() {
        return get().provider === ProviderType.Database;
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
          console.error("[Import]", e);
          showToast(Locale.Settings.Sync.ImportFailed);
        }
      },

      getClient() {
        const provider = get().provider;
        const client = createSyncClient(provider, get());
        return client;
      },

      triggerDebounceSync(storeKeys?: SyncStoreKey[]) {
        const keysToSync = normalizeSyncKeys(storeKeys);

        // 清除之前的定时器
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        const executeSync = async () => {
          clearPendingDebounceTask();

          // 检查是否已配置同步
          if (!this.cloudSync()) {
            logSyncDebug("[Sync] 🔕 同步未配置，跳过防抖同步");
            return;
          }

          logSyncDebug("[Sync] 🚀 防抖同步触发", {
            keys: keysToSync.map((k) => STORE_DISPLAY_NAMES[k]).join(", "),
          });

          try {
            await this.sync(keysToSync);
          } catch (error) {
            console.error("[Sync] ❌ 防抖同步失败:", error);
            writePendingDebounceTask({
              keys: keysToSync,
              scheduledAt: Date.now(),
            });
          }
        };

        // 设置新的防抖定时器
        debounceTimer = setTimeout(executeSync, DEBOUNCE_DELAY);

        writePendingDebounceTask({
          keys: keysToSync,
          scheduledAt: Date.now() + DEBOUNCE_DELAY,
        });
      },

      async resumePendingDebounceSync() {
        const pendingTask = readPendingDebounceTask();
        if (!pendingTask) {
          return false;
        }

        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }

        logSyncDebug("[Sync] ♻️ 恢复未完成的防抖同步", {
          keys: pendingTask.keys.map((k) => STORE_DISPLAY_NAMES[k]).join(", "),
        });

        clearPendingDebounceTask();

        try {
          await this.sync(pendingTask.keys);
          return true;
        } catch (error) {
          console.error("[Sync] ❌ 恢复防抖同步失败:", error);
          writePendingDebounceTask({
            keys: pendingTask.keys,
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

      async sync(storeKeys: SyncStoreKey[] = [...SYNC_STORE_KEYS]) {
        const normalizedStoreKeys = normalizeSyncKeys(storeKeys);
        normalizedStoreKeys.forEach((key) => queuedSyncKeys.add(key));

        if (syncInFlight) {
          logSyncDebug(
            "[Sync] ⏳ 已有同步进行中，已合并到队列等待当前任务完成",
            {
              keys: normalizedStoreKeys
                .map((k) => STORE_DISPLAY_NAMES[k])
                .join(", "),
            },
          );
          await syncInFlight;
          return;
        }

        syncInFlight = (async () => {
          while (queuedSyncKeys.size > 0) {
            const currentStoreKeys = [...queuedSyncKeys];
            queuedSyncKeys = new Set<SyncStoreKey>();

            const state = getNonFunctionFileds(this) as SyncStore;
            const providerName =
              state.provider === ProviderType.Database
                ? "PostgreSQL 数据库"
                : "云端存储";
            logSyncDebug(`[Sync] 🔄 开始同步到 ${providerName}...`);

            const client = this.getClient() as any;
            const initialMetas =
              typeof client.getMeta === "function" &&
              currentStoreKeys.length > 0
                ? await client.getMeta(currentStoreKeys)
                : [];
            let remoteMetaMap = buildMetaMap(initialMetas);

            logSyncDebug(
              `[Sync] 📋 准备同步 ${currentStoreKeys.length} 个数据块`,
            );

            const appConfig = useAppConfig.getState() as any;
            const localTheme = appConfig.theme;
            const localSidebarWidth = localStorage.getItem("sidebarWidth");
            const localTightBorder = appConfig.tightBorder;
            const localAppStateCache = {
              ...getLocalAppState(),
            } as { [K in SyncStoreKey]: AppState[K] };

            const syncRegularStore = async (
              key: SyncStoreKey,
              displayName: string,
              stepLabel: string,
            ) => {
              for (let attempt = 0; attempt < 2; attempt += 1) {
                const remoteDataText = await withRetry<string>(
                  () => client.get(key),
                  {
                    retries: 1,
                    retryable: (error) =>
                      error instanceof Error &&
                      RETRYABLE_DB_SYNC_ERROR.test(error.message),
                    onRetry: (retryAttempt, error) => {
                      warnSyncDebug(
                        `[Sync] ⚠️ [${stepLabel}] ${displayName}读取失败，准备第 ${retryAttempt} 次重试:`,
                        error,
                      );
                    },
                  },
                );

                const currentMeta = remoteMetaMap.get(key);
                if (!remoteDataText || remoteDataText === "") {
                  const localStoreState = localAppStateCache[key];
                  try {
                    await client.set(
                      key,
                      stringifyPersistedStoreState(key, localStoreState),
                      {
                        expectedMissing: !currentMeta,
                        expectedUpdatedAt: currentMeta?.updatedAt,
                        expectedChecksum: currentMeta?.checksum,
                      },
                    );
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
                    throw error;
                  }

                  return {
                    summary: getStoreSummary(key, localStoreState),
                    status: "uploaded" as const,
                  };
                }

                const parsedRemoteState =
                  parseStoreStatePayload(remoteDataText);
                const mergedStoreState = mergeStoreState(
                  key,
                  localAppStateCache[key],
                  parsedRemoteState,
                );

                setLocalStoreState(key, mergedStoreState);
                localAppStateCache[key] = mergedStoreState;

                try {
                  await client.set(
                    key,
                    stringifyPersistedStoreState(key, mergedStoreState),
                    {
                      expectedMissing: !currentMeta,
                      expectedUpdatedAt: currentMeta?.updatedAt,
                      expectedChecksum: currentMeta?.checksum,
                    },
                  );
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
                  throw error;
                }

                return {
                  summary: getStoreSummary(key, mergedStoreState),
                  status: "merged" as const,
                  remoteSummary: getStoreSummary(key, parsedRemoteState),
                };
              }

              throw new Error(`[Sync] ${displayName}冲突重试失败`);
            };

            const syncChatStoreWithRetry = async (
              localStoreState: AppState[typeof StoreKey.Chat],
            ) => {
              for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                  return await syncChatStore(
                    client,
                    localStoreState,
                    remoteMetaMap.get(StoreKey.Chat),
                  );
                } catch (error) {
                  if (
                    attempt === 0 &&
                    error instanceof Error &&
                    /\[DB Sync\] 409\b/.test(error.message) &&
                    typeof client.getMeta === "function"
                  ) {
                    console.log(
                      "[Sync] ⚠️ 检测到 409 冲突，正在获取最新元数据重试...",
                    );
                    const latestMetas = await client.getMeta([StoreKey.Chat]);
                    remoteMetaMap = buildMetaMap([
                      ...Array.from(remoteMetaMap.values()).filter(
                        (meta) => meta.key !== StoreKey.Chat,
                      ),
                      ...latestMetas,
                    ]);
                    console.log("[Sync] 🔄 使用最新元数据重试同步");
                    continue;
                  }
                  throw error;
                }
              }

              throw new Error("[Sync] 会话冲突重试失败");
            };

            try {
              const syncResults: Array<{
                key: SyncStoreKey;
                name: string;
                summary: string;
                status: "downloaded" | "uploaded" | "merged";
              }> = [];
              const failedKeys: Array<{
                key: SyncStoreKey;
                name: string;
                error: unknown;
              }> = [];

              for (const [index, key] of currentStoreKeys.entries()) {
                try {
                  const displayName = STORE_DISPLAY_NAMES[key];
                  const stepLabel = `${index + 1}/${currentStoreKeys.length}`;
                  logSyncDebug(
                    `[Sync] 📋 [${stepLabel}] 正在同步${displayName}...`,
                  );
                  const localStoreState = localAppStateCache[key];

                  if (
                    key === StoreKey.Chat &&
                    typeof client.getChatIndex === "function" &&
                    typeof client.getChatSessions === "function" &&
                    typeof client.setChatDelta === "function"
                  ) {
                    const chatResult = await syncChatStoreWithRetry(
                      localStoreState as AppState[typeof StoreKey.Chat],
                    );
                    logSyncDebug(
                      `[Sync] ✅ [${stepLabel}] ${displayName}读取完成，${chatResult.remoteSummary}`,
                    );
                    syncResults.push({
                      key,
                      name: displayName,
                      summary: chatResult.mergedSummary,
                      status: chatResult.status,
                    });

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

                    setLocalStoreState(key, chatResult.mergedStoreState as any);
                    localAppStateCache[key] =
                      chatResult.mergedStoreState as any;
                    continue;
                  }

                  const regularResult = await syncRegularStore(
                    key,
                    displayName,
                    stepLabel,
                  );
                  if (regularResult.status === "merged") {
                    logSyncDebug(
                      `[Sync] ✅ [${stepLabel}] ${displayName}读取完成，远端 ${regularResult.remoteSummary}`,
                    );
                    logSyncDebug(LOG_SEPARATOR);
                  }
                  syncResults.push({
                    key,
                    name: displayName,
                    summary: regularResult.summary,
                    status: regularResult.status,
                  });
                } catch (e) {
                  failedKeys.push({
                    key,
                    name: STORE_DISPLAY_NAMES[key],
                    error: e,
                  });
                  console.error(
                    `[Sync] ❌ [${index + 1}/${currentStoreKeys.length}] ${
                      STORE_DISPLAY_NAMES[key]
                    }同步失败:`,
                    e,
                  );
                }
              }

              if (localSidebarWidth && appConfig.setSidebarWidth) {
                appConfig.setSidebarWidth(parseInt(localSidebarWidth));
              }
              if (localTightBorder !== undefined) {
                useAppConfig.setState({ tightBorder: localTightBorder });
              }
              if (localTheme !== undefined) {
                useAppConfig.setState({ theme: localTheme });
              }

              logSyncDebug("[Sync] 📊 数据同步汇总");
              syncResults.forEach((item) => {
                logSyncDebug(`[Sync] - ${item.name}: ${item.summary}`);
              });

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
                console.error(`[Sync] ❌ 本次同步存在失败项: ${failedSummary}`);
                throw new Error(`[Sync] 部分数据同步失败: ${failedSummary}`);
              }

              logSyncDebug("[Sync] ✅ 同步完成");
              logSyncDebug(LOG_SEPARATOR);

              if (
                typeof client.getMeta === "function" &&
                currentStoreKeys.length > 0
              ) {
                const latestMetas = await client.getMeta(currentStoreKeys);
                this.updateDatabaseMeta(latestMetas);
              }
            } catch (e) {
              console.error("[Sync] ❌ 同步失败:", e);
              throw e;
            }

            this.markSyncTime();
          }
        })();

        try {
          await syncInFlight;
        } finally {
          syncInFlight = null;
        }
      },

      async autoSync() {
        await this.sync([StoreKey.Chat]);

        const remainingKeys = AUTO_SYNC_STORE_KEYS.filter(
          (key) => key !== StoreKey.Chat,
        );
        if (remainingKeys.length > 0) {
          await this.sync(remainingKeys);
        }
      },

      async syncModels() {
        return this.sync([...MODEL_SYNC_STORE_KEYS]);
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
