import {
  getModelVendorGroupName,
  isCustomAutoModelName,
} from "./model-vendor-normalize";
import { inferVendorFromModelName } from "./models";

export type ModelDisplayGroupInput = {
  modelName?: string;
  vendorName?: string;
  providerName?: string;
  displayName?: string;
};

/**
 * 网页模型列表与控制台共用的最终模型公司分组入口。
 * 已知模型系列优先归属真实公司；无法识别时才使用上游厂商或 API 配置回退值。
 */
export function getModelDisplayGroup({
  modelName = "",
  vendorName = "",
  providerName = "",
  displayName = "",
}: ModelDisplayGroupInput) {
  if (isCustomAutoModelName(modelName)) return "CUSTOM";

  const combinedName = `${modelName} ${displayName}`;
  const inferredVendor = inferVendorFromModelName(combinedName);
  if (inferredVendor?.name) {
    return getModelVendorGroupName(inferredVendor.name);
  }

  return getModelVendorGroupName(vendorName || providerName || "Other");
}
