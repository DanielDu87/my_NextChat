import { jest } from "@jest/globals";

const mockGet = jest.fn();
const mockSet = jest.fn();
const mockDel = jest.fn();
const mockClear = jest.fn();

jest.unstable_mockModule("idb-keyval", () => ({
  get: mockGet,
  set: mockSet,
  del: mockDel,
  clear: mockClear,
}));

describe("indexedDBStorage", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
    mockDel.mockReset();
    mockClear.mockReset();
    window.localStorage.clear();
  });

  test("should not throw when localStorage quota is exceeded", async () => {
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    jest
      .spyOn(window.localStorage.__proto__, "setItem")
      .mockImplementation(() => {
        throw new DOMException(
          "Setting the value exceeded the quota.",
          "QuotaExceededError",
        );
      });

    const { safeLocalStorage } = await import("../app/utils");

    expect(() => safeLocalStorage().setItem("chat-next-web-store", "x")).not.toThrow();

    window.localStorage.__proto__.setItem = originalSetItem;
  });

  test("should prefer indexeddb and skip localStorage mirror for large payloads", async () => {
    mockSet.mockResolvedValue(undefined);
    const removeSpy = jest.spyOn(window.localStorage.__proto__, "removeItem");
    const setSpy = jest.spyOn(window.localStorage.__proto__, "setItem");

    const { indexedDBStorage } = await import("../app/utils/indexedDB-storage");
    await indexedDBStorage.setItem("chat-next-web-store", "x".repeat(120 * 1024));

    expect(mockSet).toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith("chat-next-web-store");
  });

  test("should fallback to localStorage when indexeddb write fails", async () => {
    mockSet.mockRejectedValue(new Error("idb failed"));
    const setSpy = jest.spyOn(window.localStorage.__proto__, "setItem");

    const { indexedDBStorage } = await import("../app/utils/indexedDB-storage");
    await indexedDBStorage.setItem("app-config", '{"ok":true}');

    expect(setSpy).toHaveBeenCalledWith("app-config", '{"ok":true}');
  });
});
