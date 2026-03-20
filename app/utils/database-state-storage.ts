import { StateStorage } from "zustand/middleware";
import { safeLocalStorage } from "../utils";
import { isPersistStoreKey, PERSIST_STORE_KEYS } from "./sync-store-keys";

type RequestMethod = "GET" | "PUT" | "DELETE";
const localStorage = safeLocalStorage();

async function request(path: string, method: RequestMethod, body?: string) {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers:
      method === "PUT"
        ? {
            "Content-Type": "application/json; charset=utf-8",
          }
        : undefined,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `[DatabaseStateStorage] ${method} ${path} -> ${response.status}${
        errorText ? ` ${errorText}` : ""
      }`,
    );
  }

  return response;
}

class DatabaseStateStorage implements StateStorage {
  private cache = new Map<string, string>();
  private hydrated = new Set<string>();
  private hydrating = new Set<string>();
  private pendingWrites = new Map<string, string>();

  private path(name: string) {
    return `/api/db/sync/${encodeURIComponent(name)}`;
  }

  private isAvailable() {
    return typeof window !== "undefined";
  }

  private async migrateLegacyValue(name: string) {
    const legacyValue = localStorage.getItem(name);
    if (!legacyValue) return null;

    await request(this.path(name), "PUT", legacyValue);
    localStorage.removeItem(name);
    this.cache.set(name, legacyValue);
    return legacyValue;
  }

  private async flushPendingWrite(name: string) {
    const pendingValue = this.pendingWrites.get(name);
    if (!pendingValue) return;

    await request(this.path(name), "PUT", pendingValue);
    this.cache.set(name, pendingValue);
    this.pendingWrites.delete(name);
  }

  public async getItem(name: string): Promise<string | null> {
    if (!this.isAvailable() || !isPersistStoreKey(name)) return null;

    try {
      this.hydrating.add(name);
      const pendingValue = this.pendingWrites.get(name);
      const response = await request(this.path(name), "GET");
      const text = await response.text();
      if (text.length > 0) {
        const resolvedValue = pendingValue ?? text;
        if (pendingValue) {
          await request(this.path(name), "PUT", pendingValue);
        }
        this.cache.set(name, resolvedValue);
        this.hydrated.add(name);
        return resolvedValue;
      }

      const migratedValue = await this.migrateLegacyValue(name);
      this.hydrated.add(name);
      if (migratedValue) {
        const resolvedValue = pendingValue ?? migratedValue;
        if (pendingValue) {
          await request(this.path(name), "PUT", pendingValue);
        }
        this.cache.set(name, resolvedValue);
        return resolvedValue;
      }

      await this.flushPendingWrite(name);
      return this.pendingWrites.get(name) ?? this.cache.get(name) ?? null;
    } catch (error) {
      console.error(`[DatabaseStateStorage] 读取 ${name} 失败`, error);
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
      localStorage.removeItem(name);
      return;
    }

    await request(this.path(name), "PUT", value);
    this.cache.set(name, value);
    this.pendingWrites.delete(name);
    localStorage.removeItem(name);
  }

  public async removeItem(name: string): Promise<void> {
    if (!this.isAvailable() || !isPersistStoreKey(name)) return;

    await request(this.path(name), "DELETE");
    this.cache.delete(name);
    this.pendingWrites.delete(name);
    this.hydrated.delete(name);
    this.hydrating.delete(name);
    localStorage.removeItem(name);
  }

  public async clear(): Promise<void> {
    for (const key of PERSIST_STORE_KEYS) {
      await this.removeItem(key);
    }
  }
}

export const databaseStateStorage = new DatabaseStateStorage();

export async function clearPersistedStateStorage() {
  await databaseStateStorage.clear();
}
