import { buildAiHubMixPredictionPayload } from "../app/client/platforms/openai";

describe("buildAiHubMixPredictionPayload", () => {
  test("should include style for aihubmix dall-e-3 requests", () => {
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
    });

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
});
