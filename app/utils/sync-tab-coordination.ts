export const AUTO_SYNC_LOCK_KEY = "nextchat_auto_sync_lock";
export const AUTO_SYNC_CHANNEL_NAME = "nextchat-sync";
export const AUTO_SYNC_LOCK_TTL_MS = 30_000;
export const AUTO_SYNC_TAB_ID_KEY = "nextchat_auto_sync_tab_id";
export const CHAT_SYNC_HINT_KEY = "nextchat_chat_sync_hint";
export const CHAT_SYNC_UPDATED_MESSAGE_TYPE = "chat-sync-updated";

export type ChatSyncHint = {
  owner: string;
  updatedAt: number;
};

export type AutoSyncLock = {
  owner: string;
  expiresAt: number;
};

export function parseAutoSyncLock(raw: string | null | undefined) {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AutoSyncLock>;
    if (
      typeof parsed.owner !== "string" ||
      !parsed.owner ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt)
    ) {
      return null;
    }

    return {
      owner: parsed.owner,
      expiresAt: parsed.expiresAt,
    } satisfies AutoSyncLock;
  } catch {
    return null;
  }
}

export function buildAutoSyncLock(
  owner: string,
  now = Date.now(),
  ttlMs = AUTO_SYNC_LOCK_TTL_MS,
) {
  return {
    owner,
    expiresAt: now + ttlMs,
  } satisfies AutoSyncLock;
}

export function isAutoSyncLockActive(
  lock: AutoSyncLock | null | undefined,
  now = Date.now(),
) {
  return !!lock && lock.expiresAt > now;
}

export function shouldAutoSyncLockBeTakenOver(
  lock: AutoSyncLock | null | undefined,
  owner: string,
  now = Date.now(),
) {
  if (!lock) {
    return true;
  }

  if (lock.owner === owner) {
    return true;
  }

  return !isAutoSyncLockActive(lock, now);
}

export function buildChatSyncHint(owner: string, updatedAt = Date.now()) {
  return {
    owner,
    updatedAt,
  } satisfies ChatSyncHint;
}

export function parseChatSyncHint(raw: string | null | undefined) {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ChatSyncHint>;
    if (
      typeof parsed.owner !== "string" ||
      !parsed.owner ||
      typeof parsed.updatedAt !== "number" ||
      !Number.isFinite(parsed.updatedAt)
    ) {
      return null;
    }

    return {
      owner: parsed.owner,
      updatedAt: parsed.updatedAt,
    } satisfies ChatSyncHint;
  } catch {
    return null;
  }
}

export function getOrCreateAutoSyncTabId(
  storage?: Pick<Storage, "getItem" | "setItem"> | null,
) {
  const existing = String(storage?.getItem(AUTO_SYNC_TAB_ID_KEY) || "").trim();
  if (existing) {
    return existing;
  }

  const nextId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  storage?.setItem(AUTO_SYNC_TAB_ID_KEY, nextId);
  return nextId;
}
