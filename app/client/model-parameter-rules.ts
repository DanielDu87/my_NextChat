type SamplingPayload = {
  temperature?: number;
  top_p?: number;
  topP?: number;
  top_k?: number;
  topK?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
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

export type StructuredOutputMode = "none" | "json_object" | "json_schema";

export type ReasoningEffortOption = {
  value: string;
  label: string;
};

export type ToolChoiceMode = "auto" | "required" | "none";

export function parseStopSequences(value?: string, limit = 16) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, Math.max(1, limit));
}

export function normalizeToolChoice(value?: string): ToolChoiceMode {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "required" || normalized === "none"
    ? normalized
    : "auto";
}

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

export function isDeepSeekModel(model: string) {
  return model.toLowerCase().startsWith("deepseek-");
}

export function isDeepSeekThinkingModel(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    lowerModel.includes("deepseek-reasoner") ||
    lowerModel.includes("deepseek-r1") ||
    lowerModel.startsWith("deepseek-v4") ||
    lowerModel.includes("deepseek-thinking")
  );
}

export function isDeepSeekV4Model(model: string) {
  return model.toLowerCase().startsWith("deepseek-v4");
}

export function isGlmModel(model: string) {
  const lowerModel = model.toLowerCase();
  return lowerModel.startsWith("glm-") || lowerModel.startsWith("chatglm-");
}

export function isMiniMaxModel(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    lowerModel.startsWith("minimax-") ||
    lowerModel.startsWith("minimax/") ||
    lowerModel.startsWith("minimax-m")
  );
}

export function isMiniMaxM3Model(model: string) {
  return /(?:^|\/)minimax-m3(?:-|$)/i.test(model);
}

export function isQwenModel(model: string) {
  const lowerModel = model.toLowerCase();
  return lowerModel.startsWith("qwen");
}

export function isKimiModel(model: string) {
  const lowerModel = model.toLowerCase();
  return lowerModel.startsWith("kimi-") || lowerModel.startsWith("kimi/");
}

export function isXAIModel(model: string) {
  return model.toLowerCase().startsWith("grok-");
}

export function isXAIReasoningModel(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    lowerModel.startsWith("grok-4.3") ||
    lowerModel.startsWith("grok-4.5") ||
    lowerModel.startsWith("grok-4.20") ||
    lowerModel.includes("grok-reasoning")
  );
}

function isMoonshotModel(model: string) {
  const lowerModel = model.toLowerCase();
  return lowerModel.startsWith("moonshot-") || isKimiModel(model);
}

export function supportsGlmThinking(model: string) {
  const lowerModel = model.toLowerCase();
  const matched = lowerModel.match(/^(?:chat)?glm-(\d+)(?:\.(\d+))?/);
  if (!matched) return false;
  const major = Number(matched[1]);
  const minor = Number(matched[2] ?? 0);
  return major > 4 || (major === 4 && minor >= 5);
}

export function isGlm52Model(model: string) {
  return /^(?:chat)?glm-5\.2(?:-|$)/i.test(model);
}

function isClaudeModel(model: string) {
  return model.toLowerCase().startsWith("claude-");
}

export function isGemini3Model(model: string) {
  return model.toLowerCase().startsWith("gemini-3");
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
  return (
    isOpenAIReasoningModel(model) ||
    lowerModel.startsWith("gpt-5") ||
    isMiniMaxModel(model) ||
    /(?:^|\/)qwen3(?:[.-]|$)/i.test(model) ||
    /(?:^|\/)kimi-k2(?:[.-]|$)/i.test(model)
  );
}

function isClaudeAdaptiveThinkingModel(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    /claude-opus-4-(?:6|7|8)/.test(lowerModel) ||
    /claude-sonnet-(?:4-6|[5-9])/.test(lowerModel) ||
    lowerModel.includes("claude-fable-") ||
    lowerModel.includes("claude-mythos")
  );
}

function isClaudeStructuredOutputModel(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    /claude-(?:opus|sonnet|haiku)-4-(?:[5-9])/.test(lowerModel) ||
    /claude-(?:opus|sonnet|haiku)-[5-9]/.test(lowerModel) ||
    lowerModel.includes("claude-fable-") ||
    lowerModel.includes("claude-mythos")
  );
}

