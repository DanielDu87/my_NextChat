import { jest } from "@jest/globals";

type SnapshotMeta = {
  updatedAt: string;
  checksum: string;
};

type RequestLike = {
  headers: Headers;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
};

const getStoreSnapshotMetaMock = jest.fn<
  (storeKey: string, userId: string) => Promise<SnapshotMeta | null>
>();
const setStoreSnapshotMock = jest.fn(async () => undefined);
const applyChatDeltaMock = jest.fn(async () => undefined);
const withRetryablePostgresOperationMock = jest.fn(
  async <T>(handler: () => Promise<T>) => handler(),
);
const resolveSyncUserIdMock = jest.fn(() => "route-user");

jest.unstable_mockModule("next/server", () => ({
  NextRequest: class {},
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: HeadersInit }) => ({
      status: init?.status ?? 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...(init?.headers || {}),
      },
      json: async () => body,
    }),
  },
}));

jest.unstable_mockModule("../app/constant", () => ({
  StoreKey: {
    Chat: "chat-next-web-store",
  },
}));

jest.unstable_mockModule("../app/utils/server/sync-store-repository", () => ({
  getStoreSnapshotMeta: getStoreSnapshotMetaMock,
  getStoreSnapshot: jest.fn(),
  isSupportedStoreKey: jest.fn(() => true),
  removeStoreSnapshot: jest.fn(),
  setStoreSnapshot: setStoreSnapshotMock,
  applyChatDelta: applyChatDeltaMock,
  getChatIndexSnapshot: jest.fn(),
}));

jest.unstable_mockModule("../app/utils/server/postgres", () => ({
  withRetryablePostgresOperation: withRetryablePostgresOperationMock,
}));

jest.unstable_mockModule("../app/utils/server/sync-user", () => ({
  resolveSyncUserId: resolveSyncUserIdMock,
}));

const syncRoute = await import("../app/api/db/sync/[key]/route");
const chatSyncRoute = await import("../app/api/db/chat-sync/route");

function createJsonRequest(body: unknown, headers?: Record<string, string>): RequestLike {
  const rawBody = JSON.stringify(body);
  return {
    headers: new Headers(headers),
    text: async () => rawBody,
    json: async () => JSON.parse(rawBody),
  };
}

describe("db sync routes", () => {
  beforeEach(() => {
    getStoreSnapshotMetaMock.mockReset();
    setStoreSnapshotMock.mockClear();
    applyChatDeltaMock.mockClear();
    withRetryablePostgresOperationMock.mockClear();
    resolveSyncUserIdMock.mockClear();
    resolveSyncUserIdMock.mockReturnValue("route-user");
  });

  test("sync store PUT should return snapshot conflict payload on revision conflict", async () => {
    getStoreSnapshotMetaMock.mockResolvedValue({
      updatedAt: "2026-03-24T10:00:00.000Z",
      checksum: "server-checksum",
    });

    const req = createJsonRequest(
      { theme: "dark" },
      {
        "content-type": "application/json",
        "x-expected-updated-at": "2026-03-24T09:00:00.000Z",
        "x-expected-checksum": "client-checksum",
      },
    );

    const res = await syncRoute.PUT(req as any, {
      params: { key: "app-config" },
    });
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toEqual({
      ok: false,
      error: "snapshot_conflict",
      current: {
        updatedAt: "2026-03-24T10:00:00.000Z",
        checksum: "server-checksum",
      },
    });
    expect(setStoreSnapshotMock).not.toHaveBeenCalled();
  });

  test("sync store PUT should persist when snapshot revision matches", async () => {
    getStoreSnapshotMetaMock.mockResolvedValue({
      updatedAt: "2026-03-24T10:00:00.000Z",
      checksum: "same-checksum",
    });

    const req = createJsonRequest(
      { theme: "light" },
      {
        "content-type": "application/json",
        "x-expected-updated-at": "2026-03-24T10:00:00.000Z",
        "x-expected-checksum": "same-checksum",
      },
    );

    const res = await syncRoute.PUT(req as any, {
      params: { key: "app-config" },
    });
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(setStoreSnapshotMock).toHaveBeenCalledWith(
      "app-config",
      { theme: "light" },
      "route-user",
    );
  });

  test("chat sync PUT should return snapshot conflict payload on revision conflict", async () => {
    getStoreSnapshotMetaMock.mockResolvedValue({
      updatedAt: "2026-03-24T11:00:00.000Z",
      checksum: "chat-server-checksum",
    });

    const req = createJsonRequest(
      {
        index: { version: 1, state: {}, sessions: [] },
        upsertSessions: [],
        deleteSessionIds: [],
      },
      {
        "content-type": "application/json",
        "x-expected-updated-at": "2026-03-24T10:59:00.000Z",
        "x-expected-checksum": "chat-client-checksum",
      },
    );

    const res = await chatSyncRoute.PUT(req as any);
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toEqual({
      ok: false,
      error: "snapshot_conflict",
      current: {
        updatedAt: "2026-03-24T11:00:00.000Z",
        checksum: "chat-server-checksum",
      },
    });
    expect(applyChatDeltaMock).not.toHaveBeenCalled();
  });

  test("chat sync PUT should apply delta when snapshot revision matches", async () => {
    getStoreSnapshotMetaMock.mockResolvedValue({
      updatedAt: "2026-03-24T11:00:00.000Z",
      checksum: "chat-same-checksum",
    });

    const req = createJsonRequest(
      {
        index: {
          version: 1,
          state: { currentSessionId: "s1" },
          sessions: [{ id: "s1", lastUpdate: 1, messageCount: 1 }],
        },
        upsertSessions: [{ id: "s1", messages: [{ id: "m1" }] }],
        deleteSessionIds: ["s2"],
      },
      {
        "content-type": "application/json",
        "x-expected-updated-at": "2026-03-24T11:00:00.000Z",
        "x-expected-checksum": "chat-same-checksum",
      },
    );

    const res = await chatSyncRoute.PUT(req as any);
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(applyChatDeltaMock).toHaveBeenCalledWith({
      userId: "route-user",
      index: {
        version: 1,
        state: { currentSessionId: "s1" },
        sessions: [{ id: "s1", lastUpdate: 1, messageCount: 1 }],
      },
      upsertSessions: [{ id: "s1", messages: [{ id: "m1" }] }],
      deleteSessionIds: ["s2"],
    });
  });
});
