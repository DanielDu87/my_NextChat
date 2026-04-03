import { jest } from "@jest/globals";

const pgQueryMock = jest.fn();

jest.unstable_mockModule("../app/utils/server/postgres", () => ({
  pgQuery: pgQueryMock,
}));

const { getEncryptedSyncSecret } = await import(
  "../app/utils/server/sync-secrets"
);

describe("sync secrets", () => {
  beforeEach(() => {
    pgQueryMock.mockReset();
  });

  test("getEncryptedSyncSecret should return null when ciphertext is invalid", async () => {
    pgQueryMock.mockResolvedValue({
      rows: [{ encrypted_payload: "invalid-ciphertext" }],
    });

    await expect(
      getEncryptedSyncSecret({
        userId: "single-user",
        secretKey: "access-control",
      }),
    ).resolves.toBeNull();
  });
});
