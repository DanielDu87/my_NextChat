import { jest } from "@jest/globals";

const pgQueryMock = jest.fn();

jest.unstable_mockModule("../app/constant", () => ({
  StoreKey: {
    Config: "app-config",
    ModelCache: "model-cache-store",
    Plugin: "chat-next-web-plugin",
    Sync: "sync",
    Access: "access-control",
    Mask: "mask-store",
    Prompt: "prompt-store",
    Update: "chat-update",
    SdList: "sd-list",
  },
}));

jest.unstable_mockModule("../app/utils/server/postgres", () => ({
  ensureSyncStorageSchema: jest.fn(async () => undefined),
  pgQuery: pgQueryMock,
}));

jest.unstable_mockModule("../app/utils/server/sync-app-user", () => ({
  getOrCreateSyncAppUserId: jest.fn(async () => "user-uuid"),
}));

const { syncAppSettingsStore, getAppSettingsStore } = await import(
  "../app/utils/server/app-settings-repository"
);

describe("app settings repository", () => {
  beforeEach(() => {
    pgQueryMock.mockReset();
  });

  test("syncAppSettingsStore should write prompt store into extra_settings", async () => {
    await syncAppSettingsStore("single-user", "prompt-store", {
      state: { prompts: { p1: { id: "p1" } } },
      version: 3,
    });

    expect(pgQueryMock).toHaveBeenCalledTimes(1);
    expect(pgQueryMock.mock.calls[0][0]).toContain("extra_settings");
    expect(pgQueryMock.mock.calls[0][1]).toEqual([
      "user-uuid",
      "prompt-store",
      JSON.stringify({
        state: { prompts: { p1: { id: "p1" } } },
        version: 3,
      }),
    ]);
  });

  test("getAppSettingsStore should read store payload from mapped column", async () => {
    pgQueryMock.mockImplementationOnce(async () => ({
      rows: [{ payload_json: { state: { prompts: {} }, version: 3 } }],
    }));

    const payload = await getAppSettingsStore("single-user", "prompt-store");

    expect(payload).toEqual({ state: { prompts: {} }, version: 3 });
    expect(pgQueryMock.mock.calls[0][0]).toContain("extra_settings");
  });
});
