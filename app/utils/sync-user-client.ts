function safeLocalStorage(): {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
} {
  let storage: Storage | null;

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      storage = window.localStorage;
    } else {
      storage = null;
    }
  } catch {
    storage = null;
  }

  return {
    getItem(key: string): string | null {
      if (storage) {
        return storage.getItem(key);
      }

      return null;
    },
    setItem(key: string, value: string): void {
      if (storage) {
        try {
          storage.setItem(key, value);
        } catch (error) {
          console.warn(
            `[safeLocalStorage] Failed to set item "${key}", skipping localStorage write:`,
            error,
          );
        }
      }
    },
    removeItem(key: string): void {
      if (storage) {
        storage.removeItem(key);
      }
    },
    clear(): void {
      if (storage) {
        storage.clear();
      }
    },
  };
}

const SYNC_USER_ID_STORAGE_KEY = "nextchat_sync_user_id";
const SYNC_USER_ID_HEADER = "x-nextchat-user-id";
const localStorage = safeLocalStorage();
const FIXED_SYNC_USER_ID =
  process.env.NEXT_PUBLIC_DEFAULT_SYNC_USER_ID?.trim() || "";

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
  if (FIXED_SYNC_USER_ID) {
    localStorage.setItem(SYNC_USER_ID_STORAGE_KEY, FIXED_SYNC_USER_ID);
    return FIXED_SYNC_USER_ID;
  }

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
