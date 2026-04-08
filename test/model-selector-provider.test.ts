import { getActiveModelSelectorProviderId } from "../app/utils/model-selector-provider";
import { getLatestOpenAIModelForCurrentSupplier } from "../app/utils/model";
import { ServiceProvider } from "../app/constant";

describe("model selector provider state", () => {
  test("模型选择器打开后应优先使用切换中的 provider id", () => {
    expect(
      getActiveModelSelectorProviderId({
        showModelSelector: true,
        modelSelectorProviderId: "custom_yutoapi",
        currentProviderId: "custom_aihubmix",
      }),
    ).toBe("custom_yutoapi");
  });

  test("模型选择器关闭后应回退到当前会话 provider id", () => {
    expect(
      getActiveModelSelectorProviderId({
        showModelSelector: false,
        modelSelectorProviderId: "custom_yutoapi",
        currentProviderId: "custom_aihubmix",
      }),
    ).toBe("custom_aihubmix");
  });

  test("切换供应商时应优先选择该供应商下最新 OpenAI 主模型", () => {
    const result = getLatestOpenAIModelForCurrentSupplier(
      [
        {
          available: true,
          name: "gpt-4o",
          provider: {
            id: "custom_yutoapi",
            providerName: ServiceProvider.Custom,
          },
          publishedAt: 20240513,
        },
        {
          available: true,
          name: "gpt-5.4",
          provider: {
            id: "custom_yutoapi",
            providerName: ServiceProvider.Custom,
          },
          publishedAt: 20260301,
        },
        {
          available: true,
          name: "gpt-5",
          provider: {
            id: "custom_other",
            providerName: ServiceProvider.Custom,
          },
          publishedAt: 20260101,
        },
      ] as any,
      {
        model: "gpt-4o",
        providerName: ServiceProvider.Custom,
        providerId: "custom_yutoapi",
      } as any,
      [],
    );

    expect(result).toEqual({
      model: "gpt-5.4",
      providerName: ServiceProvider.Custom,
    });
  });
});
