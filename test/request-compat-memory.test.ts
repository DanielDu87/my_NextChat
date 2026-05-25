import {
  applyRequestCompatibilityState,
  buildRequestCompatibilityKey,
  getRequestCompatibilityFallback,
  getRequestCompatibilityState,
} from "../app/utils/request-compat-memory";
import { ServiceProvider } from "../app/constant";

beforeEach(() => {
  localStorage.clear();
});

describe("request compatibility memory", () => {
  test("AihubMix temperature unsupported_value 应自动关闭 temperature", () => {
    const fallback = getRequestCompatibilityFallback(
      JSON.stringify({
        error: {
          message:
            "Unsupported value: 'temperature' does not support 0.5 with this model. Only the default (1) value is supported.",
          type: "invalid_request_error",
          param: "temperature",
          code: "unsupported_value",
        },
      }),
      {},
    );

    expect(fallback).toEqual({
      nextState: {
        disableTemperature: true,
      },
      disabledField: "temperature",
    });

    expect(
      applyRequestCompatibilityState(
        {
          model: "some-aihubmix-model",
          temperature: 0.5,
          top_p: 1,
        },
        fallback!.nextState,
      ),
    ).toEqual({
      model: "some-aihubmix-model",
      top_p: 1,
    });
  });

  test("AihubMix gpt-chat-latest 应默认记住关闭 temperature", () => {
    const key = buildRequestCompatibilityKey({
      providerName: ServiceProvider.Custom,
      baseUrl: "https://aihubmix.com",
      model: "gpt-chat-latest",
    });

    expect(getRequestCompatibilityState(key)).toEqual({
      disableTemperature: true,
    });

    const raw = localStorage.getItem("nextchat_request_compat_memory_v1");
    expect(raw ? JSON.parse(raw)[key] : undefined).toEqual({
      disableTemperature: true,
    });
  });
});
