/**
 * 供应商图标配置
 * 统一管理所有 AI 供应商的图标映射
 *
 * 使用方式：
 * - ui-lib.tsx: Selector 组件的供应商分组过滤器
 * - emoji.tsx: Avatar 组件的模型头像
 */

export const PROVIDER_ICONS: Record<string, string> = {
  // OpenAI
  openai: "/provider-icons/openai.png",
  gpt: "/provider-icons/openai.png",

  // Anthropic / Claude
  anthropic: "/provider-icons/claude-code.png",
  claude: "/provider-icons/claude-code.png",

  // Google / Gemini
  google: "/provider-icons/gemini-bg.svg",
  gemini: "/provider-icons/gemini-bg.svg",
  gemma: "/provider-icons/google.png",

  // xAI / Grok
  xai: "/provider-icons/xai.png",
  grok: "/provider-icons/xai.png",

  // DeepSeek
  deepseek: "/provider-icons/deepseek-bg.svg",

  // Alibaba / Qwen
  alibaba: "/provider-icons/qwen-bg.svg",
  qwen: "/provider-icons/qwen-bg.svg",
  千问: "/provider-icons/qwen-bg.svg",
  阿里巴巴: "/provider-icons/qwen-bg.svg",

  // ByteDance
  bytedance: "/provider-icons/doubao-bg.svg",
  豆包: "/provider-icons/doubao-bg.svg",
  字节跳动: "/provider-icons/doubao-bg.svg",

  // Zhipu
  zhipu: "/provider-icons/zhipu-bg.svg",
  智谱: "/provider-icons/zhipu-bg.svg",

  // 01.AI
  "01.ai": "/provider-icons/lingyi.png",
  "01-ai": "/provider-icons/lingyi.png",
  "01.AI": "/provider-icons/lingyi.png",
  万物: "/provider-icons/lingyi.png",
  lingyi: "/provider-icons/lingyi.png",

  // Moonshot
  moonshot: "/provider-icons/moonshot.png",
  kimi: "/provider-icons/moonshot.png",

  // Minimax
  minimax: "/provider-icons/minimax.png",
  海螺: "/provider-icons/minimax.png",

  // Tencent
  tencent: "/provider-icons/tencent.png",
  腾讯: "/provider-icons/tencent.png",
  hunyuan: "/provider-icons/tencent.png",
  混元: "/provider-icons/tencent.png",

  // Baidu
  baidu: "/provider-icons/baidu.png",
  文心: "/provider-icons/baidu.png",
  wenxin: "/provider-icons/baidu.png",

  // iFlytek
  iflytek: "/provider-icons/iflytek.png",
  讯飞星火: "/provider-icons/iflytek.png",
  讯飞: "/provider-icons/iflytek.png",

  // Cohere
  cohere: "/provider-icons/cohere-official.png",

  // Mistral
  mistral: "/provider-icons/mistral-official.png",

  // Meta
  meta: "/provider-icons/meta-bg.svg",

  // Microsoft
  microsoft: "/provider-icons/microsoft-alt.png",

  // Nvidia
  nvidia: "/provider-icons/nvidia-official.png",

  // Perplexity
  perplexity: "/provider-icons/perplexity-official.png",

  // StepFun
  stepfun: "/provider-icons/stepfun.png",

  // Baai
  baai: "/provider-icons/baai-official.png",

  // Baichuan
  baichuan: "/provider-icons/baichuan-official.png",

  // Ideogram
  ideogram: "/provider-icons/ideogram-official.png",

  // Jina AI
  jina: "/provider-icons/jina-official.png",
  "jina ai": "/provider-icons/jina-official.png",

  // Stability
  stability: "/provider-icons/stability.png",

  // Flux
  flux: "/provider-icons/flux-official.png",

  // Meituan
  meituan: "/provider-icons/meituan-official.png",

  // InclusionAI
  inclusionai: "/provider-icons/inclusionai-official.png",

  // FAL
  fal: "/provider-icons/fal.png",
  "fal.ai": "/provider-icons/fal.png",

  // Luma
  luma: "/provider-icons/luma.png",

  // Kuaishou
  kuaishou: "/provider-icons/kuaishou.png",
  快手: "/provider-icons/kuaishou.png",

  // Midjourney
  midjourney: "/provider-icons/midjourney.png",

  // OpenRouter
  openrouter: "/provider-icons/openrouter.png",

  // Pika
  pika: "/provider-icons/pika.png",

  // Pixverse
  pixverse: "/provider-icons/pixverse.png",

  // Recraft
  recraft: "/provider-icons/recraft.png",

  // Runway
  runway: "/provider-icons/runway.png",

  // Suno
  suno: "/provider-icons/suno.png",

  // Vidu
  vidu: "/provider-icons/vidu.png",

  // Viggle
  viggle: "/provider-icons/viggle.png",

  // Xiaomi
  xiaomi: "/provider-icons/xiaomi.png",

  // Ascend Huawei
  ascend: "/provider-icons/ascend-huawei.png",

  // ChatGLM
  chatglm: "/provider-icons/chatglm.png",

  // Fireworks
  fireworks: "/provider-icons/fireworks-official.png",

  // Groq
  groq: "/provider-icons/groq-official.png",

  // Together
  together: "/provider-icons/together-official.png",

  // Upstage
  upstage: "/provider-icons/upstage-official.png",

  // Yuto
  yuto: "/provider-icons/yuto-official.png",

  // Aihubmix
  aihubmix: "/provider-icons/aihubmix.png",

  // 其他/未分类
  other: "/provider-icons/openai.png",
};

/**
 * 获取供应商图标路径
 */
export function getProviderIcon(provider: string): string | undefined {
  return PROVIDER_ICONS[provider.toLowerCase()];
}
