/**
 * 供应商图标配置
 * 统一管理所有 AI 供应商的图标映射
 *
 * 使用方式：
 * - ui-lib.tsx: Selector 组件的供应商分组过滤器
 * - emoji.tsx: Avatar 组件的模型头像
 */

/**
 * 供应商图标映射表（规范键 → 图标路径）
 * 规范键为小写，与 getProviderIcon 的 toLowerCase 匹配
 */
export const PROVIDER_ICONS: Record<string, string> = {
  // AI21
  ai21: "/provider-icons/ai21-bg.svg",
  "ai21 labs": "/provider-icons/ai21-bg.svg",
  "ai21-labs": "/provider-icons/ai21-bg.svg",
  jamba: "/provider-icons/ai21-bg.svg",

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
  doubao: "/provider-icons/doubao-bg.svg",
  volc: "/provider-icons/doubao-bg.svg",
  volcengine: "/provider-icons/doubao-bg.svg",
  ark: "/provider-icons/doubao-bg.svg",
  豆包: "/provider-icons/doubao-bg.svg",
  字节跳动: "/provider-icons/doubao-bg.svg",
  火山引擎: "/provider-icons/doubao-bg.svg",

  // Zhipu
  zhipu: "/provider-icons/zhipu-bg.svg",
  "zhipu ai": "/provider-icons/zhipu-bg.svg",
  "z.ai": "/provider-icons/zhipu-bg.svg",
  智谱: "/provider-icons/zhipu-bg.svg",

  // 01.AI / 零一万物
  "01.ai": "/provider-icons/lingyi-bg.svg",
  "01-ai": "/provider-icons/lingyi-bg.svg",
  "01.AI": "/provider-icons/lingyi-bg.svg",
  零一万物: "/provider-icons/lingyi-bg.svg",
  万物: "/provider-icons/lingyi-bg.svg",
  lingyi: "/provider-icons/lingyi-bg.svg",
  "01ai": "/provider-icons/lingyi-bg.svg",

  // Moonshot
  moonshot: "/provider-icons/moonshot-bg.svg",
  kimi: "/provider-icons/moonshot-bg.svg",

  // Minimax
  minimax: "/provider-icons/minimax-bg.svg",
  "hailuo ai": "/provider-icons/minimax-bg.svg",
  海螺: "/provider-icons/minimax-bg.svg",

  // Tencent / 腾讯混元
  tencent: "/provider-icons/hunyuan-bg.svg",
  "tencent hunyuan": "/provider-icons/hunyuan-bg.svg",
  腾讯: "/provider-icons/hunyuan-bg.svg",
  hunyuan: "/provider-icons/hunyuan-bg.svg",
  混元: "/provider-icons/hunyuan-bg.svg",
  腾讯混元: "/provider-icons/hunyuan-bg.svg",

  // Baidu / 文心一言
  baidu: "/provider-icons/wenxin-bg.svg",
  ernie: "/provider-icons/wenxin-bg.svg",
  文心: "/provider-icons/wenxin-bg.svg",
  文心一言: "/provider-icons/wenxin-bg.svg",
  wenxin: "/provider-icons/wenxin-bg.svg",

  // iFlytek
  iflytek: "/provider-icons/iflytek.png",
  "iflytek spark": "/provider-icons/iflytek.png",
  讯飞星火: "/provider-icons/iflytek.png",
  讯飞: "/provider-icons/iflytek.png",

  // Cohere
  cohere: "/provider-icons/cohere-official.png",

  // ElevenLabs
  elevenlabs: "/provider-icons/elevenlabs.svg",

  // Mistral
  mistral: "/provider-icons/mistral-official.png",

  // Meta
  meta: "/provider-icons/meta-bg.svg",

  // Microsoft
  microsoft: "/provider-icons/microsoft-alt.png",

  // IBM / Granite
  ibm: "/provider-icons/ibm-bg.svg",
  "ibm granite": "/provider-icons/ibm-bg.svg",
  "ibm-granite": "/provider-icons/ibm-bg.svg",
  granite: "/provider-icons/ibm-bg.svg",

  // Amazon / Bedrock
  amazon: "/provider-icons/amazon-bg.svg",
  aws: "/provider-icons/amazon-bg.svg",
  bedrock: "/provider-icons/amazon-bg.svg",
  "amazon bedrock": "/provider-icons/amazon-bg.svg",
  "amazon-bedrock": "/provider-icons/amazon-bg.svg",

  // Nvidia
  nvidia: "/provider-icons/nvidia-bg.svg",

  // Perplexity
  perplexity: "/provider-icons/perplexity-bg.svg",

  // StepFun
  stepfun: "/provider-icons/stepfun.png",
  "stepfun ai": "/provider-icons/stepfun.png",
  "stepfun al": "/provider-icons/stepfun.png",
  "stepfun-ai": "/provider-icons/stepfun.png",
  "step fun": "/provider-icons/stepfun.png",
  阶跃: "/provider-icons/stepfun.png",
  stepfunai: "/provider-icons/stepfun.png",

  // SiliconFlow
  siliconflow: "/provider-icons/siliconflow-bg.svg",
  "silicon flow": "/provider-icons/siliconflow-bg.svg",
  硅基流动: "/provider-icons/siliconflow-bg.svg",

  // Baai
  baai: "/provider-icons/baai-bg.svg",

  // Baichuan
  baichuan: "/provider-icons/baichuan-bg.svg",

  // Ideogram
  ideogram: "/provider-icons/ideogram-bg.svg",

  // Jina AI
  jina: "/provider-icons/jina-bg.svg",
  "jina ai": "/provider-icons/jina-bg.svg",

  // Stability
  stability: "/provider-icons/stability-bg.svg",

  // Flux
  flux: "/provider-icons/flux-official.png",

  // Meituan
  meituan: "/provider-icons/meituan-bg.svg",

  // InclusionAI
  inclusionai: "/provider-icons/inclusionai-bg.svg",

  // FAL
  fal: "/provider-icons/fal.png",
  "fal.ai": "/provider-icons/fal.png",

  // Luma
  luma: "/provider-icons/luma.png",

  // Mureka
  mureka: "/provider-icons/mureka.png",

  // Kuaishou
  kuaishou: "/provider-icons/kuaishou.png",
  快手: "/provider-icons/kuaishou.png",
  kling: "/provider-icons/kuaishou.png",
  "kling ai": "/provider-icons/kuaishou.png",
  kwaipilot: "/provider-icons/kwaipilot-bg.svg",
  "kwaipilot ai": "/provider-icons/kwaipilot-bg.svg",
  "kwai kolors": "/provider-icons/kwaipilot-bg.svg",
  kolors: "/provider-icons/kwaipilot-bg.svg",
  kat: "/provider-icons/kwaipilot-bg.svg",
  "kat coder": "/provider-icons/kwaipilot-bg.svg",
  "kat-coder": "/provider-icons/kwaipilot-bg.svg",
  "kat dev": "/provider-icons/kwaipilot-bg.svg",
  "kat-dev": "/provider-icons/kwaipilot-bg.svg",

  // Midjourney
  midjourney: "/provider-icons/midjourney.png",

  // OpenRouter
  openrouter: "/provider-icons/openrouter-bg.svg",

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
  xiaomi: "/provider-icons/xiaomi-bg.svg",

  // Ascend Huawei
  ascend: "/provider-icons/ascend-huawei.png",

  // ChatGLM
  chatglm: "/provider-icons/zhipu-bg.svg",

  // Upstage
  upstage: "/provider-icons/upstage-bg.svg",

  // Aihubmix
  aihubmix: "/provider-icons/aihubmix-bg.svg",

  // TheDrummer / Thedrumn
  thedrummer: "/provider-icons/thedrummer-bg.svg",
  thedrumn: "/provider-icons/thedrummer-bg.svg",
  drummer: "/provider-icons/thedrummer-bg.svg",
  drumn: "/provider-icons/thedrummer-bg.svg",

  // Aion Labs
  aionlabs: "/provider-icons/aionlabs-bg.svg",
  "aion labs": "/provider-icons/aionlabs-bg.svg",

  // Allen Institute for AI
  allenai: "/provider-icons/allenai-bg.svg",
  "allen ai": "/provider-icons/allenai-bg.svg",
  "allen institute": "/provider-icons/allenai-bg.svg",

  // Anthracite / Anthracite Org (HuggingFace community)
  anthracite: "/provider-icons/anthracite-bg.svg",
  "anthracite org": "/provider-icons/anthracite-org-bg.svg",
  "anthracite-org": "/provider-icons/anthracite-org-bg.svg",
  magnum: "/provider-icons/anthracite-org-bg.svg",

  // Arcee AI
  arcee: "/provider-icons/arcee-bg.svg",
  "arcee ai": "/provider-icons/arcee-bg.svg",

  // Cognitive Computations
  cognitivecom: "/provider-icons/cognitivecom-bg.svg",
  cognitivecomputations: "/provider-icons/cognitivecom-bg.svg",

  // Deepcogito
  deepcogito: "/provider-icons/deepcogito-bg.svg",

  // Gryphe
  gryphe: "/provider-icons/gryphe-bg.svg",

  // ByteDance Seed (merged with general Doubao)
  "bytedance seed": "/provider-icons/doubao-bg.svg",
  seed: "/provider-icons/doubao-bg.svg",

  // Inception
  inception: "/provider-icons/inception-bg.svg",

  // Inflection
  inflection: "/provider-icons/inflection-bg.svg",

  // Liquid
  liquid: "/provider-icons/liquid-bg.svg",

  // Mancer
  mancer: "/provider-icons/mancer-bg.svg",

  // Morph
  morph: "/provider-icons/morph-bg.svg",

  // Nex Agi
  "nex agi": "/provider-icons/nexagi-bg.svg",
  nexagi: "/provider-icons/nexagi-bg.svg",

  // Nousresearch
  nousresearch: "/provider-icons/nousresearch-bg.svg",
  nous: "/provider-icons/nousresearch-bg.svg",

  // Perceptron
  perceptron: "/provider-icons/perceptron-bg.svg",

  // Poolside
  poolside: "/provider-icons/poolside-bg.svg",

  // Rekaai
  rekaai: "/provider-icons/rekaai-bg.svg",

  // Relace
  relace: "/provider-icons/relace-bg.svg",

  // Sakana
  sakana: "/provider-icons/sakana-bg.svg",
  "sakana ai": "/provider-icons/sakana-bg.svg",

  // Sao10k
  sao10k: "/provider-icons/sao10k-bg.svg",
  "sao 10k": "/provider-icons/sao10k-bg.svg",

  // Undi95
  undi95: "/provider-icons/undi95-bg.svg",

  // Writer
  writer: "/provider-icons/writer-bg.svg",
};

