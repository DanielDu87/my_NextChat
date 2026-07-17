import {
  getModelVendorGroupName,
  isGenericModelVendorName,
  isCustomAutoModelName,
} from "./model-vendor-normalize";
import { inferVendorFromModelName } from "./models";

export type ModelDisplayGroupInput = {
  modelName?: string;
  vendorName?: string;
  vendorId?: number;
  providerName?: string;
  displayName?: string;
};

/**
 * 网页模型列表与控制台共用的最终模型公司分组入口。
 * 已知模型系列和上游声明优先归属真实公司；无法识别时统一进入 Other。
 */
export function getModelDisplayGroup({
  modelName = "",
  vendorName = "",
  vendorId,
  providerName = "",
  displayName = "",
}: ModelDisplayGroupInput) {
  if (isCustomAutoModelName(modelName)) return "CUSTOM";

  const combinedName = `${modelName} ${displayName}`;
  const inferredVendor = inferVendorFromModelName(combinedName);
  if (inferredVendor?.name) {
    return getModelVendorGroupName(inferredVendor.name);
  }

  // 旧缓存中的 -4 表示 Custom/Local 配置回退，不是模型厂商声明。
  if (
    vendorId === -4 &&
    ["custom", "local"].includes(providerName.trim().toLowerCase())
  ) {
    return "Other";
  }

  if (!isGenericModelVendorName(vendorName)) {
    return getModelVendorGroupName(vendorName);
  }

  if (
    !isGenericModelVendorName(providerName) &&
    !["custom", "local"].includes(providerName.trim().toLowerCase())
  ) {
    return getModelVendorGroupName(providerName);
  }

  return "Other";
}