function supportsClaudeEffort(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    /claude-opus-4-(?:[5-9])/.test(lowerModel) ||
    /claude-sonnet-(?:4-6|[5-9])/.test(lowerModel) ||
    /claude-(?:opus|sonnet)-[5-9]/.test(lowerModel) ||
    lowerModel.includes("claude-fable-") ||
    lowerModel.includes("claude-mythos")
  );
}

function supportsReasoningControls(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    isOpenAIReasoningModel(model) ||
    lowerModel.startsWith("gpt-5") ||
    isClaudeModel(model) ||
    lowerModel.includes("gemini-2.5") ||
    lowerModel.includes("gemini-3") ||
    isDeepSeekThinkingModel(model) ||
    supportsGlmThinking(model) ||
    isMiniMaxModel(model) ||
    /(?:^|\/)qwen3(?:[.-]|$)/i.test(model) ||
    /(?:^|\/)kimi-k2(?:[.-]|$)/i.test(model) ||
    isXAIReasoningModel(model) ||
    lowerModel.endsWith("-think") ||
    lowerModel.includes("thinking")
  );
}

function supportsReasoningEffortControl(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    isOpenAIReasoningModel(model) ||
    lowerModel.startsWith("gpt-5") ||
    supportsClaudeEffort(model) ||
    lowerModel.includes("gemini-3") ||
    isDeepSeekV4Model(model) ||
    supportsGlmThinking(model) ||
    isMiniMaxM3Model(model) ||
    /(?:^|\/)qwen3(?:[.-]|$)/i.test(model) ||
    /(?:^|\/)kimi-k2(?:[.-]|$)/i.test(model) ||
    isXAIReasoningModel(model) ||
    lowerModel.endsWith("-think")
  );
}

function supportsReasoningTokenControl(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    (isClaudeModel(model) && !isClaudeAdaptiveThinkingModel(model)) ||
    lowerModel.includes("gemini-2.5") ||
    (lowerModel.endsWith("-think") && !isClaudeAdaptiveThinkingModel(model)) ||
    /(?:^|\/)qwen3(?:[.-]|$)/i.test(model)
  );
}

function supportsAnthropicBetaHeader(model: string) {
  return isClaudeModel(model);
}

function supportsMediaResolutionControl(model: string) {
  return isGemini3Model(model);
}

function supportsTopKControl(model: string) {
  const lowerModel = model.toLowerCase();
  return lowerModel.startsWith("gemini-") && !isGemini3Model(model);
}

function isKnownToolCallingFamily(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    lowerModel.startsWith("gpt-") ||
    isOpenAIReasoningModel(model) ||
    isClaudeModel(model) ||
    lowerModel.startsWith("gemini-") ||
    isDeepSeekModel(model) ||
    isGlmModel(model) ||
    isMiniMaxModel(model) ||
    isQwenModel(model) ||
    isMoonshotModel(model) ||
    isXAIModel(model)
  );
}

function supportsStopSequences(model: string) {
  const lowerModel = model.toLowerCase();
  if (
    isOpenAIReasoningModel(model) ||
    lowerModel.startsWith("gpt-5") ||
    isXAIReasoningModel(model)
  ) {
    return false;
  }
  return (
    lowerModel.startsWith("gpt-") ||
    isClaudeModel(model) ||
    lowerModel.startsWith("gemini-") ||
    isDeepSeekModel(model) ||
    isGlmModel(model) ||
    isMiniMaxModel(model) ||
    isQwenModel(model) ||
    isMoonshotModel(model) ||
    isXAIModel(model)
  );
}

export function getStopSequenceLimit(model: string) {
  const lowerModel = model.toLowerCase();
  if (isGlmModel(model)) return 1;
  if (lowerModel.startsWith("gemini-")) return 5;
  if (isDeepSeekModel(model)) return 16;
  if (isXAIModel(model)) return 4;
  if (lowerModel.startsWith("gpt-") || isOpenAIReasoningModel(model)) return 4;
  return 16;
}