const CANONICAL_PROVIDER_KEY_BY_ICON = Object.entries(PROVIDER_ICONS).reduce(
  (canonicalKeys, [key, icon]) => {
    if (!canonicalKeys.has(icon)) {
      canonicalKeys.set(icon, key);
    }
    return canonicalKeys;
  },
  new Map<string, string>(),
);

/**
 * 返回共享图标映射中同一品牌的稳定键。所有同图标别名都会得到相同结果，
 * 供模型选择器等分组入口合并旧缓存和上游不同写法。
 */
export function getCanonicalProviderKey(provider: string): string | undefined {
  const icon = getProviderIcon(provider);
  return icon ? CANONICAL_PROVIDER_KEY_BY_ICON.get(icon) : undefined;
}

/**
 * getModelGroup 返回值到规范键的映射
 * 处理如 "Tencent Hunyuan" -> "tencent" 等格式
 */
const MODEL_GROUP_TO_CANONICAL_KEY: Record<string, string> = {
  // 分组名（带空格/特殊字符）-> 规范小写键
  "tencent hunyuan": "tencent",
  "01.ai": "01ai",
  "iflytek spark": "iflytek",
  "01ai": "01ai",
  stepfunai: "stepfun",
};

/**
 * 获取供应商图标路径
 * 支持：
 * 1. 直接小写匹配（如 "openai", "gpt", "deepseek"）
 * 2. 带空格的分组名（如 "Tencent Hunyuan" -> "tencent"）
 * 3. getModelGroup 返回值自动转换
 */
export function getProviderIcon(provider: string): string | undefined {
  const normalized = provider.toLowerCase();

  // 1. 直接匹配
  if (PROVIDER_ICONS[normalized]) {
    return PROVIDER_ICONS[normalized];
  }

  // 2. 通过分组映射转换后再匹配
  const canonicalKey = MODEL_GROUP_TO_CANONICAL_KEY[normalized];
  if (canonicalKey && PROVIDER_ICONS[canonicalKey]) {
    return PROVIDER_ICONS[canonicalKey];
  }

  // 3. 尝试去除空格后匹配（如 "TencentHunyuan" -> "tencent"）
  const noSpaces = normalized.replace(/\s+/g, "");
  if (PROVIDER_ICONS[noSpaces]) {
    return PROVIDER_ICONS[noSpaces];
  }

  return undefined;
}
