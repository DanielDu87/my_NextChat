type SamplingPayload = {
  temperature?: number;
  top_p?: number;
  topP?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
};

type Capability =
  | "chat"
  | "search"
  | "vision"
  | "image"
  | "video"
  | "audio"
  | "tts"
  | "stt"
  | "embedding"
  | "realtime";

function isSearchModel(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    lowerModel.includes("search-preview") ||
    lowerModel.includes("-search") ||
    lowerModel.includes("web-search")
  );
}

function isOpenAIReasoningModel(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    lowerModel.startsWith("o1") ||
    lowerModel.startsWith("o3") ||
    lowerModel.startsWith("o4") ||
    lowerModel.startsWith("o5")
  );
}

function isClaudeModel(model: string) {
  return model.toLowerCase().startsWith("claude-");
}

function isClaudeThinkingConstrainedModel(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    lowerModel.startsWith("claude-sonnet-4-6") || lowerModel.endsWith("-think")
  );
}

function isGpt5TemperatureConstrainedModel(model: string) {
  const lowerModel = model.toLowerCase();
  return lowerModel.startsWith("gpt-5") && lowerModel !== "gpt-5-chat-latest";
}

function isO3MiniTemperatureConstrainedModel(model: string) {
  return model.toLowerCase().startsWith("o3-mini");
}

function shouldUseMaxCompletionTokens(model: string) {
  const lowerModel = model.toLowerCase();
  return isOpenAIReasoningModel(model) || lowerModel.startsWith("gpt-5");
}

function isClaudeAdaptiveThinkingModel(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    lowerModel.includes("claude-opus-4-6") ||
    lowerModel.includes("claude-sonnet-4-6")
  );
}

function supportsReasoningControls(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    isOpenAIReasoningModel(model) ||
    isClaudeModel(model) ||
    lowerModel.endsWith("-think") ||
    lowerModel.includes("thinking")
  );
}

function supportsAnthropicBetaHeader(model: string) {
  return isClaudeModel(model);
}

function supportsMediaResolutionControl(model: string) {
  return inferModelCapability(model) === "vision";
}

function supportsWebSearchControl(model: string) {
  const capability = inferModelCapability(model);
  return (
    capability === "chat" || capability === "search" || capability === "vision"
  );
}

function supportsStructuredOutputControl(model: string) {
  const capability = inferModelCapability(model);
  return capability === "chat";
}

export function applyModelSamplingRules<T extends SamplingPayload>(
  model: string,
  payload: T,
): T {
  const nextPayload = { ...payload };
  const capability = inferModelCapability(model);

  if (capability === "image" || capability === "video") {
    delete nextPayload.temperature;
    delete nextPayload.top_p;
    delete nextPayload.topP;
    delete nextPayload.presence_penalty;
    delete nextPayload.frequency_penalty;
  }

  // Search models reject fine-grained sampling knobs.
  if (isSearchModel(model)) {
    delete nextPayload.temperature;
    delete nextPayload.top_p;
    delete nextPayload.topP;
    delete nextPayload.presence_penalty;
    delete nextPayload.frequency_penalty;
  }

  // Claude family on these gateways rejects sending both temperature and top_p.
  if (isClaudeModel(model)) {
    delete nextPayload.top_p;
    delete nextPayload.topP;
    delete nextPayload.presence_penalty;
    delete nextPayload.frequency_penalty;
  }

  // Claude thinking-constrained models further restrict manual temperature overrides.
  if (isClaudeThinkingConstrainedModel(model)) {
    delete nextPayload.temperature;
  }

  // GPT-5 family only allows default temperature on most variants.
  if (isGpt5TemperatureConstrainedModel(model)) {
    delete nextPayload.temperature;
    delete nextPayload.top_p;
    delete nextPayload.topP;
    delete nextPayload.presence_penalty;
    delete nextPayload.frequency_penalty;
  }

  // o3-mini also constrains manual temperature overrides.
  if (isO3MiniTemperatureConstrainedModel(model)) {
    delete nextPayload.temperature;
  }

  if (isOpenAIReasoningModel(model)) {
    delete nextPayload.top_p;
    delete nextPayload.topP;
    delete nextPayload.presence_penalty;
    delete nextPayload.frequency_penalty;
  }

  return nextPayload;
}

