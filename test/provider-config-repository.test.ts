import { jest } from "@jest/globals";

const queryMock = jest.fn();

jest.unstable_mockModule("../app/constant", () => ({
  ServiceProvider: {
    Custom: "Custom",
    OpenAI: "OpenAI",
  },
}));

jest.unstable_mockModule("../app/utils/server/postgres", () => ({
  ensureSyncStorageSchema: jest.fn(async () => undefined),
  pgQuery: jest.fn(),
  withPgTransaction: async (
    handler: (client: { query: typeof queryMock }) => Promise<unknown>,
  ) => handler({ query: queryMock }),
}));

jest.unstable_mockModule("../app/utils/server/sync-secrets", () => ({
  encryptSyncSecretPayload: jest.fn((value: unknown) => `enc:${String(value)}`),
}));

jest.unstable_mockModule("../app/utils/server/sync-app-user", () => ({
  getOrCreateSyncAppUserId: jest.fn(async () => "user-uuid"),
}));

const { syncProviderConfigsFromAccessState } = await import(
  "../app/utils/server/provider-config-repository"
);

describe("provider config repository", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  test("syncProviderConfigsFromAccessState 应该写入 provider 配置与密钥", async () => {
    queryMock.mockImplementationOnce(async () => undefined);
    queryMock.mockImplementationOnce(async () => ({
      rows: [{ id: "provider-config-1" }],
    }));
    queryMock.mockImplementation(async () => undefined);

    await syncProviderConfigsFromAccessState("single-user", {
      state: {
        apiProfiles: [
          {
            id: "profile-1",
            name: "Main",
            provider: "OpenAI",
            baseUrl: "https://api.example.com",
            apiKey: "sk-main",
            balanceQueryApiKey: "sk-balance",
            apiKeyGroups: {
              premium: "sk-premium",
            },
            enabled: true,
          },
        ],
      },
    });

    expect(queryMock.mock.calls[0][0]).toContain("delete from provider_configs");
    expect(queryMock.mock.calls[1][0]).toContain("insert into provider_configs");
    expect(queryMock.mock.calls[2][0]).toContain("delete from provider_api_keys");
    expect(queryMock.mock.calls[3][1]).toEqual([
      "provider-config-1",
      "default",
      "api",
      null,
      "enc:sk-main",
      "sk***in",
      JSON.stringify({ syncedFrom: "access-control" }),
    ]);
    expect(queryMock.mock.calls[4][1]).toEqual([
      "provider-config-1",
      "balance-query",
      "balance_query",
      null,
      "enc:sk-balance",
      "sk-b***ance",
      JSON.stringify({ syncedFrom: "access-control" }),
    ]);
    expect(queryMock.mock.calls[5][1]).toEqual([
      "provider-config-1",
      "group:premium",
      "group",
      "premium",
      "enc:sk-premium",
      "sk-p***mium",
      JSON.stringify({ syncedFrom: "access-control" }),
    ]);
  });
});