export function getSupportedToolChoiceModes(model: string): ToolChoiceMode[] {
  if (isGlmModel(model)) return ["auto"];
  if (isMiniMaxModel(model) || isQwenModel(model) || isKimiModel(model)) {
    return ["auto", "none"];
  }
  return ["auto", "required", "none"];
}

export function normalizeToolChoiceForModel(
  model: string,
  value?: string,
): ToolChoiceMode {
  const normalized = normalizeToolChoice(value);
  return getSupportedToolChoiceModes(model).includes(normalized)
    ? normalized
    : "auto";
}

export function getTemperatureRange(model: string) {
  if (isGlmModel(model)) {
    return { min: 0, max: 1, step: 0.1 };
  }
  if (isMiniMaxModel(model)) return { min: 0.1, max: 1, step: 0.1 };
  if (isQwenModel(model)) return { min: 0.1, max: 1.9, step: 0.1 };
  return { min: 0, max: 2, step: 0.1 };
}

export function getTopPRange(model: string) {
  if (isGlmModel(model) || isMiniMaxModel(model) || isQwenModel(model)) {
    return { min: 0.01, max: 1, step: 0.01 };
  }
  return { min: 0, max: 1, step: 0.1 };
}

export function getKnownContextWindow(model: string) {
  const lowerModel = model.toLowerCase();
  if (/^gpt-5\.4-(?:mini|nano)/.test(lowerModel)) return 400_000;
  if (/^gpt-5\.(4|5|6)/.test(lowerModel)) return 1_050_000;
  if (lowerModel.startsWith("gpt-5")) return 400_000;
  if (lowerModel.startsWith("gpt-4.1")) return 1_047_576;
  if (lowerModel.startsWith("gpt-4o")) return 128_000;
  if (lowerModel.startsWith("gemini-3")) return 1_048_576;
  if (lowerModel.startsWith("gemini-2.5")) return 1_048_576;
  if (isDeepSeekV4Model(model)) return 1_000_000;
  if (lowerModel.includes("qwen3.7")) return 1_000_000;
  if (lowerModel.includes("kimi-k2.6")) return 262_144;
  if (lowerModel.startsWith("grok-4.3") || lowerModel.startsWith("grok-4.20"))
    return 1_000_000;
  if (lowerModel.startsWith("grok-4.5")) return 500_000;
  if (isMiniMaxM3Model(model)) return 196_608;
  if (/minimax-m2(?:[.\/-]|$)/i.test(model)) return 204_800;
  if (isGlm52Model(model)) return 202_752;
  if (
    /claude-opus-4-(?:6|7|8)/.test(lowerModel) ||
    /claude-sonnet-(?:4-6|[5-9])/.test(lowerModel) ||
    lowerModel.includes("claude-fable-") ||
    lowerModel.includes("claude-mythos")
  )
    return 1_000_000;
  if (isClaudeModel(model)) return 200_000;
  return 0;
}

export function getKnownMaxOutputTokens(model: string) {
  const lowerModel = model.toLowerCase();
  if (lowerModel === "gpt-5-chat-latest") return 16_384;
  if (lowerModel.startsWith("gpt-5")) return 128_000;
  if (lowerModel.startsWith("gpt-4.1")) return 32_768;
  if (lowerModel.startsWith("gpt-4o")) return 16_384;
  if (lowerModel.startsWith("gemini-3")) return 65_536;
  if (lowerModel.startsWith("gemini-2.5")) return 65_536;
  if (isDeepSeekV4Model(model)) return 393_216;
  if (isXAIReasoningModel(model)) return 131_072;
  if (
    /claude-(?:fable|mythos)-5/.test(lowerModel) ||
    /claude-opus-4-(?:6|7|8)/.test(lowerModel) ||
    /claude-sonnet-5/.test(lowerModel)
  )
    return 128_000;
  if (
    lowerModel.includes("claude-sonnet-4-6") ||
    lowerModel.includes("claude-haiku-4-5")
  )
    return 64_000;
  if (/^(?:chat)?glm-(?:5(?:\.|-|$)|4\.[67])/.test(lowerModel)) return 131_072;
  if (/^(?:chat)?glm-4\.5/.test(lowerModel)) return 98_304;
  return 0;
}

