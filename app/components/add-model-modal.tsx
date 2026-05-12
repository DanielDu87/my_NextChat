import { useState, useMemo } from "react";
import { useAppConfig } from "../store";
import { Selector } from "./ui-lib";
import { useAllAvailableModels } from "../utils/hooks";
import Locale from "../locales";

export function AddModelModal(props: { onClose: () => void }) {
  const config = useAppConfig();
  const allAvailableModels = useAllAvailableModels();

  // 已添加的模型列表
  const addedModelKeys = useMemo(() => {
    const customModels = config.customModels || "";
    return new Set(
      customModels
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean)
        .map((m) => {
          // 移除前缀符号 +/-
          const cleaned = m.replace(/^[+-]/, "");
          return cleaned;
        }),
    );
  }, [config.customModels]);

  // 转换为 Selector 需要的格式
  const selectorItems = useMemo(() => {
    return allAvailableModels.map((model) => {
      const modelKey = `${model.name}@${model.provider?.id}`;
      const isAdded = addedModelKeys.has(modelKey);

      return {
        title: model.displayName || model.name,
        value: modelKey,
        group: model.vendor?.name || model.provider?.providerName || "Other",
        disable: isAdded,
        searchText: `${model.displayName} ${model.name}`,
        order: model.sorted,
        publishedAt: model.publishedAt,
        publishedAtSource: model.publishedAtSource,
        catalogRank: model.catalogRank,
        sortKey: model.name,
        meta: {
          category: model.category,
          categorySource: model.categorySource,
          type: model.type,
          types: model.types,
          features: model.features,
          capabilities: model.capabilities,
          categories: model.categories,
          vendorName: model.vendor?.name,
        },
      };
    });
  }, [allAvailableModels, addedModelKeys]);

  // 处理模型选择
  const handleSelection = (selectedModels: string[]) => {
    if (selectedModels.length === 0) {
      return;
    }

    // 获取当前的 customModels
    const currentCustomModels = config.customModels || "";
    const currentModels = currentCustomModels
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);

    // 添加新选择的模型（使用 + 前缀表示启用）
    const newModels = selectedModels.map((m) => `+${m}`);

    // 合并并去重
    const allModels = [...currentModels, ...newModels];
    const uniqueModels = Array.from(new Set(allModels));

    // 更新 customModels
    config.update((state) => {
      state.customModels = uniqueModels.join(",");
    });

    props.onClose();
  };

  return (
    <Selector
      title="添加模型"
      items={selectorItems}
      multiple={true}
      showSearch={true}
      showGroupFilter={true}
      onSelection={handleSelection}
      onClose={props.onClose}
      enableVirtualization={true}
      virtualizationThreshold={50}
    />
  );
}
