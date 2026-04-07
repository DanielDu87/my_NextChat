import { create } from "zustand";
import { StoreKey } from "../constant";
import {
  ChatPersistSplitIndex,
  getChatIndexStorageKey,
} from "../utils/chat-persist-storage";
import { indexedDbStateStorage } from "../utils/indexeddb-state-storage";
import { isPerfFeatureEnabled, logPerfSummary, nowMs } from "../utils/perf";
import { parseStoreStatePayload } from "../utils/sync-store-keys";
import { ChatSessionSummary, createEmptySession, useChatStore } from "./chat";
import { DEFAULT_TOPIC } from "./chat-defaults";
import { logger } from "../utils/logger";

const INITIAL_VISIBLE_SESSION_TITLE_COUNT = 20;
const LOAD_MORE_SESSION_TITLE_COUNT = 10;
const INITIAL_PRELOAD_SESSION_BODY_COUNT = 2;

type ChatIndexState = {
  allOrderedSessionIds: string[];
  orderedSessionIds: string[];
  sessionSummaries: Record<string, ChatSessionSummary>;
  currentSessionId: string;
  globalClearAt: number;
  deletedSessionTimestamps: Record<string, number>;
  visibleCount: number;
  initialized: boolean;
  initialize: () => Promise<void>;
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

  const orderedSessionIds = Array.isArray(parsedIndex.state.sessionIds)
    ? parsedIndex.state.sessionIds.map(String)
    : [];
  const currentSessionIndex = Math.max(
    0,
    Number(parsedIndex.state.currentSessionIndex) || 0,
  );
  const currentSessionId = orderedSessionIds[currentSessionIndex] || "";
  const visibleWindow = applyVisibleWindow(orderedSessionIds);

  return {
    ...visibleWindow,
    sessionSummaries: normalizeSessionSummaries(
      parsedIndex.state.sessionSummaries,
      orderedSessionIds,
    ),
    currentSessionId,
    globalClearAt: Number(parsedIndex.state.globalClearAt) || 0,
    deletedSessionTimestamps: isObjectLike(
      parsedIndex.state.deletedSessionTimestamps,
    )
      ? (parsedIndex.state.deletedSessionTimestamps as Record<string, number>)
      : {},
  };
}

function buildSnapshotFromChatStore(): ChatIndexSnapshot {
  const chatState = useChatStore.getState();
  const sessionSummaries = Array.isArray(chatState.sessionSummaries)
    ? chatState.sessionSummaries
    : [];
  const orderedSessionIds = sessionSummaries
    .map((summary) => String(summary?.id || ""))
    .filter(Boolean);
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
    sessionSummaries: Object.fromEntries(
      sessionSummaries.map((summary) => [summary.id, summary]),
    ),
    currentSessionId,
    globalClearAt: chatState.globalClearAt,
    deletedSessionTimestamps: chatState.deletedSessionTimestamps,
  };
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
    syncFromChatStoreDebounceTimer = setTimeout(() => {
      syncFromChatStoreDebounceTimer = null;
      useChatIndexStore.getState().syncFromChatStore();
    }, SYNC_FROM_CHAT_STORE_DEBOUNCE_MS);
  });
}

function ensureSessionsInChatStore(sessionIds: string[]) {
  const chatStore = useChatStore.getState();
  const summaryMap = useChatIndexStore.getState().sessionSummaries;
  const sessionMap = new Map(
    chatStore.sessions.map((session) => [session.id, session]),
  );
  let shouldUpdateSessions = false;

  const nextSessions = chatStore.sessions.slice();

  sessionIds.forEach((sessionId) => {
    if (!sessionId || sessionMap.has(sessionId)) {
      return;
    }

    const summary = summaryMap[sessionId];
    if (!summary) {
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

  if (shouldUpdateSessions) {
    useChatStore.setState((state) => ({
      ...state,
      sessions: nextSessions,
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
  async initialize() {
    const startedAt = nowMs();
    bindChatStoreSubscription();

    // 优先从 chatStore 内存构建，避免重复 IndexedDB 读取
    const chatStoreState = useChatStore.getState();
    const hasChatStoreHydrated = Boolean((chatStoreState as any)._hasHydrated);

    let nextSnapshot: ChatIndexSnapshot;

    if (
      hasChatStoreHydrated &&
      Array.isArray(chatStoreState.sessions) &&
      chatStoreState.sessions.length > 0
    ) {
      nextSnapshot = buildSnapshotFromChatStore();
    } else {
      const indexText = await indexedDbStateStorage.getRawItem(
        getChatIndexStorageKey(StoreKey.Chat),
      );
      const snapshot = indexText
        ? buildSnapshotFromPersistedIndex(
            parseStoreStatePayload<ChatPersistSplitIndex>(indexText),
          )
        : null;
      nextSnapshot = snapshot ?? buildSnapshotFromChatStore();
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

    recordChatIndexPerf({
      chatIndexInitDurationMs: Number((nowMs() - startedAt).toFixed(2)),
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
    set(() => ({
      ...buildSnapshotFromChatStore(),
      initialized: true,
    }));
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