function supportsWebSearchControl(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    isSearchModel(model) ||
    lowerModel.startsWith("gpt-5") ||
    isOpenAIReasoningModel(model)
  );
}

export function getStructuredOutputMode(model: string): StructuredOutputMode {
  const lowerModel = model.toLowerCase();
  const capability = inferModelCapability(model);
  if (capability !== "chat" && capability !== "vision") return "none";

  if (isDeepSeekModel(model) || isGlmModel(model) || isQwenModel(model))
    return "json_object";
  if (lowerModel.startsWith("gemini-")) return "json_schema";
  if (isClaudeStructuredOutputModel(model)) return "json_schema";
  if (
    lowerModel.startsWith("gpt-5") ||
    lowerModel.startsWith("gpt-4.1") ||
    lowerModel.startsWith("gpt-4o") ||
    lowerModel.startsWith("o3") ||
    lowerModel.startsWith("o4") ||
    lowerModel.startsWith("o5") ||
    isXAIModel(model)
  ) {
    return "json_schema";
  }
  return "none";
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
    delete nextPayload.top_k;
    delete nextPayload.topK;
    delete nextPayload.presence_penalty;
    delete nextPayload.frequency_penalty;
    delete nextPayload.presencePenalty;
    delete nextPayload.frequencyPenalty;
  }

  // Search models reject fine-grained sampling knobs.
  if (isSearchModel(model)) {
    delete nextPayload.temperature;
    delete nextPayload.top_p;
    delete nextPayload.topP;
    delete nextPayload.top_k;
    delete nextPayload.topK;
    delete nextPayload.presence_penalty;
    delete nextPayload.frequency_penalty;
    delete nextPayload.presencePenalty;
    delete nextPayload.frequencyPenalty;
  }

  // Claude defaults are the cross-version safe recommendation. Newer models
  // reject sampling overrides, and thinking is incompatible with them.
  if (isClaudeModel(model)) {
    delete nextPayload.temperature;
    delete nextPayload.top_p;
    delete nextPayload.topP;
    delete nextPayload.top_k;
    delete nextPayload.topK;
    delete nextPayload.presence_penalty;
    delete nextPayload.frequency_penalty;
    delete nextPayload.presencePenalty;
    delete nextPayload.frequencyPenalty;
  }

  // Claude thinking-constrained models further restrict manual temperature overrides.
  if (isClaudeThinkingConstrainedModel(model)) {
    delete nextPayload.temperature;
  }

  // Gemini 3.x is tuned for model defaults; Google explicitly recommends
  // removing temperature, top-p and top-k from requests.
  if (isGemini3Model(model)) {
    delete nextPayload.temperature;
    delete nextPayload.top_p;
    delete nextPayload.topP;
    delete nextPayload.top_k;
    delete nextPayload.topK;
  }

  // GPT-5 family only allows default temperature on most variants.
  if (isGpt5TemperatureConstrainedModel(model)) {
    delete nextPayload.temperature;
    delete nextPayload.top_p;
    delete nextPayload.topP;
    delete nextPayload.top_k;
    delete nextPayload.topK;
    delete nextPayload.presence_penalty;
    delete nextPayload.frequency_penalty;
    delete nextPayload.presencePenalty;
    delete nextPayload.frequencyPenalty;
  }

  // o3-mini also constrains manual temperature overrides.
  if (isO3MiniTemperatureConstrainedModel(model)) {
    delete nextPayload.temperature;
  }

  if (isOpenAIReasoningModel(model)) {
    delete nextPayload.temperature;
    delete nextPayload.top_p;
    delete nextPayload.topP;
    delete nextPayload.top_k;
    delete nextPayload.topK;
    delete nextPayload.presence_penalty;
    delete nextPayload.frequency_penalty;
    delete nextPayload.presencePenalty;
    delete nextPayload.frequencyPenalty;
  }

  // xAI reasoning models reject sampling controls and repetition penalties.
  if (isXAIReasoningModel(model)) {
    delete nextPayload.temperature;
    delete nextPayload.top_p;
    delete nextPayload.topP;
    delete nextPayload.top_k;
    delete nextPayload.topK;
    delete nextPayload.presence_penalty;
    delete nextPayload.frequency_penalty;
    delete nextPayload.presencePenalty;
    delete nextPayload.frequencyPenalty;
  }

  // DeepSeek thinking mode ignores sampling knobs, while all current
  // DeepSeek chat models deprecate presence/frequency penalties.
  if (isDeepSeekModel(model)) {
    delete nextPayload.presence_penalty;
    delete nextPayload.frequency_penalty;
    delete nextPayload.presencePenalty;
    delete nextPayload.frequencyPenalty;
    if (isDeepSeekThinkingModel(model)) {
      delete nextPayload.temperature;
      delete nextPayload.top_p;
      delete nextPayload.topP;
      delete nextPayload.top_k;
      delete nextPayload.topK;
    }
  }

  if (isMiniMaxModel(model)) {
    delete nextPayload.presence_penalty;
    delete nextPayload.frequency_penalty;
    delete nextPayload.presencePenalty;
    delete nextPayload.frequencyPenalty;
    // Current MiniMax direct-supply models expose fixed sampling defaults.
    delete nextPayload.temperature;
    delete nextPayload.top_p;
    delete nextPayload.topP;
    delete nextPayload.top_k;
    delete nextPayload.topK;
  }

  // Qwen recommends adjusting temperature or top_p, not both. The shared
  // programming preset uses temperature, so omit top_p on Qwen requests.
  if (isQwenModel(model)) {
    delete nextPayload.top_p;
    delete nextPayload.topP;
  }

  // Current Kimi K2.5+ direct-supply models use fixed sampling defaults and
  // do not accept a manual thinking budget.
  if (isKimiModel(model)) {
    delete nextPayload.temperature;
    delete nextPayload.top_p;
    delete nextPayload.topP;
    delete nextPayload.top_k;
    delete nextPayload.topK;
    delete nextPayload.presence_penalty;
    delete nextPayload.frequency_penalty;
    delete nextPayload.presencePenalty;
    delete nextPayload.frequencyPenalty;
  }

  // Z.AI's Chat Completions schema does not expose OpenAI-style penalties.
  if (isGlmModel(model)) {
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
    lowerModel.includes("gpt-image") ||
    lowerModel.includes("dall-e") ||
    lowerModel.startsWith("dalle") ||
    lowerModel.startsWith("imagen-") ||
    (lowerModel.startsWith("gemini-") && lowerModel.includes("image")) ||
    lowerModel.includes("image-preview") ||
    lowerModel.includes("image-generation") ||
    lowerModel.includes("nano-banana") ||
    lowerModel.includes("qwen-image") ||
    lowerModel.startsWith("irag-") ||
    lowerModel.startsWith("ernie-irag-") ||
    lowerModel.startsWith("flux-") ||
    lowerModel.startsWith("flux/") ||
    lowerModel.includes("seedream-") ||
    lowerModel.includes("glm-image") ||
    lowerModel.includes("cogview-") ||
    (/(?:^|\/)wan2[.-]/.test(lowerModel) &&
      (lowerModel.includes("-image") || lowerModel.includes("-t2i"))) ||
    (/(?:^|\/)wanx2[.-]/.test(lowerModel) && lowerModel.includes("-t2i")) ||
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
  const lowerModel = model.toLowerCase();
  const sampled = applyModelSamplingRules(model, {
    temperature: 1,
    top_p: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
  });
  const capability = inferModelCapability(model);
  const structuredOutputMode = getStructuredOutputMode(model);
  const conversational = capability === "chat" || capability === "vision";
  const reasoning = supportsReasoningControls(model);

  return {
    temperature: "temperature" in sampled,
    top_p: "top_p" in sampled,
    top_k: supportsTopKControl(model),
    presence_penalty: "presence_penalty" in sampled,
    frequency_penalty: "frequency_penalty" in sampled,
    max_tokens: capability === "chat" || capability === "vision",
    max_completion_tokens: shouldUseMaxCompletionTokens(model),
    stream:
      capability === "chat" ||
      capability === "search" ||
      capability === "vision",
    conversation: conversational,
    web_search: supportsWebSearchControl(model),
    reasoning,
    reasoning_effort: supportsReasoningEffortControl(model),
    reasoning_max_tokens: supportsReasoningTokenControl(model),
    include_thoughts: reasoning,
    anthropic_beta: supportsAnthropicBetaHeader(model),
    media_resolution: supportsMediaResolutionControl(model),
    context_window: false,
    context_window_tokens: getKnownContextWindow(model),
    stop_sequences: conversational && supportsStopSequences(model),
    candidate_count: false,
    tool_choice: conversational && isKnownToolCallingFamily(model),
    safety_settings: conversational && lowerModel.startsWith("gemini-"),
    prompt_cache: conversational && isClaudeModel(model),
    prompt_cache_automatic:
      conversational &&
      (lowerModel.startsWith("gpt-") ||
        lowerModel.startsWith("gemini-") ||
        isDeepSeekModel(model) ||
        isGlmModel(model) ||
        isMiniMaxModel(model) ||
        isQwenModel(model) ||
        isMoonshotModel(model) ||
        isXAIModel(model)),
    stop_sequence_limit: getStopSequenceLimit(model),
    tool_choice_modes: getSupportedToolChoiceModes(model),
    structured_output: structuredOutputMode !== "none",
    structured_output_mode: structuredOutputMode,
    json_schema: structuredOutputMode === "json_schema",
    // OpenAI 专用参数支持
    seed: supportsSeedControl(model),
    modalities: supportsModalitiesControl(model),
    capability,
  };
}

