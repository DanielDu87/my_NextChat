import { matchModelCategory } from "../app/utils/model-category-rules";

describe("model category rules", () => {
  test("应支持从 capabilities categories 和 category 字段命中快速筛选", () => {
    expect(
      matchModelCategory("image", {
        title: "gpt-4o-image",
        meta: {
          capabilities: ["image_generation"],
        } as any,
      }),
    ).toBe(true);

    expect(
      matchModelCategory("video", {
        title: "veo-3",
        meta: {
          categories: ["video_generation"],
        } as any,
      }),
    ).toBe(true);

    expect(
      matchModelCategory("web", {
        title: "gpt-5",
        meta: {
          category: "web_search",
        } as any,
      }),
    ).toBe(true);

    expect(
      matchModelCategory("thinking", {
        title: "o3",
        meta: {
          capabilities: ["thinking"],
        } as any,
      }),
    ).toBe(true);
  });
});
