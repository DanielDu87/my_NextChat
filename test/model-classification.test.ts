import {
  normalizeModelClassification,
} from "../app/utils/model-classification";

describe("normalizeModelClassification", () => {
  test("should classify image and video generation models by shared patterns", () => {
    expect(
      normalizeModelClassification({
        model_name: "recraftv3",
      }),
    ).toMatchObject({
      category: "image",
      categorySource: 0,
      type: "image",
      categories: expect.arrayContaining(["image"]),
      capabilities: expect.arrayContaining(["generate-image"]),
    });

    expect(
      normalizeModelClassification({
        model_name: "runway-aleph",
      }),
    ).toMatchObject({
      category: "video",
      categorySource: 0,
      type: "video",
      categories: expect.arrayContaining(["video"]),
      capabilities: expect.arrayContaining(["generate-video"]),
    });
  });

  test("should normalize shared web and thinking categories from provider metadata", () => {
    expect(
      normalizeModelClassification({
        model_name: "gpt-5.4",
        features: "thinking,web",
      }),
    ).toMatchObject({
      category: "web",
      categorySource: 0,
      categories: expect.arrayContaining(["web", "thinking"]),
      features: expect.arrayContaining(["thinking", "web", "web_search"]),
      capabilities: expect.arrayContaining(["reasoning", "web", "search"]),
    });
  });

  test("should classify generic OpenAI-compatible models with only model ids", () => {
    expect(
      normalizeModelClassification({
        id: "o3-mini",
      }),
    ).toMatchObject({
      category: "thinking",
      categorySource: 0,
      categories: expect.arrayContaining(["thinking"]),
      features: expect.arrayContaining(["thinking"]),
    });

    expect(
      normalizeModelClassification({
        id: "perplexity/sonar-pro",
      }),
    ).toMatchObject({
      category: "web",
      categorySource: 0,
      categories: expect.arrayContaining(["web"]),
      features: expect.arrayContaining(["web", "web_search"]),
    });
  });

  test("should classify newly added common model naming patterns", () => {
    expect(
      normalizeModelClassification({
        id: "midjourney-niji",
      }),
    ).toMatchObject({
      category: "image",
      categorySource: 0,
      categories: expect.arrayContaining(["image"]),
    });

    expect(
      normalizeModelClassification({
        id: "runway-gen-3",
      }),
    ).toMatchObject({
      category: "video",
      categorySource: 0,
      categories: expect.arrayContaining(["video"]),
    });

    expect(
      normalizeModelClassification({
        id: "kimi-联网版",
      }),
    ).toMatchObject({
      category: "web",
      categorySource: 0,
      categories: expect.arrayContaining(["web"]),
    });

    expect(
      normalizeModelClassification({
        id: "qwq-math",
      }),
    ).toMatchObject({
      category: "thinking",
      categorySource: 0,
      categories: expect.arrayContaining(["thinking"]),
    });

    expect(
      normalizeModelClassification({
        id: "qwen2-vl-ocr",
      }),
    ).toMatchObject({
      category: "image",
      categorySource: 0,
      categories: expect.arrayContaining(["image"]),
    });

    expect(
      normalizeModelClassification({
        id: "luma-dream-machine",
      }),
    ).toMatchObject({
      category: "video",
      categorySource: 0,
      categories: expect.arrayContaining(["video"]),
    });

    expect(
      normalizeModelClassification({
        id: "gpt-4-search-enabled-plugin",
      }),
    ).toMatchObject({
      category: "web",
      categorySource: 0,
      categories: expect.arrayContaining(["web"]),
    });

    expect(
      normalizeModelClassification({
        id: "reasoning-solver-math",
      }),
    ).toMatchObject({
      category: "thinking",
      categorySource: 0,
      categories: expect.arrayContaining(["thinking"]),
    });
  });

  test("should prefer category stored on the model itself", () => {
    expect(
      normalizeModelClassification({
        id: "custom-model",
        category: "thinking",
      }),
    ).toMatchObject({
      category: "thinking",
      categorySource: 1,
      categories: expect.arrayContaining(["thinking"]),
      features: expect.arrayContaining(["thinking"]),
    });
  });
});
