export function safeLocalStorage(): {
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
