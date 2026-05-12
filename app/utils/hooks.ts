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
    // 如果 customModels 为空，返回空数组（只显示用户手动添加的模型）
    if (!customModels || customModels.trim() === "") {
      return [];
    }
    return collectModelsWithDefaultModel(models, customModels, defaultModel);
  }, [models, customModels, defaultModel]);

  return allModels;
}

// 获取所有可用模型（用于添加模型弹窗）
export function useAllAvailableModels() {
  const defaultModel = useAccessStore((s) => s.defaultModel);
  const models = useAppConfig((s) => s.models);

  const allAvailableModels = useMemo(() => {
    // 返回所有可用模型，不受 customModels 限制
    return collectModelsWithDefaultModel(models, "+all", defaultModel);
  }, [models, defaultModel]);

  return allAvailableModels;
}
