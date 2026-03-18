import { ServiceProvider } from "../constant";
import type { LLMModel } from "../client/api";
import { writeAccessSnapshot } from "./access-snapshot";
import { normalizeModelClassification } from "./model-classification";
import { applyModelPublishedAt } from "./model-published-at";

/**
 * AiHubMix developer_id 到供应商名称的映射
 * 数据来源: https://aihubmix.com/api/v1/models
 * 最后更新: 2026-03-16
 *
 * 注意: developer_id 分类是 AiHubMix 内部使用的，不完全对应原始供应商
 * 如 developer_id: 3 实际是 Microsoft Phi 系列模型
 */
const AIHUBMIX_VENDOR_MAP: Record<number, { name: string; icon?: string }> = {
  1: { name: "OpenAI", icon: "OpenAI" }, // o1-global, Jamba
  2: { name: "Anthropic", icon: "Claude.Color" },
  3: { name: "Microsoft", icon: "Nvidia" }, // Phi 系列 (微软/Nvidia)
  4: { name: "ByteDance", icon: "Doubao.Color" }, // Doubao/Seed
  5: { name: "Zhipu", icon: "Zhipu.Color" }, // GLM 系列
  6: { name: "Cohere", icon: "Cohere" }, // Command A/R
  7: { name: "DeepSeek", icon: "DeepSeek.Color" },
  8: { name: "Google", icon: "Gemini.Color" },
  9: { name: "xAI", icon: "XAI" }, // Grok 系列
  10: { name: "Mistral", icon: "Mistral.Color" },
  11: { name: "Meta", icon: "Meta.Color" }, // Llama 系列
  12: { name: "OpenAI", icon: "OpenAI" }, // GPT 系列
  13: { name: "Alibaba", icon: "Qwen.Color" },
  14: { name: "01.AI", icon: "Yi" },
  15: { name: "Moonshot", icon: "Moonshot" },
  16: { name: "StepFun", icon: "StepFun" },
  17: { name: "Nvidia", icon: "Nvidia" },
  18: { name: "Minimax", icon: "Minimax.Color" },
  19: { name: "Perplexity", icon: "Perplexity" },
  20: { name: "Baichuan", icon: "Baichuan" },
  21: { name: "Ideogram", icon: "Ideogram" },
  22: { name: "Jina AI", icon: "Jina" },
  23: { name: "Stability", icon: "Stability" },
  24: { name: "Tencent", icon: "Hunyuan.Color" },
  25: { name: "Baidu", icon: "Ernie.Color" },
  27: { name: "Flux", icon: "Flux" },
  28: { name: "Meituan", icon: "Meituan" },
  29: { name: "InclusionAI", icon: "InclusionAI" },
  30: { name: "BAAI", icon: "BAAI" },
  31: { name: "Xiaomi", icon: "Xiaomi" },
};

/**
 * 通过模型名称前缀推断供应商
 */
function inferVendorFromModelName(
  modelName: string,
): { name: string; icon?: string } | null {
  const lowerName = modelName.toLowerCase();

  // OpenAI
  if (
    lowerName.startsWith("gpt-") ||
    lowerName.startsWith("chatgpt-") ||
    lowerName.startsWith("o1-") ||
    lowerName.startsWith("o3-")
  ) {
    return { name: "OpenAI", icon: "OpenAI" };
  }
  // Anthropic Claude
  if (lowerName.startsWith("claude-")) {
    return { name: "Anthropic", icon: "Claude.Color" };
  }
  // Google Gemini
  if (lowerName.startsWith("gemini-") || lowerName.startsWith("pregenie-")) {
    return { name: "Google", icon: "Gemini.Color" };
  }
  // DeepSeek
  if (lowerName.startsWith("deepseek-")) {
    return { name: "DeepSeek", icon: "DeepSeek.Color" };
  }
  // xAI Grok
  if (lowerName.startsWith("grok-")) {
    return { name: "xAI", icon: "XAI" };
  }
  // Alibaba Qwen
  if (lowerName.startsWith("qwen-") || lowerName.startsWith("qwen3")) {
    return { name: "Alibaba", icon: "Qwen.Color" };
  }
  // ByteDance Doubao
  if (lowerName.startsWith("doubao-")) {
    return { name: "ByteDance", icon: "Doubao.Color" };
  }
  // Moonshot
  if (lowerName.startsWith("moonshot-")) {
    return { name: "Moonshot", icon: "Moonshot" };
  }
  // Baidu Ernie
  if (lowerName.startsWith("ernie-")) {
    return { name: "Baidu", icon: "Ernie.Color" };
  }
  // Tencent Hunyuan
  if (lowerName.startsWith("hunyuan-")) {
    return { name: "Tencent", icon: "Hunyuan.Color" };
  }
  // Zhipu GLM
  if (lowerName.startsWith("glm-")) {
    return { name: "Zhipu", icon: "Zhipu.Color" };
  }
  // Meta Llama
  if (lowerName.startsWith("llama-") || lowerName.startsWith("llama3")) {
    return { name: "Meta", icon: "Ollama" };
  }
  // Mistral
  if (lowerName.startsWith("mistral-") || lowerName.startsWith("mixtral-")) {
    return { name: "Mistral", icon: "Mistral.Color" };
  }
  // Minimax
  if (lowerName.startsWith("abab-") || lowerName.startsWith("minimax")) {
    return { name: "Minimax", icon: "Minimax.Color" };
  }

  return null;
}

