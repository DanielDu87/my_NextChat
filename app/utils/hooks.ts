import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { collectModelsWithDefaultModel } from "./model";

export function useAllModels() {
  // 使用精确 selector，只订阅 defaultModel、models、customModels
  // 避免其他 store 字段变化触发不必要的重渲染
  const defaultModel = useAccessStore((s) => s.defaultModel);
  const models = useAppConfig((s) => s.models);
  const customModels = useAppConfig((s) => s.customModels);

  const allModels = useMemo(() => {
    return collectModelsWithDefaultModel(models, customModels, defaultModel);
  }, [models, customModels, defaultModel]);

  return allModels;
}
