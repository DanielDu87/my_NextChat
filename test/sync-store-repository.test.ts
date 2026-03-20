import {
  buildChatSessionRows,
  dedupeDeleteSessionIds,
} from "../app/utils/server/sync-store-helpers";
import { jest } from "@jest/globals";

const queryMock = jest.fn();

jest.unstable_mockModule("../app/constant", () => ({
  StoreKey: {
    Chat: "chat-next-web-store",
    Plugin: "chat-next-web-plugin",
    Access: "access-control",
    Config: "app-config",
    ModelCache: "model-cache-store",
    Mask: "mask-store",
    Prompt: "prompt-store",
    Update: "chat-update",
    Sync: "sync",
    SdList: "sd-list",
  },
}));

jest.unstable_mockModule("../app/utils/chat-sync", () => ({
  buildChatIndexPayload: jest.fn(),
  buildChatStateFromIndex: jest.fn(),
  getSyncableChatSessions: jest.fn(),
}));

jest.unstable_mockModule("../app/utils/sync-store-keys", () => ({
  buildPersistedStoreState: jest.fn(),
  PERSIST_STORE_KEYS: [
    "chat-next-web-store",
    "chat-next-web-plugin",
    "access-control",
    "app-config",
    "model-cache-store",
    "mask-store",
    "prompt-store",
    "chat-update",
    "sync",
    "sd-list",
  ],
  unwrapPersistedStoreState: jest.fn(),
}));

jest.unstable_mockModule("../app/utils/server/postgres", () => ({
  withPgTransaction: async (
    handler: (client: { query: typeof queryMock }) => Promise<unknown>,
  ) => handler({ query: queryMock }),
  pgQuery: jest.fn(),
}));

const { applyChatDelta } = await import("../app/utils/server/sync-store-repository");

describe("sync store repository helpers", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  test("buildChatSessionRows should batch valid sessions and sanitize null bytes", () => {
    const rows = buildChatSessionRows([
      { id: "s1", messages: [{ id: "m1", text: "a" }] },
      { id: "", messages: [] },
      { id: "s2", text: "b\u0000" },
    ]);

    expect(rows).toEqual([
      {
        artifactType: "chat_session",
        artifactPath: "s1",
        payloadText: JSON.stringify({
          id: "s1",
          messages: [{ id: "m1", text: "a" }],
        }),
      },
      {
        artifactType: "chat_session",
        artifactPath: "s2",
        payloadText: JSON.stringify({
          id: "s2",
          text: "b",
        }),
      },
    ]);
  });

  test("dedupeDeleteSessionIds should remove duplicates and empty values", () => {
    expect(dedupeDeleteSessionIds(["s1", "", "s2", "s1"])).toEqual([
      "s1",
      "s2",
    ]);
  });

  test("applyChatDelta should batch session upserts and dedupe deletes", async () => {
    await applyChatDelta({
      index: {
        version: 1,
        state: { currentSessionId: "s1" },
        sessions: [],
      },
      upsertSessions: [
        { id: "s1", text: "a" },
        { id: "s2", text: "b\u0000" },
      ],
      deleteSessionIds: ["s2", "", "s1", "s2"],
    });

    expect(queryMock).toHaveBeenCalledTimes(4);

    expect(queryMock.mock.calls[0][0]).toContain(
      "insert into sync_artifacts (artifact_type, artifact_path, payload_json)",
    );
    expect(queryMock.mock.calls[0][1]).toEqual([
      "chat_index",
      "chat-next-web-store",
      JSON.stringify({
        version: 1,
        state: { currentSessionId: "s1" },
        sessions: [],
      }),
    ]);

    expect(queryMock.mock.calls[1][0]).toContain(
      "from unnest($1::text[], $2::text[], $3::text[])",
    );
    expect(queryMock.mock.calls[1][1]).toEqual([
      ["chat_session", "chat_session"],
      ["s1", "s2"],
      [JSON.stringify({ id: "s1", text: "a" }), JSON.stringify({ id: "s2", text: "b" })],
    ]);

    expect(queryMock.mock.calls[2][0]).toContain("delete from sync_artifacts");
    expect(queryMock.mock.calls[2][1]).toEqual([
      ["s2", "s1"],
      "chat_session",
    ]);

    expect(queryMock.mock.calls[3][0]).toContain("delete from sync_artifacts");
    expect(queryMock.mock.calls[3][1]).toEqual([
      "chat-next-web-store",
      "store_state",
    ]);
  });
});
