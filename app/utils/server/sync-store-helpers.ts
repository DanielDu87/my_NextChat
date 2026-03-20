const CHAT_SESSION_ARTIFACT_TYPE = "chat_session";

export function sanitizeJsonPayload(payload: unknown) {
  return JSON.stringify(payload, (_, value) => {
    if (typeof value === "string") {
      return value.replace(/\u0000/g, "");
    }

    return value;
  });
}

export function buildChatSessionRows(
  upsertSessions: Array<Record<string, unknown>>,
) {
  return upsertSessions
    .map((session) => {
      const sessionId = String(session.id || "");
      if (!sessionId) {
        return null;
      }

      return {
        artifactType: CHAT_SESSION_ARTIFACT_TYPE,
        artifactPath: sessionId,
        payloadText: sanitizeJsonPayload(session),
      };
    })
    .filter(Boolean) as Array<{
    artifactType: string;
    artifactPath: string;
    payloadText: string;
  }>;
}

export function dedupeDeleteSessionIds(deleteSessionIds?: string[]) {
  return [...new Set((deleteSessionIds || []).filter(Boolean))];
}
