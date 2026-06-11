import {
  buildChatSessionRows,
  dedupeDeleteSessionIds,
} from "../app/utils/server/sync-store-helpers";
import { jest } from "@jest/globals";

const queryMock = jest.fn();
const pgQueryMock = jest.fn();
const syncNormalizedChatSessionsMock = jest.fn(async () => undefined);
const getNormalizedChatSessionSnapshotsMock = jest.fn(async () => ({}));
const buildNormalizedChatIndexSnapshotMock = jest.fn(async () => undefined);

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
  ServiceProvider: {
    Custom: "Custom",
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
  ensureSyncStorageSchema: jest.fn(async () => undefined),
  withPgTransaction: async (
    handler: (client: { query: typeof queryMock }) => Promise<unknown>,
  ) => handler({ query: queryMock }),
  pgQuery: pgQueryMock,
}));

jest.unstable_mockModule("../app/utils/server/sync-secrets", () => ({
  getEncryptedSyncSecret: jest.fn(async () => null),
  setEncryptedSyncSecret: jest.fn(async () => undefined),
  encryptSyncSecretPayload: jest.fn((value) => `enc:${String(value)}`),
}));

jest.unstable_mockModule("../app/utils/server/sync-user", () => ({
  getDefaultSyncUserId: jest.fn(() => "user:admin"),
}));

jest.unstable_mockModule("../app/utils/server/access-store-security", () => ({
  splitAccessStorePayload: jest.fn((payload) => ({
    publicPayload: payload,
    secretPayload: {},
  })),
  mergeAccessStorePayload: jest.fn((payload) => payload),
  stripAccessStoreProfiles: jest.fn((payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return payload;
    }

    if (
      "state" in payload &&
      payload.state &&
      typeof payload.state === "object" &&
      !Array.isArray(payload.state)
    ) {
      const state = { ...(payload.state as Record<string, unknown>) };
      delete state.apiProfiles;
      return { ...payload, state };
    }

    const nextPayload = { ...(payload as Record<string, unknown>) };
    delete nextPayload.apiProfiles;
    return nextPayload;
  }),
}));

const getProviderProfilesForAccessStateMock = jest.fn(async () => []);
const syncProviderConfigsFromAccessStateMock = jest.fn(async () => undefined);

jest.unstable_mockModule("../app/utils/server/provider-config-repository", () => ({
  getProviderProfilesForAccessState: getProviderProfilesForAccessStateMock,
  syncProviderConfigsFromAccessState: syncProviderConfigsFromAccessStateMock,
}));

jest.unstable_mockModule(
  "../app/utils/server/chat-conversation-repository",
  () => ({
    syncNormalizedChatSessions: syncNormalizedChatSessionsMock,
    getNormalizedChatSessionSnapshots: getNormalizedChatSessionSnapshotsMock,
    buildNormalizedChatIndexSnapshot: buildNormalizedChatIndexSnapshotMock,
  }),
);

const getAppSettingsStoreMock = jest.fn(async () => undefined);
const syncAppSettingsStoreMock = jest.fn(async () => undefined);
const getChatIndexStateMock = jest.fn(async () => undefined);
const setChatIndexStateMock = jest.fn(async () => undefined);
const removeChatIndexStateMock = jest.fn(async () => undefined);

jest.unstable_mockModule("../app/utils/server/app-settings-repository", () => ({
  getAppSettingsStore: getAppSettingsStoreMock,
  syncAppSettingsStore: syncAppSettingsStoreMock,
  getChatIndexState: getChatIndexStateMock,
  setChatIndexState: setChatIndexStateMock,
  removeChatIndexState: removeChatIndexStateMock,
}));

const { applyChatDelta } = await import("../app/utils/server/sync-store-repository");

