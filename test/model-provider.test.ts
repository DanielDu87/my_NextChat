describe("getModelProvider", () => {
  async function loadModelUtils() {
    const mod = await import("../app/utils/model-provider");
    return mod as typeof import("../app/utils/model-provider");
  }

  test("should return model and provider when input contains '@'", async () => {
    const { getModelProvider } = await loadModelUtils();
    const input = "model@provider";
    const [model, provider] = getModelProvider(input);
    expect(model).toBe("model");
    expect(provider).toBe("provider");
  });

  test("should return model and undefined provider when input does not contain '@'", async () => {
    const { getModelProvider } = await loadModelUtils();
    const input = "model";
    const [model, provider] = getModelProvider(input);
    expect(model).toBe("model");
    expect(provider).toBeUndefined();
  });

  test("should handle multiple '@' characters correctly", async () => {
    const { getModelProvider } = await loadModelUtils();
    const input = "model@provider@extra";
    const [model, provider] = getModelProvider(input);
    expect(model).toBe("model@provider");
    expect(provider).toBe("extra");
  });

  test("should return empty strings when input is empty", async () => {
    const { getModelProvider } = await loadModelUtils();
    const input = "";
    const [model, provider] = getModelProvider(input);
    expect(model).toBe("");
    expect(provider).toBeUndefined();
  });
});
