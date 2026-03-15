import { jest } from "@jest/globals";
import {
  ChatGPTApi,
  __testables,
  buildAiHubMixPredictionPayload,
  buildAiHubMixVideoPayload,
  getAiHubMixPredictionModelPath,
  isAiHubMixVideoModel,
} from "../app/client/platforms/openai";
import { inferModelCapability } from "../app/client/model-parameter-rules";
import {
  isImageGenerationModel,
  isVideoGenerationModel,
} from "../app/utils";

describe("AiHubMix media routing", () => {
  test("should omit quality for aihubmix dall-e-2 predictions", () => {
    const payload = buildAiHubMixPredictionPayload("dall-e-2", {
      messages: [{ role: "user", content: "test prompt" }],
      config: {
        model: "dall-e-2",
        size: "1792x1024",
        quality: "high",
        style: "natural",
      },
      onFinish() {},
    });

    expect(payload).toEqual({
      input: {
        prompt: "test prompt",
        n: 1,
        size: "1792x1024",
      },
    });
  });

  test("should map ideogram aliases to AiHubMix prediction route", () => {
    expect(getAiHubMixPredictionModelPath("ideogram")).toBe("ideogram/V3");
  });

  test("should recognize nano banana and recraft as image models", () => {
    expect(inferModelCapability("nano-banana-hd")).toBe("image");
    expect(inferModelCapability("recraftv3")).toBe("image");
    expect(isImageGenerationModel("nano-banana-hd")).toBe(true);
    expect(isImageGenerationModel("recraftv3")).toBe(true);
  });

  test("should recognize major AiHubMix video models", () => {
    const models = [
      "wanx2.1-t2v",
      "veo2-fast-frames",
      "sora-1:1-480p-10s",
      "runway-aleph",
      "pixverse1",
      "fal-ai/vidu/reference-to",
      "jimeng-3.0-1080p",
      "I2V-01-live",
    ];

    models.forEach((model) => {
      expect(inferModelCapability(model)).toBe("video");
      expect(isVideoGenerationModel(model)).toBe(true);
      expect(isAiHubMixVideoModel(model)).toBe(true);
    });
  });

  test("should build AiHubMix video payload with latest image when present", () => {
    const payload = buildAiHubMixVideoPayload("I2V-01-live", {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: "https://example.com/input.png",
              },
            },
            {
              type: "text",
              text: "make it cinematic",
            },
          ],
        },
      ] as any,
      config: {
        model: "I2V-01-live",
      },
      onFinish() {},
    });

    expect(payload).toEqual({
      model: "I2V-01-live",
      prompt: "make it cinematic",
      image_url: "https://example.com/input.png",
      size: "720x1280",
      seconds: 4,
    });
  });

  test("should omit duration for veo text video payloads", () => {
    const payload = buildAiHubMixVideoPayload("veo2-fast", {
      messages: [{ role: "user", content: "a cat walking in the rain" }],
      config: {
        model: "veo2-fast",
        seconds: "4",
      },
      onFinish() {},
    });

    expect(payload).toEqual({
      model: "veo2-fast",
      prompt: "a cat walking in the rain",
      images: [],
      enhance_prompt: true,
      enable_upsample: false,
    });
  });

  test("should keep image urls array for veo image to video payloads", () => {
    const payload = buildAiHubMixVideoPayload("veo2-fast", {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: "https://example.com/input.png",
              },
            },
            {
              type: "text",
              text: "a cat turns around slowly",
            },
          ],
        },
      ] as any,
      config: {
        model: "veo2-fast",
      },
      onFinish() {},
    });

    expect(payload).toEqual({
      model: "veo2-fast",
      prompt: "a cat turns around slowly",
      images: ["https://example.com/input.png"],
      enhance_prompt: true,
      enable_upsample: false,
    });
  });

  test("should reject chinese prompt for veo payloads", () => {
    expect(() =>
      buildAiHubMixVideoPayload("veo2-fast", {
        messages: [{ role: "user", content: "一只猫在雨中行走" }],
        config: {
          model: "veo2-fast",
        },
        onFinish() {},
      }),
    ).toThrow("Veo 系列当前只接受英文提示词");
  });

  test("should extract image from AihubMix output urls payload", async () => {
    const api = new ChatGPTApi();
    const message = await api.extractMessage({
      output: {
        b64_json: [],
        urls: ["https://example.com/generated.png"],
      },
      usage: null,
    });

    expect(message).toEqual([
      {
        type: "image_url",
        image_url: {
          url: "https://example.com/generated.png",
        },
      },
    ]);
  });

  test("should show queued video task status when result is not ready", async () => {
    const api = new ChatGPTApi();
    const message = await api.extractMessage({
      id: "video_123",
      object: "video",
      status: "queued",
      progress: 12,
      completed_at: null,
      model: "sora-2",
    });

    expect(message).toBe("视频任务状态：queued (video_123)，进度 12%");
  });

  test("should explain invalid veo task failure with english hint", async () => {
    const api = new ChatGPTApi();
    const message = await api.extractMessage({
      id: "video_123",
      object: "video",
      status: "failed",
      model: "veo2-fast",
      prompt: "一只猫在雨中行走",
      error: {
        code: 400,
        status: "INVALID_ARGUMENT",
        message: "Request contains an invalid argument.",
        url: "/v1/video:batchAsyncGenerateVideoText",
      },
    });

    expect(message).toContain("视频任务失败");
    expect(message).toContain("Veo 系列当前通常只接受英文提示词");
    expect(message).toContain("/v1/video:batchAsyncGenerateVideoText");
  });

  test("should explain veo invalid argument as upstream issue when prompt is already english", async () => {
    const api = new ChatGPTApi();
    const message = await api.extractMessage({
      id: "video_124",
      object: "video",
      status: "failed",
      model: "veo2-fast",
      prompt: "A cute cat playing in the sunshine",
      error: {
        code: 400,
        status: "INVALID_ARGUMENT",
        message: "Request contains an invalid argument.",
        url: "/v1/video:batchAsyncGenerateVideoText",
      },
    });

    expect(message).toContain("渠道侧或上游模型适配异常");
    expect(message).toContain("不是当前前端独有问题");
  });

  test("should attach fetched blob url for completed video task", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalFetch = global.fetch;
    URL.createObjectURL = jest
      .fn()
      .mockReturnValue("blob:https://example.com/video");
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: {
          get: () => "video/mp4",
        },
        blob: () => Promise.resolve(new Blob(["video-bytes"])),
      } as Response),
    ) as any;
    const payload = await __testables.attachCompletedVideoContent(
      {
        id: "video_123",
        object: "video",
        status: "completed",
      },
      "https://example.com/v1/videos/video_123/content",
      {},
      new AbortController(),
    );

    expect(payload).toMatchObject({
      output: {
        video_url: "blob:https://example.com/video",
      },
    });

    URL.createObjectURL = originalCreateObjectURL;
    global.fetch = originalFetch;
  });

  test("should report empty response when completed video content is empty", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: {
          get: () => "video/mp4",
        },
        blob: () => Promise.resolve(new Blob()),
      } as Response),
    ) as any;

    const payload = await __testables.attachCompletedVideoContent(
      {
        id: "video_789",
        object: "video",
        status: "completed",
      },
      "https://example.com/v1/videos/video_789/content",
      {},
      new AbortController(),
    );

    expect(payload).toMatchObject({
      output: {
        content_error: {
          message: "视频内容接口返回空响应",
          response: null,
        },
      },
    });
  });

  test("should keep json error body when content endpoint returns json", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: {
          get: () => "application/json",
        },
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: {
                message: "获取Token失败",
                type: "Aihubmix_api_error",
              },
              type: "error",
            }),
          ),
      } as unknown as Response),
    ) as any;

    const payload = await __testables.attachCompletedVideoContent(
      {
        id: "video_json",
        object: "video",
        status: "completed",
      },
      "https://example.com/v1/videos/video_json/content",
      {},
      new AbortController(),
    );

    expect(payload).toMatchObject({
      output: {
        content_error: {
          message: "视频内容接口返回非视频响应：HTTP 200",
          response: {
            error: {
              message: "获取Token失败",
              type: "Aihubmix_api_error",
            },
            type: "error",
          },
        },
      },
    });
  });

  test("should surface structured content error json in final message", async () => {
    const api = new ChatGPTApi();
    const message = await api.extractMessage({
      id: "video_999",
      output: {
        content_error: {
          message: "视频内容拉取失败：HTTP 500",
          response: {
            error: {
              message: "获取Token失败",
              type: "Aihubmix_api_error",
            },
            type: "error",
          },
        },
      },
    });

    expect(message).toContain("视频内容拉取失败");
    expect(message).toContain('"获取Token失败"');
    expect(message).toContain('"Aihubmix_api_error"');
  });

  test("should extract blob video url as video markdown", async () => {
    const api = new ChatGPTApi();
    const message = await api.extractMessage({
      output: {
        video_url: "blob:http://localhost:3000/video-blob-id",
      },
    });

    expect(message).toBe(
      "[Generated Video](blob:http://localhost:3000/video-blob-id)",
    );
  });

  test("should format in-progress video task status for polling updates", async () => {
    const api = new ChatGPTApi();
    const message = await api.extractMessage({
      id: "video_456",
      object: "video",
      status: "in_progress",
      progress: 48,
      completed_at: null,
      model: "sora-2",
    });

    expect(message).toBe("视频任务状态：in_progress (video_456)，进度 48%");
  });
});
