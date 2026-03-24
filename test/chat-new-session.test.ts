import {
  applyAutoModeModelConfig,
  mergeNewSessionModelConfig,
} from "../app/utils/chat-session-model";
import { resolveModelProviderId } from "../app/utils/model";
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
});
