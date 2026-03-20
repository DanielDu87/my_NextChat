import type { ModelConfig } from "../store/config";

export function applyAutoModeModelConfig(
  currentModelConfig: ModelConfig,
  autoModeModelConfig: Pick<ModelConfig, "model" | "providerName">,
) {
  return {
    ...currentModelConfig,
    model: autoModeModelConfig.model,
    providerName: autoModeModelConfig.providerName,
  };
}

export function mergeNewSessionModelConfig(
  currentModelConfig: ModelConfig | undefined,
  nextModelConfig: ModelConfig,
  autoModeEnabled: boolean,
) {
  if (!currentModelConfig) {
    return { ...nextModelConfig };
  }

  return {
    ...currentModelConfig,
    ...(autoModeEnabled
      ? applyAutoModeModelConfig(currentModelConfig, {
          model: nextModelConfig.model,
          providerName: nextModelConfig.providerName,
        })
      : {}),
  };
}
