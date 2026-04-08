import { DEFAULT_CONFIG, useAppConfig } from "../app/store/config";

describe("config model hydration", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppConfig.setState({
      ...DEFAULT_CONFIG,
      models: [],
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  test("mergeModels 后写入 store 的模型应直接带上 AihubMix catalogRank", () => {
    localStorage.setItem(
      "nextchat:aihubmix-catalog-metadata",
      JSON.stringify([
        ["gpt-5.4-mini", { rank: 12 }],
        ["gpt-5-codex", { rank: 115 }],
        ["o3-deep-research", { rank: 123 }],
      ]),
    );

    useAppConfig.getState().mergeModels(
      [
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
      ] as any,
      { silent: true, skipMarkUpdate: true },
    );

    const rankByName = new Map(
      useAppConfig
        .getState()
        .models.map((model) => [model.name, model.catalogRank]),
    );

    expect(rankByName.get("gpt-5.4-mini")).toBe(12);
    expect(rankByName.get("gpt-5-codex-medium")).toBe(115);
    expect(rankByName.get("03-deep-research-2025-06-26")).toBe(123);
  });
});
