import { resolveHydratedStateValue } from "../app/utils/state-storage-helpers";

describe("indexeddb state storage helpers", () => {
  test("should prefer pending write over stale hydrated value", () => {
    expect(resolveHydratedStateValue("fresh-value", "stale-value")).toBe(
      "fresh-value",
    );
  });

  test("should use hydrated value when no pending write exists", () => {
    expect(resolveHydratedStateValue(undefined, "stored-value")).toBe(
      "stored-value",
    );
  });

  test("should keep null when both values are missing", () => {
    expect(resolveHydratedStateValue(undefined, null)).toBeNull();
  });
});
