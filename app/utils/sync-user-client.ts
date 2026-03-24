import { safeLocalStorage } from "../utils";

const SYNC_USER_ID_STORAGE_KEY = "nextchat_sync_user_id";
const SYNC_USER_ID_HEADER = "x-nextchat-user-id";
const localStorage = safeLocalStorage();

function createSyncUserId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `nextchat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getOrCreateClientSyncUserId() {
  const existing = localStorage.getItem(SYNC_USER_ID_STORAGE_KEY)?.trim();
  if (existing) {
    return existing;
  }

  const nextId = createSyncUserId();
  localStorage.setItem(SYNC_USER_ID_STORAGE_KEY, nextId);
  return nextId;
}

export function withSyncUserHeaders(headers?: HeadersInit) {
  const nextHeaders = new Headers(headers);
  nextHeaders.set(SYNC_USER_ID_HEADER, getOrCreateClientSyncUserId());
  return nextHeaders;
}

export { SYNC_USER_ID_HEADER };
