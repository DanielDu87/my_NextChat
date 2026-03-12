import { ServiceProvider } from "../constant";
import { LLMModel } from "../client/api";

/**
 * 从指定供应商获取模型列表
 */
export async function fetchModelsFromProvider(
  provider: ServiceProvider,
  baseUrl?: string,
  apiKey?: string,
): Promise<LLMModel[]> {
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
      return [];
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
        providerId = "custom";
        providerName = "Custom";
        providerType = "openai";
        sorted = 0;
      } else {
        return [];
      }
      break;
    default:
      return [];
  }

  try {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    // 对于自定义供应商，通过代理请求，需要设置 x-base-url header
    const url =
      provider === ServiceProvider.Custom && baseUrl
        ? apiPath // 使用代理路径
        : baseUrl
        ? `${baseUrl}${apiPath}`
        : apiPath;

    // 为自定义供应商设置 x-base-url header
    if (provider === ServiceProvider.Custom && baseUrl) {
      headers["x-base-url"] = baseUrl;
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      console.error(
        `[Fetch Models] Failed to fetch from ${provider}:`,
        response.status,
      );
      return [];
    }

    const data = await response.json();

    // 标准化模型列表响应
    let models: any[] = [];
    if (data.data && Array.isArray(data.data)) {
      models = data.data;
    } else if (data.object === "list" && data.data) {
      models = data.data;
    }

    let seq = 1000;
    return models.map((m: any) => ({
      name: m.id || m.name,
      available: true,
      sorted: seq++,
      provider: {
        id: providerId,
        providerName: providerName,
        providerType: providerType,
        sorted: sorted,
      },
    }));
  } catch (error) {
    console.error(`[Fetch Models] Error fetching from ${provider}:`, error);
    return [];
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
    console.log("[updateModelsInStore] No models fetched, returning");
    return "";
  }

  const modelsString = modelsToCustomModelsString(models);
  console.log(
    "[updateModelsInStore] Models string (first 200 chars):",
    modelsString.substring(0, 200),
  );

  // 动态导入store（避免循环依赖）
  const { useAccessStore } = await import("../store/access");
  const accessStore = useAccessStore.getState();

  console.log(
    "[updateModelsInStore] Before update - accessStore.customModels:",
    accessStore.customModels?.substring(0, 100),
  );

  // 走 store.update，确保持久化格式和更新时间与其他配置写入保持一致。
  accessStore.update((state) => {
    state.customModels = modelsString;
  });

  console.log("[updateModelsInStore] Updated accessStore.customModels");

  // 等待一下让持久化完成
  await new Promise((resolve) => setTimeout(resolve, 300));

  const verifyState = useAccessStore.getState();
  console.log(
    "[updateModelsInStore] Verify after update:",
    verifyState.customModels?.substring(0, 100),
  );

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
  const models = await fetchModelsFromProvider(provider, baseUrl, apiKey);

  console.log("[fetchAndUpdateModels] Fetched models count:", models.length);

  return updateModelsInStore(models);
}
