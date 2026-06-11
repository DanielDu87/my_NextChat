describe("model fetch candidates", () => {
  let common: typeof import("../app/utils/model-fetch-common");

  beforeAll(async () => {
    common = await import("../app/utils/model-fetch-common");
  });

  test("所有供应商使用同一套代理候选路径全集", () => {
    const providers = [
      "https://aihubmix.com",
      "https://gptapi.asia",
      "https://api.ocoolai.com",
      "https://toapis.com",
      "https://api.deepseek.com",
    ];
    const candidateLists = providers.map((baseUrl) =>
      common.buildProxyModelFetchCandidateUrls(baseUrl),
    );

    expect(
      candidateLists.every((list) => list.length === candidateLists[0].length),
    ).toBe(true);
    expect(candidateLists[0]).toEqual(candidateLists[1]);
    expect(candidateLists[0]).toEqual(
      expect.arrayContaining([
        "/api/proxy/api/v1/models",
        "/api/proxy/models",
        "/api/proxy/v1/models",
        "/api/proxy/api/models",
        "/api/proxy/api/pricing",
        "/api/proxy/pricing",
        "/api/proxy/api/user/available_model",
        "/api/proxy/api/user/available_models",
        "/api/proxy/api/user/available_models_by_groups",
        "/api/ocoolai/available-models-by-groups",
        "/api/proxy/api/tags",
        "/api/proxy/v1/internal/model/list",
        "/api/proxy/openai/models",
        "/api/proxy/api/v1/compatibility/openai/v1/models",
      ]),
    );
  });

  test("服务端直连候选路径与代理候选路径数量一致", () => {
    const upstream = common.buildModelFetchCandidateUrls("https://example.com");
    const proxy = common.buildProxyModelFetchCandidateUrls(
      "https://example.com",
    );

    expect(upstream).toHaveLength(proxy.length);
    expect(upstream).toContain("https://example.com/api/v1/models");
    expect(upstream).toContain("https://example.com/api/tags");
    expect(upstream).toContain("https://example.com/openai/models");
    expect(upstream).toContain(
      "https://one.ocoolai.com/api/user/available_models_by_groups",
    );
  });
});
