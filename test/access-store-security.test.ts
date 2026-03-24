import {
  mergeAccessStorePayload,
  splitAccessStorePayload,
} from "../app/utils/server/access-store-security";

describe("access store security helpers", () => {
  test("splitAccessStorePayload 应该剥离顶层和 profile 敏感字段", () => {
    const payload = {
      state: {
        provider: "OpenAI",
        openaiApiKey: "sk-top",
        customUrl: "https://example.com",
        apiProfiles: [
          {
            id: "p1",
            name: "默认",
            baseUrl: "https://api.example.com",
            apiKey: "sk-profile",
            modelFetchApiKey: "sk-fetch",
            enabled: true,
          },
        ],
      },
      version: 4,
    };

    const { publicPayload, secretPayload } = splitAccessStorePayload(payload);

    expect(publicPayload).toEqual({
      state: {
        provider: "OpenAI",
        customUrl: "https://example.com",
        apiProfiles: [
          {
            id: "p1",
            name: "默认",
            baseUrl: "https://api.example.com",
            enabled: true,
          },
        ],
      },
      version: 4,
    });

    expect(secretPayload).toEqual({
      openaiApiKey: "sk-top",
      apiProfiles: [
        {
          id: "p1",
          apiKey: "sk-profile",
          modelFetchApiKey: "sk-fetch",
        },
      ],
    });
  });

  test("mergeAccessStorePayload 应该回填敏感字段", () => {
    const payload = {
      state: {
        provider: "OpenAI",
        apiProfiles: [
          {
            id: "p1",
            name: "默认",
            baseUrl: "https://api.example.com",
            enabled: true,
          },
        ],
      },
      version: 4,
    };

    const merged = mergeAccessStorePayload(payload, {
      openaiApiKey: "sk-top",
      apiProfiles: [
        {
          id: "p1",
          apiKey: "sk-profile",
        },
      ],
    });

    expect(merged).toEqual({
      state: {
        provider: "OpenAI",
        openaiApiKey: "sk-top",
        apiProfiles: [
          {
            id: "p1",
            name: "默认",
            baseUrl: "https://api.example.com",
            enabled: true,
            apiKey: "sk-profile",
          },
        ],
      },
      version: 4,
    });
  });
});