describe("sync store repository helpers", () => {
  beforeEach(() => {
    queryMock.mockReset();
    pgQueryMock.mockReset();
    getAppSettingsStoreMock.mockClear();
    syncAppSettingsStoreMock.mockClear();
    syncNormalizedChatSessionsMock.mockClear();
    getNormalizedChatSessionSnapshotsMock.mockClear();
    buildNormalizedChatIndexSnapshotMock.mockClear();
    getProviderProfilesForAccessStateMock.mockClear();
    syncProviderConfigsFromAccessStateMock.mockClear();
    getChatIndexStateMock.mockClear();
    setChatIndexStateMock.mockClear();
    removeChatIndexStateMock.mockClear();
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

  test("applyChatDelta should upsert sessions and dedupe deletes", async () => {
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

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0]?.[0]).toContain("insert into app_settings");
    expect(queryMock.mock.calls[0]?.[1]).toEqual([
      "user:admin",
      "__chat-index-state__",
      JSON.stringify({ currentSessionId: "s1" }),
    ]);

    expect(syncNormalizedChatSessionsMock).toHaveBeenCalledTimes(1);
    expect(setChatIndexStateMock).not.toHaveBeenCalled();
    expect(syncNormalizedChatSessionsMock).toHaveBeenCalledWith(
      { query: queryMock },
      {
        externalUserId: "user:admin",
        index: {
          version: 1,
          state: { currentSessionId: "s1" },
          sessions: [],
        },
        upsertSessions: [
          { id: "s1", text: "a" },
          { id: "s2", text: "b\u0000" },
        ],
        deleteSessionIds: ["s2", "s1"],
      },
    );
    expect(syncAppSettingsStoreMock).not.toHaveBeenCalled();
  });

  test("applyChatDelta should physically delete empty orphan conversations", async () => {
    await applyChatDelta({
      index: {
        version: 1,
        state: { currentSessionId: "s1", sessionIds: ["s1"] },
        sessions: [
          {
            id: "s1",
            topic: "Keep",
            createdAt: 1,
            lastUpdate: 1,
            messageCount: 1,
          },
        ],
      },
      upsertSessions: [],
      deleteSessionIds: [],
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[1]?.[0]).toContain(
      "delete from conversations",
    );
    expect(queryMock.mock.calls[1]?.[0]).not.toContain("set is_deleted");
    expect(queryMock.mock.calls[1]?.[1]).toEqual(["user:admin", ["s1"]]);
  });

  test("setStoreSnapshot should also sync app settings for config stores", async () => {
    const { setStoreSnapshot } = await import(
      "../app/utils/server/sync-store-repository"
    );

    await setStoreSnapshot("prompt-store", {
      state: {
        prompts: {
          p1: { id: "p1", title: "hello" },
        },
      },
      version: 3,
    });

    expect(syncAppSettingsStoreMock).toHaveBeenCalledWith(
      "user:admin",
      "prompt-store",
      {
        state: {
          prompts: {
            p1: { id: "p1", title: "hello" },
          },
        },
        version: 3,
      },
    );
  });

  test("setStoreSnapshot should strip apiProfiles from app settings for access store", async () => {
    const { setStoreSnapshot } = await import(
      "../app/utils/server/sync-store-repository"
    );

    await setStoreSnapshot("access-control", {
      state: {
        customModels: "abc",
        apiProfiles: [{ id: "p1", name: "Main" }],
      },
      version: 4,
    });

    expect(syncProviderConfigsFromAccessStateMock).toHaveBeenCalledWith(
      "user:admin",
      {
        state: {
          customModels: "abc",
          apiProfiles: [{ id: "p1", name: "Main" }],
        },
        version: 4,
      },
      expect.anything(),
    );

    expect(syncAppSettingsStoreMock).toHaveBeenCalledWith(
      "user:admin",
      "access-control",
      {
        state: {
          customModels: "abc",
        },
        version: 4,
      },
      expect.anything(),
    );
  });

  test("getStoreSnapshot should keep provider secrets when app settings has empty apiProfiles", async () => {
    const { getStoreSnapshot } = await import(
      "../app/utils/server/sync-store-repository"
    );

    pgQueryMock.mockImplementationOnce(async () => ({
      rows: [],
    }));
    getAppSettingsStoreMock.mockImplementationOnce(async () => ({
      state: {
        customModels: "abc",
        apiProfiles: [
          {
            id: "p1",
            name: "Main",
            provider: "Custom",
            baseUrl: "https://local.example.com",
            apiKey: "",
            enabled: true,
          },
        ],
      },
      version: 4,
    }) as any);
    getProviderProfilesForAccessStateMock.mockImplementationOnce(async () => [
      {
        id: "p1",
        name: "Main",
        provider: "Custom",
        baseUrl: "https://remote.example.com",
        apiKey: "sk-remote",
        enabled: true,
      },
    ] as any);

    const snapshot = await getStoreSnapshot("access-control");

    expect(snapshot).toEqual({
      state: {
        customModels: "abc",
        apiProfiles: [
          {
            id: "p1",
            name: "Main",
            provider: "Custom",
            baseUrl: "https://remote.example.com",
            apiKey: "sk-remote",
            enabled: true,
          },
        ],
      },
      version: 4,
    });
  });

  test("getChatIndexSnapshot should not query removed legacy tables", async () => {
    const { getChatIndexSnapshot } = await import(
      "../app/utils/server/sync-store-repository"
    );

    buildNormalizedChatIndexSnapshotMock.mockResolvedValueOnce(undefined);
    getChatIndexStateMock.mockResolvedValueOnce({
      currentSessionId: "s1",
    } as any);

    const snapshot = await getChatIndexSnapshot("user:admin");

    expect(snapshot).toBeUndefined();
    expect(queryMock).not.toHaveBeenCalled();
    expect(buildNormalizedChatIndexSnapshotMock).toHaveBeenCalledWith(
      "user:admin",
      { currentSessionId: "s1" },
    );
  });

  test("removeFullChatStateSnapshot should delete all conversations for the user", async () => {
    const { removeFullChatStateSnapshot } = await import(
      "../app/utils/server/sync-store-repository"
    );

    await removeFullChatStateSnapshot("user:admin");

    expect(removeChatIndexStateMock).toHaveBeenCalledWith("user:admin");
    expect(pgQueryMock).toHaveBeenCalledTimes(1);
    expect(pgQueryMock.mock.calls[0][0]).toContain("delete from conversations");
    expect(pgQueryMock.mock.calls[0][0]).not.toContain(
      "external_session_id is not null",
    );
    expect(pgQueryMock.mock.calls[0][1]).toEqual(["user:admin"]);
  });
});
