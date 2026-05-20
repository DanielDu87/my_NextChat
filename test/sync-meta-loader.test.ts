import { jest } from "@jest/globals";

type StoreSnapshotMeta = {
  key: string;
  updatedAt: string;
  checksum: string;
  sizeBytes: number;
};

const getStoreSnapshotMetasMock =
  jest.fn<(keys: string[], userId: string) => Promise<StoreSnapshotMeta[]>>();

jest.unstable_mockModule("../app/utils/server/sync-store-repository", () => ({
  getStoreSnapshotMetas: getStoreSnapshotMetasMock,
}));

const { loadStoreSnapshotMetasSafely } = await import(
  "../app/utils/server/sync-meta-loader"
);

describe("sync meta loader", () => {
  beforeEach(() => {
    getStoreSnapshotMetasMock.mockReset();
  });

  test("should fall back to per-key reads when batch load fails", async () => {
    getStoreSnapshotMetasMock.mockImplementation(
      async (keys: string[], userId: string) => {
        if (keys.length > 1) {
          throw new Error(`batch failed for ${userId}`);
        }

        return [
          {
            key: keys[0],
            updatedAt: "2026-04-03T00:00:00.000Z",
            checksum: `${keys[0]}-checksum`,
            sizeBytes: 1,
          },
        ];
      },
    );

    const metas = await loadStoreSnapshotMetasSafely(
      ["access-control", "model-cache-store"],
      "single-user",
    );

    expect(metas).toEqual([
      {
        key: "access-control",
        updatedAt: "2026-04-03T00:00:00.000Z",
        checksum: "access-control-checksum",
        sizeBytes: 1,
      },
      {
        key: "model-cache-store",
        updatedAt: "2026-04-03T00:00:00.000Z",
        checksum: "model-cache-store-checksum",
        sizeBytes: 1,
      },
    ]);
  });
});
