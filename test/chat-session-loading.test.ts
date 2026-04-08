import { shouldShowCurrentSessionLoading } from "../app/store/chat-session";

describe("chat session loading", () => {
  test("已有内存占位会话时，不应继续阻塞聊天界面", () => {
    expect(
      shouldShowCurrentSessionLoading({
        currentSessionId: "session-1",
        hydratingSessionId: "session-1",
        inMemorySession: {
          id: "session-1",
          topic: "",
          messages: [],
        } as any,
      }),
    ).toBe(false);
  });

  test("当前会话完全不存在且仍在 hydrate 时，应显示加载态", () => {
    expect(
      shouldShowCurrentSessionLoading({
        currentSessionId: "session-1",
        hydratingSessionId: "session-1",
        summaryMessageCount: 2,
      }),
    ).toBe(true);
  });

  test("空会话即使正在 hydrate，也不应显示加载态", () => {
    expect(
      shouldShowCurrentSessionLoading({
        currentSessionId: "session-1",
        hydratingSessionId: "session-1",
        summaryMessageCount: 0,
      }),
    ).toBe(false);
  });
});
