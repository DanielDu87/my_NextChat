import { create } from "zustand";
import { StoreKey } from "../constant";
import {
  ChatPersistSplitIndex,
  getActiveChatStoreScopeUserId,
  getChatIndexStorageKey,
  getScopedChatStoreKey,
} from "../utils/chat-persist-storage";
import { indexedDbStateStorage } from "../utils/indexeddb-state-storage";
import {
  isPerfDebugEnabled,
  isPerfFeatureEnabled,
  logPerfSummary,
  nowMs,
} from "../utils/perf";
import { parseStoreStatePayload } from "../utils/sync-store-keys";
import { ChatSessionSummary, createEmptySession, useChatStore } from "./chat";
import { DEFAULT_TOPIC } from "./chat-defaults";
import { logger } from "../utils/logger";

// 每个用户首开/切换先展示最近 50 个会话；继续下滑时再按页加载更早历史。
const INITIAL_VISIBLE_SESSION_TITLE_COUNT = 50;
const LOAD_MORE_SESSION_TITLE_COUNT = 10;
const INITIAL_PRELOAD_SESSION_BODY_COUNT = 5;

type ChatIndexState = {
  allOrderedSessionIds: string[];
  orderedSessionIds: string[];
  sessionSummaries: Record<string, ChatSessionSummary>;
  currentSessionId: string;
  globalClearAt: number;
  deletedSessionTimestamps: Record<string, number>;
  visibleCount: number;
  initialized: boolean;
  initialize: (options?: { forceFromIndexedDB?: boolean }) => Promise<void>;
  syncFromChatStore: () => void;
  loadMore: () => void;
};

type ChatIndexSnapshot = Pick<
  ChatIndexState,
  | "allOrderedSessionIds"
  | "orderedSessionIds"
  | "sessionSummaries"
  | "currentSessionId"
  | "globalClearAt"
  | "deletedSessionTimestamps"
  | "visibleCount"
>;

