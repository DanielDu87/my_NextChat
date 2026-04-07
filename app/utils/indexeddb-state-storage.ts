import { StateStorage } from "zustand/middleware";
import { isPersistStoreKey, PERSIST_STORE_KEYS } from "./sync-store-keys";
import { resolveHydratedStateValue } from "./state-storage-helpers";
import { withSyncUserHeaders } from "./sync-user-client";
import { logger } from "./logger";

const DB_NAME = "nextchat-local-cache";
const STORE_NAME = "state-cache";
const DB_VERSION = 1;
const AUTH_CACHE_MARKER_KEY = "nextchat_auth_cache_marker";
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

let sharedDbPromise: Promise<IDBDatabase> | null = null;

function resetSharedDbPromise() {
  sharedDbPromise = null;
}

function openDb() {
  if (sharedDbPromise) {
    return sharedDbPromise;
  }

  sharedDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => resetSharedDbPromise();
      db.onversionchange = () => {
        db.close();
        resetSharedDbPromise();
      };
      resolve(db);
    };
    request.onerror = () => {
      resetSharedDbPromise();
      reject(request.error);
    };
    request.onblocked = () => resetSharedDbPromise();
  });

  return sharedDbPromise;
}

function idbRequest<T = unknown>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function readRemoteValue(name: string) {
  const response = await fetch(`/api/db/sync/${encodeURIComponent(name)}`, {
    method: "GET",
    cache: "no-store",
    headers: withSyncUserHeaders(),
  });

  if (response.status === 401) {
    removeLocalStorageValue(AUTH_CACHE_MARKER_KEY);
    return null;
  }

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
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const value = await idbRequest<string | undefined>(store.get(name));
    return value ?? null;
  }

  public async getRawItem(name: string) {
    if (!this.isAvailable()) return null;
    return this.getFromIndexedDb(name);
  }

  public async getRawItems(names: string[]) {
    if (!this.isAvailable() || names.length === 0) {
      return {} as Record<string, string | null>;
    }

    const db = await openDb();
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const entries = await Promise.all(
      names.map(async (name) => {
        const value = await idbRequest<string | undefined>(store.get(name));
        return [name, value ?? null] as const;
      }),
    );
    await waitForTransaction(transaction);
    return Object.fromEntries(entries) as Record<string, string | null>;
  }

  private async setToIndexedDb(name: string, value: string) {
    const db = await openDb();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    await idbRequest(store.put(value, name));
  }

  public async setRawItem(name: string, value: string) {
    if (!this.isAvailable()) return;
    await this.setToIndexedDb(name, value);
  }

  private async deleteFromIndexedDb(name: string) {
    const db = await openDb();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    await idbRequest(store.delete(name));
  }

  public async removeRawItem(name: string) {
    if (!this.isAvailable()) return;
    await this.deleteFromIndexedDb(name);
  }

  public async applyRawChanges(params: {
    set?: Record<string, string>;
    remove?: string[];
  }) {
    if (!this.isAvailable()) return;

    const setEntries = Object.entries(params.set || {});
    const removeKeys = params.remove || [];
    if (setEntries.length === 0 && removeKeys.length === 0) {
      return;
    }

    const db = await openDb();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    setEntries.forEach(([key, value]) => {
      store.put(value, key);
    });
    removeKeys.forEach((key) => {
      store.delete(key);
    });

    await waitForTransaction(transaction);
  }

  private async clearIndexedDb() {
    const db = await openDb();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    await idbRequest(store.clear());
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
      const pendingValue = this.pendingWrites.get(name);

      const localValue = await this.getFromIndexedDb(name);
      if (localValue) {
        const resolvedValue = resolveHydratedStateValue(
          pendingValue,
          localValue,
        );
        if (resolvedValue === null) {
          return null;
        }
        if (pendingValue) {
          await this.flushPendingWrite(name);
        }
        this.cache.set(name, resolvedValue);
        this.hydrated.add(name);
        return resolvedValue;
      }

      const migratedValue = await this.migrateLegacyValue(name);
      if (migratedValue) {
        const resolvedValue = resolveHydratedStateValue(
          pendingValue,
          migratedValue,
        );
        if (resolvedValue === null) {
          return null;
        }
        if (pendingValue) {
          await this.flushPendingWrite(name);
        }
        this.cache.set(name, resolvedValue);
        this.hydrated.add(name);
        return resolvedValue;
      }

      this.hydrated.add(name);
      await this.flushPendingWrite(name);
      return this.pendingWrites.get(name) ?? this.cache.get(name) ?? null;
    } catch (error) {
      logger.indexedDB.error(`读取 ${name} 失败`, error);
      return this.pendingWrites.get(name) ?? this.cache.get(name) ?? null;
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
