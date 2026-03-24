describe("buildAiHubMixPredictionPayload", () => {
  async function loadMediaUtils() {
    const mod = await import("../app/client/openai-media-utils");
    return mod as typeof import("../app/client/openai-media-utils");
  }

  test("should include style for aihubmix dall-e-3 requests", async () => {
    const { buildAiHubMixPredictionPayload } = await loadMediaUtils();
    const payload = buildAiHubMixPredictionPayload("dall-e-3", {
      messages: [
        {
          role: "user",
          content: "Generate a rainy neon alley scene",
        },
      ],
      config: {
        model: "dall-e-3",
        size: "1792x1024",
        quality: "high",
        style: "natural",
      },
      onFinish() {},
    } as any);

    expect(payload).toEqual({
      input: {
        prompt: "Generate a rainy neon alley scene",
        n: 1,
        size: "1792x1024",
        quality: "hd",
        style: "natural",
      },
    });
  });

  test("should omit style for aihubmix dall-e-2 requests", async () => {
    const { buildAiHubMixPredictionPayload } = await loadMediaUtils();
    const payload = buildAiHubMixPredictionPayload("dall-e-2", {
      messages: [
        {
          role: "user",
          content: "Generate a rainy neon alley scene",
        },
      ],
      config: {
        model: "dall-e-2",
        size: "1792x1024",
        quality: "high",
        style: "natural",
      },
      onFinish() {},
    } as any);

    expect(payload).toEqual({
      input: {
        prompt: "Generate a rainy neon alley scene",
        n: 1,
        size: "1792x1024",
      },
    });
  });
});
