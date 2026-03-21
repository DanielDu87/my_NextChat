describe("image parameter support", () => {
  async function loadUtils() {
    const mod = await import("../app/utils/model-capabilities");
    return (mod.default ?? mod) as typeof import("../app/utils/model-capabilities");
  }

  test("should keep dall-e-3 size quality and style controls", async () => {
    const {
      getModelSizes,
      getSupportedImageQualityOptions,
      getSupportedImageStyleOptions,
      supportsCustomSize,
      supportsImageQualityControl,
      supportsImageStyleControl,
    } = await loadUtils();
    expect(getModelSizes("dall-e-3")).toEqual([
      "1024x1024",
      "1792x1024",
      "1024x1792",
    ]);
    expect(getSupportedImageQualityOptions("dall-e-3")).toEqual([
      "standard",
      "hd",
    ]);
    expect(getSupportedImageStyleOptions("dall-e-3")).toEqual([
      "vivid",
      "natural",
    ]);
    expect(supportsCustomSize("dall-e-3")).toBe(true);
    expect(supportsImageQualityControl("dall-e-3")).toBe(true);
    expect(supportsImageStyleControl("dall-e-3")).toBe(true);
  });

  test("should only keep size for qwen-image requests", async () => {
    const {
      getModelSizes,
      getSupportedImageQualityOptions,
      getSupportedImageStyleOptions,
      supportsCustomSize,
      supportsImageQualityControl,
      supportsImageStyleControl,
    } = await loadUtils();
    expect(getModelSizes("qwen-image")).toEqual([
      "1024x1024",
      "1792x1024",
      "1024x1792",
    ]);
    expect(getSupportedImageQualityOptions("qwen-image")).toEqual([]);
    expect(getSupportedImageStyleOptions("qwen-image")).toEqual([]);
    expect(supportsCustomSize("qwen-image")).toBe(true);
    expect(supportsImageQualityControl("qwen-image")).toBe(false);
    expect(supportsImageStyleControl("qwen-image")).toBe(false);
  });

  test("should hide unsupported controls for flux models", async () => {
    const {
      getModelSizes,
      getSupportedImageQualityOptions,
      getSupportedImageStyleOptions,
      supportsCustomSize,
      supportsImageQualityControl,
      supportsImageStyleControl,
    } = await loadUtils();
    expect(getModelSizes("flux-2-dev")).toEqual([]);
    expect(getSupportedImageQualityOptions("flux-2-dev")).toEqual([]);
    expect(getSupportedImageStyleOptions("flux-2-dev")).toEqual([]);
    expect(supportsCustomSize("flux-2-dev")).toBe(false);
    expect(supportsImageQualityControl("flux-2-dev")).toBe(false);
    expect(supportsImageStyleControl("flux-2-dev")).toBe(false);
  });

  test("should expose gpt-image-1.5 specific quality options", async () => {
    const {
      getModelSizes,
      getSupportedImageQualityOptions,
      supportsImageQualityControl,
      supportsImageStyleControl,
    } = await loadUtils();
    expect(getModelSizes("gpt-image-1.5")).toEqual([
      "1024x1024",
      "1024x1536",
      "1536x1024",
    ]);
    expect(getSupportedImageQualityOptions("gpt-image-1.5")).toEqual([
      "auto",
      "low",
      "medium",
      "high",
    ]);
    expect(supportsImageQualityControl("gpt-image-1.5")).toBe(true);
    expect(supportsImageStyleControl("gpt-image-1.5")).toBe(false);
  });

  test("should preserve cogview custom size list", async () => {
    const { getModelSizes } = await loadUtils();
    expect(getModelSizes("cogview-3-plus")).toEqual([
      "1024x1024",
      "768x1344",
      "864x1152",
      "1344x768",
      "1152x864",
      "1440x720",
      "720x1440",
    ]);
  });
});
