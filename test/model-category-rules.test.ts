import { matchModelCategory } from "../app/utils/model-category-rules";

describe("matchModelCategory", () => {
  test("should match categories from title keywords", () => {
    expect(
      matchModelCategory("image", {
        title: "qwen2-vl-ocr",
      }),
    ).toBe(true);

    expect(
      matchModelCategory("video", {
        title: "runway-gen-3",
      }),
    ).toBe(true);

    expect(
      matchModelCategory("web", {
        title: "gpt-4-search-enabled-plugin",
      }),
    ).toBe(true);

    expect(
      matchModelCategory("thinking", {
        title: "qwq-math",
      }),
    ).toBe(true);
  });

  test("should match categories from metadata keywords", () => {
    expect(
      matchModelCategory("image", {
        title: "custom-model",
        meta: {
          capabilities: ["generate-image"],
        },
      }),
    ).toBe(true);

    expect(
      matchModelCategory("video", {
        title: "custom-model",
        meta: {
          types: ["video_generation"],
        },
      }),
    ).toBe(true);

    expect(
      matchModelCategory("web", {
        title: "custom-model",
        meta: {
          features: ["web_search"],
        },
      }),
    ).toBe(true);

    expect(
      matchModelCategory("thinking", {
        title: "custom-model",
        meta: {
          capabilities: ["reasoning"],
        },
      }),
    ).toBe(true);
  });
});
