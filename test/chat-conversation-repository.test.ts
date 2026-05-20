import { jest } from "@jest/globals";

type QueryResult = { rows: Array<Record<string, unknown>> };
type QueryFn = (sql: string, params?: unknown[]) => Promise<QueryResult>;

const pgQueryMock = jest.fn<QueryFn>();
const ensureSyncStorageSchemaMock = jest.fn(async () => undefined);
const getOrCreateSyncAppUserIdMock = jest.fn(async () => "app-user-id");

jest.unstable_mockModule("../app/utils/server/postgres", () => ({
  ensureSyncStorageSchema: ensureSyncStorageSchemaMock,
  pgQuery: pgQueryMock,
}));

jest.unstable_mockModule("../app/utils/server/sync-app-user", () => ({
  getOrCreateSyncAppUserId: getOrCreateSyncAppUserIdMock,
}));

const { buildNormalizedChatIndexSnapshot, syncNormalizedChatSessions } =
  await import("../app/utils/server/chat-conversation-repository");

describe("chat conversation repository", () => {
  beforeEach(() => {
    pgQueryMock.mockReset();
    ensureSyncStorageSchemaMock.mockClear();
    getOrCreateSyncAppUserIdMock.mockClear();
    getOrCreateSyncAppUserIdMock.mockResolvedValue("app-user-id");
  });

  test("syncNormalizedChatSessions should soft-delete removed sessions and clear messages", async () => {
    const queryMock = jest
      .fn<QueryFn>()
      .mockResolvedValueOnce({ rows: [{ id: "conversation-id" }] })
      .mockResolvedValueOnce({ rows: [] });

    await syncNormalizedChatSessions({ query: queryMock } as any, {
      externalUserId: "single-user",
      upsertSessions: [],
      deleteSessionIds: ["s1", "s1", ""],
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[0]?.[0]).toContain("set is_deleted = true");
    expect(queryMock.mock.calls[0]?.[1]).toEqual(["app-user-id", ["s1"]]);
    expect(queryMock.mock.calls[1]?.[0]).toContain("delete from messages");
    expect(queryMock.mock.calls[1]?.[1]).toEqual([["conversation-id"]]);
  });

  test("buildNormalizedChatIndexSnapshot should exclude soft-deleted conversations", async () => {
    pgQueryMock.mockResolvedValueOnce({ rows: [] });

    await buildNormalizedChatIndexSnapshot("single-user");

    expect(pgQueryMock).toHaveBeenCalledTimes(1);
    expect(pgQueryMock.mock.calls[0]?.[0]).toContain("c.is_deleted = false");
  });
});
