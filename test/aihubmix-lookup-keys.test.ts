import {
  getAiHubMixLookupKeys,
  resolveAiHubMixCatalogRank,
} from "../app/utils/models";

describe("aihubmix lookup keys", () => {
  test("应为带命名空间前缀的模型生成 AihubMix 主模型名候选", () => {
    expect(getAiHubMixLookupKeys("deepseek-ai/DeepSeek-R1")).toEqual(
      expect.arrayContaining(["deepseek-ai/deepseek-r1", "deepseek-r1"]),
    );
  });

  test("应去掉命名空间后模型名上的尾部日期后缀", () => {
    expect(getAiHubMixLookupKeys("qwen/Qwen3-32B-20260305")).toEqual(
      expect.arrayContaining(["qwen/qwen3-32b-20260305", "qwen3-32b"]),
    );
  });

  test("名称大小写和尾部日期不同但归一化后相同，应命中同一个 AihubMix 名称", () => {
    const metadataMap = new Map([
      ["deepseek-r1", { rank: 12 }],
      ["deepseek-v3", { rank: 34 }],
    ]);

    expect(
      resolveAiHubMixCatalogRank("deepseek-ai/DeepSeek-R1-0528", metadataMap),
    ).toBe(12);
  });

  test("中间夹带日期也应尽量匹配到 AihubMix 顺序", () => {
    const metadataMap = new Map([["qwen3-32b", { rank: 21 }]]);

    expect(
      resolveAiHubMixCatalogRank("qwen/Qwen3-20260305-32B", metadataMap),
    ).toBe(21);
  });

  test("大小写和分隔符不一致时也应按小写归一后匹配", () => {
    const metadataMap = new Map([["gpt-4o-mini", { rank: 7 }]]);

    expect(resolveAiHubMixCatalogRank("GPT_4O_MINI", metadataMap)).toBe(7);
  });

  test("codex 的 high medium low 变体应尽量回落到 AihubMix 主模型顺序", () => {
    const metadataMap = new Map([
      ["gpt-5-codex", { rank: 115 }],
      ["gpt-5.3-codex", { rank: 22 }],
    ]);

    expect(resolveAiHubMixCatalogRank("gpt-5-codex-medium", metadataMap)).toBe(
      115,
    );
    expect(resolveAiHubMixCatalogRank("gpt-5.3-codex-high", metadataMap)).toBe(
      22,
    );
  });

  test("供应商把 o3 o4 o1 写成 03 04 01 时也应尽量匹配到 AihubMix 顺序", () => {
    const metadataMap = new Map([["o3-deep-research", { rank: 123 }]]);

    expect(
      resolveAiHubMixCatalogRank("03-deep-research-2025-06-26", metadataMap),
    ).toBe(123);
  });

  test("渠道前缀和 official 后缀也应尽量回落到 AihubMix 主模型顺序", () => {
    const metadataMap = new Map([
      ["gpt-4-turbo-preview", { rank: 40 }],
      ["gpt-3.5-turbo-0613", { rank: 240 }],
      ["gpt-5.4", { rank: 6 }],
      ["gpt-5.3-codex", { rank: 22 }],
    ]);

    expect(resolveAiHubMixCatalogRank("net-gpt-4-turbo-preview", metadataMap)).toBe(
      40,
    );
    expect(resolveAiHubMixCatalogRank("net-gpt-3.5-turbo-0613", metadataMap)).toBe(
      240,
    );
    expect(resolveAiHubMixCatalogRank("gpt-5.4-official", metadataMap)).toBe(6);
    expect(resolveAiHubMixCatalogRank("gpt-5.3-codex-official", metadataMap)).toBe(
      22,
    );
  });
});
