import { jest } from "@jest/globals";
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

const { readFromFile } = require("../app/utils");
const { mergeAppState, mergeStoreState } = require("../app/utils/sync");

function createAppState(overrides: Partial<Record<StoreKey, any>> = {}) {
  return {
    [StoreKey.Chat]: {
      sessions: [],
      currentSessionIndex: 0,
    },
    [StoreKey.Plugin]: {
      plugins: {},
    },
    [StoreKey.Access]: {
      apiProfiles: [],
      lastUpdateTime: 0,
    },
    [StoreKey.Config]: {
      models: [],
      lastUpdate: 0,
    },
    [StoreKey.ModelCache]: {
      profiles: {},
    },
    [StoreKey.Mask]: {
      masks: {},
    },
    [StoreKey.Prompt]: {
      prompts: {},
    },
    [StoreKey.Update]: {
      lastUpdateTime: 0,
    },
    [StoreKey.SdList]: {
      draw: [],
      currentId: 0,
    },
    ...overrides,
  } as any;
}

describe("sync merge safety", () => {
  test("mergeAppState should ignore missing remote stores", () => {
    const localState = createAppState({
      [StoreKey.Prompt]: {
        prompts: {
          keep: { id: "keep", title: "保留提示词" },
        },
      },
      [StoreKey.Chat]: {
        sessions: [
          {
            id: "local",
            topic: "本地会话",
            createdAt: 10,
            lastUpdate: 10,
            messages: [],
          },
        ],
        currentSessionIndex: 0,
      },
    });

    const remoteState = {
      [StoreKey.Chat]: {
        sessions: [
          {
            id: "remote",
            topic: "远端会话",
            createdAt: 20,
            lastUpdate: 20,
            messages: [],
          },
        ],
        currentSessionIndex: 0,
      },
    } as any;

    expect(() => mergeAppState(localState, remoteState)).not.toThrow();
    expect(localState[StoreKey.Prompt].prompts.keep.title).toBe("保留提示词");
    expect(localState[StoreKey.Chat].sessions).toHaveLength(2);
  });

  test("mergeStoreState should keep remote empty sessions and sort by createdAt", () => {
    const merged = mergeStoreState(
      StoreKey.Chat,
      {
        sessions: [
          {
            id: "session-1",
            topic: "旧会话",
            createdAt: 100,
            lastUpdate: 500,
            messages: [{ id: "m1", date: "2026-03-18T10:00:00.000Z" }],
          },
        ],
        currentSessionIndex: 0,
      } as any,
      {
        sessions: [
          {
            id: "session-1",
            topic: "旧会话",
            createdAt: 100,
            lastUpdate: 400,
            messages: [],
          },
          {
            id: "session-2",
            topic: "远端空会话",
            createdAt: 300,
            lastUpdate: 300,
            messages: [],
          },
        ],
        currentSessionIndex: 0,
      } as any,
    );

    expect(merged.sessions.map((session: any) => session.id)).toEqual([
      "session-2",
      "session-1",
    ]);
    expect(
      merged.sessions.find((session: any) => session.id === "session-2"),
    ).toBeTruthy();
  });

  test("readFromFile should reject when file selection is canceled", async () => {
    const originalCreateElement = document.createElement.bind(document);
    let fileInput: HTMLInputElement | undefined;

    const createElementSpy = jest
      .spyOn(document, "createElement")
      .mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
        const element = originalCreateElement(tagName, options);
        if (tagName === "input") {
          fileInput = element as HTMLInputElement;
        }
        return element;
      }) as typeof document.createElement);

    const promise = readFromFile();
    fileInput?.onchange?.({ target: { files: [] } } as any);

    await expect(promise).rejects.toThrow("[File] 用户取消选择文件");

    createElementSpy.mockRestore();
  });
});