export function inferModelCapability(model: string): Capability {
  const lowerModel = model.toLowerCase();

  if (
    lowerModel.includes("search-preview") ||
    lowerModel.includes("-search") ||
    lowerModel.includes("web-search") ||
    lowerModel.includes("sonar") ||
    lowerModel.includes("perplexity")
  ) {
    return "search";
  }

  if (
    lowerModel.startsWith("gpt-image") ||
    lowerModel.startsWith("dall-e") ||
    lowerModel.startsWith("dalle") ||
    lowerModel.startsWith("imagen-") ||
    lowerModel.includes("image-preview") ||
    lowerModel.includes("image-generation") ||
    lowerModel.includes("nano-banana") ||
    lowerModel.includes("qwen-image") ||
    lowerModel.startsWith("irag-") ||
    lowerModel.startsWith("ernie-irag-") ||
    lowerModel.startsWith("flux-") ||
    lowerModel.startsWith("flux/") ||
    lowerModel.startsWith("doubao-seedream-") ||
    lowerModel.startsWith("cogview-") ||
    lowerModel === "v3" ||
    lowerModel.includes("ideogram") ||
    lowerModel.includes("recraft")
  ) {
    return "image";
  }

  if (
    lowerModel.startsWith("cogvideo-") ||
    lowerModel.includes("video-gen") ||
    lowerModel.includes("seedance") ||
    lowerModel.includes("veo") ||
    lowerModel.includes("sora") ||
    lowerModel.includes("runway") ||
    lowerModel.includes("pixverse") ||
    lowerModel.includes("vidu") ||
    lowerModel.includes("ray-2") ||
    lowerModel.includes("jimeng") ||
    lowerModel.includes("t2v") ||
    lowerModel.includes("i2v") ||
    lowerModel.includes("wanx2.1-t2v") ||
    lowerModel.includes("wanx2.1-i2v")
  ) {
    return "video";
  }

  if (
    lowerModel.startsWith("tts-") ||
    lowerModel.includes("text-to-speech") ||
    lowerModel.includes("-tts")
  ) {
    return "tts";
  }

  if (
    lowerModel.startsWith("whisper-") ||
    lowerModel.includes("transcription") ||
    lowerModel.includes("speech-to-text") ||
    lowerModel.includes("-stt")
  ) {
    return "stt";
  }

  if (
    lowerModel.includes("embedding") ||
    lowerModel.includes("embed") ||
    lowerModel.includes("jina-embeddings")
  ) {
    return "embedding";
  }

  if (
    lowerModel.includes("realtime") ||
    lowerModel.includes("real-time") ||
    lowerModel.includes("realtime-preview")
  ) {
    return "realtime";
  }

  if (lowerModel.includes("audio") || lowerModel.includes("speech")) {
    return "audio";
  }

  if (
    lowerModel.includes("vision") ||
    lowerModel.includes("gemini-pro-vision") ||
    lowerModel.includes("grok-vision") ||
    lowerModel.includes("omni")
  ) {
    return "vision";
  }

  return "chat";
}

export function getModelParameterSupport(model: string) {
  const sampled = applyModelSamplingRules(model, {
    temperature: 1,
    top_p: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
  });
  const capability = inferModelCapability(model);

  return {
    temperature: "temperature" in sampled,
    top_p: "top_p" in sampled,
    presence_penalty: "presence_penalty" in sampled,
    frequency_penalty: "frequency_penalty" in sampled,
    max_tokens: capability === "chat" || capability === "vision",
    max_completion_tokens: shouldUseMaxCompletionTokens(model),
    web_search: supportsWebSearchControl(model),
    reasoning: supportsReasoningControls(model),
    anthropic_beta: supportsAnthropicBetaHeader(model),
    media_resolution: supportsMediaResolutionControl(model),
    structured_output: supportsStructuredOutputControl(model),
    capability,
  };
}

export function isNonConversationalCapability(capability: Capability) {
  return (
    capability === "image" ||
    capability === "video" ||
    capability === "search" ||
    capability === "vision" ||
    capability === "audio" ||
    capability === "tts" ||
    capability === "stt" ||
    capability === "embedding" ||
    capability === "realtime"
  );
}

export function getCapabilityHint(capability: Capability) {
  const hints: Partial<Record<Capability, string>> = {
    search: "该模型按联网搜索能力处理，聊天历史与记忆配置不生效",
    vision: "该模型按视觉能力处理，聊天历史与记忆配置不生效",
    image: "该模型按图像生成能力处理，聊天历史与记忆配置不生效",
    video: "该模型按视频生成能力处理，聊天历史与记忆配置不生效",
    audio: "该模型按音频能力处理，聊天历史与记忆配置不生效",
    tts: "该模型按语音合成能力处理，聊天历史与记忆配置不生效",
    stt: "该模型按语音转文本能力处理，聊天历史与记忆配置不生效",
    embedding: "该模型按向量嵌入能力处理，聊天历史与记忆配置不生效",
    realtime: "该模型按实时能力处理，聊天历史与记忆配置不生效",
  };

  return hints[capability];
}

