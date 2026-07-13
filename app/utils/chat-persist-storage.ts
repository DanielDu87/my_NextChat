import { StateStorage } from "zustand/middleware";
import {
  buildPersistedStoreState,
  unwrapPersistedStoreState,
} from "./sync-store-keys";
import { indexedDbStateStorage } from "./indexeddb-state-storage";
import { resolveHydratedStateValue } from "./state-storage-helpers";
import {
  isPerfDebugEnabled,
  isPerfFeatureEnabled,
  logPerfSummary,
  nowMs,
} from "./perf";
import { logger } from "./logger";

type PersistedEnvelope = {
  state?: Record<string, unknown>;
  version?: number;
};

const AUTH_CACHE_MARKER_KEY = "nextchat_auth_cache_marker";
const localStorage = (() => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
})();

export type ChatPersistSplitIndex = {
  version: 2;
  persistVersion: number;
  ownerId: string;
  state: Record<string, unknown> & {
    sessionIds: string[];
  };
};

const CHAT_INDEX_SUFFIX = "::index";
const CHAT_SESSION_SUFFIX = "::session::";
const CHAT_STORE_KEY = "chat-next-web-store";
const CHAT_STORE_SCOPE_SUFFIX = "::user::";
export const INITIAL_HYDRATED_RECENT_SESSION_LIMIT = 3;
// 每个用户先保留最近 50 个会话壳，正文仍按需读取，避免一次水合全部历史消息。
export const INITIAL_RETAINED_SESSION_LIMIT = 50;

export function getChatIndexStorageKey(name: string) {
  return `${name}${CHAT_INDEX_SUFFIX}`;
}

export function getChatSessionStorageKey(name: string, sessionId: string) {
  return `${name}${CHAT_SESSION_SUFFIX}${sessionId}`;
}

export function getActiveChatStoreScopeUserId() {
  return String(localStorage?.getItem(AUTH_CACHE_MARKER_KEY) || "").trim();
}

export function getScopedChatStoreKey(name: string, userId?: string) {
  const scopedUserId = String(
    typeof userId === "string" ? userId : getActiveChatStoreScopeUserId(),
  ).trim();
  return `${name}${CHAT_STORE_SCOPE_SUFFIX}${scopedUserId || "anonymous"}`;
}

function isScopedChatStoreKeyActive(scopedName: string) {
  return getScopedChatOwnerId(scopedName) === getActiveChatStoreScopeUserId();
}

