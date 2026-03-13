import { StateStorage } from "zustand/middleware";
import { get, set, del, clear } from "idb-keyval";
import { safeLocalStorage } from "@/app/utils";

const localStorage = safeLocalStorage();

class IndexedDBStorage implements StateStorage {
  public async getItem(name: string): Promise<string | null> {
    // 优先从 localStorage 读取，确保数据一致性
    const localValue = localStorage.getItem(name);
    if (localValue) {
      return localValue;
    }
    try {
      return (await get<string>(name)) ?? null;
    } catch (error) {
      return null;
    }
  }

  public async setItem(name: string, value: string): Promise<void> {
    // 同时保存到 IndexedDB 和 localStorage
    // localStorage 作为主要存储，确保数据不会丢失
    localStorage.setItem(name, value);

    try {
      await set(name, value);
    } catch (error) {
      // IndexedDB 失败时，localStorage 已经保存了
      console.warn(
        "[IndexedDBStorage] Failed to save to IndexedDB, using localStorage:",
        error,
      );
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
