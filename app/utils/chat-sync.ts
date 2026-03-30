import { DEFAULT_TOPIC } from "../store/chat-defaults";

type ChatSessionLike = {
  id?: string;
  topic?: string;
  createdAt?: number;
  lastUpdate?: number;
  messages?: unknown[];
  memoryPrompt?: string;
};

type ChatStateLike = {
  sessions?: ChatSessionLike[];
  currentSessionIndex?: number;
  [key: string]: unknown;
};

export type ChatIndexSessionEntry = {
  id: string;
  topic: string;
  createdAt: number;
  lastUpdate: number;
  messageCount: number;
};

export type ChatIndexPayload = {
  version: 1;
  state: Record<string, unknown> & {
    currentSessionId?: string;
  };
  sessions: ChatIndexSessionEntry[];
};

export function shouldSyncChatSession(session: ChatSessionLike | undefined) {
  if (!session?.id) {
    return false;
  }

  const messageCount = Array.isArray(session.messages)
    ? session.messages.length
    : 0;
  const topic = String(session.topic || "").trim();
  const hasMemoryPrompt =
    typeof session.memoryPrompt === "string" &&
    session.memoryPrompt.trim().length > 0;
  const isUntouchedEmptyChat =
    messageCount === 0 &&
    !hasMemoryPrompt &&
    (!topic || topic === DEFAULT_TOPIC || topic === "新的聊天");

  if (isUntouchedEmptyChat) {
    return false;
  }

  return true;
}

export function getSyncableChatSessions<T extends ChatSessionLike>(
  sessions: T[],
) {
  return normalizeChatSessions(sessions).filter((session) =>
    shouldSyncChatSession(session),
  );
}

function toFiniteNumber(value: unknown) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : 0;
}

export function normalizeChatSessions<T extends ChatSessionLike>(
  sessions: T[],
) {
  return Array.isArray(sessions) ? sessions : [];
}

export function buildChatIndexPayload(
  chatState: ChatStateLike,
): ChatIndexPayload {
  const allSessions = normalizeChatSessions(
    chatState.sessions as ChatSessionLike[],
  );
  const sessions = getSyncableChatSessions(allSessions);
  const currentSessionIndex = toFiniteNumber(chatState.currentSessionIndex);
  const rawCurrentSessionId = allSessions[currentSessionIndex]?.id;
  const currentSessionId =
    typeof rawCurrentSessionId === "string" &&
    sessions.some((session) => session.id === rawCurrentSessionId)
      ? rawCurrentSessionId
      : sessions[0]?.id;
  const {
    sessions: _sessions,
    currentSessionIndex: _currentSessionIndex,
    ...rest
  } = chatState;

  return {
    version: 1,
    state: {
      ...rest,
      currentSessionId:
        typeof currentSessionId === "string" ? currentSessionId : "",
      // 使用 sessions（过滤后的）来生成 sessionIds，确保一致性
      sessionIds: sessions
        .map((session) => (session.id ? String(session.id) : ""))
        .filter(Boolean),
    },
    sessions: sessions.map((session) => ({
      id: String(session.id || ""),
      topic: String(session.topic || ""),
      createdAt: toFiniteNumber(session.createdAt),
      lastUpdate: toFiniteNumber(session.lastUpdate),
      messageCount: Array.isArray(session.messages)
        ? session.messages.length
        : 0,
    })),
  };
}

export function buildChatStateFromIndex(
  indexPayload: ChatIndexPayload,
  sessionsById: Record<string, unknown>,
) {
  const currentSessionId =
    typeof indexPayload.state?.currentSessionId === "string"
      ? indexPayload.state.currentSessionId
      : "";
  const sessions = indexPayload.sessions
    .map((entry) => {
      const payload = sessionsById[entry.id];
      if (!payload || typeof payload !== "object") {
        return null;
      }

      return payload;
    })
    .filter(Boolean) as Record<string, unknown>[];

  const currentSessionIndex = currentSessionId
    ? sessions.findIndex((session) => session.id === currentSessionId)
    : 0;

  const { currentSessionId: _currentSessionId, ...restState } =
    indexPayload.state;

  return {
    ...restState,
    currentSessionIndex: currentSessionIndex >= 0 ? currentSessionIndex : 0,
    sessions,
  };
}

export function createChatSessionMap<T extends ChatSessionLike>(sessions: T[]) {
  const sessionMap = new Map<string, T>();

  getSyncableChatSessions(sessions).forEach((session) => {
    if (!session?.id) {
      return;
    }

    sessionMap.set(String(session.id), session);
  });

  return sessionMap;
}

export function createChatIndexEntryMap(entries: ChatIndexSessionEntry[]) {
  const entryMap = new Map<string, ChatIndexSessionEntry>();

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry?.id) {
      return;
    }

    entryMap.set(String(entry.id), entry);
  });

  return entryMap;
}