function getScopedChatOwnerId(scopedName: string) {
  const separatorIndex = scopedName.lastIndexOf(CHAT_STORE_SCOPE_SUFFIX);
  return separatorIndex >= 0
    ? scopedName.slice(separatorIndex + CHAT_STORE_SCOPE_SUFFIX.length)
    : "";
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

function measureBytes(value: string) {
  return new TextEncoder().encode(value).length;
}

function getSessionSummariesFromIndex(index: ChatPersistSplitIndex) {
  return Array.isArray((index.state as any).sessionSummaries)
    ? ((index.state as any).sessionSummaries as Array<Record<string, unknown>>)
    : [];
}

function createSessionSummaryMap(index: ChatPersistSplitIndex) {
  return new Map(
    getSessionSummariesFromIndex(index)
      .filter((summary) => summary?.id)
      .map((summary) => [String(summary.id), summary]),
  );
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
      version: 2 as const,
      persistVersion: Number(payload?.version ?? 0),
      // 缓存键和 payload 都绑定同一个用户。双重校验可以阻止旧版无归属
      // 缓存或错误迁移的缓存被另一个用户直接展示。
      ownerId: getActiveChatStoreScopeUserId() || "anonymous",
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
  sessionPayloads: Array<string | Record<string, unknown> | null>,
) {
  const sessions = index.state.sessionIds
    .map((sessionId, indexPosition) => {
      const sessionPayload = sessionPayloads[indexPosition];
      const parsed =
        typeof sessionPayload === "string"
          ? parseJson<Record<string, unknown>>(sessionPayload)
          : sessionPayload;
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
  const sessionSummaryMap = createSessionSummaryMap(index);
  const isMeaningfulSession = (sessionId: string) => {
    const summary = sessionSummaryMap.get(sessionId);
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

function getInitialRetainedSessionIds(index: ChatPersistSplitIndex) {
  const sessionIds = Array.isArray(index.state.sessionIds)
    ? index.state.sessionIds.filter(Boolean)
    : [];
  const currentSessionIndex = Math.max(
    0,
    Number(index.state.currentSessionIndex) || 0,
  );
  const currentSessionId = sessionIds[currentSessionIndex] || "";
  const leadingSessionIds = sessionIds.slice(0, INITIAL_RETAINED_SESSION_LIMIT);

  return Array.from(
    new Set([currentSessionId, ...leadingSessionIds].filter(Boolean)),
  );
}

function buildSessionPlaceholder(
  index: ChatPersistSplitIndex,
  sessionId: string,
  summaryMap = createSessionSummaryMap(index),
) {
  const summary = summaryMap.get(sessionId);

  return {
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
  };
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
  summaryMap = createSessionSummaryMap(index),
) {
  const summary = summaryMap.get(sessionId);
  return Number(summary?.messageCount || 0);
}

function isPrunedSessionPayload(
  index: ChatPersistSplitIndex,
  sessionId: string,
  value: string,
  summaryMap = createSessionSummaryMap(index),
) {
  const summaryMessageCount = getSessionSummaryMessageCount(
    index,
    sessionId,
    summaryMap,
  );
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
  private lastHydratedUserId: string =
    typeof window !== "undefined" ? getActiveChatStoreScopeUserId() : "";
  private hasWarnedAboutStorageQuota = false;

  public setLastHydratedUserId(userId: string) {
    this.lastHydratedUserId = String(userId || "").trim();
  }

  public getLastHydratedUserId() {
    return this.lastHydratedUserId;
  }

  private isAvailable() {
    return typeof window !== "undefined";
  }

  private async writeSplitValue(
    name: string,
    scopedName: string,
    value: string,
  ) {
    const startedAt = nowMs();
    const nextPayload = splitChatPersistedState(value);
    nextPayload.index.ownerId = getScopedChatOwnerId(scopedName);
    const summaryMap = createSessionSummaryMap(nextPayload.index);
    const nextIndexKey = getChatIndexStorageKey(scopedName);
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
      getChatSessionStorageKey(scopedName, entry.sessionId),
    );
    const previousSessionPayloads = await indexedDbStateStorage.getRawItems(
      nextSessionStorageKeys,
    );
    const changedSessionEntries = nextPayload.sessionEntries.filter((entry) => {
      const storageKey = getChatSessionStorageKey(scopedName, entry.sessionId);
      const isPrunedPayload = isPrunedSessionPayload(
        nextPayload.index,
        entry.sessionId,
        entry.value,
        summaryMap,
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
            getChatSessionStorageKey(scopedName, entry.sessionId),
            nextSessionEntryMap.get(entry.sessionId) as string,
          ]),
        ),
      },
      remove: [
        ...staleSessionIds.map((sessionId) =>
          getChatSessionStorageKey(scopedName, sessionId),
        ),
      ],
    });

    void this.warnWhenStorageQuotaIsLow();

    if (isPerfDebugEnabled()) {
      const sessionBytes = nextPayload.sessionEntries.reduce(
        (total, entry) => total + measureBytes(entry.value),
        0,
      );
      const changedSessionBytes = changedSessionEntries.reduce(
        (total, entry) => total + measureBytes(entry.value),
        0,
      );
      logPerfSummary("ChatPersist", {
        mode: "write",
        sessionCount: nextPayload.sessionEntries.length,
        changedSessionCount: changedSessionEntries.length,
        fullBytes: measureBytes(value),
        indexBytes: measureBytes(JSON.stringify(nextPayload.index)),
        sessionBytes,
        changedSessionBytes,
        staleSessionCount: staleSessionIds.length,
        durationMs: Number((nowMs() - startedAt).toFixed(2)),
      });
    }
  }

  private async warnWhenStorageQuotaIsLow() {
    if (
      this.hasWarnedAboutStorageQuota ||
      typeof navigator === "undefined" ||
      typeof navigator.storage?.estimate !== "function"
    ) {
      return;
    }

    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      if (quota > 0 && usage / quota >= 0.8) {
        this.hasWarnedAboutStorageQuota = true;
        logger.chatPersist.warn("浏览器本地缓存空间接近上限", {
          usage,
          quota,
          ratio: Number((usage / quota).toFixed(3)),
        });
      }
    } catch {
      // 存储配额 API 在部分浏览器不可用，不影响正常缓存读写。
    }
  }

  private async removeSplitValue(name: string, scopedName: string) {
    const indexKey = getChatIndexStorageKey(scopedName);
    const previousIndexText = await indexedDbStateStorage.getRawItem(indexKey);
    const previousSessionIds = getSessionIdsFromIndexText(previousIndexText);

    await indexedDbStateStorage.applyRawChanges({
      remove: [
        indexKey,
        scopedName,
        ...previousSessionIds.map((sessionId) =>
          getChatSessionStorageKey(scopedName, sessionId),
        ),
      ],
    });
  }

  private async flushPendingWrite(name: string, scopedName: string) {
    const pendingValue = this.pendingWrites.get(scopedName);
    if (!pendingValue) {
      return;
    }

    await this.writeSplitValue(name, scopedName, pendingValue);
    this.cache.set(scopedName, pendingValue);
    this.pendingWrites.delete(scopedName);
  }

  public async getItem(name: string): Promise<string | null> {
    if (!this.isAvailable() || name !== CHAT_STORE_KEY) return null;

    const scopedName = getScopedChatStoreKey(name);
    const expectedOwnerId = getScopedChatOwnerId(scopedName);

    try {
      this.hydrating.add(scopedName);
      const pendingValue = this.pendingWrites.get(scopedName);
      const indexText = await indexedDbStateStorage.getRawItem(
        getChatIndexStorageKey(scopedName),
      );

      if (!isScopedChatStoreKeyActive(scopedName)) {
        return null;
      }

      if (indexText) {
        const index = parseJson<ChatPersistSplitIndex>(indexText);
        const isOwnedByActiveUser =
          index?.version === 2 && index.ownerId === expectedOwnerId;
        if (index && isOwnedByActiveUser) {
          const startedAt = nowMs();
          const summaryMap = createSessionSummaryMap(index);
          const retainedSessionIds = new Set(
            getInitialRetainedSessionIds(index),
          );
          const hydratedSessionIds = getInitialHydratedSessionIds(index);
          const sessionPayloadMap = await indexedDbStateStorage.getRawItems(
            hydratedSessionIds.map((sessionId) =>
              getChatSessionStorageKey(scopedName, sessionId),
            ),
          );
          if (!isScopedChatStoreKeyActive(scopedName)) {
            return null;
          }
          const placeholderStartedAt = nowMs();
          const sessionPayloads = index.state.sessionIds.map((sessionId) => {
            if (!retainedSessionIds.has(sessionId)) {
              return null;
            }
            if (!hydratedSessionIds.includes(sessionId)) {
              const placeholder = buildSessionPlaceholder(
                index,
                sessionId,
                summaryMap,
              );
              return isPerfFeatureEnabled("PERF_ENABLE_CHAT_LAZY_HYDRATE")
                ? placeholder
                : JSON.stringify(placeholder);
            }
            return (
              sessionPayloadMap[
                getChatSessionStorageKey(scopedName, sessionId)
              ] ?? null
            );
          });
          const localValue = rebuildChatPersistedState(index, sessionPayloads);
          const resolvedValue = resolveHydratedStateValue(
            pendingValue,
            localValue,
          );
          if (resolvedValue === null) {
            this.lastHydratedUserId = expectedOwnerId;
            return null;
          }
          if (pendingValue) {
            await this.flushPendingWrite(name, scopedName);
          }
          this.cache.set(scopedName, resolvedValue);
          this.hydrated.add(scopedName);
          this.lastHydratedUserId = expectedOwnerId;
          if (isPerfDebugEnabled()) {
            const sessionBytes = sessionPayloads.reduce(
              (total, payloadText) =>
                total +
                measureBytes(
                  typeof payloadText === "string"
                    ? payloadText
                    : JSON.stringify(payloadText ?? {}),
                ),
              0,
            );
            logPerfSummary("ChatPersist", {
              mode: "read",
              sessionCount: index.state.sessionIds.length,
              hydratedSessionCount: hydratedSessionIds.length,
              retainedSessionCount: retainedSessionIds.size,
              placeholderSessionCount:
                retainedSessionIds.size - hydratedSessionIds.length,
              placeholderBuildDurationMs: Number(
                (nowMs() - placeholderStartedAt).toFixed(2),
              ),
              rebuiltBytes: measureBytes(resolvedValue),
              indexBytes: measureBytes(indexText),
              sessionBytes,
              durationMs: Number((nowMs() - startedAt).toFixed(2)),
            });
          }
          return resolvedValue;
        }

        if (index) {
          // v1 缓存没有 ownerId，无法证明它没有从旧的全局缓存迁移而来；
          // 本次不展示也不删除，留给当前用户的 download-only 同步安全重建。
          logger.chatPersist.warn("跳过无归属或归属不匹配的聊天缓存", {
            scopedName,
            expectedOwnerId,
            cachedOwnerId: index.ownerId || "",
            cacheVersion: index.version,
          });
          this.hydrated.add(scopedName);
          this.lastHydratedUserId = expectedOwnerId;
          return null;
        }
      }

      this.hydrated.add(scopedName);
      if (pendingValue) {
        await this.flushPendingWrite(name, scopedName);
      }
      const resolvedValue =
        this.pendingWrites.get(scopedName) ??
        this.cache.get(scopedName) ??
        null;
      this.lastHydratedUserId = expectedOwnerId;
      return resolvedValue;
    } catch (error) {
      logger.chatPersist.error(`读取 ${name} 失败`, error);
      this.lastHydratedUserId = expectedOwnerId;
      return (
        this.pendingWrites.get(scopedName) ?? this.cache.get(scopedName) ?? null
      );
    } finally {
      this.hydrating.delete(scopedName);
    }
  }

  public async setItem(name: string, value: string): Promise<void> {
    if (!this.isAvailable() || name !== CHAT_STORE_KEY) return;

    const scopedName = getScopedChatStoreKey(name);
    const activeUserId = getScopedChatOwnerId(scopedName);

    // 关键校验：如果当前 activeUserId 与内存水合的 lastHydratedUserId 不一致，
    // 说明内存仍为旧用户数据（或正处于切换空窗期），拒绝写入，避免旧数据污染新用户。
    if (this.lastHydratedUserId && activeUserId !== this.lastHydratedUserId) {
      logger.chatPersist.warn(
        `[chatPersistStorage] 拦截到跨用户数据写入尝试，已拒绝。`,
        {
          activeUserId,
          lastHydratedUserId: this.lastHydratedUserId,
        },
      );
      return;
    }

    if (!this.hydrated.has(scopedName) || this.hydrating.has(scopedName)) {
      this.pendingWrites.set(scopedName, value);
      this.cache.set(scopedName, value);
      return;
    }

    await this.writeSplitValue(name, scopedName, value);
    if (!isScopedChatStoreKeyActive(scopedName)) {
      return;
    }
    this.cache.set(scopedName, value);
    this.pendingWrites.delete(scopedName);
  }

  public async removeItem(name: string): Promise<void> {
    if (!this.isAvailable() || name !== CHAT_STORE_KEY) return;

    const scopedName = getScopedChatStoreKey(name);
    await this.removeSplitValue(name, scopedName);
    this.cache.delete(scopedName);
    this.pendingWrites.delete(scopedName);
    this.hydrated.delete(scopedName);
    this.hydrating.delete(scopedName);
  }
}

