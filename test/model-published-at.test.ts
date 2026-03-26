describe("model publishedAt", () => {
  let comparePublishedAt: (typeof import("../app/utils/model-published-at"))["comparePublishedAt"];
  let extractPublishedAtFromName: (typeof import("../app/utils/model-published-at"))["extractPublishedAtFromName"];
  let getTodayPublishedAt: (typeof import("../app/utils/model-published-at"))["getTodayPublishedAt"];
  let resolveModelPublishedAt: (typeof import("../app/utils/model-published-at"))["resolveModelPublishedAt"];

  async function loadPublishedAtUtils() {
    const mod = await import("../app/utils/model-published-at");
    return mod as typeof import("../app/utils/model-published-at");
  }

  beforeAll(async () => {
    const loaded = await loadPublishedAtUtils();
    comparePublishedAt = loaded.comparePublishedAt;
    extractPublishedAtFromName = loaded.extractPublishedAtFromName;
    getTodayPublishedAt = loaded.getTodayPublishedAt;
    resolveModelPublishedAt = loaded.resolveModelPublishedAt;
  });

  test("should extract complete dates from model names", async () => {
    expect(extractPublishedAtFromName("gemini-2.5-pro-preview-05-06")).toBe(
      20250506,
    );
    expect(extractPublishedAtFromName("deepseek-r1-2025_01_20")).toBe(
      20250120,
    );
    expect(extractPublishedAtFromName("qwen-202501")).toBeUndefined();
    expect(extractPublishedAtFromName("model-2025")).toBeUndefined();
  });

  test("should format sync fallback date as yyyymmdd", async () => {
    expect(getTodayPublishedAt(new Date("2026-03-20T08:00:00.000Z"))).toBe(
      20260320,
    );
  });

  test("should resolve family fallback when model has no standalone date", async () => {
    expect(
      resolveModelPublishedAt({
        name: "claude-opus-4-thinking",
      }),
    ).toMatchObject({
      publishedAt: 20250522,
      publishedAtSource: "family",
    });
  });

  test("should keep claude 4.x alias fallback on the claude 4 family", async () => {
    expect(
      resolveModelPublishedAt({
        name: "claude-sonnet-4-6",
      }),
    ).toMatchObject({
      publishedAt: 20250522,
      publishedAtSource: "family",
    });
  });

  test("should resolve dotted openai legacy aliases", async () => {
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

  test("should resolve openai compatibility aliases for image and legacy text models", async () => {
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

  test("should resolve vendor alias names for zhipu and runway families", async () => {
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

  test("should resolve provider-prefixed openai aliases", async () => {
    expect(
      resolveModelPublishedAt({
        name: "aistudio_gpt-4.1-mini",
      }),
    ).toMatchObject({
      publishedAt: 20250414,
      publishedAtSource: "family",
    });
  });

  test("should resolve official openai tool and realtime model aliases", async () => {
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

  test("should resolve zhipu family aliases from official timeline pages", async () => {
    expect(
      resolveModelPublishedAt({
        name: "chatglm_turbo",
      }),
    ).toMatchObject({
      publishedAt: 20230301,
      publishedAtSource: "family",
    });

    expect(
      resolveModelPublishedAt({
        name: "glm-4-plus",
      }),
    ).toMatchObject({
      publishedAt: 20240912,
      publishedAtSource: "official",
    });

    expect(
      resolveModelPublishedAt({
        name: "glm-zero-preview",
      }),
    ).toMatchObject({
      publishedAt: 20241201,
      publishedAtSource: "official",
    });
  });

  test("should resolve sora packaging aliases to the sora 2 family date", async () => {
    expect(
      resolveModelPublishedAt({
        name: "sora-16:9-720p-5s",
      }),
    ).toMatchObject({
      publishedAt: 20250930,
      publishedAtSource: "family",
    });

    expect(
      resolveModelPublishedAt({
        name: "gpt-video-2-pro",
      }),
    ).toMatchObject({
      publishedAt: 20250930,
      publishedAtSource: "family",
    });
  });

  test("should resolve legacy openai search and edits families from official posts", async () => {
    expect(
      resolveModelPublishedAt({
        name: "text-search-ada-doc-001",
      }),
    ).toMatchObject({
      publishedAt: 20220125,
      publishedAtSource: "family",
    });

    expect(
      resolveModelPublishedAt({
        name: "text-davinci-edit-001",
      }),
    ).toMatchObject({
      publishedAt: 20220127,
      publishedAtSource: "family",
    });

    expect(
      resolveModelPublishedAt({
        name: "search-gpts-chat",
      }),
    ).toMatchObject({
      publishedAt: 20241031,
      publishedAtSource: "family",
    });
  });

  test("should resolve whisper and channel aliases near the openai family", async () => {
    expect(
      resolveModelPublishedAt({
        name: "gpt-3.5o",
      }),
    ).toMatchObject({
      publishedAt: 20230301,
      publishedAtSource: "family",
    });

    expect(
      resolveModelPublishedAt({
        name: "whisper-large-v3",
      }),
    ).toMatchObject({
      publishedAt: 20231106,
      publishedAtSource: "family",
    });

    expect(
      resolveModelPublishedAt({
        name: "aihubmix-Jamba-1-5-Large",
      }),
    ).toMatchObject({
      publishedAt: 20240801,
      publishedAtSource: "family",
    });
  });

  test("should resolve broad vendor family fallbacks for hosted aliases", () => {
    expect(
      resolveModelPublishedAt({
        name: "qwen1.5-72b-chat",
      }),
    ).toMatchObject({
      publishedAt: 20240130,
      publishedAtSource: "family",
    });

    expect(
      resolveModelPublishedAt({
        name: "fal-ai/flux-1/dev",
      }),
    ).toMatchObject({
      publishedAt: 20240801,
      publishedAtSource: "family",
    });

    expect(
      resolveModelPublishedAt({
        name: "viduq2-pro",
      }),
    ).toMatchObject({
      publishedAt: 20240701,
      publishedAtSource: "family",
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
