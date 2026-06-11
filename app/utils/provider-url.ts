import {
  AI302_BASE_URL,
  ALIBABA_BASE_URL,
  ANTHROPIC_BASE_URL,
  BAIDU_BASE_URL,
  BYTEDANCE_BASE_URL,
  CHATGLM_BASE_URL,
  DEEPSEEK_BASE_URL,
  GEMINI_BASE_URL,
  IFLYTEK_BASE_URL,
  MOONSHOT_BASE_URL,
  OPENAI_BASE_URL,
  ServiceProvider,
  SILICONFLOW_BASE_URL,
  STABILITY_BASE_URL,
  TENCENT_BASE_URL,
  XAI_BASE_URL,
} from "../constant";
import { normalizeProviderBaseUrl } from "./url";

export const OFFICIAL_PROVIDER_BASE_URLS: Partial<
  Record<ServiceProvider, string>
> = {
  [ServiceProvider.OpenAI]: OPENAI_BASE_URL,
  [ServiceProvider.Google]: GEMINI_BASE_URL,
  [ServiceProvider.Anthropic]: ANTHROPIC_BASE_URL,
  [ServiceProvider.Baidu]: BAIDU_BASE_URL,
  [ServiceProvider.ByteDance]: BYTEDANCE_BASE_URL,
  [ServiceProvider.Alibaba]: ALIBABA_BASE_URL,
  [ServiceProvider.Tencent]: TENCENT_BASE_URL,
  [ServiceProvider.Moonshot]: MOONSHOT_BASE_URL,
  [ServiceProvider.Stability]: STABILITY_BASE_URL,
  [ServiceProvider.Iflytek]: IFLYTEK_BASE_URL,
  [ServiceProvider.XAI]: XAI_BASE_URL,
  [ServiceProvider.ChatGLM]: CHATGLM_BASE_URL,
  [ServiceProvider.DeepSeek]: DEEPSEEK_BASE_URL,
  [ServiceProvider.SiliconFlow]: SILICONFLOW_BASE_URL,
  [ServiceProvider["302.AI"]]: AI302_BASE_URL,
};

export function getOfficialProviderBaseUrl(
  provider?: ServiceProvider | string,
) {
  return normalizeProviderBaseUrl(
    OFFICIAL_PROVIDER_BASE_URLS[provider as ServiceProvider] || "",
  );
}

export function isOfficialProviderBaseUrlLocked(
  provider?: ServiceProvider | string,
) {
  return Boolean(getOfficialProviderBaseUrl(provider));
}

export function getEffectiveProviderBaseUrl(
  provider: ServiceProvider | string,
  baseUrl?: string,
) {
  return (
    getOfficialProviderBaseUrl(provider) ||
    normalizeProviderBaseUrl(baseUrl || "")
  );
}
