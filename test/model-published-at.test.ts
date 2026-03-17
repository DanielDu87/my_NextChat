import {
  comparePublishedAt,
  extractPublishedAtFromName,
  resolveModelPublishedAt,
} from "../app/utils/model-published-at";

describe("model publishedAt", () => {
  test("should extract complete dates from model names", () => {
    expect(extractPublishedAtFromName("gemini-2.5-pro-preview-05-06")).toBe(
      20250506,
    );
    expect(extractPublishedAtFromName("deepseek-r1-2025_01_20")).toBe(
      20250120,
    );
    expect(extractPublishedAtFromName("qwen-202501")).toBeUndefined();
    expect(extractPublishedAtFromName("model-2025")).toBeUndefined();
  });

  test("should resolve family fallback when model has no standalone date", () => {
    expect(
      resolveModelPublishedAt({
        name: "claude-opus-4-thinking",
      }),
    ).toMatchObject({
      publishedAt: 20250522,
      publishedAtSource: "family",
    });
  });

  test("should keep claude 4.x alias fallback on the claude 4 family", () => {
    expect(
      resolveModelPublishedAt({
        name: "claude-sonnet-4-6",
      }),
    ).toMatchObject({
      publishedAt: 20250522,
      publishedAtSource: "family",
    });
  });

  test("should resolve dotted openai legacy aliases", () => {
    expect(
      resolveModelPublishedAt({
        name: "gpt-3.5-turbo-1106",
      }),
    ).toMatchObject({
      publishedAt: 20230301,
      publishedAtSource: "family",
    });

    expect(
      resolveModelPublishedAt({
        name: "chatgpt-4o-latest",
      }),
    ).toMatchObject({
      publishedAt: 20240513,
      publishedAtSource: "family",
    });
  });

  test("should resolve openai compatibility aliases for image and legacy text models", () => {
    expect(
      resolveModelPublishedAt({
        name: "gpt-image-test",
      }),
    ).toMatchObject({
      publishedAt: 20250423,
      publishedAtSource: "family",
    });

    expect(
      resolveModelPublishedAt({
        name: "davinci-002",
      }),
    ).toMatchObject({
      publishedAt: 20231106,
      publishedAtSource: "official",
    });
  });

  test("should resolve vendor alias names for zhipu and runway families", () => {
    expect(
      resolveModelPublishedAt({
        name: "glm-4-air",
      }),
    ).toMatchObject({
      publishedAt: 20250414,
      publishedAtSource: "family",
    });

    expect(
      resolveModelPublishedAt({
        name: "runwayml-gen4_turbo",
      }),
    ).toMatchObject({
      publishedAt: 20250401,
      publishedAtSource: "family",
    });
  });

  test("should resolve official openai tool and realtime model aliases", () => {
    expect(
      resolveModelPublishedAt({
        name: "gpt-realtime",
      }),
    ).toMatchObject({
      publishedAt: 20250828,
      publishedAtSource: "official",
    });

    expect(
      resolveModelPublishedAt({
        name: "codex-mini-latest",
      }),
    ).toMatchObject({
      publishedAt: 20250516,
      publishedAtSource: "official",
    });
  });

  test("should preserve manual publishedAt metadata", () => {
    expect(
      resolveModelPublishedAt({
        name: "custom-alias",
        publishedAt: 20250301,
        publishedAtSource: "manual",
        publishedAtUrl: "https://example.com/manual",
        publishedAtNote: "手动确认",
      }),
    ).toEqual({
      publishedAt: 20250301,
      publishedAtSource: "manual",
      publishedAtUrl: "https://example.com/manual",
      publishedAtNote: "手动确认",
    });
  });

  test("should sort by publishedAt then version then order then name", () => {
    const models = [
      { name: "alpha-1.0", publishedAt: 20250301, order: 3 },
      { name: "alpha-2.0", publishedAt: 20250301, order: 2 },
      { name: "alpha-2.0", publishedAt: 20250101, order: 1 },
      { name: "beta-2.0", order: 0 },
    ];

    const sorted = models.slice().sort(comparePublishedAt);

    expect(sorted.map((item) => item.name)).toEqual([
      "alpha-2.0",
      "alpha-1.0",
      "alpha-2.0",
      "beta-2.0",
    ]);
    expect(sorted[0].publishedAt).toBe(20250301);
    expect(sorted[1].publishedAt).toBe(20250301);
    expect(sorted[2].publishedAt).toBe(20250101);
  });
});
