import { hydrateModelsWithAiHubMixMetadata } from "../app/utils/models";

describe("aihubmix hydration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test("不同供应商的同步恢复模型都应补回 AihubMix catalogRank", () => {
    localStorage.setItem(
      "nextchat:aihubmix-catalog-metadata",
      JSON.stringify([
        ["gpt-5.4-mini", { rank: 12 }],
        ["gpt-5-mini", { rank: 119 }],
        ["gpt-5-codex", { rank: 115 }],
        ["o3-deep-research", { rank: 123 }],
      ]),
    );

    const hydrated = hydrateModelsWithAiHubMixMetadata([
      {
        name: "gpt-5.4-mini",
        provider: { id: "custom_yutoapi", providerName: "Custom" },
      },
      {
        name: "gpt-5-codex-medium",
        provider: { id: "custom_ocoolai", providerName: "Custom" },
      },
      {
        name: "03-deep-research-2025-06-26",
        provider: { id: "custom_toapis", providerName: "Custom" },
      },
      {
        name: "gpt-5-mini",
        provider: { id: "custom_other", providerName: "Custom" },
      },
    ] as any);

    const rankByName = new Map(
      hydrated.map((model) => [model.name, model.catalogRank]),
    );

    expect(rankByName.get("gpt-5.4-mini")).toBe(12);
    expect(rankByName.get("gpt-5-codex-medium")).toBe(115);
    expect(rankByName.get("03-deep-research-2025-06-26")).toBe(123);
    expect(rankByName.get("gpt-5-mini")).toBe(119);
  });
});
