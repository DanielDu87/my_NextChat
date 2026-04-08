import { collectModels } from "../app/utils/model";

describe("runtime model order", () => {
  test("未命中 AihubMix 的模型不应因日期更大而排到已命中模型前面", () => {
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

    const sorted = collectModels(models, "");

    expect(sorted.map((item) => item.name)).toEqual([
      "gpt-5.4",
      "gpt-4o-realtime-preview-2025-06-03",
      "gpt-audio-mini-2025-12-15",
    ]);
  });
});
