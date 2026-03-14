import { StateStorage } from "zustand/middleware";
import { get, set, del, clear } from "idb-keyval";
import { safeLocalStorage } from "@/app/utils";

const localStorage = safeLocalStorage();
const MAX_LOCALSTORAGE_MIRROR_SIZE = 100 * 1024;

function shouldMirrorToLocalStorage(value: string) {
  return (
    value.length <= MAX_LOCALSTORAGE_MIRROR_SIZE &&
    !value.includes("data:image/") &&
    !value.includes("base64,")
  );
}

class IndexedDBStorage implements StateStorage {
  public async getItem(name: string): Promise<string | null> {
    try {
      const indexedValue = (await get<string>(name)) ?? null;
      if (indexedValue) {
        return indexedValue;
      }
    } catch (error) {
      // ignore and fallback to localStorage
    }
    return localStorage.getItem(name);
  }

  public async setItem(name: string, value: string): Promise<void> {
    try {
      await set(name, value);
    } catch (error) {
      console.warn(
        "[IndexedDBStorage] Failed to save to IndexedDB, trying localStorage fallback:",
        error,
      );
      localStorage.setItem(name, value);
      return;
    }

    if (shouldMirrorToLocalStorage(value)) {
      localStorage.setItem(name, value);
    } else {
      localStorage.removeItem(name);
    }
  }

  public async removeItem(name: string): Promise<void> {
    localStorage.removeItem(name);
    try {
      await del(name);
    } catch (error) {
      // ignore
    }
  }

  public async clear(): Promise<void> {
    localStorage.clear();
    try {
      await clear();
    } catch (error) {
      // ignore
    }
  }
}

export const indexedDBStorage = new IndexedDBStorage();
