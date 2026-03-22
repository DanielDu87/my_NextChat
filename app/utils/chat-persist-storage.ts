import { StateStorage } from "zustand/middleware";
import {
  buildPersistedStoreState,
  unwrapPersistedStoreState,
} from "./sync-store-keys";
import { indexedDbStateStorage } from "./indexeddb-state-storage";
import { resolveHydratedStateValue } from "./state-storage-helpers";

type PersistedEnvelope = {
  state?: Record<string, unknown>;
  version?: number;
};

export type ChatPersistSplitIndex = {
  version: 1;
  persistVersion: number;
  state: Record<string, unknown> & {
    sessionIds: string[];
  };
};

const CHAT_INDEX_SUFFIX = "::index";
const CHAT_SESSION_SUFFIX = "::session::";
const CHAT_STORE_KEY = "chat-next-web-store";
const PERF_DEBUG_KEY = "nextchat_perf_debug";
export const INITIAL_HYDRATED_RECENT_SESSION_LIMIT = 20;

export function getChatIndexStorageKey(name: string) {
  return `${name}${CHAT_INDEX_SUFFIX}`;
}

export function getChatSessionStorageKey(name: string, sessionId: string) {
  return `${name}${CHAT_SESSION_SUFFIX}${sessionId}`;
}

function parseJson<T>(text: string | null | undefined): T | null {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPerfDebugEnabled() {
  try {
    return (
      typeof window !== "undefined" &&
      window.localStorage.getItem(PERF_DEBUG_KEY) === "1"
    );
  } catch {
    return false;
  }
}

function measureBytes(value: string) {
  return new TextEncoder().encode(value).length;
}

export function splitChatPersistedState(text: string) {
  const payload = parseJson<PersistedEnvelope>(text);
  const state = unwrapPersistedStoreState(payload) as Record<string, unknown>;
  const sessions = Array.isArray(state?.sessions) ? state.sessions : [];
  const { sessions: _sessions, ...restState } = state;
  const sessionIds = sessions
    .map((session) =>
      isObjectLike(session) && session.id ? String(session.id) : "",
    )
    .filter(Boolean);

  return {
    index: {
      version: 1 as const,
      persistVersion: Number(payload?.version ?? 0),
      state: {
        ...restState,
        sessionIds,
      },
    },
    sessionEntries: sessionIds.map((sessionId, index) => ({
      sessionId,
      value: JSON.stringify(sessions[index]),
    })),
  };
}

export function rebuildChatPersistedState(
  index: ChatPersistSplitIndex,
  sessionPayloads: Array<string | null>,
) {
  const sessions = index.state.sessionIds
    .map((sessionId, indexPosition) => {
      const sessionText = sessionPayloads[indexPosition];
      const parsed = parseJson<Record<string, unknown>>(sessionText);
      if (!parsed || String(parsed.id || "") !== sessionId) {
        return null;
      }
      return parsed;
    })
    .filter(Boolean);

  const { sessionIds: _sessionIds, ...restState } = index.state;

  return JSON.stringify(
    buildPersistedStoreState(CHAT_STORE_KEY as any, {
      ...restState,
      sessions,
    }),
  );
}

function getInitialHydratedSessionIds(index: ChatPersistSplitIndex) {
  const sessionIds = Array.isArray(index.state.sessionIds)
    ? index.state.sessionIds.filter(Boolean)
    : [];
  const currentSessionIndex = Math.max(
    0,
    Number(index.state.currentSessionIndex) || 0,
  );
  const currentSessionId = sessionIds[currentSessionIndex] || "";
  const sessionSummaries = Array.isArray((index.state as any).sessionSummaries)
    ? ((index.state as any).sessionSummaries as Array<Record<string, unknown>>)
    : [];
  const isMeaningfulSession = (sessionId: string) => {
    const summary = sessionSummaries.find((item) => item?.id === sessionId);
    return Number(summary?.messageCount || 0) > 0;
  };
  const recentSessionIds = sessionIds
    .filter(
      (sessionId) =>
        sessionId === currentSessionId || isMeaningfulSession(sessionId),
    )
    .slice(0, INITIAL_HYDRATED_RECENT_SESSION_LIMIT);

  return Array.from(
    new Set([currentSessionId, ...recentSessionIds].filter(Boolean)),
  );
}

function buildSessionPlaceholder(
  index: ChatPersistSplitIndex,
  sessionId: string,
) {
  const sessionSummaries = Array.isArray((index.state as any).sessionSummaries)
    ? ((index.state as any).sessionSummaries as Array<Record<string, unknown>>)
    : [];
  const summary = sessionSummaries.find((item) => item?.id === sessionId);

  return JSON.stringify({
    id: sessionId,
    topic: String(summary?.topic || ""),
    messages: [],
    memoryPrompt: "",
    stat: {
      tokenCount: 0,
      wordCount: 0,
      charCount: 0,
    },
    createdAt: Number(summary?.createdAt || summary?.displayTime || 0),
    lastUpdate: Number(summary?.displayTime || summary?.createdAt || 0),
    lastSummarizeIndex: 0,
    mask: {
      avatar: String(summary?.avatar || "gpt-bot"),
      context: [],
      hideContext: false,
      plugin: [],
      syncGlobalConfig: true,
      modelConfig: {
        model: String(summary?.model || ""),
        providerName: "",
      },
    },
  });
}

function getSessionIdsFromIndexText(indexText: string | null) {
  const parsed = parseJson<ChatPersistSplitIndex>(indexText);
  return Array.isArray(parsed?.state?.sessionIds)
    ? parsed!.state.sessionIds.filter(Boolean)
    : [];
}

function createSessionEntryMap(
  entries: Array<{
    sessionId: string;
    value: string;
  }>,
) {
  return new Map(entries.map((entry) => [entry.sessionId, entry.value]));
}

function getSessionsFromPersistedEnvelope(text: string | null | undefined) {
  const payload = parseJson<PersistedEnvelope>(text);
  const state = unwrapPersistedStoreState(payload) as Record<string, unknown>;
  return Array.isArray(state?.sessions)
    ? (state.sessions as Record<string, unknown>[])
    : [];
}

function getSessionSummaryMessageCount(
  index: ChatPersistSplitIndex,
  sessionId: string,
) {
  const sessionSummaries = Array.isArray((index.state as any).sessionSummaries)
    ? ((index.state as any).sessionSummaries as Array<Record<string, unknown>>)
    : [];
  const summary = sessionSummaries.find((item) => item?.id === sessionId);
  return Number(summary?.messageCount || 0);
}

function isPrunedSessionPayload(
  index: ChatPersistSplitIndex,
  sessionId: string,
  value: string,
) {
  const summaryMessageCount = getSessionSummaryMessageCount(index, sessionId);
  if (summaryMessageCount <= 0) {
    return false;
  }

  const parsed = parseJson<Record<string, unknown>>(value);
  if (!parsed) {
    return false;
  }

  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  return messages.length === 0;
}

class ChatPersistStorage implements StateStorage {
  private cache = new Map<string, string>();
  private hydrated = new Set<string>();
  private hydrating = new Set<string>();
  private pendingWrites = new Map<string, string>();

  private isAvailable() {
    return typeof window !== "undefined";
  }

  private async writeSplitValue(name: string, value: string) {
    const startedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const nextPayload = splitChatPersistedState(value);
    const nextIndexKey = getChatIndexStorageKey(name);
    const previousIndexText =
      await indexedDbStateStorage.getRawItem(nextIndexKey);
    const previousSessionIds = new Set(
      getSessionIdsFromIndexText(previousIndexText),
    );
    const nextSessionIds = new Set(
      nextPayload.sessionEntries.map((entry) => entry.sessionId),
    );
    const nextSessionEntryMap = createSessionEntryMap(
      nextPayload.sessionEntries,
    );
    const nextSessionStorageKeys = nextPayload.sessionEntries.map((entry) =>
      getChatSessionStorageKey(name, entry.sessionId),
    );
    const previousSessionPayloads = await indexedDbStateStorage.getRawItems(
      nextSessionStorageKeys,
    );
    const changedSessionEntries = nextPayload.sessionEntries.filter((entry) => {
      const storageKey = getChatSessionStorageKey(name, entry.sessionId);
      const isPrunedPayload = isPrunedSessionPayload(
        nextPayload.index,
        entry.sessionId,
        entry.value,
      );

      if (previousSessionPayloads[storageKey] === entry.value) {
        return false;
      }

      // 避免把“未加载正文的空壳会话”写入分片。
      if (isPrunedPayload) {
        return false;
      }

      return true;
    });

    const staleSessionIds = [...previousSessionIds].filter(
      (sessionId) => !nextSessionIds.has(sessionId),
    );

    await indexedDbStateStorage.applyRawChanges({
      set: {
        [nextIndexKey]: JSON.stringify(nextPayload.index),
        ...Object.fromEntries(
          changedSessionEntries.map((entry) => [
            getChatSessionStorageKey(name, entry.sessionId),
            nextSessionEntryMap.get(entry.sessionId) as string,
          ]),
        ),
      },
      remove: [
        ...staleSessionIds.map((sessionId) =>
          getChatSessionStorageKey(name, sessionId),
        ),
      ],
    });

    if (isPerfDebugEnabled()) {
      const endedAt =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const sessionBytes = nextPayload.sessionEntries.reduce(
        (total, entry) => total + measureBytes(entry.value),
        0,
      );
      const changedSessionBytes = changedSessionEntries.reduce(
        (total, entry) => total + measureBytes(entry.value),
        0,
      );
      console.info("[Perf][ChatPersist]", {
        mode: "write",
        sessionCount: nextPayload.sessionEntries.length,
        changedSessionCount: changedSessionEntries.length,
        fullBytes: measureBytes(value),
        indexBytes: measureBytes(JSON.stringify(nextPayload.index)),
        sessionBytes,
        changedSessionBytes,
        staleSessionCount: staleSessionIds.length,
        durationMs: Number((endedAt - startedAt).toFixed(2)),
      });
    }
  }

  private async removeSplitValue(name: string) {
    const indexKey = getChatIndexStorageKey(name);
    const previousIndexText = await indexedDbStateStorage.getRawItem(indexKey);
    const previousSessionIds = getSessionIdsFromIndexText(previousIndexText);

    await indexedDbStateStorage.applyRawChanges({
      remove: [
        indexKey,
        name,
        ...previousSessionIds.map((sessionId) =>
          getChatSessionStorageKey(name, sessionId),
        ),
      ],
    });
  }

  private async flushPendingWrite(name: string) {
    const pendingValue = this.pendingWrites.get(name);
    if (!pendingValue) {
      return;
    }

    await this.writeSplitValue(name, pendingValue);
    this.cache.set(name, pendingValue);
    this.pendingWrites.delete(name);
  }

  public async getItem(name: string): Promise<string | null> {
    if (!this.isAvailable() || name !== CHAT_STORE_KEY) return null;

    try {
      this.hydrating.add(name);
      const pendingValue = this.pendingWrites.get(name);
      const indexText = await indexedDbStateStorage.getRawItem(
        getChatIndexStorageKey(name),
      );

      if (indexText) {
        const index = parseJson<ChatPersistSplitIndex>(indexText);
        if (index) {
          const startedAt =
            typeof performance !== "undefined" ? performance.now() : Date.now();
          const hydratedSessionIds = getInitialHydratedSessionIds(index);
          const sessionPayloadMap = await indexedDbStateStorage.getRawItems(
            hydratedSessionIds.map((sessionId) =>
              getChatSessionStorageKey(name, sessionId),
            ),
          );
          const sessionPayloads = index.state.sessionIds.map((sessionId) => {
            if (!hydratedSessionIds.includes(sessionId)) {
              return buildSessionPlaceholder(index, sessionId);
            }
            return (
              sessionPayloadMap[getChatSessionStorageKey(name, sessionId)] ??
              null
            );
          });
          const localValue = rebuildChatPersistedState(index, sessionPayloads);
          const resolvedValue = resolveHydratedStateValue(
            pendingValue,
            localValue,
          );
          if (resolvedValue === null) {
            return null;
          }
          if (pendingValue) {
            await this.flushPendingWrite(name);
          }
          this.cache.set(name, resolvedValue);
          this.hydrated.add(name);
          if (isPerfDebugEnabled()) {
            const endedAt =
              typeof performance !== "undefined"
                ? performance.now()
                : Date.now();
            const sessionBytes = sessionPayloads.reduce(
              (total, payloadText) => total + measureBytes(payloadText ?? ""),
              0,
            );
            console.info("[Perf][ChatPersist]", {
              mode: "read",
              sessionCount: index.state.sessionIds.length,
              rebuiltBytes: measureBytes(resolvedValue),
              indexBytes: measureBytes(indexText),
              sessionBytes,
              durationMs: Number((endedAt - startedAt).toFixed(2)),
            });
          }
          return resolvedValue;
        }
      }

      const legacyValue = await indexedDbStateStorage.getItem(name);
      if (legacyValue) {
        const resolvedValue = resolveHydratedStateValue(
          pendingValue,
          legacyValue,
        );
        if (resolvedValue === null) {
          return null;
        }
        if (pendingValue) {
          await this.flushPendingWrite(name);
        }
        this.cache.set(name, resolvedValue);
        this.hydrated.add(name);
        return resolvedValue;
      }

      this.hydrated.add(name);
      if (pendingValue) {
        await this.flushPendingWrite(name);
      }
      return this.pendingWrites.get(name) ?? this.cache.get(name) ?? null;
    } catch (error) {
      console.error(`[ChatPersistStorage] 读取 ${name} 失败`, error);
      return this.pendingWrites.get(name) ?? this.cache.get(name) ?? null;
    } finally {
      this.hydrating.delete(name);
    }
  }

  public async setItem(name: string, value: string): Promise<void> {
    if (!this.isAvailable() || name !== CHAT_STORE_KEY) return;

    if (!this.hydrated.has(name) || this.hydrating.has(name)) {
      this.pendingWrites.set(name, value);
      this.cache.set(name, value);
      return;
    }

    await this.writeSplitValue(name, value);
    this.cache.set(name, value);
    this.pendingWrites.delete(name);
  }

  public async removeItem(name: string): Promise<void> {
    if (!this.isAvailable() || name !== CHAT_STORE_KEY) return;

    await this.removeSplitValue(name);
    this.cache.delete(name);
    this.pendingWrites.delete(name);
    this.hydrated.delete(name);
    this.hydrating.delete(name);
  }
}

export const chatPersistStorage = new ChatPersistStorage();

export async function getPersistedChatSession<T = Record<string, unknown>>(
  sessionId: string,
) {
  if (!sessionId) {
    return null;
  }

  const sessionText = await indexedDbStateStorage.getRawItem(
    getChatSessionStorageKey(CHAT_STORE_KEY, sessionId),
  );
  const splitSession = parseJson<T>(sessionText);
  if (splitSession) {
    return splitSession;
  }

  const legacyStoreText =
    await indexedDbStateStorage.getRawItem(CHAT_STORE_KEY);
  const legacySession = getSessionsFromPersistedEnvelope(legacyStoreText).find(
    (session) => String(session?.id || "") === sessionId,
  );

  return (legacySession as T | undefined) ?? null;
}

export async function setPersistedChatSession(
  sessionId: string,
  value: Record<string, unknown>,
) {
  if (!sessionId) {
    return;
  }

  await indexedDbStateStorage.setRawItem(
    getChatSessionStorageKey(CHAT_STORE_KEY, sessionId),
    JSON.stringify(value),
  );
}

export async function removePersistedChatSession(sessionId: string) {
  if (!sessionId) {
    return;
  }

  await indexedDbStateStorage.removeRawItem(
    getChatSessionStorageKey(CHAT_STORE_KEY, sessionId),
  );
}
