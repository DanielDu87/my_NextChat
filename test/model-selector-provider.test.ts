import {
  getActiveModelSelectorProviderId,
  getModelSelectorDefaultValue,
} from "../app/utils/model-selector-provider";
import {
  collectModels,
  getLatestOpenAIModelForCurrentSupplier,
  getLatestOpenAIModelForProviderId,
  getLatestOpenAIModelName,
} from "../app/utils/model";
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

  test("模型选择器关闭后应保留刚切换的 provider id", () => {
    expect(
      getActiveModelSelectorProviderId({
        showModelSelector: false,
        modelSelectorProviderId: "custom_yutoapi",
        currentProviderId: "custom_aihubmix",
      }),
    ).toBe("custom_yutoapi");
  });

  test("打开模型选择器时应优先选中当前展示模型", () => {
    expect(
      getModelSelectorDefaultValue({
        providerId: "custom_aihubmix",
        currentModel: "gpt-chat-latest",
        latestModel: "gpt-5.5",
      }),
    ).toBe("gpt-chat-latest@custom_aihubmix");
  });

  test("当前模型为空时才使用供应商最新模型兜底", () => {
    expect(
      getModelSelectorDefaultValue({
        providerId: "custom_yutoapi",
        latestModel: "gpt-5.5",
      }),
    ).toBe("gpt-5.5@custom_yutoapi");
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

  test("AIhubmix 自动选择应优先使用 gpt-chat-latest", () => {
    const models = [
      {
        available: true,
        name: "gpt-5.5",
        provider: {
          id: "custom_aihubmix",
          providerName: ServiceProvider.Custom,
        },
        publishedAt: 20260501,
      },
      {
        available: true,
        name: "gpt-chat-latest",
        provider: {
          id: "custom_aihubmix",
          providerName: ServiceProvider.Custom,
        },
        publishedAt: 20260401,
      },
    ] as any;

    expect(getLatestOpenAIModelForProviderId(models, "custom_aihubmix")).toEqual(
      {
        model: "gpt-chat-latest",
        providerName: ServiceProvider.Custom,
      },
    );
    expect(
      getLatestOpenAIModelForCurrentSupplier(
        models,
        {
          model: "gpt-5.5",
          providerName: ServiceProvider.Custom,
          providerId: "custom_aihubmix",
        } as any,
        [],
      ),
    ).toEqual({
      model: "gpt-chat-latest",
      providerName: ServiceProvider.Custom,
    });
  });

  test("非 AIhubmix 供应商仍应优先使用最新 OpenAI 主模型", () => {
    expect(
      getLatestOpenAIModelForProviderId(
        [
          {
            available: true,
            name: "gpt-chat-latest",
            provider: {
              id: "custom_yutoapi",
              providerName: ServiceProvider.Custom,
            },
            publishedAt: 20260401,
          },
          {
            available: true,
            name: "gpt-5.5",
            provider: {
              id: "custom_yutoapi",
              providerName: ServiceProvider.Custom,
            },
            publishedAt: 20260501,
          },
        ] as any,
        "custom_yutoapi",
      ),
    ).toEqual({
      model: "gpt-5.5",
      providerName: ServiceProvider.Custom,
    });
  });

  test("目标供应商没有当前模型时，不应沿用其他供应商的 OpenAI 模型", () => {
    const result = getLatestOpenAIModelForCurrentSupplier(
      [
        {
          available: true,
          name: "gpt-5.5-free",
          provider: {
            id: "custom_aihubmix",
            providerName: ServiceProvider.Custom,
          },
          publishedAt: 20260501,
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
          name: "gpt-4o",
          provider: {
            id: "custom_yutoapi",
            providerName: ServiceProvider.Custom,
          },
          publishedAt: 20240513,
        },
      ] as any,
      {
        model: "gpt-5.5-free",
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

  test("自动检测最新 OpenAI 主模型时，基础模型应优先于同版本 free 变体", () => {
    expect(
      getLatestOpenAIModelName([
        {
          available: true,
          name: "gpt-5.5-free",
          provider: {
            id: "custom_aihubmix",
            providerName: ServiceProvider.Custom,
          },
          publishedAt: 20260520,
        },
        {
          available: true,
          name: "gpt-5.5",
          provider: {
            id: "custom_yutoapi",
            providerName: ServiceProvider.Custom,
          },
          publishedAt: 20260501,
        },
        {
          available: true,
          name: "gpt-5.4",
          provider: {
            id: "custom_ocoolai",
            providerName: ServiceProvider.Custom,
          },
          publishedAt: 20260301,
        },
      ] as any),
    ).toBe("gpt-5.5");
  });

  test("自动补到目标供应商的同名模型应继承正常排序元数据", () => {
    const models = collectModels(
      [
        {
          available: true,
          name: "gpt-5.5",
          displayName: "gpt-5.5",
          sorted: 12,
          catalogRank: 4,
          publishedAt: 20260501,
          publishedAtSource: "manual",
          provider: {
            id: "custom_aihubmix",
            providerName: ServiceProvider.Custom,
            providerType: "custom",
            sorted: 0,
          },
        },
      ] as any,
      "+gpt-5.5@custom_yutoapi",
    );

    const yutoModel = models.find(
      (model) =>
        model.name === "gpt-5.5" && model.provider?.id === "custom_yutoapi",
    );

    expect(yutoModel).toEqual(
      expect.objectContaining({
        catalogRank: 4,
        publishedAt: 20260501,
        sorted: 12,
      }),
    );
  });
});
