import { collectModels } from "../app/utils/model";

describe("runtime model order", () => {
  test("运行期模型保持添加顺序，不再按日期或排名自动重排", () => {
    const models = [
      {
        name: "gpt-4o-realtime-preview-2025-06-03",
        available: true,
        sorted: 1,
        provider: {
          id: "custom_yuto",
          providerName: "Custom",
          providerType: "openai",
          sorted: 0,
        },
      },
      {
        name: "gpt-5.4",
        available: true,
        sorted: 2,
        catalogRank: 6,
        provider: {
          id: "custom_yuto",
          providerName: "Custom",
          providerType: "openai",
          sorted: 0,
        },
      },
      {
        name: "gpt-audio-mini-2025-12-15",
        available: true,
        sorted: 3,
        provider: {
          id: "custom_yuto",
          providerName: "Custom",
          providerType: "openai",
          sorted: 0,
        },
      },
    ] as any;

    const collected = collectModels(models, "");

    expect(collected.map((item) => item.name)).toEqual([
      "gpt-4o-realtime-preview-2025-06-03",
      "gpt-5.4",
      "gpt-audio-mini-2025-12-15",
    ]);
  });
});