function inferVendorFromOcoolaiModel(
  modelName: string,
): { name: string; icon?: string } | null {
  const [prefix] = modelName.split("/", 1);
  const normalizedPrefix = prefix.trim().toLowerCase();

  const prefixVendorMap: Record<string, { name: string; icon?: string }> = {
    "01-ai": { name: "01.AI", icon: "Yi" },
    ascend: { name: "Ascend", icon: "Box" },
    azure: { name: "Microsoft", icon: "Azure" },
    baai: { name: "BAAI", icon: "Box" },
    "deepseek-ai": { name: "DeepSeek", icon: "DeepSeek.Color" },
    "ibm-granite": { name: "IBM", icon: "Box" },
    "meta-llama": { name: "Meta", icon: "Ollama" },
    meta: { name: "Meta", icon: "Ollama" },
    mistralai: { name: "Mistral", icon: "Mistral.Color" },
    ocoolai: { name: "Ocoolai", icon: "Box" },
    qwen: { name: "Alibaba", icon: "Qwen.Color" },
    web: { name: "Web", icon: "Globe" },
  };

  if (modelName.includes("/") && prefixVendorMap[normalizedPrefix]) {
    return prefixVendorMap[normalizedPrefix];
  }

  return inferVendorFromModelName(modelName);
}

export type FetchModelsResult = {
  models: LLMModel[];
  total: number;
};

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

/**
 * 从 baseUrl 中提取平台名称用于显示
 */
export function getProviderDisplayName(
  provider: ServiceProvider,
  baseUrl?: string,
): string {
  if (provider !== ServiceProvider.Custom || !baseUrl) {
    return provider;
  }

  try {
    const url = new URL(baseUrl);
    const hostname = url.hostname;

    // 尝试从域名中提取有意义的平台名称
    const parts = hostname.split(".");
    // 移除常见的 TLD 和二级域名
    const cleanParts = parts.filter(
      (part) =>
        !["com", "cn", "org", "net", "io", "ai", "api", "www", "open"].includes(
          part,
        ),
    );

    if (cleanParts.length > 0) {
      // 取第一个有意义的部分，首字母大写
      const name = cleanParts[0];
      return name.charAt(0).toUpperCase() + name.slice(1);
    }

    return hostname;
  } catch {
    return baseUrl;
  }
}

function isAiHubMixUrl(baseUrl?: string) {
  if (!baseUrl) return false;

  try {
    return new URL(baseUrl).hostname === "aihubmix.com";
  } catch {
    return false;
  }
}

/**
 * 检测是否为 YutoAPI (cn.gptapi.asia)
 */
function isYutoApiUrl(baseUrl?: string) {
  if (!baseUrl) return false;

  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === "cn.gptapi.asia" || hostname === "gptapi.asia";
  } catch {
    return false;
  }
}

/**
 * 检测是否为 Ocoolai (one.ocoolai.com)
 */
function isOcoolaiUrl(baseUrl?: string) {
  if (!baseUrl) return false;

  try {
    const hostname = new URL(baseUrl).hostname;
    return (
      hostname === "one.ocoolai.com" ||
      hostname === "ocoolai.com" ||
      hostname === "one.ooo.cool"
    );
  } catch {
    return false;
  }
}

