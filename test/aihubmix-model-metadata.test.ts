import { normalizeAiHubMixModelMetadata } from "../app/utils/models";

describe("normalizeAiHubMixModelMetadata", () => {
  test("should tag recraft and nano banana as image models", () => {
    expect(
      normalizeAiHubMixModelMetadata({
        model_name: "recraftv3",
      }),
    ).toMatchObject({
      type: "image",
      capabilities: expect.arrayContaining(["generate-image"]),
    });

    expect(
      normalizeAiHubMixModelMetadata({
        model_name: "nano-banana-hd",
      }),
    ).toMatchObject({
      type: "image",
      capabilities: expect.arrayContaining(["generate-image"]),
    });
  });

  test("should tag runway and wanx models as video models", () => {
    expect(
      normalizeAiHubMixModelMetadata({
        model_name: "runway-aleph",
      }),
    ).toMatchObject({
      type: "video",
      capabilities: expect.arrayContaining(["generate-video"]),
    });

    expect(
      normalizeAiHubMixModelMetadata({
        model_name: "wanx2.1-t2v",
      }),
    ).toMatchObject({
      type: "video",
      capabilities: expect.arrayContaining(["generate-video"]),
    });
  });

  test("should preserve explicit endpoint type metadata", () => {
    expect(
      normalizeAiHubMixModelMetadata({
        model_name: "custom-model",
        model_type: "video_generation",
        supported_endpoint_type: "video",
      }),
    ).toMatchObject({
      type: "video",
      types: expect.arrayContaining(["video_generation"]),
      capabilities: expect.arrayContaining(["video", "generate-video"]),
    });
  });
});
