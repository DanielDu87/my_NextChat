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

function getFixedClientSyncUserId() {
  if (!FIXED_SYNC_USER_ID) {
    throw new Error(
      "[SyncUser] 缺少 NEXT_PUBLIC_DEFAULT_SYNC_USER_ID，当前已禁用浏览器侧随机 user_id",
    );
  }

  localStorage.removeItem(SYNC_USER_ID_STORAGE_KEY);
  localStorage.setItem(SYNC_USER_ID_STORAGE_KEY, FIXED_SYNC_USER_ID);
  return FIXED_SYNC_USER_ID;
}

export function withSyncUserHeaders(headers?: HeadersInit) {
  const nextHeaders = new Headers(headers);
  nextHeaders.set(SYNC_USER_ID_HEADER, getFixedClientSyncUserId());
  return nextHeaders;
}

export { getFixedClientSyncUserId, SYNC_USER_ID_HEADER };