function applyVisibleWindow(
  orderedSessionIds: string[],
  visibleCount: number = INITIAL_VISIBLE_SESSION_TITLE_COUNT,
) {
  const safeVisibleCount = Math.max(
    INITIAL_VISIBLE_SESSION_TITLE_COUNT,
    visibleCount,
  );

  return {
    allOrderedSessionIds: orderedSessionIds,
    orderedSessionIds: orderedSessionIds.slice(0, safeVisibleCount),
    visibleCount: safeVisibleCount,
  };
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeSessionSummaries(
  input: unknown,
  orderedSessionIds: string[],
): Record<string, ChatSessionSummary> {
  const summaries = Array.isArray(input) ? input : [];
  const summaryMap: Record<string, ChatSessionSummary> = {};

  summaries.forEach((summary) => {
    if (!isObjectLike(summary) || !summary.id) {
      return;
    }

    summaryMap[String(summary.id)] = summary as unknown as ChatSessionSummary;
  });

  orderedSessionIds.forEach((sessionId) => {
    if (!summaryMap[sessionId]) {
      return;
    }

    summaryMap[sessionId] = {
      ...summaryMap[sessionId],
      searchText: String(summaryMap[sessionId].searchText || ""),
    };
  });

  return summaryMap;
}

function isPinnedNewChatSummary(
  session: Pick<ChatSessionSummary, "topic" | "messageCount"> | undefined,
) {
  return (
    session?.topic === DEFAULT_TOPIC && Number(session?.messageCount || 0) === 0
  );
}

function getInitialPreloadSessionIds(
  orderedSessionIds: string[],
  sessionSummaries: Record<string, ChatSessionSummary>,
  currentSessionId: string,
) {
  const preloadSessionIds = orderedSessionIds.filter((sessionId) => {
    if (sessionId === currentSessionId) {
      return true;
    }

    return !isPinnedNewChatSummary(sessionSummaries[sessionId]);
  });

  return preloadSessionIds.slice(0, INITIAL_PRELOAD_SESSION_BODY_COUNT);
}

function ensureSessionPlaceholders(sessionIds: string[]) {
  if (sessionIds.length === 0) {
    return;
  }

  ensureSessionsInChatStore(sessionIds);
}

function preloadSessionRange(sessionIds: string[]) {
  ensureSessionPlaceholders(sessionIds);

  if (!isPerfFeatureEnabled("PERF_ENABLE_CHAT_LAZY_HYDRATE")) {
    sessionIds.forEach((sessionId) => {
      if (!sessionId) {
        return;
      }

      void useChatStore
        .getState()
        .hydrateSessionIntoMemory(sessionId)
        .catch((error) => {
          logger.chatIndex.error("预加载会话失败:", sessionId, error);
        });
    });
    return;
  }

  const currentSessionId = useChatIndexStore.getState().currentSessionId;
  if (!currentSessionId) {
    return;
  }

  void useChatStore
    .getState()
    .hydrateSessionIntoMemory(currentSessionId)
    .catch((error) => {
      logger.chatIndex.error("预加载当前会话失败:", currentSessionId, error);
    });
}

function recordChatIndexPerf(metrics: Record<string, unknown>) {
  logPerfSummary("ChatIndex", metrics);
}

function maybePreloadVisibleSessionRange(sessionIds: string[]) {
  if (isPerfFeatureEnabled("PERF_ENABLE_CHAT_LAZY_HYDRATE")) {
    ensureSessionPlaceholders(sessionIds);
    return;
  }

  preloadSessionRange(sessionIds);
}

function buildSnapshotFromPersistedIndex(
  parsedIndex: ChatPersistSplitIndex | null,
): ChatIndexSnapshot | null {
  if (!parsedIndex || !isObjectLike(parsedIndex.state)) {
    return null;
  }

  let orderedSessionIds = Array.isArray(parsedIndex.state.sessionIds)
    ? parsedIndex.state.sessionIds.map(String)
    : [];
  const deletedSessionTimestamps = isObjectLike(
    parsedIndex.state.deletedSessionTimestamps,
  )
    ? (parsedIndex.state.deletedSessionTimestamps as Record<string, number>)
    : {};
  const summaries = normalizeSessionSummaries(
    parsedIndex.state.sessionSummaries,
    orderedSessionIds,
  );

  // 过滤已删除会话，避免从旧快照中复活
  const filtered = removeDeletedSessionIds(
    orderedSessionIds,
    summaries,
    deletedSessionTimestamps,
  );
  orderedSessionIds = filtered.filteredIds;

  const currentSessionIndex = Math.max(
    0,
    Number(parsedIndex.state.currentSessionIndex) || 0,
  );
  const currentSessionId = orderedSessionIds[currentSessionIndex] || "";
  const visibleWindow = applyVisibleWindow(orderedSessionIds);

  return {
    ...visibleWindow,
    sessionSummaries: filtered.filteredSummaries,
    currentSessionId,
    globalClearAt: Number(parsedIndex.state.globalClearAt) || 0,
    deletedSessionTimestamps,
  };
}

function buildSnapshotFromChatStore(): ChatIndexSnapshot {
  const chatState = useChatStore.getState();
  const sessionSummaries = Array.isArray(chatState.sessionSummaries)
    ? chatState.sessionSummaries
    : [];
  const deletedSessionTimestamps = chatState.deletedSessionTimestamps || {};
  let orderedSessionIds = sessionSummaries
    .map((summary) => String(summary?.id || ""))
    .filter(Boolean);
  const summariesMap = Object.fromEntries(
    sessionSummaries.map((summary) => [summary.id, summary]),
  );

  // 过滤已删除会话，防止 chat-index 持有过期摘要
  const filtered = removeDeletedSessionIds(
    orderedSessionIds,
    summariesMap,
    deletedSessionTimestamps,
  );
  orderedSessionIds = filtered.filteredIds;

  const currentSessionId =
    chatState.selectedSessionId ||
    chatState.sessions?.[Math.max(0, chatState.currentSessionIndex || 0)]?.id ||
    orderedSessionIds[Math.max(0, chatState.currentSessionIndex || 0)] ||
    "";
  const currentVisibleCount =
    useChatIndexStore.getState?.().visibleCount ||
    INITIAL_VISIBLE_SESSION_TITLE_COUNT;
  const visibleWindow = applyVisibleWindow(
    orderedSessionIds,
    currentVisibleCount,
  );

  return {
    ...visibleWindow,
    sessionSummaries: filtered.filteredSummaries,
    currentSessionId,
    globalClearAt: chatState.globalClearAt,
    deletedSessionTimestamps,
  };
}

function arraysShallowEqual(a: string[], b: string[]) {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function recordsShallowEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
) {
  if (a === b) {
    return true;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

// 将派生快照合并进当前 state：仅在被追踪字段发生实质变化时才替换引用。
// 这样可以保证 syncFromChatStore 幂等，避免「写会话 → 订阅器同步 → 重建全新引用 →
// 组件重渲染 → 再次触发 effect」造成的无限更新循环。
function mergeSnapshotIntoState(
  state: ChatIndexState,
  snapshot: ChatIndexSnapshot,
): ChatIndexState | null {
  const next: Partial<ChatIndexState> = {};
  let changed = false;

  if (
    !arraysShallowEqual(
      state.allOrderedSessionIds,
      snapshot.allOrderedSessionIds,
    )
  ) {
    next.allOrderedSessionIds = snapshot.allOrderedSessionIds;
    changed = true;
  }
  if (
    !arraysShallowEqual(state.orderedSessionIds, snapshot.orderedSessionIds)
  ) {
    next.orderedSessionIds = snapshot.orderedSessionIds;
    changed = true;
  }
  if (
    !recordsShallowEqual(
      state.sessionSummaries as Record<string, unknown>,
      snapshot.sessionSummaries as Record<string, unknown>,
    )
  ) {
    next.sessionSummaries = snapshot.sessionSummaries;
    changed = true;
  }
  if (state.currentSessionId !== snapshot.currentSessionId) {
    next.currentSessionId = snapshot.currentSessionId;
    changed = true;
  }
  if (state.globalClearAt !== snapshot.globalClearAt) {
    next.globalClearAt = snapshot.globalClearAt;
    changed = true;
  }
  if (
    !recordsShallowEqual(
      state.deletedSessionTimestamps,
      snapshot.deletedSessionTimestamps,
    )
  ) {
    next.deletedSessionTimestamps = snapshot.deletedSessionTimestamps;
    changed = true;
  }
  if (state.visibleCount !== snapshot.visibleCount) {
    next.visibleCount = snapshot.visibleCount;
    changed = true;
  }
  if (!state.initialized) {
    next.initialized = true;
    changed = true;
  }

  if (!changed) {
    return null;
  }

  return { ...state, ...next };
}

let hasBoundChatStoreSubscription = false;
let syncFromChatStoreDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_FROM_CHAT_STORE_DEBOUNCE_MS = 150;

function bindChatStoreSubscription() {
  if (hasBoundChatStoreSubscription) {
    return;
  }

  hasBoundChatStoreSubscription = true;
  useChatStore.subscribe((state, prevState) => {
    const sessionsChanged = state.sessions !== prevState.sessions;
    const indexChanged =
      state.currentSessionIndex !== prevState.currentSessionIndex;
    const selectionChanged =
      state.selectedSessionId !== prevState.selectedSessionId;
    const summariesChanged =
      state.sessionSummaries !== prevState.sessionSummaries;

    if (
      !sessionsChanged &&
      !indexChanged &&
      !selectionChanged &&
      !summariesChanged
    ) {
      return;
    }

    if (syncFromChatStoreDebounceTimer) {
      clearTimeout(syncFromChatStoreDebounceTimer);
    }

    const debounceMs = sessionsChanged ? 16 : SYNC_FROM_CHAT_STORE_DEBOUNCE_MS;
    syncFromChatStoreDebounceTimer = setTimeout(() => {
      syncFromChatStoreDebounceTimer = null;
      useChatIndexStore.getState().syncFromChatStore();
    }, debounceMs);
  });
}

function removeDeletedSessionIds(
  orderedIds: string[],
  summaries: Record<string, ChatSessionSummary>,
  deletedTimestamps: Record<string, number>,
) {
  if (Object.keys(deletedTimestamps).length === 0) {
    return { filteredIds: orderedIds, filteredSummaries: summaries };
  }

  const filteredIds = orderedIds.filter((id) => !deletedTimestamps[id]);
  const filteredSummaries: Record<string, ChatSessionSummary> = {};
  for (const id of filteredIds) {
    if (summaries[id]) {
      filteredSummaries[id] = summaries[id];
    }
  }

  return { filteredIds, filteredSummaries };
}

function ensureSessionsInChatStore(sessionIds: string[]) {
  const chatStore = useChatStore.getState();
  const chatIndexStore = useChatIndexStore.getState();
  const summaryMap = chatIndexStore.sessionSummaries;
  const sessionMap = new Map(
    chatStore.sessions.map((session) => [session.id, session]),
  );
  const summaryIdSet = new Set(
    (chatStore.sessionSummaries || []).map((summary) => summary.id),
  );

  // 合并两端 deletedSessionTimestamps，防止已删除会话被重新创建
  const mergedDeletedTimestamps = {
    ...chatStore.deletedSessionTimestamps,
    ...chatIndexStore.deletedSessionTimestamps,
  };

  let shouldUpdateSessions = false;
  let shouldUpdateSummaries = false;

  const nextSessions = chatStore.sessions.slice();
  const nextSessionSummaries = (chatStore.sessionSummaries || []).slice();

  sessionIds.forEach((sessionId) => {
    if (!sessionId) {
      return;
    }

    // 已删除的会话不应被重新创建
    if (mergedDeletedTimestamps[sessionId]) {
      return;
    }

    const summary = summaryMap[sessionId];
    if (!summary) {
      return;
    }

    if (!summaryIdSet.has(sessionId)) {
      nextSessionSummaries.push(summary);
      summaryIdSet.add(sessionId);
      shouldUpdateSummaries = true;
    }

    if (sessionMap.has(sessionId)) {
      return;
    }

    const placeholder = createEmptySession();
    placeholder.id = sessionId;
    placeholder.topic = String(summary.topic || "");
    placeholder.createdAt = Number(
      summary.createdAt || summary.displayTime || Date.now(),
    );
    placeholder.lastUpdate = Number(
      summary.displayTime || summary.createdAt || Date.now(),
    );
    placeholder.mask.avatar = String(summary.avatar || placeholder.mask.avatar);
    placeholder.mask.name = placeholder.topic || placeholder.mask.name;
    placeholder.mask.modelConfig.model = String(
      summary.model || placeholder.mask.modelConfig.model || "",
    );

    nextSessions.push(placeholder);
    sessionMap.set(sessionId, placeholder);
    shouldUpdateSessions = true;
  });

  if (shouldUpdateSessions || shouldUpdateSummaries) {
    useChatStore.setState((state) => ({
      ...state,
      sessions: shouldUpdateSessions ? nextSessions : state.sessions,
      sessionSummaries: shouldUpdateSummaries
        ? nextSessionSummaries
        : state.sessionSummaries,
    }));
  }
}

export const useChatIndexStore = create<ChatIndexState>((set) => ({
  allOrderedSessionIds: [],
  orderedSessionIds: [],
  sessionSummaries: {},
  currentSessionId: "",
  globalClearAt: 0,
  deletedSessionTimestamps: {},
  visibleCount: INITIAL_VISIBLE_SESSION_TITLE_COUNT,
  initialized: false,
  async initialize(options?: { forceFromIndexedDB?: boolean }) {
    const startedAt = nowMs();
    bindChatStoreSubscription();
    const expectedUserId = getActiveChatStoreScopeUserId();

    // 优先从 chatStore 内存构建，避免重复 IndexedDB 读取。
    // 但切换用户且有缓存时，内存状态不完整（只有前 20 个会话占位符），
    // 必须强制从 IndexedDB 读取完整 index，否则侧边栏会漏掉旧会话。
    const chatStoreState = useChatStore.getState();
    const hasChatStoreHydrated = Boolean((chatStoreState as any)._hasHydrated);
    const shouldForceFromIndexedDB = options?.forceFromIndexedDB === true;
    const sourceFromMemory =
      !shouldForceFromIndexedDB &&
      hasChatStoreHydrated &&
      Array.isArray(chatStoreState.sessions) &&
      chatStoreState.sessions.length > 0;

    let nextSnapshot: ChatIndexSnapshot;

    if (sourceFromMemory) {
      nextSnapshot = buildSnapshotFromChatStore();
    } else {
      const indexText = await indexedDbStateStorage.getRawItem(
        getChatIndexStorageKey(getScopedChatStoreKey(StoreKey.Chat)),
      );
      if (getActiveChatStoreScopeUserId() !== expectedUserId) {
        return;
      }
      const snapshot = indexText
        ? buildSnapshotFromPersistedIndex(
            parseStoreStatePayload<ChatPersistSplitIndex>(indexText),
          )
        : null;
      nextSnapshot = snapshot ?? buildSnapshotFromChatStore();
    }

    if (getActiveChatStoreScopeUserId() !== expectedUserId) {
      return;
    }

    set(() => ({
      ...nextSnapshot,
      initialized: true,
    }));

    preloadSessionRange(
      getInitialPreloadSessionIds(
        nextSnapshot.orderedSessionIds,
        nextSnapshot.sessionSummaries,
        nextSnapshot.currentSessionId,
      ),
    );

    const durationMs = Number((nowMs() - startedAt).toFixed(2));
    if (isPerfDebugEnabled()) {
      logger.chatIndex.log(
        `[ChatIndex.initialize] 完成 | 来源: ${
          sourceFromMemory ? "内存" : "IndexedDB"
        } | ` +
          `forceFromIndexedDB: ${shouldForceFromIndexedDB} | ` +
          `会话数: ${nextSnapshot.allOrderedSessionIds.length} | ` +
          `当前会话: ${nextSnapshot.currentSessionId || "(空)"} | ` +
          `耗时: ${durationMs}ms`,
      );
    }

    recordChatIndexPerf({
      chatIndexInitDurationMs: durationMs,
      sessionCount: nextSnapshot.allOrderedSessionIds.length,
      hydratedSessionCount: getInitialPreloadSessionIds(
        nextSnapshot.orderedSessionIds,
        nextSnapshot.sessionSummaries,
        nextSnapshot.currentSessionId,
      ).length,
      currentSessionId: nextSnapshot.currentSessionId,
    });
  },
  syncFromChatStore() {
    set((state) => {
      const merged = mergeSnapshotIntoState(
        state,
        buildSnapshotFromChatStore(),
      );
      // 内容无实质变化时返回原 state，复用旧引用，避免订阅组件无谓重渲染
      return merged ?? state;
    });
  },
  loadMore() {
    set((state) => {
      const nextVisibleCount = Math.min(
        state.allOrderedSessionIds.length,
        state.visibleCount + LOAD_MORE_SESSION_TITLE_COUNT,
      );

      if (nextVisibleCount === state.visibleCount) {
        return state;
      }

      return {
        visibleCount: nextVisibleCount,
        orderedSessionIds: state.allOrderedSessionIds.slice(
          0,
          nextVisibleCount,
        ),
      };
    });

    const state = useChatIndexStore.getState();
    const nextSessionIds = state.orderedSessionIds.slice(
      Math.max(0, state.visibleCount - LOAD_MORE_SESSION_TITLE_COUNT),
      state.visibleCount,
    );
    maybePreloadVisibleSessionRange(nextSessionIds);
  },
}));

export function selectChatSessionById(sessionId: string) {
  ensureSessionsInChatStore([sessionId]);
  useChatStore.getState().selectSessionById(sessionId);
}
