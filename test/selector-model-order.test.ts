import { compareSelectorItems } from "../app/components/ui-lib";

describe("selector model order", () => {
  test("未命中 AihubMix 时，应优先保留原始顺序而不是按展示名排序", () => {
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
      "gpt-4o",
      "gpt-4.1-mini",
    ]);
  });

  test("未命中 AihubMix 时，应保留原始顺序而不是按发布时间抢前", () => {
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
      "aistudio_gpt-4.1-mini",
      "aihubmix-router",
      "gpt-5.4",
      "gpt-5.4-mini",
    ]);
  });

  test("命中 AihubMix catalogRank 时应严格按 URL 顺序排序", () => {
    const items = [
      {
        title: "gpt-4o-realtime-preview-2025-06-03",
        sortKey: "gpt-4o-realtime-preview-2025-06-03",
        value: "gpt-4o-realtime-preview-2025-06-03@Custom",
        group: "OpenAI",
        publishedAt: 20250603,
        order: 1,
        catalogRank: 0,
      },
      {
        title: "gpt-5.4",
        sortKey: "gpt-5.4",
        value: "gpt-5.4@Custom",
        group: "OpenAI",
        publishedAt: 20260305,
        order: 2,
        catalogRank: 5,
      },
      {
        title: "gpt-5.4-mini",
        sortKey: "gpt-5.4-mini",
        value: "gpt-5.4-mini@Custom",
        group: "OpenAI",
        publishedAt: 20260305,
        order: 3,
        catalogRank: 6,
      },
    ];

    const sorted = items.slice().sort(compareSelectorItems);

    expect(sorted.map((item) => item.sortKey)).toEqual([
      "gpt-4o-realtime-preview-2025-06-03",
      "gpt-5.4",
      "gpt-5.4-mini",
    ]);
  });

  test("带日期的模型名应去除日期后按同一个 AihubMix 顺序排序", () => {
    const items = [
      {
        title: "gpt-4o-mini-2025-06-03",
        sortKey: "gpt-4o-mini-2025-06-03",
        value: "gpt-4o-mini-2025-06-03@Custom",
        group: "OpenAI",
        publishedAt: 20250603,
        order: 1,
        catalogRank: 8,
      },
      {
        title: "gpt-4o",
        sortKey: "gpt-4o",
        value: "gpt-4o@Custom",
        group: "OpenAI",
        publishedAt: 20240513,
        order: 2,
        catalogRank: 3,
      },
      {
        title: "gpt-4o-mini",
        sortKey: "gpt-4o-mini",
        value: "gpt-4o-mini@Custom",
        group: "OpenAI",
        publishedAt: 20240718,
        order: 3,
        catalogRank: 8,
      },
    ];

    const sorted = items.slice().sort(compareSelectorItems);

    expect(sorted.map((item) => item.sortKey)).toEqual([
      "gpt-4o",
      "gpt-4o-mini-2025-06-03",
      "gpt-4o-mini",
    ]);
  });

  test("未匹配到 AihubMix 顺序的模型应统一排在最后", () => {
    const items = [
      {
        title: "custom-unknown-model",
        sortKey: "custom-unknown-model",
        value: "custom-unknown-model@Custom",
        group: "Custom",
        publishedAt: 20270101,
        order: 1,
      },
      {
        title: "gpt-4o-mini-2025-06-03",
        sortKey: "gpt-4o-mini-2025-06-03",
        value: "gpt-4o-mini-2025-06-03@Custom",
        group: "OpenAI",
        publishedAt: 20250603,
        order: 2,
        catalogRank: 8,
      },
      {
        title: "gpt-4o",
        sortKey: "gpt-4o",
        value: "gpt-4o@Custom",
        group: "OpenAI",
        publishedAt: 20240513,
        order: 3,
        catalogRank: 3,
      },
    ];

    const sorted = items.slice().sort(compareSelectorItems);

    expect(sorted.map((item) => item.sortKey)).toEqual([
      "gpt-4o",
      "gpt-4o-mini-2025-06-03",
      "custom-unknown-model",
    ]);
  });

  test("两个都未匹配到 AihubMix 时，应保留原始顺序而不是按日期抢前面", () => {
    const items = [
      {
        title: "gpt-5.4",
        sortKey: "gpt-5.4",
        value: "gpt-5.4@Custom",
        group: "OpenAI",
        publishedAt: 20260305,
        order: 1,
        catalogRank: 6,
      },
      {
        title: "gpt-audio-mini-2025-12-15",
        sortKey: "gpt-audio-mini-2025-12-15",
        value: "gpt-audio-mini-2025-12-15@Custom",
        group: "OpenAI",
        publishedAt: 20251215,
        order: 2,
      },
      {
        title: "gpt-4o-realtime-preview-2025-06-03",
        sortKey: "gpt-4o-realtime-preview-2025-06-03",
        value: "gpt-4o-realtime-preview-2025-06-03@Custom",
        group: "OpenAI",
        publishedAt: 20250603,
        order: 3,
      },
    ];

    const sorted = items.slice().sort(compareSelectorItems);

    expect(sorted.map((item) => item.sortKey)).toEqual([
      "gpt-5.4",
      "gpt-audio-mini-2025-12-15",
      "gpt-4o-realtime-preview-2025-06-03",
    ]);
  });

  test("GPT 数字版本应按版本降序，并让基础模型优先于变体", () => {
    const items = [
      {
        title: "gpt-5.4",
        sortKey: "gpt-5.4",
        value: "gpt-5.4@Custom",
        group: "OpenAI",
        publishedAt: 20260305,
        order: 1,
        catalogRank: 5,
      },
      {
        title: "gpt-5.4-mini",
        sortKey: "gpt-5.4-mini",
        value: "gpt-5.4-mini@Custom",
        group: "OpenAI",
        publishedAt: 20260305,
        order: 2,
        catalogRank: 6,
      },
      {
        title: "gpt-5.5-pro",
        sortKey: "gpt-5.5-pro",
        value: "gpt-5.5-pro@Custom",
        group: "OpenAI",
        publishedAt: 20260520,
        order: 3,
        catalogRank: 20,
      },
      {
        title: "gpt-5.5",
        sortKey: "gpt-5.5",
        value: "gpt-5.5@Custom",
        group: "OpenAI",
        publishedAt: 20260520,
        order: 4,
        catalogRank: 21,
      },
    ];

    const sorted = items.slice().sort(compareSelectorItems);

    expect(sorted.map((item) => item.sortKey)).toEqual([
      "gpt-5.5",
      "gpt-5.5-pro",
      "gpt-5.4",
      "gpt-5.4-mini",
    ]);
  });

  test("GPT 数字版本应排在 gpt-image 和 gpt-chat-latest 前面", () => {
    const items = [
      {
        title: "gpt-5.4",
        sortKey: "gpt-5.4",
        value: "gpt-5.4@Custom",
        group: "OpenAI",
        order: 1,
        catalogRank: 5,
      },
      {
        title: "gpt-image-2",
        sortKey: "gpt-image-2",
        value: "gpt-image-2@Custom",
        group: "OpenAI",
        order: 2,
        catalogRank: 6,
      },
      {
        title: "gpt-chat-latest",
        sortKey: "gpt-chat-latest",
        value: "gpt-chat-latest@Custom",
        group: "OpenAI",
        order: 3,
        catalogRank: 7,
      },
      {
        title: "gpt-5.5",
        sortKey: "gpt-5.5",
        value: "gpt-5.5@Custom",
        group: "OpenAI",
        order: 4,
        catalogRank: 20,
      },
      {
        title: "gpt-5.5-pro",
        sortKey: "gpt-5.5-pro",
        value: "gpt-5.5-pro@Custom",
        group: "OpenAI",
        order: 5,
        catalogRank: 21,
      },
    ];

    const sorted = items.slice().sort(compareSelectorItems);

    expect(sorted.map((item) => item.sortKey)).toEqual([
      "gpt-5.5",
      "gpt-5.5-pro",
      "gpt-5.4",
      "gpt-image-2",
      "gpt-chat-latest",
    ]);
  });
});
