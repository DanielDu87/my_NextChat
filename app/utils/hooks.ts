import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { collectModelsWithDefaultModel } from "./model";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const models = useMemo(() => {
    return collectModelsWithDefaultModel(
      configStore.models,
      configStore.customModels,
      accessStore.defaultModel,
    );
  }, [accessStore.defaultModel, configStore.customModels, configStore.models]);

  return models;
}
