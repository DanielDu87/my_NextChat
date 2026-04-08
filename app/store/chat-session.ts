import { useEffect, useMemo, useRef, useState } from "react";

import { ChatSession, normalizeSession, useChatStore } from "./chat";

export function shouldShowCurrentSessionLoading(params: {
  currentSessionId?: string;
  hydratingSessionId?: string;
  inMemorySession?: ChatSession;
  loadedSession?: ChatSession;
  summaryMessageCount?: number;
}) {
  if (Number(params.summaryMessageCount || 0) <= 0) {
    return false;
  }

  return (
    !!params.currentSessionId &&
    params.hydratingSessionId === params.currentSessionId &&
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

  return {
    session: readyInMemorySession || loadedSession,
    loading: shouldShowCurrentSessionLoading({
      currentSessionId,
      hydratingSessionId,
      inMemorySession,
      loadedSession,
      summaryMessageCount: Number(currentSessionSummary?.messageCount || 0),
    }),
  };
}
