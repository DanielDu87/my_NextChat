export const AUTO_SYNC_LOCK_KEY = "nextchat_auto_sync_lock";
export const AUTO_SYNC_CHANNEL_NAME = "nextchat-sync";
export const AUTO_SYNC_LOCK_TTL_MS = 30_000;

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