function mapModels(
  models: any[],
  providerId: string,
  providerName: string,
  providerType: string,
  sorted: number,
  vendorsMap?: Record<number, { name: string; icon?: string }>,
  apiKeyGroup?: string,
) {
  let seq = 1000;
  return models.map((m: any) => {
    const modelName = m.id || m.name || m.model_id || m.model_name;
    const normalizedCapabilities = normalizeAiHubMixModelMetadata(m);

    // 提取供应商信息
    let vendor: { id: number; name: string; icon?: string } | undefined;

    // YutoAPI: 有 vendor_id 和 vendors 数组
    if (m.vendor_id !== undefined && vendorsMap) {
      const vendorInfo = vendorsMap[m.vendor_id];
      if (vendorInfo) {
        vendor = {
          id: m.vendor_id,
          name: vendorInfo.name,
          icon: vendorInfo.icon,
        };
      }
    }
    // AiHubMix: 有 developer_id
    else if (m.developer_id !== undefined && vendorsMap) {
      const vendorInfo = vendorsMap[m.developer_id];
      if (vendorInfo) {
        vendor = {
          id: m.developer_id,
          name: vendorInfo.name,
          icon: vendorInfo.icon,
        };
      }
    }
    // Ocoolai / 其他：优先按命名空间前缀分类，再降级到模型名前缀推断
    else {
      const inferred = inferVendorFromOcoolaiModel(modelName);
      if (inferred) {
        vendor = {
          id: -1, // 推断的供应商没有固定 ID
          name: inferred.name,
          icon: inferred.icon,
        };
      }
    }

    return applyModelPublishedAt({
      name: modelName,
      available: true,
      sorted: seq++,
      category: normalizedCapabilities.category,
      categorySource: normalizedCapabilities.categorySource,
      type: normalizedCapabilities.type,
      types: normalizedCapabilities.types,
      features: normalizedCapabilities.features,
      capabilities: normalizedCapabilities.capabilities,
      categories: normalizedCapabilities.categories,
      apiKeyGroup,
      provider: {
        id: providerId,
        providerName: providerName,
        providerType: providerType,
        sorted: sorted,
      },
      vendor,
    });
  });
}

function getYutoApiKeyGroupPriority(modelName: string, groupName?: string) {
  const normalizedGroup = String(groupName || "default")
    .trim()
    .toLowerCase();
  const lowerModelName = modelName.toLowerCase();
  const isClaudeModel = lowerModelName.startsWith("claude");

  if (isClaudeModel) {
    const priorityMap: Record<string, number> = {
      anthropic: 50,
      enterprise: 40,
      discount: 30,
      user: 20,
      default: 10,
    };
    return priorityMap[normalizedGroup] ?? 0;
  }

  const priorityMap: Record<string, number> = {
    enterprise: 50,
    discount: 40,
    user: 30,
    anthropic: 20,
    default: 10,
  };
  return priorityMap[normalizedGroup] ?? 0;
}

export function normalizeAiHubMixModelMetadata(model: any): {
  category?: string;
  categorySource?: 0 | 1;
  type?: string;
  types?: string[];
  features?: string[];
  capabilities?: string[];
  categories?: string[];
} {
  return normalizeModelClassification(model);
}

/**
 * 将相对路径转为完整 URL 用于日志显示
 */
function fullUrl(url: string, baseUrl?: string): string {
  if (url.startsWith("/")) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    // pricing 代理：显示实际目标 URL
    if (url.includes("/proxy/v1/pricing") && baseUrl) {
      return `${origin}${url} → ${baseUrl}/api/pricing`;
    }
    return baseUrl ? `${origin}${url} (代理 → ${baseUrl})` : `${origin}${url}`;
  }
  return url;
}

function isServerSide() {
  return typeof window === "undefined";
}

async function fetchJsonWithCandidates(
  urls: string[],
  headers: Record<string, string>,
  baseUrl?: string,
) {
  let lastError: Error | null = null;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const display = fullUrl(url, baseUrl);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        lastError = new Error(`${response.status} ${response.statusText}`);
        // 404 不显示为错误，而是提示
        if (response.status === 404) {
          console.log(
            `[Fetch Models] 💡 第 ${i + 1} 个 URL 不存在 (404)，尝试下一个...`,
          );
        } else {
          console.log(
            `[Fetch Models] ⚠️ 第 ${i + 1} 个 URL 返回 ${response.status}`,
          );
        }
        continue;
      }

      console.log(`[Fetch Models] ✅ 使用模型接口: ${display}`);
      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("请求失败");
      console.log(`[Fetch Models] ❌ 第 ${i + 1} 个 URL 请求异常:`, error);
    }
  }

  throw lastError ?? new Error("未找到可用的模型接口");
}

