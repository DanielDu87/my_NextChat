async function loadModelsUtils() {
  const mod = await import("../app/utils/models");
  return (mod.default ?? mod) as typeof import("../app/utils/models");
}

async function loadClassificationUtils() {
  const mod = await import("../app/utils/model-classification");
  return (mod.default ?? mod) as typeof import("../app/utils/model-classification");
}

describe("normalizeAiHubMixModelMetadata", () => {
  test("should tag recraft and nano banana as image models", async () => {
    const { normalizeAiHubMixModelMetadata } = await loadModelsUtils();
    expect(
      normalizeAiHubMixModelMetadata({
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
      normalizeAiHubMixModelMetadata({
        model_name: "nano-banana-hd",
      }),
    ).toMatchObject({
      category: "image",
      categorySource: 0,
      type: "image",
      categories: expect.arrayContaining(["image"]),
      capabilities: expect.arrayContaining(["generate-image"]),
    });
  });

  test("should tag runway and wanx models as video models", async () => {
    const { normalizeAiHubMixModelMetadata } = await loadModelsUtils();
    expect(
      normalizeAiHubMixModelMetadata({
        model_name: "runway-aleph",
      }),
    ).toMatchObject({
      category: "video",
      categorySource: 0,
      type: "video",
      categories: expect.arrayContaining(["video"]),
      capabilities: expect.arrayContaining(["generate-video"]),
    });

    expect(
      normalizeAiHubMixModelMetadata({
        model_name: "wanx2.1-t2v",
      }),
    ).toMatchObject({
      category: "video",
      categorySource: 0,
      type: "video",
      categories: expect.arrayContaining(["video"]),
      capabilities: expect.arrayContaining(["generate-video"]),
    });
  });

  test("should preserve explicit endpoint type metadata", async () => {
    const { normalizeAiHubMixModelMetadata } = await loadModelsUtils();
    expect(
      normalizeAiHubMixModelMetadata({
        model_name: "custom-model",
        model_type: "video_generation",
        supported_endpoint_type: "video",
      }),
    ).toMatchObject({
      category: "video",
      categorySource: 0,
      type: "video",
      categories: expect.arrayContaining(["video"]),
      types: expect.arrayContaining(["video_generation"]),
      capabilities: expect.arrayContaining(["video", "generate-video"]),
    });
  });

  test("should normalize web and thinking features into shared categories", async () => {
    const { normalizeAiHubMixModelMetadata } = await loadModelsUtils();
    expect(
      normalizeAiHubMixModelMetadata({
        model_name: "gpt-5.4",
        features: "thinking,web",
      }),
    ).toMatchObject({
      category: "web",
      categorySource: 0,
      categories: expect.arrayContaining(["thinking", "web"]),
      features: expect.arrayContaining(["thinking", "web", "web_search"]),
      capabilities: expect.arrayContaining(["reasoning", "web", "search"]),
    });
  });
});

describe("normalizeModelClassification", () => {
  test("should classify generic OpenAI-compatible models with the shared rules", async () => {
    const { normalizeModelClassification } = await loadClassificationUtils();
    expect(
      normalizeModelClassification({
        id: "o3-mini",
      }),
    ).toMatchObject({
      categories: expect.arrayContaining(["thinking"]),
      features: expect.arrayContaining(["thinking"]),
    });

    expect(
      normalizeModelClassification({
        id: "perplexity/sonar-pro",
      }),
    ).toMatchObject({
      categories: expect.arrayContaining(["web"]),
      features: expect.arrayContaining(["web", "web_search"]),
    });
  });
});
