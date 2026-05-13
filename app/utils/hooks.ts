import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { collectModelsWithDefaultModel } from "./model";

// 返回所有模型（受 customModels 过滤）
export function useAllModels() {
  const defaultModel = useAccessStore((s) => s.defaultModel);
  const models = useAppConfig((s) => s.models);
  const customModels = useAppConfig((s) => s.customModels);

  const allModels = useMemo(() => {
    return collectModelsWithDefaultModel(models, customModels, defaultModel);
  }, [models, customModels, defaultModel]);

  return allModels;
}

// 只返回用户手动添加的模型（customModels 中 + 前缀的条目）
export function useUserModels() {
  const defaultModel = useAccessStore((s) => s.defaultModel);
  const models = useAppConfig((s) => s.models);
  const customModels = useAppConfig((s) => s.customModels);

  const userModels = useMemo(() => {
    if (!customModels || customModels.trim() === "") {
      return [];
    }
    // 只保留 + 前缀的条目（用户手动添加的），过滤掉 - 前缀（禁用的）
    const userAddedOnly = customModels
      .split(",")
      .map((m) => m.trim())
      .filter((m) => m.startsWith("+"))
      .join(",");

    if (!userAddedOnly) return [];
    return collectModelsWithDefaultModel(models, userAddedOnly, defaultModel);
  }, [models, customModels, defaultModel]);

  return userModels;
}
