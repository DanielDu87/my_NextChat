import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { collectModelsWithDefaultModel } from "./model";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const models = useMemo(() => {
    const result = collectModelsWithDefaultModel(
      configStore.models,
      configStore.customModels,
      accessStore.defaultModel,
    );
    console.log(
      "[useAllModels] configStore.models count:",
      configStore.models.length,
    );
    console.log("[useAllModels] result count:", result.length);
    return result;
  }, [accessStore.defaultModel, configStore.customModels, configStore.models]);

  return models;
}