/**
 * 从指定供应商获取模型列表
 */
export async function fetchModelsFromProvider(
  provider: ServiceProvider,
  baseUrl?: string,
  apiKey?: string,
  profileName?: string,
  apiKeyGroups?: Record<string, string>,
): Promise<FetchModelsResult> {
  // 构建API路径
  let apiPath = "";
  let providerId = "";
  let providerName = "";
  let providerType = "";
  let sorted = 0;

  switch (provider) {
    case ServiceProvider.OpenAI:
      apiPath = "/api/openai/v1/models";
      providerId = "openai";
      providerName = "OpenAI";
      providerType = "openai";
      sorted = 1;
      break;
    case ServiceProvider.Anthropic:
      // Anthropic 暂不支持公开模型列表API，返回空
      return { models: [], total: 0 };
    case ServiceProvider.Azure:
      apiPath = "/api/azure/openai/deployments";
      providerId = "azure";
      providerName = "Azure";
      providerType = "azure";
      sorted = 2;
      break;
    case ServiceProvider.SiliconFlow:
      apiPath = "/api/siliconflow/v1/models?sub_type=chat";
      providerId = "siliconflow";
      providerName = "SiliconFlow";
      providerType = "siliconflow";
      sorted = 14;
      break;
    case ServiceProvider["302.AI"]:
      apiPath = "/api/302ai/v1/models?llm=1";
      providerId = "ai302";
      providerName = "302.AI";
      providerType = "302ai";
      sorted = 15;
      break;
    case ServiceProvider.DeepSeek:
      apiPath = "/api/deepseek/v1/models";
      providerId = "deepseek";
      providerName = "DeepSeek";
      providerType = "deepseek";
      sorted = 13;
      break;
    case ServiceProvider.XAI:
      apiPath = "/api/xai/v1/models";
      providerId = "xai";
      providerName = "XAI";
      providerType = "xai";
      sorted = 12;
      break;
    case ServiceProvider.Custom:
      // 自定义供应商通过代理获取模型列表
      if (baseUrl) {
        apiPath = "/api/proxy/v1/models";
        providerId = profileName ? `custom_${profileName}` : "custom";
        providerName = "Custom";
        providerType = "openai";
        sorted = 0;
      } else {
        return { models: [], total: 0 };
      }
      break;
    default:
      return { models: [], total: 0 };
  }

  try {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    let data: any;

    if (
      baseUrl &&
      [ServiceProvider.OpenAI, ServiceProvider.Custom].includes(provider)
    ) {
      const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
      const baseWithoutV1 = normalizedBaseUrl.replace(/\/v1$/, "");

      // 为自定义供应商设置 x-base-url header
      if (provider === ServiceProvider.Custom) {
        headers["x-base-url"] = baseUrl;
      }

      // YutoAPI 和 Ocoolai 使用专门的 pricing 接口（通过后端代理避免 CORS）
      const candidateUrls =
        isYutoApiUrl(baseUrl) || isOcoolaiUrl(baseUrl)
          ? isServerSide()
            ? [`${baseWithoutV1}/api/pricing`, `${baseWithoutV1}/pricing`]
            : ["/api/proxy/v1/pricing"]
          : isAiHubMixUrl(baseUrl)
          ? [
              `${new URL(baseUrl).origin}/api/v1/models`,
              `${baseWithoutV1}/v1/models`,
            ]
          : [
              `${baseWithoutV1}/api/v1/models`,
              `${baseWithoutV1}/v1/models`,
              `${baseWithoutV1}/models`,
              `${baseWithoutV1}/api/pricing`,
            ];

      data = await fetchJsonWithCandidates(candidateUrls, headers, baseUrl);
    } else {
      const url = baseUrl ? `${normalizeBaseUrl(baseUrl)}${apiPath}` : apiPath;

      const response = await fetch(url, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.log(
            `[Fetch Models] 💡 ${provider} 不支持模型列表接口 (${url})`,
          );
        } else {
          console.error(
            `[Fetch Models] ❌ 从 ${provider} 获取模型失败: ${response.status}`,
          );
        }
        return { models: [], total: 0 };
      }

      data = await response.json();
    }

    // 标准化模型列表响应
    let models: any[] = [];

    // 提取供应商映射
    let vendorsMap: Record<number, { name: string; icon?: string }> | undefined;

    // YutoAPI: 从 vendors 数组构建映射
    if (data.vendors && Array.isArray(data.vendors)) {
      vendorsMap = {};
      data.vendors.forEach((v: any) => {
        vendorsMap![v.id] = {
          name: v.name,
          icon: v.icon,
        };
      });
    }
    // AiHubMix: 使用预定义的映射表
    else if (isAiHubMixUrl(baseUrl)) {
      vendorsMap = AIHUBMIX_VENDOR_MAP;
    }
    // Ocoolai: 使用模型名推断（在 mapModels 中处理）
    else if (isOcoolaiUrl(baseUrl)) {
      // 不需要特殊处理，mapModels 会推断
    }

    // 检测数据格式
    // YutoAPI 格式: {vendors: [...], data: [{model_name: "...", vendor_id: ..., ...}]}
    // 必须同时有 vendors 数组才能确认是 YutoAPI
    if (
      data.vendors &&
      Array.isArray(data.vendors) &&
      data.data &&
      Array.isArray(data.data) &&
      data.data.length > 0 &&
      data.data[0].model_name
    ) {
      models = data.data;
      console.log(`[Fetch Models] 🎯 检测到 YutoAPI 格式`);
    }
    // Ocoolai 格式: {data: {Models: ["...", "..."]}}
    else if (data.data?.Models && Array.isArray(data.data.Models)) {
      models = data.data.Models.map((name: string) => ({ id: name }));
    }
    // AiHubMix 格式: {data: [{model_id: "...", model_name: "...", developer_id: ...}]}
    else if (
      data.data &&
      Array.isArray(data.data) &&
      data.data.length > 0 &&
      data.data[0].model_id !== undefined &&
      data.data[0].developer_id !== undefined
    ) {
      models = data.data;
    }
    // 标准 OpenAI 格式
    else if (data.data && Array.isArray(data.data)) {
      models = data.data;
    } else if (data.object === "list" && data.data) {
      models = data.data;
    } else if (data.models && Array.isArray(data.models)) {
      models = data.models;
    }

    if (isYutoApiUrl(baseUrl)) {
      const normalizedBaseUrl = normalizeBaseUrl(baseUrl!);
      const baseWithoutV1 = normalizedBaseUrl.replace(/\/v1$/, "");
      const candidateUrls = isServerSide()
        ? [`${baseWithoutV1}/api/pricing`, `${baseWithoutV1}/pricing`]
        : ["/api/proxy/v1/pricing"];
      const groupedEntries = Object.entries(apiKeyGroups || {}).filter(
        ([, value]) => Boolean(value?.trim()),
      );
      const fetchEntries =
        groupedEntries.length > 0
          ? groupedEntries
          : [["default", apiKey || ""]];
      const mergedModelMap = new Map<string, LLMModel>();
      let addedCount = 0;
      let updatedCount = 0;

      for (const [groupName, groupApiKey] of fetchEntries) {
        if (!groupApiKey) continue;
        const groupedHeaders: Record<string, string> = {
          Authorization: `Bearer ${groupApiKey}`,
          ...(baseUrl ? { "x-base-url": baseUrl } : {}),
        };
        const groupedData = await fetchJsonWithCandidates(
          candidateUrls,
          groupedHeaders,
          baseUrl,
        );
        const groupedModels =
          groupedData?.vendors &&
          Array.isArray(groupedData.vendors) &&
          groupedData?.data &&
          Array.isArray(groupedData.data)
            ? groupedData.data
            : [];
        const groupedVendorsMap: Record<
          number,
          { name: string; icon?: string }
        > = {};
        (groupedData?.vendors || []).forEach((vendor: any) => {
          groupedVendorsMap[vendor.id] = {
            name: vendor.name,
            icon: vendor.icon,
          };
        });

        mapModels(
          groupedModels,
          providerId,
          providerName,
          providerType,
          sorted,
          groupedVendorsMap,
          groupName,
        ).forEach((model) => {
          const key = `${model.name}@${model.provider?.id}`;
          const existing = mergedModelMap.get(key);

          if (!existing) {
            addedCount += 1;
            mergedModelMap.set(key, model);
          } else {
            const existingPriority = getYutoApiKeyGroupPriority(
              model.name,
              existing.apiKeyGroup,
            );
            const nextPriority = getYutoApiKeyGroupPriority(
              model.name,
              groupName,
            );

            if (nextPriority > existingPriority) {
              updatedCount += 1;
              mergedModelMap.set(key, { ...model, apiKeyGroup: groupName });
            }
          }
        });
      }

      const mappedModels = [...mergedModelMap.values()];
      console.log(
        `[Models] YutoAPI 分组合并完成: 新增 ${addedCount}，更新 ${updatedCount}，最终 ${mappedModels.length} 个模型`,
      );
      return {
        models: mappedModels,
        total: mappedModels.length,
      };
    }

    if (isAiHubMixUrl(baseUrl)) {
      const mappedModels = mapModels(
        models,
        providerId,
        providerName,
        providerType,
        sorted,
        vendorsMap,
      );
      return {
        models: mappedModels,
        total: mappedModels.length,
      };
    }

    if (isOcoolaiUrl(baseUrl)) {
      const mappedModels = mapModels(
        models,
        providerId,
        providerName,
        providerType,
        sorted,
        vendorsMap,
      );
      return {
        models: mappedModels,
        total: mappedModels.length,
      };
    }

    const mappedModels = mapModels(
      models,
      providerId,
      providerName,
      providerType,
      sorted,
      vendorsMap,
    );
    return {
      models: mappedModels,
      total: mappedModels.length,
    };
  } catch (error) {
    console.error(`[Fetch Models] ❌ 从 ${provider} 获取模型时出错:`, error);
    return { models: [], total: 0 };
  }
}

