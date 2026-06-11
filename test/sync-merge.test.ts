import { jest } from "@jest/globals";
import {
  buildChatIndexPayload,
  getSyncableChatSessions,
} from "../app/utils/chat-sync";
import { mergeSessionMessages } from "../app/utils/chat-session-merge";
import { StoreKey } from "../app/constant";

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

  test("mergeStoreState should keep newer local multi api key edits", async () => {
    const { TextDecoder, TextEncoder } = await import("node:util");
    (globalThis as any).TextDecoder ??= TextDecoder;
    (globalThis as any).TextEncoder ??= TextEncoder;
    jest.unstable_mockModule("../app/store", () => ({
      useAccessStore: createStore(),
      useAppConfig: createStore(),
      useChatStore: createStore(),
      useModelCacheStore: createStore(),
      usePluginStore: createStore(),
      useUpdateStore: createStore(),
    }));
    jest.unstable_mockModule("../app/store/mask", () => ({
      useMaskStore: createStore(),
    }));
    jest.unstable_mockModule("../app/store/prompt", () => ({
      usePromptStore: createStore(),
    }));
    jest.unstable_mockModule("../app/store/sd", () => ({
      useSdStore: createStore(),
    }));
    const { mergeStoreState } = await import("../app/utils/sync");
    const localState = {
      lastUpdateTime: 200,
      apiProfiles: [
        {
          id: "p1",
          name: "YutoAPI",
          provider: "Custom",
          baseUrl: "https://example.com/v1",
          multiKeyEnabled: true,
          apiKeyGroups: {
            group1: "sk-new",
            group2: "",
          },
        },
      ],
    };
    const remoteState = {
      lastUpdateTime: 100,
      apiProfiles: [
        {
          id: "p1",
          name: "YutoAPI",
          provider: "Custom",
          baseUrl: "https://example.com/v1",
          multiKeyEnabled: true,
          apiKeyGroups: {
            group1: "sk-old",
            group2: "sk-removed",
            group3: "sk-remote-only",
          },
        },
      ],
    };

    const merged = mergeStoreState(
      StoreKey.Access,
      localState as any,
      remoteState as any,
    ) as any;

    const mergedProfile = merged.apiProfiles.find(
      (profile: any) => profile.id === "p1",
    );

    expect(mergedProfile.apiKeyGroups).toEqual({
      group1: "sk-new",
      group2: "",
      group3: "sk-remote-only",
      group4: "",
      group5: "",
      group6: "",
    });
  });

  test("mergeStoreState should preserve multi key mode when synced profile has group keys", async () => {
    const { TextDecoder, TextEncoder } = await import("node:util");
    (globalThis as any).TextDecoder ??= TextDecoder;
    (globalThis as any).TextEncoder ??= TextEncoder;
    jest.resetModules();
    const { StoreKey } = await import("../app/constant");

    const createStore = () => ({
      getState: () => ({}),
      setState: jest.fn(),
      persist: { rehydrate: jest.fn() },
    });
    jest.unstable_mockModule("../app/store", () => ({
      useAccessStore: createStore(),
      useAppConfig: createStore(),
      useChatStore: createStore(),
      useModelCacheStore: createStore(),
      usePluginStore: createStore(),
      useUpdateStore: createStore(),
    }));
    jest.unstable_mockModule("../app/store/mask", () => ({
      useMaskStore: createStore(),
    }));
    jest.unstable_mockModule("../app/store/prompt", () => ({
      usePromptStore: createStore(),
    }));
    jest.unstable_mockModule("../app/store/sd", () => ({
      useSdStore: createStore(),
    }));
    const { mergeStoreState } = await import("../app/utils/sync");
    const localState = {
      lastUpdateTime: 200,
      apiProfiles: [
        {
          id: "p1",
          name: "Ocoolai",
          provider: "Custom",
          baseUrl: "https://api.ocoolai.com",
          multiKeyEnabled: false,
          apiKeyGroups: {
            group1: "sk-group-1",
            group2: "sk-group-2",
          },
        },
      ],
    };
    const remoteState = {
      lastUpdateTime: 100,
      apiProfiles: [],
    };

    const merged = mergeStoreState(
      StoreKey.Access,
      localState as any,
      remoteState as any,
    ) as any;

    const mergedProfile = merged.apiProfiles.find(
      (profile: any) => profile.id === "p1",
    );

    expect(mergedProfile.multiKeyEnabled).toBe(true);
    expect(mergedProfile.apiKeyGroups).toEqual({
      group1: "sk-group-1",
      group2: "sk-group-2",
      group3: "",
      group4: "",
      group5: "",
      group6: "",
    });
    expect(mergedProfile.multiKeyGroupOrder).toEqual([
      "group1",
      "group2",
      "group3",
      "group4",
      "group5",
      "group6",
    ]);
  });

  test("mergeStoreState should keep newly added local api profile before remote sync finishes", async () => {
    const { TextDecoder, TextEncoder } = await import("node:util");
    (globalThis as any).TextDecoder ??= TextDecoder;
    (globalThis as any).TextEncoder ??= TextEncoder;
    const { mergeStoreState } = await import("../app/utils/sync");
    const localState = {
      lastUpdateTime: 300,
      apiProfiles: [
        {
          id: "profile_new",
          name: "新配置",
          provider: "Custom",
          baseUrl: "https://new.example.com/v1",
          apiKey: "sk-new",
          enabled: false,
        },
      ],
    };
    const remoteState = {
      lastUpdateTime: 100,
      apiProfiles: [],
    };

    const merged = mergeStoreState(
      StoreKey.Access,
      localState as any,
      remoteState as any,
    ) as any;

    expect(
      merged.apiProfiles.some((profile: any) => profile.id === "profile_new"),
    ).toBe(true);
  });

  test("mergeStoreState should keep newer local single api key edits", async () => {
    const { TextDecoder, TextEncoder } = await import("node:util");
    (globalThis as any).TextDecoder ??= TextDecoder;
    (globalThis as any).TextEncoder ??= TextEncoder;
    const { mergeStoreState } = await import("../app/utils/sync");
    const localState = {
      lastUpdateTime: 300,
      customApiKey: "sk-local-new",
      apiProfiles: [
        {
          id: "p1",
          name: "普通配置",
          provider: "Custom",
          baseUrl: "https://single.example.com/v1",
          apiKey: "sk-local-new",
          enabled: true,
        },
      ],
    };
    const remoteState = {
      lastUpdateTime: 100,
      customApiKey: "sk-remote-old",
      apiProfiles: [
        {
          id: "p1",
          name: "普通配置",
          provider: "Custom",
          baseUrl: "https://single.example.com/v1",
          apiKey: "sk-remote-old",
          enabled: true,
        },
      ],
    };

    const merged = mergeStoreState(
      StoreKey.Access,
      localState as any,
      remoteState as any,
    ) as any;
    const mergedProfile = merged.apiProfiles.find(
      (profile: any) => profile.id === "p1",
    );

    expect(merged.customApiKey).toBe("sk-local-new");
    expect(mergedProfile.apiKey).toBe("sk-local-new");
  });
});