export const chatPersistStorage = new ChatPersistStorage();

export async function getPersistedChatSession<T = Record<string, unknown>>(
  sessionId: string,
) {
  if (!sessionId) {
    return null;
  }

  const scopedName = getScopedChatStoreKey(CHAT_STORE_KEY);
  const activeUserId = getScopedChatOwnerId(scopedName);

  // 切换用户时，旧用户尚未结束的懒加载任务不能借由新 marker 读取目标用户分片。
  if (
    chatPersistStorage.getLastHydratedUserId() &&
    activeUserId !== chatPersistStorage.getLastHydratedUserId()
  ) {
    return null;
  }

  const sessionText = await indexedDbStateStorage.getRawItem(
    getChatSessionStorageKey(scopedName, sessionId),
  );
  if (!isScopedChatStoreKeyActive(scopedName)) {
    return null;
  }
  const splitSession = parseJson<T>(sessionText);
  if (splitSession) {
    return splitSession;
  }

  // 无 owner 的旧分片不能再回填到当前用户缓存，否则会重新引入跨用户串线。
  return null;
}

export async function setPersistedChatSession(
  sessionId: string,
  value: Record<string, unknown>,
) {
  if (!sessionId) {
    return;
  }

  const scopedName = getScopedChatStoreKey(CHAT_STORE_KEY);
  const activeUserId = getScopedChatOwnerId(scopedName);

  if (
    chatPersistStorage.getLastHydratedUserId() &&
    activeUserId !== chatPersistStorage.getLastHydratedUserId()
  ) {
    logger.chatPersist.warn(
      `[setPersistedChatSession] 拦截到跨用户数据写入尝试，已拒绝。`,
      {
        activeUserId,
        lastHydratedUserId: chatPersistStorage.getLastHydratedUserId(),
      },
    );
    return;
  }

  await indexedDbStateStorage.setRawItem(
    getChatSessionStorageKey(scopedName, sessionId),
    JSON.stringify(value),
  );
}

