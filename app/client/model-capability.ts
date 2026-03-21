export type Capability =
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
