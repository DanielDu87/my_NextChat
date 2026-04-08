import { ServiceProvider } from "../app/constant";
import { useAccessStore } from "../app/store/access";
import { DEFAULT_CONFIG, useAppConfig } from "../app/store/config";
import { useModelCacheStore } from "../app/store/model-cache";
import { rebuildManagedModelsFromCache } from "../app/utils/managed-model-rebuild";

describe("managed model rebuild", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppConfig.setState({
      ...DEFAULT_CONFIG,
      models: [],
    });
    useAccessStore.setState((state) => ({
      ...state,
      apiProfiles: [],
    }));
    useModelCacheStore.setState((state: any) => ({
      ...state,
      profiles: {},
    }));
  });

  afterEach(() => {
    localStorage.clear();
  });

  test("从缓存重建的模型应直接带上 AihubMix catalogRank", () => {
    localStorage.setItem(
      "nextchat:aihubmix-catalog-metadata",
      JSON.stringify([
        ["gpt-5.4-mini", { rank: 12 }],
        ["gpt-5-codex", { rank: 115 }],
        ["o3-deep-research", { rank: 123 }],
      ]),
    );

    useAccessStore.setState((state) => ({
      ...state,
      apiProfiles: [
        {
          id: "yuto-seeded",
          name: "YutoAPI",
          provider: ServiceProvider.Custom,
          cachedModels:
            "gpt-5-codex-medium,gpt-5.4-mini,03-deep-research-2025-06-26,gpt-5-mini",
        },
      ] as any,
    }));

    useModelCacheStore.setState((state: any) => ({
      ...state,
      profiles: {
        "yuto-seeded": {
          cachedModels:
            "gpt-5-codex-medium,gpt-5.4-mini,03-deep-research-2025-06-26,gpt-5-mini",
        },
      },
    }));

    rebuildManagedModelsFromCache();

    const rankByName = new Map(
      useAppConfig
        .getState()
        .models.map((model) => [model.name, model.catalogRank]),
    );

    expect(rankByName.get("gpt-5.4-mini")).toBe(12);
    expect(rankByName.get("gpt-5-codex-medium")).toBe(115);
    expect(rankByName.get("03-deep-research-2025-06-26")).toBe(123);
  });

  test("首开仅有 AihubMix 已加载时，也应从当前模型反向种出排序缓存", () => {
    useAppConfig.setState({
      ...DEFAULT_CONFIG,
      models: [
        {
          name: "gpt-5.4-mini",
          catalogRank: 12,
          provider: {
            id: "custom_aihubmix",
            providerName: "Custom",
          },
        },
        {
          name: "gpt-5-codex",
          catalogRank: 115,
          provider: {
            id: "custom_aihubmix",
            providerName: "Custom",
          },
        },
        {
          name: "o3-deep-research",
          catalogRank: 123,
          provider: {
            id: "custom_aihubmix",
            providerName: "Custom",
          },
        },
      ] as any,
    });

    useAccessStore.setState((state) => ({
      ...state,
      apiProfiles: [
        {
          id: "yuto",
          name: "YutoAPI",
          provider: ServiceProvider.Custom,
          cachedModels:
            "gpt-5-codex-medium,gpt-5.4-mini,03-deep-research-2025-06-26",
        },
      ] as any,
    }));

    useModelCacheStore.setState((state: any) => ({
      ...state,
      profiles: {
        yuto: {
          cachedModels:
            "gpt-5-codex-medium,gpt-5.4-mini,03-deep-research-2025-06-26",
        },
      },
    }));

    rebuildManagedModelsFromCache();

    const rankByName = new Map(
      useAppConfig
        .getState()
        .models.map((model) => [model.name, model.catalogRank]),
    );

    expect(rankByName.get("gpt-5.4-mini")).toBe(12);
    expect(rankByName.get("gpt-5-codex-medium")).toBe(115);
    expect(rankByName.get("03-deep-research-2025-06-26")).toBe(123);
  });

  test("从缓存重建后也应按 AihubMix catalogRank 排序，而不是按 cachedModels 原始顺序", () => {
    localStorage.setItem(
      "nextchat:aihubmix-catalog-metadata",
      JSON.stringify([
        ["gpt-5.4-mini", { rank: 12 }],
        ["gpt-5-codex", { rank: 115 }],
        ["o3-deep-research", { rank: 123 }],
      ]),
    );

    useAccessStore.setState((state) => ({
      ...state,
      apiProfiles: [
        {
          id: "yuto-order",
          name: "YutoAPI",
          provider: ServiceProvider.Custom,
          cachedModels:
            "gpt-5-codex-medium,gpt-5.4-mini,03-deep-research-2025-06-26",
        },
      ] as any,
    }));

    useModelCacheStore.setState((state: any) => ({
      ...state,
      profiles: {
        "yuto-order": {
          cachedModels:
            "gpt-5-codex-medium,gpt-5.4-mini,03-deep-research-2025-06-26",
        },
      },
    }));

    rebuildManagedModelsFromCache();

    const names = useAppConfig.getState().models.map((model) => model.name);

    expect(names).toEqual([
      "gpt-5.4-mini",
      "gpt-5-codex-medium",
      "03-deep-research-2025-06-26",
    ]);
  });

  test("强制重建时即使缓存字符串未变化，也应按最新 AihubMix 元数据重新排序", () => {
    useAccessStore.setState((state) => ({
      ...state,
      apiProfiles: [
        {
          id: "yuto-force",
          name: "YutoAPI",
          provider: ServiceProvider.Custom,
          cachedModels: "gpt-5-codex-medium,gpt-5.4-mini",
        },
      ] as any,
    }));

    useModelCacheStore.setState((state: any) => ({
      ...state,
      profiles: {
        "yuto-force": {
          cachedModels: "gpt-5-codex-medium,gpt-5.4-mini",
        },
      },
    }));

    localStorage.setItem(
      "nextchat:aihubmix-catalog-metadata",
      JSON.stringify([
        ["gpt-5-codex", { rank: 115 }],
        ["gpt-5.4-mini", { rank: 12 }],
      ]),
    );

    rebuildManagedModelsFromCache();

    localStorage.setItem(
      "nextchat:aihubmix-catalog-metadata",
      JSON.stringify([
        ["gpt-5-codex", { rank: 200 }],
        ["gpt-5.4-mini", { rank: 10 }],
      ]),
    );

    rebuildManagedModelsFromCache({ force: true });

    const names = useAppConfig.getState().models.map((model) => model.name);
    expect(names).toEqual(["gpt-5.4-mini", "gpt-5-codex-medium"]);
  });
});
