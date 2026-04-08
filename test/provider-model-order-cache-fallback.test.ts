describe("provider model order cache fallback", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
  });

  test("AihubMix 顺序接口失败时，Yuto 仍应回退到本地缓存 rank", async () => {
    const constantsModule = await import("../app/constant");
    const modelsModule = await import("../app/utils/models");

    localStorage.setItem(
      "nextchat:aihubmix-catalog-metadata",
      JSON.stringify([
        ["gpt-5.4", { rank: 6 }],
        ["gpt-5.4-mini", { rank: 12 }],
        ["gpt-4o", { rank: 360 }],
        ["gpt-4o-mini", { rank: 361 }],
      ]),
    );

    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/aihubmix/models") {
        throw new Error("aihubmix unavailable");
      }

      if (url === "/api/aihubmix/models?source=page&p=0&num=10000") {
        throw new Error("aihubmix classification unavailable");
      }

      if (url === "/api/yuto/pricing") {
        return {
          ok: true,
          json: async () => ({
            vendors: [{ id: 1, name: "OpenAI", icon: "openai" }],
            data: [
              {
                model_name: "gpt-4o-realtime-preview-2025-06-03",
                vendor_id: 1,
              },
              {
                model_name: "gpt-5.4",
                vendor_id: 1,
              },
            ],
          }),
        } as Response;
      }

      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await modelsModule.fetchModelsFromProvider(
      constantsModule.default.ServiceProvider.Custom,
      "https://gptapi.asia/v1",
      "test-key",
      "Yuto",
    );

    const rankByName = new Map(
      result.models.map((model) => [model.name, model.catalogRank]),
    );

    expect(rankByName.get("gpt-5.4")).toBe(6);
    expect(rankByName.get("gpt-4o-realtime-preview-2025-06-03")).toBeUndefined();
  });
});
