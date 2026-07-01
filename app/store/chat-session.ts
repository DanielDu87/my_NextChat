import { useEffect, useMemo, useRef, useState } from "react";

import { ChatSession, normalizeSession, useChatStore } from "./chat";

// loading 延迟显示阈值（毫秒）：hydrate 在该时间内完成则完全不显示遮罩，
// 避免极短的 IndexedDB 读取触发一闪而过的 splash 动画造成碍眼
const SESSION_LOADING_DELAY_MS = 150;

// 延迟门控：flag 置 true 时延迟一段时间才对外生效；置 false 时立即生效。
// 用于消除快速加载时的 loading 闪烁，同时保证内容就绪后立刻撤掉遮罩。
function useDelayedFlag(flag: boolean, delayMs: number) {
  const [delayedFlag, setDelayedFlag] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (flag) {
      if (timerRef.current === null) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          setDelayedFlag(true);
        }, delayMs);
      }
    } else {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setDelayedFlag(false);
    }

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [flag, delayMs]);

  return delayedFlag;
}

export function shouldShowCurrentSessionLoading(params: {
  currentSessionId?: string;
  hydratingSessionId?: string;
  inMemorySession?: ChatSession;
  loadedSession?: ChatSession;
  isPrunedInMemorySession?: boolean;
  summaryMessageCount?: number;
}) {
  if (Number(params.summaryMessageCount || 0) <= 0) {
    return false;
  }

  return (
    !!params.currentSessionId &&
    (params.hydratingSessionId === params.currentSessionId ||
      params.isPrunedInMemorySession) &&
    !(params.inMemorySession || params.loadedSession)
  );
}

export function getCurrentChatSession() {
  return useChatStore.getState().currentSession();
}

export async function getChatSessionDetail(sessionId: string) {
  const inMemorySession = useChatStore.getState().getSessionById(sessionId);
  if (inMemorySession) {
    return inMemorySession;
  }

  return useChatStore.getState().loadSessionById(sessionId);
}

export function useCurrentSession() {
  const currentSessionId = useChatStore(
    (state) =>
      state.selectedSessionId ||
      state.sessions[state.currentSessionIndex]?.id ||
      "",
  );
  const hydratingSessionId = useChatStore((state) => state.hydratingSessionId);
  const currentSessionSummary = useChatStore((state) =>
    state.sessionSummaries.find((summary) => summary.id === currentSessionId),
  );
  const rawInMemorySession = useChatStore((state) => {
    if (!currentSessionId) {
      return undefined;
    }

    return state.sessions.find((session) => session.id === currentSessionId);
  });
  const inMemorySession = useMemo(
    () => normalizeSession(rawInMemorySession),
    [rawInMemorySession],
  );
  const isPrunedInMemorySession =
    !!inMemorySession &&
    Number(currentSessionSummary?.messageCount || 0) > 0 &&
    (!Array.isArray(inMemorySession.messages) ||
      inMemorySession.messages.length === 0);
  const readyInMemorySession =
    inMemorySession && !isPrunedInMemorySession ? inMemorySession : undefined;
  const [loadedSession, setLoadedSession] = useState<ChatSession | undefined>(
    isPrunedInMemorySession ? undefined : inMemorySession,
  );
  const activeLoadedSession =
    loadedSession?.id === currentSessionId ? loadedSession : undefined;
  const lastRequestedSessionIdRef = useRef("");

  useEffect(() => {
    let cancelled = false;

    if (!currentSessionId) {
      setLoadedSession(undefined);
      return;
    }

    if (readyInMemorySession) {
      lastRequestedSessionIdRef.current = "";
      return;
    }

    if (lastRequestedSessionIdRef.current === currentSessionId) {
      return;
    }

    lastRequestedSessionIdRef.current = currentSessionId;
    setLoadedSession(undefined);

    void useChatStore
      .getState()
      .hydrateSessionIntoMemory(currentSessionId)
      .then((session) => {
        if (cancelled) {
          return;
        }

        lastRequestedSessionIdRef.current = "";
        setLoadedSession(normalizeSession(session));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        console.error("[Chat] ❌ 加载会话正文失败:", error);
        lastRequestedSessionIdRef.current = "";
        setLoadedSession(
          normalizeSession(
            useChatStore.getState().getSessionById(currentSessionId),
          ),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [currentSessionId, readyInMemorySession, isPrunedInMemorySession]);

  const rawLoading = shouldShowCurrentSessionLoading({
    currentSessionId,
    hydratingSessionId,
    inMemorySession: readyInMemorySession,
    loadedSession: activeLoadedSession,
    isPrunedInMemorySession,
    summaryMessageCount: Number(currentSessionSummary?.messageCount || 0),
  });
  // 延迟显示：加载在阈值内完成则不显示遮罩，消除快速加载时的闪烁
  const loading = useDelayedFlag(!!rawLoading, SESSION_LOADING_DELAY_MS);

  return {
    session: readyInMemorySession || activeLoadedSession,
    loading,
  };
}
