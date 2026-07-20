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
    lowerModel.includes("recraft") ||
    lowerModel.includes("wan2.") ||
    lowerModel.includes("wanx") ||
    lowerModel.startsWith("irag-") ||
    lowerModel.startsWith("ernie-irag-")
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
    if (lowerModel.includes("sora-2-pro")) {
      return [
        "720x1280",
        "1280x720",
        "1024x1792",
        "1792x1024",
        "1080x1920",
        "1920x1080",
      ];
    }
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
  if (lowerModel.includes("gpt-image-2")) {
    return [
      "auto",
      "1024x1024",
      "1024x1536",
      "1536x1024",
      "2048x2048",
      "2048x1152",
      "3840x2160",
      "2160x3840",
    ];
  }
  if (lowerModel.includes("gpt-image-1")) {
    return ["1024x1024", "1024x1536", "1536x1024"];
  }
  if (lowerModel.includes("imagen-4.0")) {
    return ["1024x1024", "768x1024", "1024x768", "1024x1536", "1536x1024"];
  }
  if (lowerModel.includes("glm-image")) {
    return [
      "1280x1280",
      "1568x1056",
      "1056x1568",
      "1472x1088",
      "1088x1472",
      "1728x960",
      "960x1728",
    ];
  }
  if (lowerModel.includes("wan2.7-image-pro")) {
    return ["1K", "2K", "4K"];
  }
  if (lowerModel.includes("wan2.7-image")) {
    return ["1K", "2K"];
  }
  if (lowerModel.includes("wan2.6")) {
    return ["1280x1280", "1280x1440", "1440x1280"];
  }
  if (lowerModel.includes("qwen-image-2.0")) {
    return [
      "1024x1024",
      "512x1024",
      "768x512",
      "768x1024",
      "1024x576",
      "576x1024",
      "2048x2048",
    ];
  }
  if (
    lowerModel.includes("qwen-image-max") ||
    lowerModel.includes("qwen-image-plus")
  ) {
    return ["1664x928", "1472x1104", "1328x1328", "1104x1472", "928x1664"];
  }
  if (
    lowerModel.includes("qwen-image-edit-plus") ||
    lowerModel.includes("qwen-image-edit-max")
  ) {
    return ["1024x1024", "512x512", "768x768", "1536x1536", "2048x2048"];
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
  if (lowerModel.includes("flux")) {
    return [
      "1024x1024",
      "768x1024",
      "1024x768",
      "1536x1024",
      "1024x1536",
      "512x512",
    ];
  }
  return [];
}

export function getSupportedImageQualityOptions(model: string): string[] {
  const lowerModel = model.toLowerCase();
  if (lowerModel.includes("gpt-image-")) {
    return ["auto", "low", "medium", "high"];
  }
  if (lowerModel.includes("dall-e-3")) {
    return ["standard", "hd"];
  }
  if (lowerModel.includes("glm-image")) {
    return ["hd", "standard"];
  }
  if (lowerModel.includes("imagen-4.0")) {
    return ["low", "medium", "high"];
  }
  return [];
}

export function getSupportedImageStyleOptions(model: string): string[] {
  const lowerModel = model.toLowerCase();
  if (lowerModel.includes("dall-e-3")) {
    return ["vivid", "natural"];
  }
  return [];
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
