import { SyncStore } from "@/app/store/sync";

export type DatabaseSyncClient = ReturnType<typeof createDatabaseSyncClient>;
export type StoreSnapshotMeta = {
  key: string;
  updatedAt: string;
  checksum: string;
  sizeBytes: number;
};

export function createDatabaseSyncClient(_: SyncStore) {
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`[DB Sync] ${response.status} ${response.statusText}`);
    }

    return response;
  };

  return {
    async check() {
      try {
        const response = await request("/api/db/health", {
          method: "GET",
          cache: "no-store",
        });
        const payload = await response.json();
        return payload?.ok === true;
      } catch (error) {
        console.error("[DB Sync] check failed", error);
        return false;
      }
    },

    async get(key: string) {
      const response = await request(
        `/api/db/sync/${encodeURIComponent(key)}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );
      return await response.text();
    },

    async set(key: string, value: string) {
      await request(`/api/db/sync/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: value,
      });
    },

    async getMeta(keys?: string[]) {
      const query = new URLSearchParams();
      (keys || []).forEach((key) => query.append("key", key));
      const suffix = query.toString() ? `?${query.toString()}` : "";
      const response = await request(`/api/db/sync-meta${suffix}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = await response.json();
      return Array.isArray(payload?.metas)
        ? (payload.metas as StoreSnapshotMeta[])
        : [];
    },
  };
}
