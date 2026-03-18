import { StateStorage } from "zustand/middleware";
import { isPersistStoreKey, PERSIST_STORE_KEYS } from "./sync-store-keys";

const DB_NAME = "nextchat-local-cache";
const STORE_NAME = "state-cache";
const DB_VERSION = 1;
const localStorage = (() => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
})();

function getLocalStorageValue(key: string) {
  return localStorage?.getItem(key) ?? null;
}

function removeLocalStorageValue(key: string) {
  localStorage?.removeItem(key);
}

function isBrowser() {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbRequest<T = unknown>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRemoteValue(name: string) {
  const response = await fetch(`/api/db/sync/${encodeURIComponent(name)}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `[IndexedDBStateStorage] GET /api/db/sync/${name} -> ${response.status}${
        errorText ? ` ${errorText}` : ""
      }`,
    );
  }

  const text = await response.text();
  return text.length > 0 ? text : null;
}

class IndexedDbStateStorage implements StateStorage {
  private cache = new Map<string, string>();
  private hydrated = new Set<string>();
  private hydrating = new Set<string>();
  private pendingWrites = new Map<string, string>();

  private isAvailable() {
    return isBrowser();
  }

  private async getFromIndexedDb(name: string) {
    const db = await openDb();
    try {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const value = await idbRequest<string | undefined>(store.get(name));
      return value ?? null;
    } finally {
      db.close();
    }
  }

  private async setToIndexedDb(name: string, value: string) {
    const db = await openDb();
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      await idbRequest(store.put(value, name));
    } finally {
      db.close();
    }
  }

  private async deleteFromIndexedDb(name: string) {
    const db = await openDb();
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      await idbRequest(store.delete(name));
    } finally {
      db.close();
    }
  }

  private async clearIndexedDb() {
    const db = await openDb();
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      await idbRequest(store.clear());
    } finally {
      db.close();
    }
  }

  private async migrateLegacyValue(name: string) {
    const legacyValue = getLocalStorageValue(name);
    if (!legacyValue) return null;

    await this.setToIndexedDb(name, legacyValue);
    removeLocalStorageValue(name);
    this.cache.set(name, legacyValue);
    return legacyValue;
  }

  private async seedFromRemote(name: string) {
    const remoteValue = await readRemoteValue(name);
    if (!remoteValue) return null;

    await this.setToIndexedDb(name, remoteValue);
    this.cache.set(name, remoteValue);
    return remoteValue;
  }

  private async flushPendingWrite(name: string) {
    const pendingValue = this.pendingWrites.get(name);
    if (!pendingValue) return;

    await this.setToIndexedDb(name, pendingValue);
    this.cache.set(name, pendingValue);
    this.pendingWrites.delete(name);
  }

  public async getItem(name: string): Promise<string | null> {
    if (!this.isAvailable() || !isPersistStoreKey(name)) return null;

    try {
      this.hydrating.add(name);

      const localValue = await this.getFromIndexedDb(name);
      if (localValue) {
        this.cache.set(name, localValue);
        this.pendingWrites.delete(name);
        this.hydrated.add(name);
        return localValue;
      }

      const migratedValue = await this.migrateLegacyValue(name);
      if (migratedValue) {
        this.pendingWrites.delete(name);
        this.hydrated.add(name);
        return migratedValue;
      }

      const remoteValue = await this.seedFromRemote(name);
      if (remoteValue) {
        this.pendingWrites.delete(name);
        this.hydrated.add(name);
        return remoteValue;
      }

      this.hydrated.add(name);
      await this.flushPendingWrite(name);
      return this.cache.get(name) ?? null;
    } catch (error) {
      console.error(`[IndexedDBStateStorage] 读取 ${name} 失败`, error);
      return this.cache.get(name) ?? null;
    } finally {
      this.hydrating.delete(name);
    }
  }

  public async setItem(name: string, value: string): Promise<void> {
    if (!this.isAvailable() || !isPersistStoreKey(name)) return;

    if (!this.hydrated.has(name) || this.hydrating.has(name)) {
      this.pendingWrites.set(name, value);
      this.cache.set(name, value);
      removeLocalStorageValue(name);
      return;
    }

    await this.setToIndexedDb(name, value);
    this.cache.set(name, value);
    this.pendingWrites.delete(name);
    removeLocalStorageValue(name);
  }

  public async removeItem(name: string): Promise<void> {
    if (!this.isAvailable() || !isPersistStoreKey(name)) return;

    await this.deleteFromIndexedDb(name);
    this.cache.delete(name);
    this.pendingWrites.delete(name);
    this.hydrated.delete(name);
    this.hydrating.delete(name);
    removeLocalStorageValue(name);
  }

  public async clear(): Promise<void> {
    for (const key of PERSIST_STORE_KEYS) {
      this.cache.delete(key);
      this.pendingWrites.delete(key);
      this.hydrated.delete(key);
      this.hydrating.delete(key);
      removeLocalStorageValue(key);
    }
    await this.clearIndexedDb();
  }
}

export const indexedDbStateStorage = new IndexedDbStateStorage();

export async function clearPersistedStateStorage() {
  await indexedDbStateStorage.clear();
}
