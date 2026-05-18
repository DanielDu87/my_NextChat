import { jest } from "@jest/globals";
import {
  buildChatIndexPayload,
  getSyncableChatSessions,
} from "../app/utils/chat-sync";
import { mergeSessionMessages } from "../app/utils/chat-session-merge";

function createStore(state: Record<string, unknown> = {}) {
  return {
    getState: () => state,
    setState: jest.fn(),
  };
}

jest.mock("../app/store", () => ({
  useAccessStore: createStore(),
  useAppConfig: createStore(),
  useChatStore: createStore(),
  useModelCacheStore: createStore(),
  usePluginStore: createStore(),
  useUpdateStore: createStore(),
}));

jest.mock("../app/store/mask", () => ({
  useMaskStore: createStore(),
}));

jest.mock("../app/store/prompt", () => ({
  usePromptStore: createStore(),
}));

jest.mock("../app/store/sd", () => ({
  useSdStore: createStore(),
}));

describe("sync merge safety", () => {
  test("buildChatIndexPayload should keep currentSessionId aligned after filtering empty sessions", () => {
    const payload = buildChatIndexPayload({
      sessions: [
        {
          id: "empty",
          topic: "空会话",
          createdAt: 100,
          lastUpdate: 100,
          messages: [],
        },
        {
          id: "target",
          topic: "目标会话",
          createdAt: 200,
          lastUpdate: 200,
          messages: [
            { id: "m1", role: "user" },
            { id: "m2", role: "assistant" },
          ],
        },
      ],
      currentSessionIndex: 1,
    });

    expect(payload.state.currentSessionId).toBe("target");
    expect(payload.sessions.map((session: any) => session.id)).toEqual([
      "target",
    ]);
  });

  test("getSyncableChatSessions should exclude empty sessions", () => {
    const sessions = getSyncableChatSessions([
      {
        id: "empty",
        topic: "空会话",
        messages: [],
      },
      {
        id: "filled",
        topic: "非空会话",
        messages: [
          { id: "m1", role: "user" },
          { id: "m2", role: "assistant" },
        ],
      },
    ]);

    expect(sessions.map((session: any) => session.id)).toEqual(["filled"]);
  });

  test("mergeSessionMessages should reuse local message array when same-timestamp sessions have no effective message diff", () => {
    const sharedMessages = [
      {
        id: "m1",
        date: "2026-03-21T10:00:00.000Z",
        content: "hello",
      },
      {
        id: "m2",
        date: "2026-03-21T10:01:00.000Z",
        content: "world",
      },
    ];
    const localSession = {
      id: "s1",
      topic: "same",
      createdAt: 100,
      lastUpdate: 200,
      messages: sharedMessages,
    };
    const remoteSession = {
      id: "s1",
      topic: "same",
      createdAt: 100,
      lastUpdate: 200,
      messages: [
        {
          id: "m1",
          date: "2026-03-21T10:00:00.000Z",
          content: "hello",
        },
        {
          id: "m2",
          date: "2026-03-21T10:01:00.000Z",
          content: "world",
        },
      ],
    };

    const mergedMessages = mergeSessionMessages(
      localSession as any,
      remoteSession as any,
    );

    expect(mergedMessages).toBe(sharedMessages);
  });
});
