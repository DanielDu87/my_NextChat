import { compareSelectorItems } from "../app/components/ui-lib";

describe("selector model order", () => {
  test("应优先按真实模型名排序，而不是展示名", () => {
    const items = [
      {
        title: "OpenAI 最新旗舰",
        sortKey: "gpt-4.1",
        value: "gpt-4.1@OpenAI",
        publishedAt: 20250414,
        order: 1,
      },
      {
        title: "OpenAI 经典模型",
        sortKey: "gpt-4o",
        value: "gpt-4o@OpenAI",
        publishedAt: 20240513,
        order: 2,
      },
      {
        title: "OpenAI 新预览",
        sortKey: "gpt-4.1-mini",
        value: "gpt-4.1-mini@OpenAI",
        publishedAt: 20250414,
        order: 3,
      },
    ];

    const sorted = items.slice().sort(compareSelectorItems);

    expect(sorted.map((item) => item.sortKey)).toEqual([
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4o",
    ]);
  });

  test("应把发布时间新的模型排在最前面", () => {
    const items = [
      {
        title: "aistudio_gpt-4.1-mini",
        sortKey: "aistudio_gpt-4.1-mini",
        value: "aistudio_gpt-4.1-mini@Custom",
        publishedAt: 20250414,
        order: 1,
      },
      {
        title: "aihubmix-router",
        sortKey: "aihubmix-router",
        value: "aihubmix-router@Custom",
        order: 2,
      },
      {
        title: "gpt-5.4",
        sortKey: "gpt-5.4",
        value: "gpt-5.4@Custom",
        publishedAt: 20260305,
        order: 3,
      },
      {
        title: "gpt-5.4-mini",
        sortKey: "gpt-5.4-mini",
        value: "gpt-5.4-mini@Custom",
        publishedAt: 20260305,
        order: 4,
      },
    ];

    const sorted = items.slice().sort(compareSelectorItems);

    expect(sorted.map((item) => item.sortKey)).toEqual([
      "gpt-5.4",
      "gpt-5.4-mini",
      "aistudio_gpt-4.1-mini",
      "aihubmix-router",
    ]);
  });
});