export async function removePersistedChatSession(sessionId: string) {
  if (!sessionId) {
    return;
  }

  const scopedName = getScopedChatStoreKey(CHAT_STORE_KEY);
  const activeUserId = getScopedChatOwnerId(scopedName);

  // 删除也必须受同一隔离锁保护：旧用户延迟完成的删除不能删掉目标用户缓存。
  if (
    chatPersistStorage.getLastHydratedUserId() &&
    activeUserId !== chatPersistStorage.getLastHydratedUserId()
  ) {
    logger.chatPersist.warn(
      "[removePersistedChatSession] 拦截到跨用户缓存删除尝试，已拒绝。",
      {
        activeUserId,
        lastHydratedUserId: chatPersistStorage.getLastHydratedUserId(),
      },
    );
    return;
  }

  await indexedDbStateStorage.removeRawItem(
    getChatSessionStorageKey(scopedName, sessionId),
  );
}

export async function hasPersistedChatCache(userId: string): Promise<boolean> {
  if (typeof window === "undefined" || !userId) {
    return false;
  }
  const scopedName = getScopedChatStoreKey(CHAT_STORE_KEY, userId);
  const indexKey = getChatIndexStorageKey(scopedName);
  const indexText = await indexedDbStateStorage.getRawItem(indexKey);
  if (!indexText) {
    return false;
  }
  const parsed = parseJson<ChatPersistSplitIndex>(indexText);
  return !!(parsed && parsed.version === 2 && parsed.ownerId === userId);
}
