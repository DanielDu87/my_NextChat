export function getActiveModelSelectorProviderId(params: {
  showModelSelector: boolean;
  modelSelectorProviderId?: string;
  currentProviderId?: string;
}) {
  const selectorProviderId = String(
    params.modelSelectorProviderId || "",
  ).trim();
  // 始终优先使用已切换的 providerId（切换供应商时已更新）
  if (selectorProviderId) {
    return selectorProviderId;
  }

  return String(params.currentProviderId || "").trim();
}