/**
 * 将模型列表转换为 customModels 字符串格式
 */
export function modelsToCustomModelsString(models: LLMModel[]): string {
  return models
    .map((m) => {
      if (m.provider && m.provider.providerName !== "Custom") {
        return `${m.name}@${m.provider.providerName}`;
      }
      return m.name;
    })
    .join(",");
}

/**
 * 将已获取的模型列表更新到配置
 */
export async function updateModelsInStore(models: LLMModel[]): Promise<string> {
  if (models.length === 0) {
    return "";
  }

  const modelsString = modelsToCustomModelsString(models);

  // 动态导入store（避免循环依赖）
  const { useAccessStore } = await import("../store/access");
  const { useAppConfig } = await import("../store/config");
  const accessStore = useAccessStore.getState();
  const configStore = useAppConfig.getState();

  // 🔥 合并模式：新模型与现有模型合并（只增不减）
  const existingModels = configStore.models || [];
  const modelMap = new Map<string, (typeof existingModels)[0]>();

  // 先添加所有现有模型
  existingModels.forEach((m: any) => {
    const key = `${m.name}@${m.provider?.id}`;
    modelMap.set(key, m);
  });

  // 添加或更新新模型
  models.forEach((m: any) => {
    const key = `${m.name}@${m.provider?.id}`;
    const existing = modelMap.get(key);
    if (existing) {
      modelMap.set(key, { ...existing, ...m, available: m.available });
    } else {
      // 不存在则添加
      modelMap.set(key, m);
    }
  });

  const mergedModels = [...modelMap.values()];

  // 更新 configStore.models 数组
  configStore.mergeModels(mergedModels, { silent: true });

  // 当前启用平台的可用模型只跟随本次真实获取结果，不再叠加历史缓存。
  accessStore.update((state) => {
    state.customModels = modelsString;
    state.apiProfiles = (state.apiProfiles || []).map((profile) =>
      profile.enabled
        ? {
            ...profile,
            cachedModels: modelsString,
            modelCount: models.length,
          }
        : profile,
    );
  });
  const latestAccessState = useAccessStore.getState();
  writeAccessSnapshot({
    useCustomConfig: latestAccessState.useCustomConfig,
    provider: latestAccessState.provider,
    apiProfiles: latestAccessState.apiProfiles,
    customModels: latestAccessState.customModels,
    customUrl: latestAccessState.customUrl,
    customApiKey: latestAccessState.customApiKey,
    customOpenAICompatible: latestAccessState.customOpenAICompatible,
  });

  // 等待一下让持久化完成
  await new Promise((resolve) => setTimeout(resolve, 300));

  return modelsString;
}

/**
 * 获取并更新模型列表到配置
 */
export async function fetchAndUpdateModels(
  provider: ServiceProvider,
  baseUrl?: string,
  apiKey?: string,
): Promise<string> {
  const displayName = getProviderDisplayName(provider, baseUrl);
  console.log(`[Models] 🔍 开始从 ${displayName} 获取模型列表...`);
  const result = await fetchModelsFromProvider(provider, baseUrl, apiKey);

  console.log(
    "[fetchAndUpdateModels] 📊 获取到的模型数量:",
    result.models.length,
  );

  return updateModelsInStore(result.models);
}