export function getDefaultReasoningSettings(
  model: string,
  maxTokens: number,
  reasoningEffort?: string,
  reasoningMaxTokens?: number,
) {
  const normalizedEffort = reasoningEffort?.trim().toLowerCase();
  if (normalizedEffort) {
    return {
      reasoningEffort: normalizedEffort,
      reasoningMaxTokens: 0,
    };
  }

  if ((reasoningMaxTokens ?? 0) > 0) {
    return {
      reasoningEffort: "",
      reasoningMaxTokens: reasoningMaxTokens ?? 0,
    };
  }

  if (model.toLowerCase().endsWith("-think")) {
    if (isClaudeAdaptiveThinkingModel(model)) {
      return {
        reasoningEffort: "medium",
        reasoningMaxTokens: 0,
      };
    }

    return {
      reasoningEffort: "",
      reasoningMaxTokens: Math.max(
        1024,
        Math.min((maxTokens || 4096) - 1, 10240),
      ),
    };
  }

  return {
    reasoningEffort: "",
    reasoningMaxTokens: 0,
  };
}

export function sanitizeModelConfigForCapability<
  T extends {
    model: string;
    enableInjectSystemPrompts?: boolean;
    customSystemPrompt?: string;
    sendMemory?: boolean;
    historyMessageCount?: number;
    webSearch?: boolean;
    reasoningEffort?: string;
    reasoningMaxTokens?: number;
    includeThoughts?: boolean;
    anthropicBeta?: string;
    mediaResolution?: string;
    size?: string;
    quality?: string;
    style?: string;
    seconds?: string;
    webSearchContextSize?: string;
    structuredOutput?: boolean;
    jsonSchema?: string;
  },
>(config: T): T {
  const nextConfig = { ...config };
  const support = getModelParameterSupport(config.model);
  const capability = support.capability;

  if (isNonConversationalCapability(capability)) {
    if ("enableInjectSystemPrompts" in nextConfig) {
      nextConfig.enableInjectSystemPrompts = false;
    }
    if ("sendMemory" in nextConfig) {
      nextConfig.sendMemory = false;
    }
    if ("historyMessageCount" in nextConfig) {
      nextConfig.historyMessageCount = 0;
    }
  }

  if ("webSearch" in nextConfig && !support.web_search) {
    nextConfig.webSearch = false;
  }

  if ("webSearchContextSize" in nextConfig && !support.web_search) {
    nextConfig.webSearchContextSize = "";
  }
  if ("webSearchContextSize" in nextConfig && support.web_search) {
    const normalized = String(nextConfig.webSearchContextSize || "")
      .trim()
      .toLowerCase();
    nextConfig.webSearchContextSize =
      normalized && ["low", "medium", "high"].includes(normalized)
        ? normalized
        : "";
  }

  if ("reasoningEffort" in nextConfig && !support.reasoning) {
    nextConfig.reasoningEffort = "";
  }

  if ("reasoningMaxTokens" in nextConfig && !support.reasoning) {
    nextConfig.reasoningMaxTokens = 0;
  }

  if ("includeThoughts" in nextConfig && !support.reasoning) {
    nextConfig.includeThoughts = false;
  }

  if ("anthropicBeta" in nextConfig && !support.anthropic_beta) {
    nextConfig.anthropicBeta = "";
  }

  if ("mediaResolution" in nextConfig && !support.media_resolution) {
    nextConfig.mediaResolution = "";
  }

  if (capability !== "image") {
    if ("size" in nextConfig) {
      nextConfig.size = capability === "video" ? "720x1280" : "1024x1024";
    }
    if ("quality" in nextConfig) {
      nextConfig.quality = "standard";
    }
    if ("style" in nextConfig) {
      nextConfig.style = "vivid";
    }
  }

  if ("seconds" in nextConfig && capability !== "video") {
    nextConfig.seconds = "4";
  }

  if ("seconds" in nextConfig && capability === "video") {
    const normalized = String(nextConfig.seconds || "").trim();
    nextConfig.seconds = ["4", "8", "12"].includes(normalized)
      ? normalized
      : "4";
  }

  if ("structuredOutput" in nextConfig && !support.structured_output) {
    nextConfig.structuredOutput = false;
  }

  if ("jsonSchema" in nextConfig && !support.structured_output) {
    nextConfig.jsonSchema = "";
  }

  return nextConfig;
}
