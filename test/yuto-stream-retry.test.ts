import { jest } from "@jest/globals";

const fetchEventSourceMock = jest.fn();

describe("YutoAPI stream fallback retry", () => {
  const originalRequestAnimationFrame = global.requestAnimationFrame;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    fetchEventSourceMock.mockReset();

    let frameBudget = 24;
    global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      if (frameBudget-- <= 0) {
        return 0;
      }
      return setTimeout(() => callback(performance.now()), 0) as unknown as number;
    }) as typeof requestAnimationFrame;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.requestAnimationFrame = originalRequestAnimationFrame;
  });

  async function loadChatUtils() {
    jest.unstable_mockModule("@fortaine/fetch-event-source", () => ({
      EventStreamContentType: "text/event-stream",
      fetchEventSource: (...args: unknown[]) => fetchEventSourceMock(...args),
    }));
    jest.unstable_mockModule("@/app/client/api", () => ({}));
    jest.unstable_mockModule("@/app/locales", () => ({
      __esModule: true,
      default: {
        Error: {
          Unauthorized: "Unauthorized",
        },
      },
    }));

    return import("../app/utils/chat");
  }

  async function runRetryScenario(
    run: (
      utils: Awaited<ReturnType<typeof loadChatUtils>>,
      onFinish: jest.Mock,
      onError: jest.Mock,
      onUpdate: jest.Mock,
    ) => void,
  ) {
    const utils = await loadChatUtils();
    const seenAuthHeaders: string[] = [];
    const onFinish = jest.fn();
    const onError = jest.fn();
    const onUpdate = jest.fn();
    const createResponse = () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({
          "content-type": "text/event-stream; charset=utf-8",
        }),
        clone() {
          return this;
        },
        async text() {
          return "";
        },
        async json() {
          return {};
        },
      }) as Response;

    fetchEventSourceMock.mockImplementation(async (_url: string, options: any) => {
      seenAuthHeaders.push(options.headers.Authorization);
      const response = createResponse();

      await options.onopen(response);

      if (seenAuthHeaders.length === 1) {
        await options.onclose();
        return;
      }

      options.onmessage({ data: "second-pass" });
      await options.onclose();
    });

    run(utils, onFinish, onError, onUpdate);

    await jest.runAllTimersAsync();

    expect(seenAuthHeaders).toEqual(["Bearer key-1", "Bearer key-2"]);
    expect(onError).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish.mock.calls[0]?.[0]).toContain("second-pass");
  }

  test("should retry empty YutoAPI stream responses with fallback api key", async () => {
    await runRetryScenario((utils, onFinish, onError, onUpdate) => {
      utils.stream(
        "https://cn.gptapi.asia/v1/chat/completions",
        { messages: [] },
        {
          Authorization: "Bearer key-1",
          "x-fallback-api-keys": ["key-1", "key-2"],
          "x-fallback-api-key-groups": ["enterprise", "discount"],
        },
        [],
        {},
        new AbortController(),
        (text: string) => text,
        () => {},
        { onFinish, onError, onUpdate },
      );
    });
  });

  test("should retry empty YutoAPI think-stream responses with fallback api key", async () => {
    await runRetryScenario((utils, onFinish, onError, onUpdate) => {
      utils.streamWithThink(
        "https://cn.gptapi.asia/v1/chat/completions",
        { messages: [] },
        {
          Authorization: "Bearer key-1",
          "x-fallback-api-keys": ["key-1", "key-2"],
          "x-fallback-api-key-groups": ["enterprise", "discount"],
        },
        [],
        {},
        new AbortController(),
        (text: string) => ({
          isThinking: false,
          content: text,
        }),
        () => {},
        { onFinish, onError, onUpdate },
      );
    });
  });

  test("should finish when all YutoAPI fallback keys fail", async () => {
    const utils = await loadChatUtils();
    const onFinish = jest.fn();
    const onError = jest.fn();

    fetchEventSourceMock.mockImplementation(async (_url: string, options: any) => {
      const response = {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: new Headers({
          "content-type": "application/json; charset=utf-8",
        }),
        clone() {
          return this;
        },
        async text() {
          return "{\"error\":{\"code\":\"model_not_found\",\"message\":\"mock fail\"}}";
        },
        async json() {
          return { error: { code: "model_not_found", message: "mock fail" } };
        },
      } as Response;

      await options.onopen(response);
    });

    utils.streamWithThink(
      "https://cn.gptapi.asia/v1/chat/completions",
      { messages: [] },
      {
        Authorization: "Bearer key-1",
        "x-fallback-api-keys": ["key-1", "key-2"],
        "x-fallback-api-key-groups": ["enterprise", "discount"],
      },
      [],
      {},
      new AbortController(),
      (text: string) => ({
        isThinking: false,
        content: text,
      }),
      () => {},
      { onFinish, onError, onUpdate: jest.fn() },
    );

    await jest.runAllTimersAsync();

    expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(String(onFinish.mock.calls[0]?.[0] || "")).toContain("mock fail");
  });
});
