import {
  buildAutoModelCandidates,
  normalizeAutoModelSeries,
} from "@/app/utils/auto-model";
import { ServiceProvider } from "@/app/constant";
import type { LLMModel } from "@/app/client/api";

function createModel(
  name: string,
  providerId: string,
  publishedAt: number,
  extras: Partial<LLMModel> = {},
): LLMModel {
  return {
    name,
    available: true,
    sorted: 0,
    publishedAt,
    provider: {
      id: providerId,
      providerName: ServiceProvider.Custom,
      providerType: "custom",
      sorted: 0,
    },
    ...extras,
  };
}

describe("buildAutoModelCandidates", () => {
  it("自动模式系列只保留一个，历史多选配置会收敛成单选", () => {
    expect(normalizeAutoModelSeries(["deepseek", "gpt", "doubao"])).toEqual([
      "gpt",
    ]);
    expect(normalizeAutoModelSeries(["doubao"])).toEqual(["doubao"]);
    expect(normalizeAutoModelSeries([])).toEqual([]);
  });

  it("默认所有已配置供应商都参与，不依赖 enabled=true", () => {
    const models: LLMModel[] = [
      createModel("gpt-5.4", "custom_first", 20260301),
      createModel("gpt-5.4-mini", "custom_first", 20260301),
      createModel("gpt-5.5", "custom_second", 20260401),
      createModel("gpt-5.5-mini", "custom_second", 20260401),
    ];

    const candidates = buildAutoModelCandidates(
      models,
      [
        {
          name: "First",
          provider: ServiceProvider.Custom,
          enabled: false,
          baseUrl: "https://first.example.com",
        },
        {
          name: "Second",
          provider: ServiceProvider.Custom,
          enabled: false,
          baseUrl: "https://second.example.com",
        },
      ],
      ["gpt"],
    );

    expect(candidates.map((item) => `${item.providerId}:${item.model}`)).toEqual([
      "custom_first:gpt-5.4",
      "custom_first:gpt-5.4-mini",
      "custom_second:gpt-5.5",
      "custom_second:gpt-5.5-mini",
    ]);
  });

  it("官方名称改了时，仍可优先按 vendor 识别 GPT 和 DeepSeek 系列", () => {
    const gptCandidates = buildAutoModelCandidates(
      [
        createModel("nova-1", "custom_aihubmix", 20260301, {
          vendor: { id: 1, name: "OpenAI" },
        }),
        createModel("nova-1-mini", "custom_aihubmix", 20260301, {
          vendor: { id: 1, name: "OpenAI" },
        }),
      ],
      [
        {
          name: "AihubMix",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://aihubmix.com",
        },
      ],
      ["gpt"],
    );

    const deepseekCandidates = buildAutoModelCandidates(
      [
        createModel("nebula-1", "custom_aihubmix", 20260301, {
          vendor: { id: 2, name: "DeepSeek" },
        }),
        createModel("nebula-1-mini", "custom_aihubmix", 20260301, {
          vendor: { id: 2, name: "DeepSeek" },
        }),
      ],
      [
        {
          name: "AihubMix",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://aihubmix.com",
        },
      ],
      ["deepseek"],
    );

    expect(gptCandidates.map((item) => `${item.series}:${item.model}`)).toEqual(
      ["gpt:nova-1", "gpt:nova-1-mini"],
    );
    expect(
      deepseekCandidates.map((item) => `${item.series}:${item.model}`),
    ).toEqual(["deepseek:nebula-1", "deepseek:nebula-1-mini"]);
  });

  it("按 API 配置里的供应商顺序生成候选并依次尝试", () => {
    const models: LLMModel[] = [
      createModel("gpt-5.4", "custom_first", 20260301),
      createModel("gpt-5.4-mini", "custom_first", 20260301),
      createModel("gpt-5.5", "custom_second", 20260401),
      createModel("gpt-5.5-mini", "custom_second", 20260401),
    ];

    const candidates = buildAutoModelCandidates(
      models,
      [
        {
          name: "First",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://first.example.com",
        },
        {
          name: "Second",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://second.example.com",
        },
      ],
      ["gpt"],
    );

    expect(candidates.map((item) => `${item.providerId}:${item.model}`)).toEqual([
      "custom_first:gpt-5.4",
      "custom_first:gpt-5.4-mini",
      "custom_second:gpt-5.5",
      "custom_second:gpt-5.5-mini",
    ]);
  });

  it("同一模型同时存在裸别名和日期快照时，优先裸别名", () => {
    const models: LLMModel[] = [
      createModel("gpt-5.4-2026-03-05", "custom_aihubmix", 20260305),
      createModel("gpt-5.4", "custom_aihubmix", 20260305),
      createModel("gpt-5.4-mini-2026-03-05", "custom_aihubmix", 20260305),
      createModel("gpt-5.4-mini", "custom_aihubmix", 20260305),
      createModel("gpt-5.4-nano-2026-03-05", "custom_aihubmix", 20260305),
      createModel("gpt-5.4-nano", "custom_aihubmix", 20260305),
    ];

    const candidates = buildAutoModelCandidates(
      models,
      [
        {
          name: "AihubMix",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://aihubmix.com",
        },
      ],
      ["gpt"],
    );

    expect(candidates.map((item) => item.model)).toEqual([
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
    ]);
  });

  it("豆包系列把 lite 视为主模型，并优先裸别名而不是日期快照", () => {
    const models: LLMModel[] = [
      createModel("doubao-seed-1-6-251015", "custom_aihubmix", 20250611),
      createModel("doubao-seed-1-6", "custom_aihubmix", 20250611),
      createModel("doubao-seed-2-0-mini-260215", "custom_aihubmix", 20260215),
      createModel("doubao-seed-2-0-mini", "custom_aihubmix", 20260215),
      createModel("doubao-seed-2-0-lite-260215", "custom_aihubmix", 20260215),
      createModel("doubao-seed-2-0-lite", "custom_aihubmix", 20260215),
    ];

    const candidates = buildAutoModelCandidates(
      models,
      [
        {
          name: "AihubMix",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://aihubmix.com",
        },
      ],
      ["doubao"],
    );

    expect(candidates.map((item) => item.model)[0]).toBe("doubao-seed-2-0-lite");
    expect(candidates.map((item) => item.model)).toContain(
      "doubao-seed-2-0-mini",
    );
  });

  it("豆包系列在发布时间缺失时，也优先较新的 seed 家族版本", () => {
    const models: LLMModel[] = [
      createModel("doubao-seed-1-6", "custom_aihubmix", 20250611),
      createModel("doubao-seed-2-0-lite", "custom_aihubmix", 0),
      createModel("doubao-seed-2-0-mini", "custom_aihubmix", 0),
    ];

    const candidates = buildAutoModelCandidates(
      models,
      [
        {
          name: "AihubMix",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://aihubmix.com",
        },
      ],
      ["doubao"],
    );

    expect(candidates.map((item) => item.model)[0]).toBe("doubao-seed-2-0-lite");
    expect(candidates.map((item) => item.model)).toContain(
      "doubao-seed-2-0-mini",
    );
  });

  it("豆包自动模式里，2.0-lite 会压过 1.6 主模型，这个规则只作用于自动模式排序", () => {
    const models: LLMModel[] = [
      createModel("doubao-seed-1-6-250615", "custom_aihubmix", 20260320),
      createModel("doubao-seed-2-0-lite", "custom_aihubmix", 20260319),
      createModel("doubao-seed-2-0-mini", "custom_aihubmix", 20260319),
    ];

    const candidates = buildAutoModelCandidates(
      models,
      [
        {
          name: "AihubMix",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://aihubmix.com",
        },
      ],
      ["doubao"],
    );

    expect(candidates.map((item) => item.model)[0]).toBe("doubao-seed-2-0-lite");
    expect(candidates.map((item) => item.model)).toContain(
      "doubao-seed-2-0-mini",
    );
  });

  it("豆包 seed 名称使用不同分隔符时，自动模式也能识别版本和档位", () => {
    const models: LLMModel[] = [
      createModel("doubao_seed_2_0_lite", "custom_aihubmix", 20260320),
      createModel("doubao.seed.2.0.mini", "custom_aihubmix", 20260320),
      createModel("doubao/seed/1/6", "custom_aihubmix", 20260320),
    ];

    const candidates = buildAutoModelCandidates(
      models,
      [
        {
          name: "AihubMix",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://aihubmix.com",
        },
      ],
      ["doubao"],
    );

    expect(candidates.map((item) => item.model)).toEqual([
      "doubao_seed_2_0_lite",
      "doubao/seed/1/6",
      "doubao.seed.2.0.mini",
    ]);
  });

  it("豆包自动模式会排除只靠 ByteDance vendor 误归类进来的非 doubao 名称模型", () => {
    const models: LLMModel[] = [
      createModel("ByteDance-Seed/Seed-OSS-36B-Instruct", "custom_aihubmix", 20260320, {
        vendor: { id: 4, name: "ByteDance" },
      }),
      createModel("doubao-seed-2-0-lite", "custom_aihubmix", 20260320, {
        vendor: { id: 4, name: "ByteDance" },
      }),
      createModel("doubao-seed-2-0-mini", "custom_aihubmix", 20260320, {
        vendor: { id: 4, name: "ByteDance" },
      }),
    ];

    const candidates = buildAutoModelCandidates(
      models,
      [
        {
          name: "AihubMix",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://aihubmix.com",
        },
      ],
      ["doubao"],
    );

    expect(candidates.map((item) => item.model)).toEqual([
      "doubao-seed-2-0-lite",
      "doubao-seed-2-0-mini",
    ]);
  });

  it("豆包自动模式会在 2.0 之后继续回退到 1.8 和 1.6", () => {
    const models: LLMModel[] = [
      createModel("doubao-seed-2-0-lite", "custom_aihubmix", 20260320),
      createModel("doubao-seed-2-0-mini", "custom_aihubmix", 20260320),
      createModel("doubao-seed-1-8", "custom_aihubmix", 20260319),
      createModel("doubao-seed-1-6", "custom_aihubmix", 20260318),
    ];

    const candidates = buildAutoModelCandidates(
      models,
      [
        {
          name: "AihubMix",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://aihubmix.com",
        },
      ],
      ["doubao"],
    );

    expect(candidates.map((item) => item.model)).toEqual([
      "doubao-seed-2-0-lite",
      "doubao-seed-1-8",
      "doubao-seed-1-6",
      "doubao-seed-2-0-mini",
    ]);
  });

  it("按已启用供应商各自可用模型挑选，不要求同名", () => {
    const models: LLMModel[] = [
      createModel("doubao-seed-2-0-lite-260215", "custom_other", 20260215),
      createModel("doubao-seed-2-0-mini-260215", "custom_other", 20260215),
      createModel("doubao-seed-2-0-lite", "custom_aihubmix", 20260201),
      createModel("doubao-seed-2-0-mini", "custom_aihubmix", 20260201),
    ];

    const candidates = buildAutoModelCandidates(
      models,
      [
        {
          name: "AihubMix",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://aihubmix.com",
        },
      ],
      ["doubao"],
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        series: "doubao",
        model: "doubao-seed-2-0-lite",
        providerId: "custom_aihubmix",
      }),
      expect.objectContaining({
        series: "doubao",
        model: "doubao-seed-2-0-mini",
        providerId: "custom_aihubmix",
      }),
    ]);
  });

  it("只按英文名称关键词排除非文本生成模型", () => {
    const models: LLMModel[] = [
      createModel("doubao-seed-2-0-pro", "custom_aihubmix", 20260220),
      createModel("doubao-search", "custom_aihubmix", 20260219),
      createModel("doubao-sorting", "custom_aihubmix", 20260218),
      createModel("doubao-排序器", "custom_aihubmix", 20260217),
      createModel("doubao-research", "custom_aihubmix", 20260216),
      createModel("doubao-image", "custom_aihubmix", 20260218, {
        category: "image",
      }),
      createModel("doubao-seedance-video", "custom_aihubmix", 20260215, {
        category: "video",
      }),
      createModel("doubao-audio", "custom_aihubmix", 20260214),
      createModel("doubao-code-preview", "custom_aihubmix", 20260213),
      createModel("doubao-codex-mini", "custom_aihubmix", 20260212),
      createModel("doubao-coding-assistant", "custom_aihubmix", 20260212),
      createModel("doubao-代码助手", "custom_aihubmix", 20260211),
      createModel("doubao-seed-2-0-lite", "custom_aihubmix", 20260210),
      createModel("doubao-seed-2-0-mini", "custom_aihubmix", 20260209),
    ];

    const candidates = buildAutoModelCandidates(
      models,
      [
        {
          name: "AihubMix",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://aihubmix.com",
        },
      ],
      ["doubao"],
    );

    expect(candidates.map((item) => item.model)[0]).toBe("doubao-seed-2-0-lite");
    expect(candidates.map((item) => item.model)).toContain(
      "doubao-seed-2-0-mini",
    );
  });

  it("不再根据类型、分类、能力字段排除，只根据名称排除", () => {
    const models: LLMModel[] = [
      createModel("doubao-seed-2-0-lite", "custom_aihubmix", 20260220, {
        type: "embedding",
      }),
      createModel("doubao-seed-2-0-fast", "custom_aihubmix", 20260219, {
        types: ["rank"],
      }),
      createModel("doubao-seed-2-0-thinking", "custom_aihubmix", 20260218, {
        categories: ["search"],
      }),
      createModel("doubao-seed-2-0-voice", "custom_aihubmix", 20260217, {
        capabilities: ["speech"],
      }),
      createModel("doubao-seed-2-0-vision", "custom_aihubmix", 20260216, {
        features: ["image"],
      }),
      createModel("doubao-seed-2-0-video", "custom_aihubmix", 20260215, {
        category: "video",
      }),
      createModel("doubao-seed-2-0-ranker", "custom_aihubmix", 20260214, {
        capabilities: ["sorting"],
      }),
      createModel("doubao-seed-2-0-lab", "custom_aihubmix", 20260213, {
        features: ["research"],
      }),
      createModel("doubao-seed-1-8", "custom_aihubmix", 20260212),
      createModel("doubao-seed-2-0-mini", "custom_aihubmix", 20260211),
    ];

    const candidates = buildAutoModelCandidates(
      models,
      [
        {
          name: "AihubMix",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://aihubmix.com",
        },
      ],
      ["doubao"],
    );

    expect(candidates.map((item) => item.model).slice(0, 2)).toEqual([
      "doubao-seed-2-0-lite",
      "doubao-seed-2-0-fast",
    ]);
    expect(candidates.map((item) => item.model)).toContain(
      "doubao-seed-2-0-mini",
    );
  });

  it("后续模型版本更新后，仍然排除非文字生成类模型", () => {
    const models: LLMModel[] = [
      createModel("doubao-seed-3-0-pro-260301", "custom_aihubmix", 20260301),
      createModel(
        "doubao-seed-3-0-rerank-260301",
        "custom_aihubmix",
        20260301,
      ),
      createModel(
        "doubao-seed-3-0-search-260301",
        "custom_aihubmix",
        20260301,
      ),
      createModel(
        "doubao-seed-3-0-research-260301",
        "custom_aihubmix",
        20260301,
      ),
      createModel(
        "doubao-seed-3-0-speech-260301",
        "custom_aihubmix",
        20260301,
      ),
      createModel(
        "doubao-seed-3-0-image-260301",
        "custom_aihubmix",
        20260301,
      ),
      createModel("doubao-seed-3-0-260301", "custom_aihubmix", 20260301),
      createModel(
        "doubao-seed-3-0-mini-260301",
        "custom_aihubmix",
        20260301,
      ),
    ];

    const candidates = buildAutoModelCandidates(
      models,
      [
        {
          name: "AihubMix",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://aihubmix.com",
        },
      ],
      ["doubao"],
    );

    expect(candidates).toEqual([
      expect.objectContaining({ model: "doubao-seed-3-0-260301" }),
      expect.objectContaining({ model: "doubao-seed-3-0-mini-260301" }),
    ]);
  });

  it("排除一看就不是文本生成的典型关键词模型", () => {
    const models: LLMModel[] = [
      createModel("doubao-diffusion", "custom_aihubmix", 20260310),
      createModel("doubao-dalle", "custom_aihubmix", 20260309),
      createModel("doubao-sdxl", "custom_aihubmix", 20260308),
      createModel("doubao-image-edit", "custom_aihubmix", 20260307),
      createModel("doubao-video", "custom_aihubmix", 20260306),
      createModel("doubao-seedream-4-5", "custom_aihubmix", 20260306),
      createModel("doubao-seedance-1-5", "custom_aihubmix", 20260306),
      createModel("jimeng-3.0", "custom_aihubmix", 20260306),
      createModel("doubao-veo", "custom_aihubmix", 20260305),
      createModel("doubao-sora", "custom_aihubmix", 20260304),
      createModel("doubao-gen-3", "custom_aihubmix", 20260303),
      createModel("doubao-whisper", "custom_aihubmix", 20260302),
      createModel("doubao-tts", "custom_aihubmix", 20260301),
      createModel("doubao-speech", "custom_aihubmix", 20260228),
      createModel("doubao-embedding", "custom_aihubmix", 20260227),
      createModel("doubao-vector", "custom_aihubmix", 20260226),
      createModel("doubao-seed-3-1", "custom_aihubmix", 20260225),
      createModel("doubao-seed-3-1-mini", "custom_aihubmix", 20260224),
    ];

    const candidates = buildAutoModelCandidates(
      models,
      [
        {
          name: "AihubMix",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://aihubmix.com",
        },
      ],
      ["doubao"],
    );

    expect(candidates).toEqual([
      expect.objectContaining({ model: "doubao-seed-3-1" }),
      expect.objectContaining({ model: "doubao-seed-3-1-mini" }),
    ]);
  });

  it("排除 realtime 和豆包图片视频系特殊命名", () => {
    const models: LLMModel[] = [
      createModel("gpt-realtime-mini-2025-12-15", "custom_aihubmix", 20260320),
      createModel("doubao-seedream-4-5", "custom_aihubmix", 20260319),
      createModel("doubao-seedance-1-5", "custom_aihubmix", 20260318),
      createModel("jimeng-3.0", "custom_aihubmix", 20260317),
      createModel("gpt-5.4", "custom_aihubmix", 20260316),
      createModel("gpt-5.4-mini", "custom_aihubmix", 20260315),
    ];

    const candidates = buildAutoModelCandidates(
      models,
      [
        {
          name: "AihubMix",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://aihubmix.com",
        },
      ],
      ["gpt", "doubao"],
    );

    expect(candidates).toEqual([
      expect.objectContaining({ model: "gpt-5.4" }),
      expect.objectContaining({ model: "gpt-5.4-mini" }),
    ]);
  });

  it("系列内部按 主模型 -> mini -> lite -> nano 取候选；豆包在缺少标准主模型时用 lite 顶上，并排除 codex", () => {
    const models: LLMModel[] = [
      createModel("gpt-5.4", "custom_aihubmix", 20260320),
      createModel("gpt-5.4-mini", "custom_aihubmix", 20260319),
      createModel("gpt-5.4-lite", "custom_aihubmix", 20260318),
      createModel("gpt-5.4-nano", "custom_aihubmix", 20260317),
      createModel("gpt-5.4-codex-mini", "custom_aihubmix", 20260321),
      createModel("gpt-5.4-code", "custom_aihubmix", 20260322),
      createModel("doubao-seed-2-0", "custom_aihubmix", 20260320),
      createModel("doubao-seed-2-0-mini", "custom_aihubmix", 20260319),
      createModel("doubao-seed-2-0-lite", "custom_aihubmix", 20260318),
    ];

    const candidates = buildAutoModelCandidates(
      models,
      [
        {
          name: "AihubMix",
          provider: ServiceProvider.Custom,
          enabled: true,
          baseUrl: "https://aihubmix.com",
        },
      ],
      ["gpt"],
    );

    expect(candidates.map((item) => `${item.series}:${item.model}`)).toEqual([
      "gpt:gpt-5.4",
      "gpt:gpt-5.4-mini",
      "gpt:gpt-5.4-lite",
      "gpt:gpt-5.4-nano",
    ]);
  });
});
