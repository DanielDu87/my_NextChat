import { useEffect, useState } from "react";

import { ChatSession, useChatStore } from "./chat";

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
  const currentSessionId = useChatStore((state) => {
    const selectedSession = state.sessions[state.currentSessionIndex];
    return selectedSession?.id ?? "";
  });
  const hydratingSessionId = useChatStore((state) => state.hydratingSessionId);
  const currentSessionSummary = useChatStore((state) =>
    state.sessionSummaries.find((summary) => summary.id === currentSessionId),
  );
  const inMemorySession = useChatStore((state) => {
    if (!currentSessionId) {
      return undefined;
    }

    return state.sessions.find((session) => session.id === currentSessionId);
  });
  const isPrunedInMemorySession =
    !!inMemorySession &&
    Number(currentSessionSummary?.messageCount || 0) > 0 &&
    (!Array.isArray(inMemorySession.messages) ||
      inMemorySession.messages.length === 0);
  const [loadedSession, setLoadedSession] = useState<ChatSession | undefined>(
    isPrunedInMemorySession ? undefined : inMemorySession,
  );

  useEffect(() => {
    let cancelled = false;

    if (!currentSessionId) {
      setLoadedSession(undefined);
      return;
    }

    if (inMemorySession && !isPrunedInMemorySession) {
      setLoadedSession(inMemorySession);
      return;
    }

    setLoadedSession(undefined);

    void useChatStore
      .getState()
      .hydrateSessionIntoMemory(currentSessionId)
      .then((session) => {
        if (cancelled) {
          return;
        }

        setLoadedSession(session);
      });

    return () => {
      cancelled = true;
    };
  }, [currentSessionId, inMemorySession, isPrunedInMemorySession]);

  return {
    session: loadedSession,
    loading:
      !!currentSessionId &&
      hydratingSessionId === currentSessionId &&
      (!loadedSession || loadedSession.messages.length === 0),
  };
}
