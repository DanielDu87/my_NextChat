import { jest } from "@jest/globals";

describe("isVisionModel", () => {
  const originalEnv = process.env;

  async function loadUtils() {
    const mod = await import("../app/utils/model-capabilities");
    return mod as typeof import("../app/utils/model-capabilities");
  }

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("should identify vision models using regex patterns", async () => {
    const { isVisionModelByConfig } = await loadUtils();
    const visionModels = [
      "gpt-4-vision",
      "claude-3-opus",
      "gemini-1.5-pro",
      "gemini-2.0",
      "gemini-exp-vision",
      "learnlm-vision",
      "qwen-vl-max",
      "qwen2-vl-max",
      "gpt-4-turbo",
      "dall-e-3",
    ];

    visionModels.forEach((model) => {
      expect(isVisionModelByConfig(model)).toBe(true);
    });
  });

  test("should exclude specific models", async () => {
    const { isVisionModelByConfig } = await loadUtils();
    expect(isVisionModelByConfig("claude-3-5-haiku-20241022")).toBe(false);
  });

  test("should not identify non-vision models", async () => {
    const { isVisionModelByConfig } = await loadUtils();
    const nonVisionModels = [
      "gpt-3.5-turbo",
      "gpt-4-turbo-preview",
      "claude-2",
      "regular-model",
    ];

    nonVisionModels.forEach((model) => {
      expect(isVisionModelByConfig(model)).toBe(false);
    });
  });

  test("should identify models from VISION_MODELS env var", async () => {
    const { isVisionModelByConfig } = await loadUtils();
    process.env.VISION_MODELS = "custom-vision-model,another-vision-model";

    expect(
      isVisionModelByConfig(
        "custom-vision-model",
        process.env.VISION_MODELS,
      ),
    ).toBe(true);
    expect(
      isVisionModelByConfig(
        "another-vision-model",
        process.env.VISION_MODELS,
      ),
    ).toBe(true);
    expect(
      isVisionModelByConfig("unrelated-model", process.env.VISION_MODELS),
    ).toBe(false);
  });

  test("should handle empty or missing VISION_MODELS", async () => {
    const { isVisionModelByConfig } = await loadUtils();
    process.env.VISION_MODELS = "";
    expect(isVisionModelByConfig("unrelated-model", process.env.VISION_MODELS)).toBe(false);

    delete process.env.VISION_MODELS;
    expect(isVisionModelByConfig("unrelated-model")).toBe(false);
    expect(isVisionModelByConfig("gpt-4-vision")).toBe(true);
  });
});
