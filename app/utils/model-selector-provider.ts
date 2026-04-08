export function getActiveModelSelectorProviderId(params: {
  showModelSelector: boolean;
  modelSelectorProviderId?: string;
  currentProviderId?: string;
}) {
  const selectorProviderId = String(
    params.modelSelectorProviderId || "",
  ).trim();
  if (params.showModelSelector && selectorProviderId) {
    return selectorProviderId;
  }

  return String(params.currentProviderId || "").trim();
}
