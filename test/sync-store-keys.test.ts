import { StoreKey } from "../app/constant";
import { AUTO_SYNC_STORE_KEYS } from "../app/utils/sync-store-keys";

describe("sync-store-keys", () => {
  test("auto sync should include model cache and config", () => {
    expect(AUTO_SYNC_STORE_KEYS).toContain(StoreKey.ModelCache);
    expect(AUTO_SYNC_STORE_KEYS).toContain(StoreKey.Config);
  });
});