function supportsSeedControl(model: string): boolean {
  const lowerModel = model.toLowerCase();
  // OpenAI o1/o3/o4/o5 系列支持 seed 参数
  if (
    lowerModel.startsWith("o1") ||
    lowerModel.startsWith("o3") ||
    lowerModel.startsWith("o4") ||
    lowerModel.startsWith("o5")
  ) {
    return true;
  }
  // GPT-5 系列支持 seed 参数
  if (lowerModel.startsWith("gpt-5")) {
    return true;
  }
  // GPT-4o 系列部分支持
  if (lowerModel.startsWith("gpt-4o")) {
    return true;
  }
  // 其他 gpt 系列
  if (lowerModel.startsWith("gpt-4") || lowerModel.startsWith("gpt-3.5")) {
    return true;
  }
  return false;
}

function supportsModalitiesControl(model: string): boolean {
  const lowerModel = model.toLowerCase();
  // OpenAI 最新模型支持 modalities 控制输出模式
  if (lowerModel.startsWith("gpt-5")) {
    return true;
  }
  // GPT-4o 及以上支持音频输出
  if (lowerModel.startsWith("gpt-4o")) {
    return true;
  }
  return false;
}

export function getReasoningEffortOptions(
  model: string,
): ReasoningEffortOption[] {
  const lowerModel = model.toLowerCase();
  const options = (values: string[]) => [
    { value: "", label: "自动" },
    ...values.map((value) => ({ value, label: value })),
  ];

  if (lowerModel.startsWith("gpt-5.6")) {
    return options(["none", "low", "medium", "high", "xhigh", "max"]);
  }
  if (/^gpt-5\.(4|5)/.test(lowerModel)) {
    if (lowerModel.includes("-pro")) {
      return options(["medium", "high", "xhigh"]);
    }
    return options(["none", "low", "medium", "high", "xhigh"]);
  }
  if (lowerModel.startsWith("gpt-5")) {
    return options(["minimal", "low", "medium", "high"]);
  }
  if (lowerModel.includes("gemini-3")) {
    return options(
      lowerModel.includes("flash")
        ? ["minimal", "low", "medium", "high"]
        : ["low", "medium", "high"],
    );
  }
  if (isMiniMaxM3Model(model)) {
    return options(["none", "high"]);
  }
  if (/(?:^|\/)qwen3(?:[.-]|$)/i.test(model)) {
    return options(["none", "high"]);
  }
  if (/(?:^|\/)kimi-k2(?:[.-]|$)/i.test(model)) {
    return options(["none", "high"]);
  }
  if (isDeepSeekV4Model(model)) {
    return options(["none", "low", "medium", "high", "xhigh", "max"]);
  }
  if (isGlm52Model(model)) {
    return options([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  }
  if (lowerModel.startsWith("grok-4.20")) {
    return options(["none", "low", "medium", "high", "xhigh"]);
  }
  if (lowerModel.startsWith("grok-4.3")) {
    return options(["none", "low", "medium", "high"]);
  }
  if (lowerModel.startsWith("grok-4.5")) {
    return options(["low", "medium", "high"]);
  }
  if (supportsGlmThinking(model)) {
    return options(["none"]);
  }
  if (isClaudeModel(model)) {
    return options(["low", "medium", "high", "xhigh", "max"]);
  }
  return options(["low", "medium", "high"]);
}

export function isNonConversationalCapability(capability: Capability) {
  return (
    capability === "image" ||
    capability === "video" ||
    capability === "search" ||
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
  const support = getModelParameterSupport(model);
  if (!support.reasoning) {
    return { reasoningEffort: "", reasoningMaxTokens: 0 };
  }

  const normalizedEffort = reasoningEffort?.trim().toLowerCase();
  if (normalizedEffort && support.reasoning_effort) {
    const supportedValues = getReasoningEffortOptions(model).map(
      (option) => option.value,
    );
    return {
      reasoningEffort: supportedValues.includes(normalizedEffort)
        ? normalizedEffort
        : "",
      reasoningMaxTokens: 0,
    };
  }

  if (support.reasoning_max_tokens && (reasoningMaxTokens ?? 0) > 0) {
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
    stopSequences?: string;
    candidateCount?: number;
    toolChoice?: string;
    safetySettings?: string;
    promptCache?: boolean;
  },
>(config: T): T {
  const nextConfig = { ...config };

  // Global settings are preserved across model switches. Unsupported fields
  // are disabled in the UI and omitted by request builders instead of being
  // erased from the shared configuration.
  if ("webSearchContextSize" in nextConfig) {
    const normalized = String(nextConfig.webSearchContextSize || "")
      .trim()
      .toLowerCase();
    nextConfig.webSearchContextSize =
      normalized && ["low", "medium", "high"].includes(normalized)
        ? normalized
        : "";
  }

  if ("mediaResolution" in nextConfig) {
    const normalized = String(nextConfig.mediaResolution || "")
      .trim()
      .toLowerCase();
    nextConfig.mediaResolution =
      normalized && ["low", "medium", "high"].includes(normalized)
        ? normalized
        : "";
  }

  if ("seconds" in nextConfig) {
    const normalized = String(nextConfig.seconds || "").trim();
    nextConfig.seconds = ["4", "8", "12", "16", "20"].includes(normalized)
      ? normalized
      : "4";
  }

  if ("stopSequences" in nextConfig) {
    nextConfig.stopSequences = parseStopSequences(
      nextConfig.stopSequences,
    ).join("\n");
  }

  if ("candidateCount" in nextConfig) {
    nextConfig.candidateCount = 1;
  }

  if ("toolChoice" in nextConfig) {
    nextConfig.toolChoice = normalizeToolChoice(nextConfig.toolChoice);
  }

  if ("safetySettings" in nextConfig) {
    const normalized = String(nextConfig.safetySettings || "")
      .trim()
      .toUpperCase();
    nextConfig.safetySettings = [
      "",
      "BLOCK_NONE",
      "OFF",
      "BLOCK_ONLY_HIGH",
      "BLOCK_MEDIUM_AND_ABOVE",
      "BLOCK_LOW_AND_ABOVE",
    ].includes(normalized)
      ? normalized
      : "";
  }

  return nextConfig;
}
