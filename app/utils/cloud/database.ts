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

type ConflictResponsePayload = {
  ok: false;
  error: "snapshot_conflict";
  current?: StoreSnapshotMeta | null;
};

const DB_SYNC_REQUEST_TIMEOUT_MS = 120000;
const DB_CHAT_REQUEST_TIMEOUT_MS = 120000;

async function fetchWithTimeout(
  path: string,
  init?: RequestInit,
  timeoutMs = DB_SYNC_REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(path, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new Error(`[DB Sync] timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(
  path: string,
  init?: RequestInit,
  options?: { timeoutMs?: number; retries?: number },
) {
  const timeoutMs = options?.timeoutMs ?? DB_SYNC_REQUEST_TIMEOUT_MS;
  const retries = options?.retries ?? 0;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchWithTimeout(path, init, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        throw error;
      }
    }
  }

  throw lastError;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSnapshotConflictPayload(
  payload: unknown,
): payload is ConflictResponsePayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "ok" in payload &&
    "error" in payload &&
    (payload as ConflictResponsePayload).ok === false &&
    (payload as ConflictResponsePayload).error === "snapshot_conflict"
  );
}

export function createDatabaseSyncClient(_: SyncStore) {
  const request = async (
    path: string,
    init?: RequestInit,
    options?: {
      timeoutMs?: number;
      retries?: number;
      retryOnStatuses?: number[];
    },
  ) => {
    const retries = options?.retries ?? 0;
    const retryOnStatuses = new Set(options?.retryOnStatuses || []);
    let response: Response | null = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      response = await fetchWithRetry(
        path,
        {
          ...init,
          headers: withSyncUserHeaders({
            "Content-Type": "application/json; charset=utf-8",
            ...(init?.headers || {}),
          }),
        },
        { ...options, retries: 0 },
      );

      if (
        response.ok ||
        attempt >= retries ||
        !retryOnStatuses.has(response.status)
      ) {
        break;
      }

      await wait(300 * (attempt + 1));
    }

    if (!response?.ok) {
      throw new Error(`[DB Sync] ${response?.status} ${response?.statusText}`);
    }

    return response;
  };

  const requestWithConflict = async (
    path: string,
    init?: RequestInit,
    options?: { timeoutMs?: number; retries?: number },
  ): Promise<{ conflict: true; current?: StoreSnapshotMeta | null } | null> => {
    const response = await fetchWithRetry(
      path,
      {
        ...init,
        headers: withSyncUserHeaders({
          "Content-Type": "application/json; charset=utf-8",
          ...(init?.headers || {}),
        }),
      },
      options,
    );

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : null;

    // 检查是否是快照冲突（409），静默处理用于重试
    if (isSnapshotConflictPayload(payload)) {
      return {
        conflict: true,
        current: payload.current ?? null,
      };
    }

    if (!response.ok) {
      throw new Error(`[DB Sync] ${response.status} ${response.statusText}`);
    }

    return null;
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
      const conflict = await requestWithConflict(
        `/api/db/sync/${encodeURIComponent(key)}`,
        {
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
        },
      );

      if (conflict) {
        throw new Error("[DB Sync] 409 Conflict");
      }
    },

    async getMeta(keys?: string[]) {
      const query = new URLSearchParams();
      (keys || []).forEach((key) => query.append("key", key));
      const suffix = query.toString() ? `?${query.toString()}` : "";
      const response = await request(
        `/api/db/sync-meta${suffix}`,
        {
          method: "GET",
          cache: "no-store",
        },
        {
          retries: 2,
          retryOnStatuses: [500, 502, 503, 504],
        },
      );
      const payload = await response.json();
      return Array.isArray(payload?.metas)
        ? (payload.metas as StoreSnapshotMeta[])
        : [];
    },

    async getChatIndex() {
      const response = await request(
        "/api/db/chat-sync",
        {
          method: "GET",
          cache: "no-store",
        },
        {
          timeoutMs: DB_CHAT_REQUEST_TIMEOUT_MS,
          retries: 1,
        },
      );
      const payload = await response.json();
      return payload?.index ? (payload.index as ChatIndexPayload) : null;
    },

    async getChatSessions(ids: string[]) {
      if (!Array.isArray(ids) || ids.length === 0) {
        return {} as Record<string, unknown>;
      }

      const response = await request(
        "/api/db/chat-sync/sessions",
        {
          method: "POST",
          body: JSON.stringify({ ids }),
        },
        {
          timeoutMs: DB_CHAT_REQUEST_TIMEOUT_MS,
          retries: 1,
        },
      );
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
      const conflict = await requestWithConflict(
        "/api/db/chat-sync",
        {
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
        },
        {
          timeoutMs: DB_CHAT_REQUEST_TIMEOUT_MS,
          retries: 1,
        },
      );

      if (conflict) {
        throw new Error("[DB Sync] 409 Conflict");
      }
    },
  };
}
