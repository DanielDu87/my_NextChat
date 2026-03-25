import { SyncStore } from "@/app/store/sync";
import type { ChatIndexPayload } from "@/app/utils/chat-sync";
import { withSyncUserHeaders } from "@/app/utils/sync-user-client";

export type DatabaseSyncClient = ReturnType<typeof createDatabaseSyncClient>;
export type StoreSnapshotMeta = {
  key: string;
  updatedAt: string;
  checksum: string;
  sizeBytes: number;
};

type StoreSnapshotWriteExpectation = {
  expectedUpdatedAt?: string;
  expectedChecksum?: string;
  expectedMissing?: boolean;
};

export function createDatabaseSyncClient(_: SyncStore) {
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(path, {
      ...init,
      headers: withSyncUserHeaders({
        "Content-Type": "application/json; charset=utf-8",
        ...(init?.headers || {}),
      }),
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

    async set(
      key: string,
      value: string,
      expectation?: StoreSnapshotWriteExpectation,
    ) {
      await request(`/api/db/sync/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: {
          ...(expectation?.expectedUpdatedAt
            ? { "x-expected-updated-at": expectation.expectedUpdatedAt }
            : {}),
          ...(expectation?.expectedChecksum
            ? { "x-expected-checksum": expectation.expectedChecksum }
            : {}),
          ...(expectation?.expectedMissing
            ? { "x-expected-missing": "1" }
            : {}),
        },
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

    async getChatIndex() {
      const response = await request("/api/db/chat-sync", {
        method: "GET",
        cache: "no-store",
      });
      const payload = await response.json();
      return payload?.index ? (payload.index as ChatIndexPayload) : null;
    },

    async getChatSessions(ids: string[]) {
      if (!Array.isArray(ids) || ids.length === 0) {
        return {} as Record<string, unknown>;
      }

      const response = await request("/api/db/chat-sync/sessions", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      const payload = await response.json();
      return payload?.sessions && typeof payload.sessions === "object"
        ? (payload.sessions as Record<string, unknown>)
        : {};
    },

    async setChatDelta(
      params: {
        index: ChatIndexPayload;
        upsertSessions: Array<Record<string, unknown>>;
        deleteSessionIds?: string[];
      },
      expectation?: StoreSnapshotWriteExpectation,
    ) {
      await request("/api/db/chat-sync", {
        method: "PUT",
        headers: {
          ...(expectation?.expectedUpdatedAt
            ? { "x-expected-updated-at": expectation.expectedUpdatedAt }
            : {}),
          ...(expectation?.expectedChecksum
            ? { "x-expected-checksum": expectation.expectedChecksum }
            : {}),
          ...(expectation?.expectedMissing
            ? { "x-expected-missing": "1" }
            : {}),
        },
        body: JSON.stringify(params),
      });
    },
  };
}
