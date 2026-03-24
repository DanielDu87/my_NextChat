import {
  buildChatSessionRows,
  dedupeDeleteSessionIds,
} from "../app/utils/server/sync-store-helpers";
import { jest } from "@jest/globals";

const queryMock = jest.fn();
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
  pgQuery: jest.fn(),
}));

jest.unstable_mockModule("../app/utils/server/sync-secrets", () => ({
  getEncryptedSyncSecret: jest.fn(async () => null),
  setEncryptedSyncSecret: jest.fn(async () => undefined),
  encryptSyncSecretPayload: jest.fn((value) => `enc:${String(value)}`),
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

    expect(queryMock).toHaveBeenCalledTimes(0);

    expect(syncNormalizedChatSessionsMock).toHaveBeenCalledTimes(1);
    expect(setChatIndexStateMock).toHaveBeenCalledWith(
      "single-user",
      JSON.stringify({
        currentSessionId: "s1",
      }),
    );
    expect(syncNormalizedChatSessionsMock).toHaveBeenCalledWith(
      { query: queryMock },
      {
        externalUserId: "single-user",
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
      "single-user",
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
      "single-user",
      {
        state: {
          customModels: "abc",
          apiProfiles: [{ id: "p1", name: "Main" }],
        },
        version: 4,
      },
    );

    expect(syncAppSettingsStoreMock).toHaveBeenCalledWith(
      "single-user",
      "access-control",
      {
        state: {
          customModels: "abc",
        },
        version: 4,
      },
    );
  });
});
