import {
  getChatGlobalClearAtFromState,
  getDeletedSessionTimestampsFromState,
  isEffectivelyEmptyRemoteChatState,
} from "../app/utils/chat-sync-state";

describe("chat sync state helpers", () => {
  test("should treat empty remote chat state as effectively empty", () => {
    expect(isEffectivelyEmptyRemoteChatState(undefined)).toBe(true);
    expect(isEffectivelyEmptyRemoteChatState({})).toBe(true);
    expect(
      isEffectivelyEmptyRemoteChatState({
        deletedSessionTimestamps: {},
        globalClearAt: 0,
      }),
    ).toBe(true);
  });

  test("should keep only valid deleted session timestamps", () => {
    expect(
      getDeletedSessionTimestampsFromState({
        deletedSessionTimestamps: {
          a: 123,
          b: "456",
          c: 0,
          d: -1,
          e: "bad",
        },
      }),
    ).toEqual({
      a: 123,
      b: 456,
    });
  });

  test("should treat delete markers or clear time as non-empty remote state", () => {
    expect(
      isEffectivelyEmptyRemoteChatState({
        deletedSessionTimestamps: {
          a: 123,
        },
      }),
    ).toBe(false);
    expect(
      isEffectivelyEmptyRemoteChatState({
        globalClearAt: 123,
      }),
    ).toBe(false);
    expect(
      getChatGlobalClearAtFromState({
        globalClearAt: "456",
      }),
    ).toBe(456);
  });
});
