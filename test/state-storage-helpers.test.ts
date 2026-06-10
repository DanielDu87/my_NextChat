import { resolveNewestHydratedStateValue } from "../app/utils/state-storage-helpers";

function persisted(lastUpdateTime: number, value: string) {
  return JSON.stringify({
    state: { lastUpdateTime, value },
    version: 1,
  });
}

describe("state storage helpers", () => {
  test("resolveNewestHydratedStateValue prefers pending writes", () => {
    expect(
      resolveNewestHydratedStateValue(
        persisted(1, "pending"),
        persisted(3, "localStorage"),
        persisted(2, "indexedDb"),
      ),
    ).toBe(persisted(1, "pending"));
  });

  test("resolveNewestHydratedStateValue keeps newer localStorage mirror over old IndexedDB", () => {
    const localStorageValue = persisted(3, "localStorage");
    const indexedDbValue = persisted(2, "indexedDb");

    expect(
      resolveNewestHydratedStateValue(undefined, localStorageValue, indexedDbValue),
    ).toBe(localStorageValue);
  });
});
