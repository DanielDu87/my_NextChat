import constants from "../constant";

const { EXCLUDE_VISION_MODEL_REGEXES, VISION_MODEL_REGEXES } = constants;

export function isVisionModelByConfig(model: string, visionModels?: string) {
  const configuredModels = visionModels?.split(",").map((item) => item.trim());
  if (configuredModels?.includes(model)) {
    return true;
  }

  return (
    !EXCLUDE_VISION_MODEL_REGEXES.some((regex) => regex.test(model)) &&
    VISION_MODEL_REGEXES.some((regex) => regex.test(model))
  );
}

export function isImageGenerationModel(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    lowerModel.includes("image") ||
    lowerModel.includes("imagen") ||
    lowerModel.includes("nano-banana") ||
    lowerModel.startsWith("dall-e") ||
    lowerModel.startsWith("dalle") ||
    lowerModel.includes("seedream") ||
    lowerModel.includes("qwen-image") ||
    lowerModel.includes("cogview") ||
    lowerModel.includes("flux") ||
    lowerModel.includes("ideogram") ||
    lowerModel.includes("recraft")
  );
}

export function isVideoGenerationModel(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    lowerModel.includes("video-gen") ||
    lowerModel.includes("seedance") ||
    lowerModel.includes("veo") ||
    lowerModel.includes("sora") ||
    lowerModel.includes("runway") ||
    lowerModel.includes("pixverse") ||
    lowerModel.includes("vidu") ||
    lowerModel.includes("ray-2") ||
    lowerModel.includes("jimeng") ||
    lowerModel.includes("wanx") ||
    lowerModel.includes("t2v") ||
    lowerModel.includes("i2v")
  );
}

export function getModelSizes(model: string): string[] {
  const lowerModel = model.toLowerCase();
  if (isVideoGenerationModel(model)) {
    return ["720x1280", "1280x720"];
  }
  if (lowerModel.includes("cogview")) {
    return [
      "1024x1024",
      "768x1344",
      "864x1152",
      "1344x768",
      "1152x864",
      "1440x720",
      "720x1440",
    ];
  }
  if (lowerModel.includes("gpt-image-1.5")) {
    return ["1024x1024", "1024x1536", "1536x1024"];
  }
  if (
    lowerModel.startsWith("dall-e-") ||
    lowerModel.startsWith("dalle-") ||
    lowerModel.startsWith("gpt-image-") ||
    lowerModel.includes("qwen-image") ||
    lowerModel.startsWith("irag-") ||
    lowerModel.startsWith("ernie-irag-")
  ) {
    return ["1024x1024", "1792x1024", "1024x1792"];
  }
  return [];
}

export function getSupportedImageQualityOptions(model: string): string[] {
  const lowerModel = model.toLowerCase();
  if (lowerModel.includes("gpt-image-1.5")) {
    return ["auto", "low", "medium", "high"];
  }
  if (lowerModel.includes("dall-e-3")) {
    return ["standard", "hd"];
  }
  return [];
}

export function getSupportedImageStyleOptions(model: string): string[] {
  return model.toLowerCase().includes("dall-e-3") ? ["vivid", "natural"] : [];
}

export function supportsImageQualityControl(model: string): boolean {
  return getSupportedImageQualityOptions(model).length > 0;
}

export function supportsImageStyleControl(model: string): boolean {
  return getSupportedImageStyleOptions(model).length > 0;
}

export function supportsCustomSize(model: string): boolean {
  return getModelSizes(model).length > 0;
}
