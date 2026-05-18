import { AUTO_SYNC_STORE_KEYS } from "../app/utils/sync-store-keys";
import { StoreKey } from "../app/constant";

describe("auto sync deferred keys", () => {
  test("首开后台同步不应包含 app-config", () => {
    const remainingKeys = AUTO_SYNC_STORE_KEYS.filter(
      (key) =>
        key !== StoreKey.Chat &&
        key !== StoreKey.Access &&
        key !== StoreKey.Config,
    );

    expect(remainingKeys).not.toContain(StoreKey.Config);
  });
});
