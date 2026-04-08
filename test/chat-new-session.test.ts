import {
  applyAutoModeModelConfig,
  mergeNewSessionModelConfig,
} from "../app/utils/chat-session-model";
import {
  getLatestOpenAIModelForProviderId,
  getPreferredDisplayModelConfig,
  getPreferredDefaultChatModel,
  getPreferredRuntimeModelConfig,
  normalizeReservedDisplayModelName,
  resolveModelProviderId,
} from "../app/utils/model";
import { ServiceProvider } from "../app/constant";

describe("chat session model config", () => {
  test("自动模式覆盖时，只替换 model 和 provider", () => {
    expect(
      applyAutoModeModelConfig(
        {
          model: "gpt-4o",
          providerName: "OpenAI",
          temperature: 0.7,
          top_p: 0.8,
        } as any,
        {
          model: "doubao-seed-2-0-lite",
          providerName: "Custom" as any,
        } as any,
      ),
    ).toEqual(
      expect.objectContaining({
        model: "doubao-seed-2-0-lite",
        providerName: "Custom",
        temperature: 0.7,
        top_p: 0.8,
      }),
    );
  });
});

describe("new session model config", () => {
  test("自动模式开启时，新会话应保留自动候选模型和 provider", () => {
    expect(
      mergeNewSessionModelConfig(
        {
          model: "gpt-4o",
          providerName: "OpenAI",
          temperature: 0.7,
          top_p: 0.8,
        } as any,
        {
          model: "doubao-seed-2-0-lite",
          providerName: "Custom",
          temperature: 0.5,
          top_p: 1,
        } as any,
        true,
      ),
    ).toEqual(
      expect.objectContaining({
        model: "doubao-seed-2-0-lite",
        providerName: "Custom",
        temperature: 0.7,
        top_p: 0.8,
      }),
    );
  });

  test("自动模式关闭时，新会话沿用当前会话模型配置", () => {
    expect(
      mergeNewSessionModelConfig(
        {
          model: "gpt-4o",
          providerName: "OpenAI",
          temperature: 0.7,
        } as any,
        {
          model: "doubao-seed-2-0-lite",
          providerName: "Custom",
          temperature: 0.5,
        } as any,
        false,
      ),
    ).toEqual(
      expect.objectContaining({
        model: "gpt-4o",
        providerName: "OpenAI",
        temperature: 0.7,
      }),
    );
  });

  test("多自定义供应商时，应优先按当前会话模型解析 provider id", () => {
    expect(
      resolveModelProviderId(
        [
          {
            name: "gpt-5.4",
            available: true,
            displayName: "gpt-5.4",
            sorted: 0,
            provider: {
              id: "custom_toapi",
              providerName: ServiceProvider.Custom,
              providerType: "custom",
              sorted: 0,
            },
          },
          {
            name: "gemini-3.1-flash-image-preview-official",
            available: true,
            displayName: "gemini-3.1-flash-image-preview-official",
            sorted: 1,
            provider: {
              id: "custom_gemini",
              providerName: ServiceProvider.Custom,
              providerType: "custom",
              sorted: 1,
            },
          },
        ] as any,
        {
          model: "gpt-5.4",
          providerName: ServiceProvider.Custom,
        },
        [
          {
            name: "Gemini",
            provider: ServiceProvider.Custom,
            enabled: true,
          },
          {
            name: "ToAPI",
            provider: ServiceProvider.Custom,
            enabled: false,
          },
        ] as any,
      ),
    ).toBe("custom_toapi");
  });

  test("首开默认聊天模型应优先使用官方保留的 gpt-5.4，而不是 Local 变体", () => {
    expect(
      getPreferredDefaultChatModel(
        [
          {
            name: "gpt-5.4-2026-03-05",
            available: true,
            displayName: "gpt-5.4-2026-03-05",
            sorted: 0,
            provider: {
              id: "local_llama.cpp",
              providerName: ServiceProvider.Local,
              providerType: "openai",
              sorted: 0,
            },
          },
          {
            name: "gpt-5.4",
            available: true,
            displayName: "gpt-5.4",
            sorted: 1,
            provider: {
              id: "openai",
              providerName: ServiceProvider.OpenAI,
              providerType: "openai",
              sorted: 1,
            },
          },
        ] as any,
        {
          model: "gpt-5.4-2026-03-05",
          providerName: ServiceProvider.Local,
        },
        [
          {
            name: "OpenAI",
            provider: ServiceProvider.OpenAI,
            enabled: true,
          },
          {
            name: "Local",
            provider: ServiceProvider.Local,
            enabled: true,
          },
        ] as any,
      ),
    ).toEqual({
      model: "gpt-5.4",
      providerName: ServiceProvider.OpenAI,
    });
  });

  test("首开使用 Local 兜底时，界面展示仍应保持官方 gpt-5.4 名称", () => {
    expect(
      getPreferredDisplayModelConfig(
        [
          {
            name: "gpt-5.4-2026-03-05",
            available: true,
            displayName: "gpt-5.4-2026-03-05",
            sorted: 0,
            provider: {
              id: "local_llama.cpp",
              providerName: ServiceProvider.Local,
              providerType: "openai",
              sorted: 0,
            },
          },
          {
            name: "gpt-5.4",
            available: true,
            displayName: "gpt-5.4",
            sorted: 1,
            provider: {
              id: "openai",
              providerName: ServiceProvider.OpenAI,
              providerType: "openai",
              sorted: 1,
            },
          },
        ] as any,
        {
          model: "gpt-5.4-2026-03-05",
          providerName: ServiceProvider.Local,
        },
        [
          {
            name: "OpenAI",
            provider: ServiceProvider.OpenAI,
            enabled: true,
          },
          {
            name: "Local",
            provider: ServiceProvider.Local,
            enabled: true,
          },
        ] as any,
      ),
    ).toEqual({
      model: "gpt-5.4",
      providerName: ServiceProvider.OpenAI,
    });
  });

  test("保留模型显示名应去掉日期后缀和 @Local", () => {
    expect(
      normalizeReservedDisplayModelName("gpt-5.4-2026-03-05@Local"),
    ).toBe("gpt-5.4");
  });

  test("首开空白会话实际发送前也应把本地日期变体切到官方 gpt-5.4", () => {
    expect(
      getPreferredRuntimeModelConfig(
        [
          {
            name: "gpt-5.4-2026-03-05",
            available: true,
            displayName: "gpt-5.4-2026-03-05",
            sorted: 0,
            provider: {
              id: "local_llama.cpp",
              providerName: ServiceProvider.Local,
              providerType: "openai",
              sorted: 0,
            },
          },
          {
            name: "gpt-5.4",
            available: true,
            displayName: "gpt-5.4",
            sorted: 1,
            provider: {
              id: "openai",
              providerName: ServiceProvider.OpenAI,
              providerType: "openai",
              sorted: 1,
            },
          },
        ] as any,
        {
          model: "gpt-5.4-2026-03-05",
          providerName: ServiceProvider.Local,
        },
        [
          {
            name: "OpenAI",
            provider: ServiceProvider.OpenAI,
            enabled: true,
          },
        ] as any,
      ),
    ).toEqual({
      model: "gpt-5.4",
      providerName: ServiceProvider.OpenAI,
    });
  });

  test("同一供应商下新会话应优先使用最新 OpenAI 主模型", () => {
    expect(
      getLatestOpenAIModelForProviderId(
        [
          {
            name: "gpt-4.1",
            available: true,
            displayName: "gpt-4.1",
            sorted: 0,
            provider: {
              id: "custom_yutoapi",
              providerName: ServiceProvider.Custom,
              providerType: "custom",
              sorted: 0,
            },
          },
          {
            name: "gpt-5.4",
            available: true,
            displayName: "gpt-5.4",
            sorted: 1,
            provider: {
              id: "custom_yutoapi",
              providerName: ServiceProvider.Custom,
              providerType: "custom",
              sorted: 0,
            },
          },
          {
            name: "gpt-5.4-mini",
            available: true,
            displayName: "gpt-5.4-mini",
            sorted: 2,
            provider: {
              id: "custom_yutoapi",
              providerName: ServiceProvider.Custom,
              providerType: "custom",
              sorted: 0,
            },
          },
        ] as any,
        "custom_yutoapi",
      ),
    ).toEqual({
      model: "gpt-5.4",
      providerName: ServiceProvider.Custom,
    });
  });

  test("新会话默认模型选择不应跳到其他供应商", () => {
    expect(
      getLatestOpenAIModelForProviderId(
        [
          {
            name: "gpt-5.4",
            available: true,
            displayName: "gpt-5.4",
            sorted: 0,
            provider: {
              id: "custom_ocoolai",
              providerName: ServiceProvider.Custom,
              providerType: "custom",
              sorted: 0,
            },
          },
          {
            name: "gpt-5.4",
            available: true,
            displayName: "gpt-5.4",
            sorted: 1,
            provider: {
              id: "custom_yutoapi",
              providerName: ServiceProvider.Custom,
              providerType: "custom",
              sorted: 0,
            },
          },
        ] as any,
        "custom_ocoolai",
      ),
    ).toEqual({
      model: "gpt-5.4",
      providerName: ServiceProvider.Custom,
    });
  });
});
