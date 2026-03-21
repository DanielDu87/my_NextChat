import type { ChatMessage, ChatSession } from "../store";

export function getSessionCreatedAt(session: Partial<ChatSession> | undefined) {
  const createdAt = Number(session?.createdAt);
  if (Number.isFinite(createdAt) && createdAt > 0) {
    return createdAt;
  }

  const lastUpdate = Number(session?.lastUpdate);
  if (Number.isFinite(lastUpdate) && lastUpdate > 0) {
    return lastUpdate;
  }

  return 0;
}

export function sortSessionsByCreatedAt(sessions: ChatSession[]) {
  return sessions.sort((a, b) => {
    const createdAtDiff = getSessionCreatedAt(b) - getSessionCreatedAt(a);
    if (createdAtDiff !== 0) {
      return createdAtDiff;
    }

    return Number(b.lastUpdate || 0) - Number(a.lastUpdate || 0);
  });
}

export function getMessageTime(message: Pick<ChatMessage, "date"> | undefined) {
  const timestamp = Date.parse(String(message?.date || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function getSessionMessages(session: Partial<ChatSession> | undefined) {
  const messages = session?.messages;
  return Array.isArray(messages) ? messages : [];
}

function isSameMessageVersion(
  a: ChatMessage | undefined,
  b: ChatMessage | undefined,
) {
  if (!a || !b) {
    return false;
  }
  return a === b || getMessageTime(a) === getMessageTime(b);
}

export function canReuseSessionMessages(
  localMessages: ChatMessage[],
  remoteMessages: ChatMessage[],
) {
  if (localMessages === remoteMessages) {
    return true;
  }
  if (localMessages.length !== remoteMessages.length) {
    return false;
  }

  const remoteMessageMap = new Map<string, ChatMessage>();
  remoteMessages.forEach((message) => {
    remoteMessageMap.set(message.id, message);
  });

  for (const localMessage of localMessages) {
    const remoteMessage = remoteMessageMap.get(localMessage.id);
    if (!isSameMessageVersion(localMessage, remoteMessage)) {
      return false;
    }
  }

  return true;
}

export function mergeSessionMessages(
  localSession: ChatSession,
  remoteSession: ChatSession,
) {
  const localMessages = getSessionMessages(localSession);
  const remoteMessages = getSessionMessages(remoteSession);

  if (canReuseSessionMessages(localMessages, remoteMessages)) {
    return localMessages;
  }

  const messageMap = new Map<string, ChatMessage>();
  localMessages.forEach((message) => {
    messageMap.set(message.id, message);
  });
  remoteMessages.forEach((message) => {
    const existing = messageMap.get(message.id);
    if (!existing || getMessageTime(message) > getMessageTime(existing)) {
      messageMap.set(message.id, message);
    }
  });

  return Array.from(messageMap.values()).sort(
    (a, b) => getMessageTime(a) - getMessageTime(b),
  );
}
