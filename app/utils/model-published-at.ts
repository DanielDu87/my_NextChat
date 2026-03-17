export type ModelPublishedAtSource =
  | "name"
  | "official"
  | "family"
  | "manual"
  | "openrouter"
  | "llm_stats"
  | "huggingface"
  | "artificial_analysis";

export type PublishedAtInfo = {
  publishedAt?: number;
  publishedAtSource?: ModelPublishedAtSource;
  publishedAtUrl?: string;
  publishedAtNote?: string;
};

type PublishedAtRule = {
  pattern: RegExp;
  publishedAt: number;
  source: Exclude<ModelPublishedAtSource, "manual" | "name">;
  url: string;
  note?: string;
};

type SortableModelLike = {
  name?: string;
  title?: string;
  publishedAt?: number;
  sorted?: number;
  order?: number;
};

const RELEASE_DATE_PATTERN =
  /20\d{2}[-_.]?(0[1-9]|1[0-2])[-_.]?([0-2]\d|3[01])/;

// 这些规则只用于官方可追溯的模型家族/系列日期回填。
const PUBLISHED_AT_RULES: PublishedAtRule[] = [
  {
    pattern: /\bgpt-5\.4(?:$|[-_.])|\bgpt-5\.4-(?:pro|high|low)(?:$|[-_.])/i,
    publishedAt: 20260305,
    source: "family",
    url: "https://openai.com/index/introducing-gpt-5-4/",
  },
  {
    pattern: /\bgpt-5\.3-codex(?:$|[-_.])/i,
    publishedAt: 20260205,
    source: "family",
    url: "https://openai.com/index/introducing-gpt-5-3-codex/",
  },
  {
    pattern:
      /\bgpt-5\.3-(?:chat|instant)(?:$|[-_.])|\bgpt-5\.3-chat-latest(?:$|[-_.])/i,
    publishedAt: 20260303,
    source: "family",
    url: "https://openai.com/index/gpt-5-3-instant/",
  },
  {
    pattern: /\bgpt-5\.2-codex(?:$|[-_.])/i,
    publishedAt: 20251218,
    source: "family",
    url: "https://openai.com/index/introducing-gpt-5-2-codex/",
  },
  {
    pattern:
      /\bgpt-5\.2(?:$|[-_.])|\bgpt-5\.2-(?:chat|pro|high|low)(?:$|[-_.])|\bgpt-5\.2-chat-latest(?:$|[-_.])/i,
    publishedAt: 20251211,
    source: "family",
    url: "https://openai.com/index/introducing-gpt-5-2/",
  },
  {
    pattern: /\bgpt-5\.1-codex-max(?:$|[-_.])/i,
    publishedAt: 20251119,
    source: "family",
    url: "https://openai.com/index/gpt-5-1-codex-max-system-card/",
  },
  {
    pattern:
      /\bgpt-5\.1(?:$|[-_.])|\bgpt-5\.1-(?:chat|codex|codex-mini)(?:$|[-_.])|\bgpt-5\.1-chat-latest(?:$|[-_.])/i,
    publishedAt: 20251112,
    source: "family",
    url: "https://openai.com/index/gpt-5-1/",
  },
  {
    pattern: /\bgpt-oss-(?:20b|120b)(?:$|[-_.])/i,
    publishedAt: 20250805,
    source: "family",
    url: "https://openai.com/index/introducing-gpt-oss",
  },
  {
    pattern: /\bgpt-5(?:$|[-_.])/i,
    publishedAt: 20250807,
    source: "family",
    url: "https://openai.com/index/introducing-gpt-5-for-developers",
  },
  {
    pattern: /\bgpt-4\.1(?:$|[-_.])/i,
    publishedAt: 20250414,
    source: "family",
    url: "https://openai.com/index/gpt-4-1/",
  },
  {
    pattern: /\bgpt-4o(?:-mini)?-search-preview(?:$|[-_.])/i,
    publishedAt: 20250311,
    source: "family",
    url: "https://platform.openai.com/docs/models/gpt-4o-search-preview",
    note: "OpenAI 平台文档中的快照日期为 2025-03-11。",
  },
  {
    pattern: /\bchatgpt-4o-latest(?:$|[-_.])/i,
    publishedAt: 20240513,
    source: "family",
    url: "https://openai.com/index/gpt-4o-and-more-tools-to-chatgpt-free/",
    note: "ChatGPT 渠道别名回退到 GPT-4o 首发日期。",
  },
  {
    pattern: /\bgpt-4o-mini(?:$|[-_.])/i,
    publishedAt: 20240718,
    source: "family",
    url: "https://openai.com/index/gpt-4o-mini-advancing-cost-efficient-intelligence/",
  },
  {
    pattern:
      /\bgpt-4-turbo(?:$|[-_.])|\bgpt-4-(?:1106|0125)-preview(?:$|[-_.])/i,
    publishedAt: 20231106,
    source: "family",
    url: "https://openai.com/index/new-models-and-developer-products-announced-at-devday/",
  },
  {
    pattern: /\bgpt-4(?:-32k)?(?:$|[-_.])|\bgpt-4-(?:0314|0613)(?:$|[-_.])/i,
    publishedAt: 20230314,
    source: "family",
    url: "https://openai.com/research/gpt-4/",
  },
  {
    pattern:
      /\bgpt-(?:3[.-]?5|35)-turbo(?:-16k)?(?:$|[-_.])|\bgpt-(?:3[.-]?5|35)-turbo-(?:0125|0301|0613|1106)(?:$|[-_.])|\bgpt-(?:3[.-]?5|35)-turbo-16k-0613(?:$|[-_.])|\bgpt-(?:3[.-]?5|35)-turbo-instruct(?:$|[-_.])|\bgpt-(?:3[.-]?5|35)-0301(?:$|[-_.])/i,
    publishedAt: 20230301,
    source: "family",
    url: "https://openai.com/index/introducing-chatgpt-and-whisper-apis/",
  },
  {
    pattern: /\btext-embedding-ada-002(?:$|[-_.])/i,
    publishedAt: 20221215,
    source: "official",
    url: "https://openai.com/index/new-and-improved-embedding-model/",
  },
  {
    pattern: /\bomni-moderation-latest(?:$|[-_.])/i,
    publishedAt: 20240926,
    source: "official",
    url: "https://openai.com/index/upgrading-the-moderation-api-with-our-new-multimodal-moderation-model/",
  },
  {
    pattern: /\bdall-e-2(?:$|[-_.])/i,
    publishedAt: 20221103,
    source: "official",
    url: "https://openai.com/index/dall-e-2/",
    note: "按 OpenAI API public beta 发布时间写入。",
  },
  {
    pattern: /\bwhisper-1(?:$|[-_.])/i,
    publishedAt: 20230301,
    source: "family",
    url: "https://openai.com/index/introducing-chatgpt-and-whisper-apis/",
  },
  {
    pattern:
      /\b(?:tts-1|tts-1-hd)(?:$|[-_.])|\b(?:tts-1|tts-1-hd)-1106(?:$|[-_.])/i,
    publishedAt: 20231106,
    source: "family",
    url: "https://openai.com/index/new-models-and-developer-products-announced-at-devday/",
  },
  {
    pattern: /\b(?:babbage|davinci)-002(?:$|[-_.])/i,
    publishedAt: 20231106,
    source: "official",
    url: "https://openai.com/index/new-models-and-developer-products-announced-at-devday/",
  },
  {
    pattern:
      /\btext-embedding-3-(?:small|large)(?:$|[-_.])|\btext-moderation-(?:latest|stable)(?:$|[-_.])/i,
    publishedAt: 20240125,
    source: "family",
    url: "https://openai.com/index/new-embedding-models-and-api-updates/",
  },
  {
    pattern: /\bdall-e-3(?:$|[-_.])/i,
    publishedAt: 20231106,
    source: "family",
    url: "https://openai.com/index/new-models-and-developer-products-announced-at-devday/",
  },
  {
    pattern: /\bsora-2(?:-pro)?(?:$|[-_.])/i,
    publishedAt: 20250930,
    source: "family",
    url: "https://openai.com/index/sora-2/",
  },
  {
    pattern: /\bcodex-mini(?:-latest)?(?:$|[-_.])/i,
    publishedAt: 20250516,
    source: "official",
    url: "https://openai.com/index/introducing-codex/",
  },
  {
    pattern: /\bcomputer-use-preview(?:$|[-_.])/i,
    publishedAt: 20250311,
    source: "official",
    url: "https://platform.openai.com/docs/models/computer-use-preview",
  },
  {
    pattern: /\bo4-mini(?:$|[-_.])/i,
    publishedAt: 20250416,
    source: "family",
    url: "https://openai.com/index/introducing-o3-and-o4-mini/",
  },
  {
    pattern: /\bo3-mini(?:$|[-_.])/i,
    publishedAt: 20250131,
    source: "family",
    url: "https://openai.com/research/openai-o3-mini/",
  },
  {
    pattern: /\bo3(?:$|[-_.])/i,
    publishedAt: 20250416,
    source: "family",
    url: "https://openai.com/index/introducing-o3-and-o4-mini/",
  },
  {
    pattern: /\bgpt-4o(?:$|[-_.])/i,
    publishedAt: 20240513,
    source: "family",
    url: "https://openai.com/index/gpt-4o-and-more-tools-to-chatgpt-free/",
  },
  {
    pattern: /\bo1(?:$|[-_.])/i,
    publishedAt: 20240912,
    source: "family",
    url: "https://help.openai.com/en/articles/9624314-model-release-notes",
  },
  {
    pattern: /\bgpt-image-1(?:$|[-_.])/i,
    publishedAt: 20250423,
    source: "family",
    url: "https://openai.com/index/image-generation-api/",
  },
  {
    pattern: /\bgpt-realtime(?:$|[-_.])/i,
    publishedAt: 20250828,
    source: "official",
    url: "https://openai.com/index/introducing-gpt-realtime/",
  },
  {
    pattern: /\badvanced-voice(?:$|[-_.])/i,
    publishedAt: 20240924,
    source: "family",
    url: "https://help.openai.com/en/articles/6825453-chatgpt-release-notes",
    note: "渠道动作名回退到 ChatGPT Advanced Voice 首次公开上线日期。",
  },
  {
    pattern: /\bgpt-image-test(?:$|[-_.])/i,
    publishedAt: 20250423,
    source: "family",
    url: "https://openai.com/index/image-generation-api/",
    note: "渠道测试别名回退到 GPT Image 1 首发日期。",
  },
  {
    pattern: /\bgemini-2[-.]5-(?:pro|flash)(?:$|[-_.])/i,
    publishedAt: 20250617,
    source: "family",
    url: "https://blog.google/products/gemini/gemini-2-5-model-family-expands",
  },
  {
    pattern: /\bgemini-2[-.]5-flash-lite(?:$|[-_.])/i,
    publishedAt: 20250617,
    source: "family",
    url: "https://blog.google/products/gemini/gemini-2-5-model-family-expands",
    note: "具体 Lite 首次预览另有后续更新，这里回退到 2.5 家族正式发布日期。",
  },
  {
    pattern: /\bgemini-2[-.]0-(?:flash|flash-lite|pro)(?:$|[-_.])/i,
    publishedAt: 20250205,
    source: "family",
    url: "https://blog.google/innovation-and-ai/models-and-research/google-deepmind/gemini-model-updates-february-2025/",
  },
  {
    pattern: /\bgemini-1[-.]5-pro(?:$|[-_.])/i,
    publishedAt: 20240215,
    source: "family",
    url: "https://blog.google/innovation-and-ai/products/google-gemini-next-generation-model-february-2024/",
  },
  {
    pattern: /\bgemini-1[-.]5-flash(?:$|[-_.])/i,
    publishedAt: 20240514,
    source: "family",
    url: "https://blog.google/innovation-and-ai/technology/developers-tools/gemini-gemma-developer-updates-may-2024/",
  },
  {
    pattern: /\bgemini-3-(?:pro|pro-preview)(?:$|[-_.])/i,
    publishedAt: 20251118,
    source: "family",
    url: "https://blog.google/products-and-platforms/products/gemini/gemini-3/",
  },
  {
    pattern:
      /\bgemini-3[-.]1-pro(?:$|[-_.])|\bgemini-3[-.]1-pro-preview(?:$|[-_.])/i,
    publishedAt: 20260219,
    source: "family",
    url: "https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-pro/",
  },
  {
    pattern:
      /\bgemini-3-(?:flash|pro)(?:$|[-_.])|\bgemini-3-(?:flash|pro)-(?:preview|image-preview|preview-thinking)(?:$|[-_.])/i,
    publishedAt: 20251217,
    source: "family",
    url: "https://blog.google/products/gemini/gemini-3-flash/",
    note: "缺少单独官方发布日期时，回退到 Gemini 3 首批公开开发者发布时间。",
  },
  {
    pattern: /\bveo3(?:$|[-_.])/i,
    publishedAt: 20250520,
    source: "family",
    url: "https://cloud.google.com/blog/products/ai-machine-learning/announcing-veo-3-imagen-4-and-lyria-2-on-vertex-ai",
  },
  {
    pattern: /\bveo(?:$|[-_.])/i,
    publishedAt: 20241203,
    source: "family",
    url: "https://cloud.google.com/blog/products/ai-machine-learning/introducing-veo-and-imagen-3-on-vertex-ai",
  },
  {
    pattern: /\bimagen-?4(?:$|[-_.])/i,
    publishedAt: 20250520,
    source: "family",
    url: "https://cloud.google.com/blog/products/ai-machine-learning/announcing-veo-3-imagen-4-and-lyria-2-on-vertex-ai",
  },
  {
    pattern: /\bimagen-?3(?:$|[-_.])/i,
    publishedAt: 20241203,
    source: "family",
    url: "https://cloud.google.com/blog/products/ai-machine-learning/introducing-veo-and-imagen-3-on-vertex-ai",
  },
  {
    pattern:
      /\bclaude-sonnet-4-1(?:$|[-_.])|\bclaude-sonnet-4-1-\d{8}(?:$|[-_.])|\bclaude-opus-4-1(?:$|[-_.])/i,
    publishedAt: 20250805,
    source: "family",
    url: "https://docs.anthropic.com/en/release-notes/system-prompts",
  },
  {
    pattern:
      /\bclaude-sonnet-4-(?:5|6)(?:$|[-_.])|\bclaude-opus-4-(?:5|6)(?:$|[-_.])/i,
    publishedAt: 20250522,
    source: "family",
    url: "https://docs.anthropic.com/en/release-notes/system-prompts",
    note: "4.5/4.6 属于渠道别名或包装名时，回退到 Claude 4 首发日期，避免误落到 Claude 3.7。",
  },
  {
    pattern:
      /\bclaude-sonnet-4(?![-_.](?:5|6))(?:$|[-_.])|\bclaude-sonnet-4-0(?:$|[-_.])/i,
    publishedAt: 20250522,
    source: "family",
    url: "https://docs.anthropic.com/en/release-notes/system-prompts",
  },
  {
    pattern:
      /\bclaude-opus-4(?![-_.](?:1|5|6))(?:$|[-_.])|\bclaude-opus-4-0(?:$|[-_.])/i,
    publishedAt: 20250522,
    source: "family",
    url: "https://docs.anthropic.com/en/release-notes/system-prompts",
  },
  {
    pattern: /\bclaude[-_.]?3[-_.]?7[-_.]?sonnet(?:$|[-_.])/i,
    publishedAt: 20250224,
    source: "family",
    url: "https://www.anthropic.com/news/claude-3-7-sonnet",
  },
  {
    pattern: /\bclaude[-_.]?3[-_.]?5[-_.]?haiku(?:$|[-_.])/i,
    publishedAt: 20241022,
    source: "family",
    url: "https://docs.anthropic.com/en/release-notes/system-prompts",
  },
  {
    pattern: /\bclaude[-_.]?3[-_.]?5[-_.]?sonnet(?:$|[-_.])/i,
    publishedAt: 20240620,
    source: "family",
    url: "https://www.anthropic.com/news/claude-3-5-sonnet",
  },
  {
    pattern: /\bclaude[-_.]?3(?:$|[-_.])/i,
    publishedAt: 20240229,
    source: "family",
    url: "https://www.anthropic.com/news/claude-3-family",
  },
  {
    pattern: /\bclaude[-_.]?2(?:[.-]?[01])?(?:$|[-_.])/i,
    publishedAt: 20230711,
    source: "family",
    url: "https://www.anthropic.com/news/claude-2",
  },
  {
    pattern: /\bclaude[-_.]?instant[-_.]?1(?:[.-]?2)?(?:$|[-_.])/i,
    publishedAt: 20230809,
    source: "family",
    url: "https://www.anthropic.com/news/releasing-claude-instant-1-2",
  },
  {
    pattern: /\bgrok-4\.1(?:$|[-_.])|\bgrok-4-1(?:$|[-_.])/i,
    publishedAt: 20251117,
    source: "family",
    url: "https://x.ai/news/grok-4-1",
  },
  {
    pattern:
      /\bgrok-4-fast(?:$|[-_.])|\bgrok-4\.1-fast(?:$|[-_.])|\bgrok-4-1-fast(?:$|[-_.])/i,
    publishedAt: 20250919,
    source: "family",
    url: "https://x.ai/news/grok-4-fast",
  },
  {
    pattern: /\bgrok-4(?:$|[-_.])|\bgrok-4-heavy(?:$|[-_.])/i,
    publishedAt: 20250707,
    source: "family",
    url: "https://x.ai/grok/",
  },
  {
    pattern: /\bgrok-video-3(?:$|[-_.])/i,
    publishedAt: 20260128,
    source: "family",
    url: "https://x.ai/news/grok-imagine-api",
    note: "缺少独立模型发布日期时，回退到 xAI 官方视频生成 API 首发日期。",
  },
  {
    pattern: /\bgrok-(?:vision-)?beta(?:$|[-_.])/i,
    publishedAt: 20241104,
    source: "family",
    url: "https://x.ai/news/api/",
    note: "grok-beta 与 grok-vision-beta 缺少独立日期时，回退到 xAI API Public Beta 公告日期。",
  },
  {
    pattern: /\bgrok-3(?:$|[-_.])/i,
    publishedAt: 20250219,
    source: "family",
    url: "https://x.ai/blog/grok-3",
  },
  {
    pattern: /\bgrok-2(?:$|[-_.])/i,
    publishedAt: 20241212,
    source: "family",
    url: "https://x.ai/news/grok-1212/",
  },
  {
    pattern: /\bgrok-code-fast-1(?:$|[-_.])/i,
    publishedAt: 20250828,
    source: "family",
    url: "https://x.ai/news/grok-code-fast-1",
  },
  {
    pattern: /\bdeepseek-v3\.2-exp(?:$|[-_.])/i,
    publishedAt: 20250929,
    source: "family",
    url: "https://api-docs.deepseek.com/news/news250929",
  },
  {
    pattern: /\bdeepseek-v3\.2(?:$|[-_.])/i,
    publishedAt: 20251201,
    source: "family",
    url: "https://api-docs.deepseek.com/news/news251201",
  },
  {
    pattern: /\bdeepseek-v3\.1-terminus(?:$|[-_.])/i,
    publishedAt: 20250922,
    source: "family",
    url: "https://api-docs.deepseek.com/updates/",
  },
  {
    pattern: /\bdeepseek-v3\.1(?:$|[-_.])/i,
    publishedAt: 20250821,
    source: "family",
    url: "https://api-docs.deepseek.com/news/news250821",
  },
  {
    pattern: /\bdeepseek-r1(?:$|[-_.])/i,
    publishedAt: 20250120,
    source: "family",
    url: "https://api-docs.deepseek.com/news/news250120",
  },
  {
    pattern: /\bdeepseek-v3(?:$|[-_.])/i,
    publishedAt: 20241226,
    source: "family",
    url: "https://api-docs.deepseek.com/news/news1226",
  },
  {
    pattern: /\bqwen3-coder(?:$|[-_.])/i,
    publishedAt: 20250722,
    source: "family",
    url: "https://qwenlm.github.io/blog/qwen3-coder/",
  },
  {
    pattern: /\bqwen3-embedding(?:$|[-_.])/i,
    publishedAt: 20250605,
    source: "family",
    url: "https://qwenlm.github.io/blog/qwen3-embedding/",
  },
  {
    pattern: /\bqwen-mt(?:$|[-_.])/i,
    publishedAt: 20250724,
    source: "family",
    url: "https://qwenlm.github.io/blog/qwen-mt/",
  },
  {
    pattern: /\bqwen2\.5-omni(?:$|[-_.])/i,
    publishedAt: 20250327,
    source: "family",
    url: "https://qwenlm.github.io/blog/qwen2.5-omni/",
  },
  {
    pattern: /\bqwen2\.5-vl(?:$|[-_.])/i,
    publishedAt: 20250126,
    source: "family",
    url: "https://qwenlm.github.io/blog/qwen2.5-vl/",
  },
  {
    pattern: /\bqwen3(?:$|[-_.])/i,
    publishedAt: 20250429,
    source: "family",
    url: "https://qwenlm.github.io/blog/qwen3/",
  },
  {
    pattern: /\bqwq-32b(?:$|[-_.])/i,
    publishedAt: 20250306,
    source: "family",
    url: "https://qwenlm.github.io/blog/qwen3/",
    note: "缺少单独官方发布时间时，回退到 Qwen 系列 2025 年推理代际发布日期。",
  },
  {
    pattern: /\bqwen2\.5(?:$|[-_.])/i,
    publishedAt: 20250126,
    source: "family",
    url: "https://qwenlm.github.io/blog/qwen2.5-vl/",
    note: "缺少单独官方发布时间时，回退到可确认的 2.5 代官方发布时间。",
  },
  {
    pattern: /\bqwen2(?:$|[-_.])/i,
    publishedAt: 20240607,
    source: "family",
    url: "https://qwenlm.github.io/blog/qwen/",
  },
  {
    pattern: /\bqwen(?:$|[-_.])/i,
    publishedAt: 20230803,
    source: "family",
    url: "https://qwenlm.github.io/blog/qwen/",
  },
  {
    pattern: /\bmoonshot-v1(?:$|[-_.])/i,
    publishedAt: 20240131,
    source: "family",
    url: "https://platform.moonshot.ai/blog/posts/kimi-latest",
    note: "moonshot-v1 系列缺少独立单模发布日期时，回退到开放平台公测首发日期。",
  },
  {
    pattern: /\bkimi-k2(?:$|[-_.])/i,
    publishedAt: 20250711,
    source: "family",
    url: "https://platform.moonshot.ai/blog/posts/changelog",
  },
  {
    pattern: /\bkimi(?:$|[-_.])/i,
    publishedAt: 20250520,
    source: "family",
    url: "https://platform.moonshot.ai/blog/posts/changelog",
    note: "缺少独立发布时间时，回退到 Moonshot Open Platform 可确认发布时间。",
  },
  {
    pattern: /\bdoubao-(?:1[-.]5-pro|pro|lite)(?:$|[-_.])/i,
    publishedAt: 20250122,
    source: "family",
    url: "https://developer.volcengine.com/articles/7462939272262189083",
  },
  {
    pattern:
      /\bdoubao-(?:1[-.]5-thinking|1[-.]5-thinking-vision-pro|1[-.]5-vision-pro)(?:$|[-_.])/i,
    publishedAt: 20250417,
    source: "family",
    url: "https://developer.volcengine.com/articles/7496711749128618020",
  },
  {
    pattern:
      /\bdoubao-seed-1[-.]6(?:$|[-_.])|\bdoubao-seed-1[-.]6-(?:flash|thinking)(?:$|[-_.])/i,
    publishedAt: 20250611,
    source: "family",
    url: "https://developer.volcengine.com/articles/7534023665457823780",
  },
  {
    pattern: /\bminimax-m2-1(?:$|[-_.])|\bminimax-m2\.1(?:$|[-_.])/i,
    publishedAt: 20260119,
    source: "family",
    url: "https://www.minimax.io/news/kilo-%E6%90%BA%E6%89%8B-minimax-%E5%8F%91%E5%B8%83%E7%BC%96%E7%A8%8B%E6%96%B0%E4%BA%A7%E5%93%81-kilo-for-slack",
  },
  {
    pattern: /\bminimax-m2-5(?:$|[-_.])|\bminimax-m2\.5(?:$|[-_.])/i,
    publishedAt: 20260212,
    source: "family",
    url: "https://www.minimax.io/news/minimax-m25",
  },
  {
    pattern: /\bminimax-m2(?:$|[-_.])/i,
    publishedAt: 20251027,
    source: "family",
    url: "https://www.minimax.io/news/minimax-m2",
  },
  {
    pattern: /\bglm-5(?:$|[-_.])/i,
    publishedAt: 20260212,
    source: "family",
    url: "https://docs.bigmodel.cn/cn/update/new-releases",
  },
  {
    pattern: /\bglm-4-7(?:$|[-_.])|\bglm-4\.7(?:$|[-_.])/i,
    publishedAt: 20260119,
    source: "family",
    url: "https://docs.bigmodel.cn/cn/update/new-releases",
  },
  {
    pattern: /\b(?:coding-)?glm-4-6(?:$|[-_.])|\bglm-4\.6(?:$|[-_.])/i,
    publishedAt: 20250930,
    source: "family",
    url: "https://docs.bigmodel.cn/cn/update",
  },
  {
    pattern: /\bglm-4-5(?:$|[-_.])|\bglm-4\.5(?:$|[-_.])/i,
    publishedAt: 20250728,
    source: "family",
    url: "https://docs.bigmodel.cn/cn/update/new-releases",
  },
  {
    pattern:
      /\bglm-4-(?:air|airx|flash|flashx)(?:$|[-_.])|\bglm-z1-(?:air|airx|flash)(?:$|[-_.])/i,
    publishedAt: 20250414,
    source: "family",
    url: "https://docs.bigmodel.cn/cn/update/new-releases",
    note: "渠道名省略日期后缀时，回退到智谱 2025-04-14 同批发布日。",
  },
  {
    pattern: /\bjina-embeddings-v5-text-(?:small|nano)(?:$|[-_.])/i,
    publishedAt: 20260218,
    source: "family",
    url: "https://jina.ai/models/jina-embeddings-v5-text-small/",
  },
  {
    pattern: /\bjina-embeddings-v4(?:$|[-_.])/i,
    publishedAt: 20250624,
    source: "family",
    url: "https://jina.ai/models/jina-embeddings-v4/",
  },
  {
    pattern: /\bjina-embeddings-v3(?:$|[-_.])/i,
    publishedAt: 20240918,
    source: "family",
    url: "https://jina.ai/models/jina-embeddings-v3/",
  },
  {
    pattern: /\bjina-reranker-v3(?:$|[-_.])/i,
    publishedAt: 20251001,
    source: "family",
    url: "https://jina.ai/models/jina-reranker-v3/",
  },
  {
    pattern: /\bjina-reranker-m0(?:$|[-_.])/i,
    publishedAt: 20250408,
    source: "family",
    url: "https://jina.ai/models/jina-reranker-m0/",
  },
  {
    pattern: /\bjina-reranker-v2-base-multilingual(?:$|[-_.])/i,
    publishedAt: 20240625,
    source: "family",
    url: "https://jina.ai/models/jina-reranker-v2-base-multilingual/",
  },
  {
    pattern: /\bjina-clip-v2(?:$|[-_.])/i,
    publishedAt: 20241105,
    source: "family",
    url: "https://jina.ai/models/jina-clip-v2/",
  },
  {
    pattern: /\bjina-colbert-v2(?:$|[-_.])/i,
    publishedAt: 20240831,
    source: "family",
    url: "https://jina.ai/models/jina-colbert-v2/",
  },
  {
    pattern:
      /\bideogram-(?:edit|generate|reframe|remix|replace-background)-v3(?:$|[-_.])/i,
    publishedAt: 20250326,
    source: "family",
    url: "https://about.ideogram.ai/3.0",
  },
  {
    pattern:
      /(?:^|[\/_-])recraftv3(?:$|[\/_-])|\brecraft-ai\/recraft-v3(?:-svg)?(?:$|[-_.])/i,
    publishedAt: 20241030,
    source: "family",
    url: "https://www.recraft.ai/blog/recraft-introduces-a-revolutionary-ai-model-that-thinks-in-design-language",
  },
  {
    pattern:
      /(?:^|[\/_-])v[_-]?2(?:a|_turbo|a_turbo|turbo)?(?:$|[\/_-])|(?:^|[\/_-])ideogram[-_.]?2(?:\.0)?(?:$|[\/_-])/i,
    publishedAt: 20240821,
    source: "family",
    url: "https://about.ideogram.ai/2.0",
  },
  {
    pattern:
      /(?:^|[\/_-])v[_-]?1(?:_turbo|turbo)?(?:$|[\/_-])|\bdescribe(?:$|[-_.])|\bupscale(?:$|[-_.])/i,
    publishedAt: 20240228,
    source: "family",
    url: "https://about.ideogram.ai/1.0",
    note: "Ideogram 1.x 动作名未区分升级节点时，先回退到 1.0 首发日期。",
  },
  {
    pattern: /\bideogram-ai\/ideogram-v2-turbo(?:$|[-_.])/i,
    publishedAt: 20240821,
    source: "family",
    url: "https://docs.ideogram.ai/using-ideogram/generation-settings/available-models",
  },
  {
    pattern: /\bsuno(?:$|[_-].+)/i,
    publishedAt: 20240321,
    source: "family",
    url: "https://about.suno.com/blog/v3",
    note: "Suno 动作名/包装名缺少独立日期时，回退到 v3 正式发布日。",
  },
  {
    pattern: /\b(?:kling|kolors)(?:$|[-_.])|\b(?:kling|kolors)[-_]/i,
    publishedAt: 20240725,
    source: "family",
    url: "https://ir.kuaishou.com/news-releases/news-release-details/kuaishou-launches-full-beta-testing-kling-ai-global-users-0",
    note: "Kling/Kolors 动作名与渠道名缺少独立日期时，回退到 Kling AI 官方全球公测日期。",
  },
  {
    pattern:
      /\bflux-2-(?:pro|flex|max|dev)(?:$|[-_.])|\bbfl\/flux-2-(?:pro|flex|max)(?:$|[-_.])/i,
    publishedAt: 20251125,
    source: "family",
    url: "https://bfl.ai/blog",
    note: "缺少独立发布日期时，回退到 FLUX.2 官方发布日。",
  },
  {
    pattern:
      /\bflux-pro-1\.1-ultra(?:$|[-_.])|\bbfl\/flux-pro-1\.1-ultra(?:$|[-_.])|\bblack-forest-labs\/flux-1\.1-pro-ultra(?:$|[-_.])/i,
    publishedAt: 20241106,
    source: "family",
    url: "https://bfl.ai/announcements/24-11-06-ultra",
  },
  {
    pattern:
      /\bflux(?:[-_.]?1\.1|[-_.]1[-_.]1)-?pro(?:$|[-_.])|\bflux[.-]?1[.-]?1-pro(?:$|[-_.])|\bblack-forest-labs\/flux-1\.1-pro(?:$|[-_.])/i,
    publishedAt: 20241002,
    source: "family",
    url: "https://bfl.ai/blog/24-10-02-flux",
  },
  {
    pattern:
      /\bflux(?:[-_.]1)?(?:[-_.]1)?-?1?-?pro(?:$|[-_.])|\bflux-pro(?:$|[-_.])|\bbfl\/flux-pro(?:$|[-_.])|\bblack-forest-labs\/flux-pro(?:$|[-_.])/i,
    publishedAt: 20240801,
    source: "family",
    url: "https://bfl.ai/blog/24-08-01-bfl",
  },
  {
    pattern:
      /\bflux(?:[-_.]1)?(?:[-_.]1)?-?1?-?dev(?:$|[-_.])|\bflux-dev(?:$|[-_.])|\bbfl\/flux-dev(?:$|[-_.])|\bblack-forest-labs\/flux-dev(?:$|[-_.])|\bflux-schnell(?:$|[-_.])|\bblack-forest-labs\/flux-schnell(?:$|[-_.])/i,
    publishedAt: 20240801,
    source: "family",
    url: "https://bfl.ai/blog/24-08-01-bfl",
  },
  {
    pattern:
      /\bflux(?:[-_.]1)?-(?:fill|depth|canny|redux)(?:$|[-_.])|\bblack-forest-labs\/flux-(?:fill|depth|canny|redux)-(?:dev|pro)(?:$|[-_.])/i,
    publishedAt: 20241101,
    source: "family",
    url: "https://bfl.ai/flux-1-tools/",
  },
  {
    pattern: /\brunway(?:$|[-_.])/i,
    publishedAt: 20250403,
    source: "family",
    url: "https://runwayml.com/news/runway-series-d-funding",
  },
  {
    pattern:
      /\brunwayml-gen4[_-]?turbo(?:$|[-_.])|\bgen-?4[_-]?turbo(?:$|[-_.])/i,
    publishedAt: 20250401,
    source: "family",
    url: "https://runwayml.com/changelog",
  },
  {
    pattern:
      /\brunwayml-gen3a[_-]?turbo(?:$|[-_.])|\bgen-?3(?:[-_.]?alpha)?[_-]?turbo(?:$|[-_.])/i,
    publishedAt: 20240916,
    source: "family",
    url: "https://runwayml.com/news/introducing-the-runway-api",
  },
  {
    pattern:
      /\bstable-diffusion-3[-_.]?2b(?:$|[-_.])|\bstable-diffusion-3[-_.]?medium(?:$|[-_.])/i,
    publishedAt: 20240612,
    source: "family",
    url: "https://stability.ai/news/stable-diffusion-3-medium",
  },
  {
    pattern: /\bstable-diffusion-3[-_.]?5[-_.]?large(?:$|[-_.])/i,
    publishedAt: 20241114,
    source: "family",
    url: "https://stability.ai/news/stable-diffusion-3-5-large-is-now-available-in-amazon-sagemaker-jumpstart",
  },
  {
    pattern:
      /\b(?:stability-ai\/)?sdxl(?:$|[-_.])|\bstable-diffusion-xl(?:$|[-_.])/i,
    publishedAt: 20230726,
    source: "family",
    url: "https://stability.ai/news/stable-diffusion-sdxl-1-announcement",
  },
  {
    pattern:
      /\b(?:stability-ai\/)?stable-diffusion(?:$|[-_.])|\bstable-diffusion(?:-img2img|-inpainting|-animation)?(?:$|[-_.])/i,
    publishedAt: 20220822,
    source: "family",
    url: "https://stability.ai/news/celebrating-one-year-of-stable-diffusion",
  },
  {
    pattern: /\baleph(?:$|[-_.])/i,
    publishedAt: 20250801,
    source: "family",
    url: "https://docs.dev.runwayml.com/api-details/api_changelog/",
  },
  {
    pattern: /\bact-two(?:$|[-_.])/i,
    publishedAt: 20250721,
    source: "family",
    url: "https://docs.dev.runwayml.com/api-details/api_changelog/",
  },
  {
    pattern: /\bray-?2(?:$|[-_.])/i,
    publishedAt: 20250115,
    source: "family",
    url: "https://lumalabs.ai/changelog/introducing-ray2",
  },
  {
    pattern: /\bflux[-.]1[-_.]kontext(?:$|[-_.])|\bflux-kontext(?:$|[-_.])/i,
    publishedAt: 20250529,
    source: "family",
    url: "https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev",
    note: "未命中官方新闻页时，回退到首个可确认公开发布的官方/官方分发页面时间。",
  },
];

export function normalizePublishedAt(publishedAt?: unknown) {
  if (typeof publishedAt === "number" && Number.isFinite(publishedAt)) {
    return publishedAt;
  }
  if (typeof publishedAt === "string" && /^\d{8}$/.test(publishedAt)) {
    return Number(publishedAt);
  }
  return undefined;
}

export function extractPublishedAtFromName(name?: string) {
  if (!name) return undefined;
  const match = name.toLowerCase().match(RELEASE_DATE_PATTERN);
  if (!match) return undefined;
  return Number(match[0].replace(/[-_.]/g, ""));
}

export function resolvePublishedAtFromName(name?: string): PublishedAtInfo {
  const publishedAt = extractPublishedAtFromName(name);
  if (!publishedAt) return {};
  return {
    publishedAt,
    publishedAtSource: "name",
  };
}

export function resolvePublishedAtFromRules(name?: string): PublishedAtInfo {
  if (!name) return {};
  const matched = PUBLISHED_AT_RULES.find((rule) => rule.pattern.test(name));
  if (!matched) return {};
  return {
    publishedAt: matched.publishedAt,
    publishedAtSource: matched.source,
    publishedAtUrl: matched.url,
    publishedAtNote: matched.note,
  };
}

export function resolveModelPublishedAt(
  model: Record<string, unknown>,
): PublishedAtInfo {
  const existingPublishedAt = normalizePublishedAt(model.publishedAt);
  if (existingPublishedAt && model.publishedAtSource === "manual") {
    return {
      publishedAt: existingPublishedAt,
      publishedAtSource: "manual",
      publishedAtUrl:
        typeof model.publishedAtUrl === "string"
          ? model.publishedAtUrl
          : undefined,
      publishedAtNote:
        typeof model.publishedAtNote === "string"
          ? model.publishedAtNote
          : undefined,
    };
  }

  const name = String(model.name || model.id || model.model_name || "");
  const fromName = resolvePublishedAtFromName(name);
  if (fromName.publishedAt) {
    return fromName;
  }

  return resolvePublishedAtFromRules(name);
}

export function applyModelPublishedAt<T extends Record<string, unknown>>(
  model: T,
) {
  return {
    ...model,
    ...resolveModelPublishedAt(model),
  };
}

function getSortableName(model?: SortableModelLike) {
  return model?.name || model?.title || "";
}

function getSortTokens(text: string) {
  const normalized = text.toLowerCase();
  const versionMatches = Array.from(
    normalized.matchAll(/\d+(?:\.\d+)+|\d{2,4}/g),
  ).map((match) => match[0]);

  return {
    normalized,
    versions: versionMatches.map((value) =>
      value.split(".").map((part) => Number(part)),
    ),
  };
}

function getPrimaryVersion(versions: number[][]) {
  if (versions.length === 0) return [];

  const semanticVersions = versions.filter((parts) => parts.length > 1);
  const candidates = semanticVersions.length > 0 ? semanticVersions : versions;

  return candidates.reduce((best, current) => {
    const maxParts = Math.max(best.length, current.length);
    for (let i = 0; i < maxParts; i += 1) {
      const diff = (current[i] ?? -1) - (best[i] ?? -1);
      if (diff > 0) return current;
      if (diff < 0) return best;
    }
    return best;
  }, candidates[0]);
}

function comparePrimaryVersion(left: number[], right: number[]) {
  const maxLength = Math.max(left.length, right.length);
  for (let i = 0; i < maxLength; i += 1) {
    const diff = (right[i] ?? -1) - (left[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function comparePublishedAt(
  left?: SortableModelLike,
  right?: SortableModelLike,
) {
  const leftPublishedAt =
    left?.publishedAt ?? extractPublishedAtFromName(getSortableName(left)) ?? 0;
  const rightPublishedAt =
    right?.publishedAt ??
    extractPublishedAtFromName(getSortableName(right)) ??
    0;
  if (rightPublishedAt !== leftPublishedAt) {
    return rightPublishedAt - leftPublishedAt;
  }

  const leftVersion = getPrimaryVersion(
    getSortTokens(getSortableName(left)).versions,
  );
  const rightVersion = getPrimaryVersion(
    getSortTokens(getSortableName(right)).versions,
  );
  const versionDiff = comparePrimaryVersion(leftVersion, rightVersion);
  if (versionDiff !== 0) {
    return versionDiff;
  }

  const leftSorted = left?.order ?? left?.sorted ?? Number.MAX_SAFE_INTEGER;
  const rightSorted = right?.order ?? right?.sorted ?? Number.MAX_SAFE_INTEGER;
  if (leftSorted !== rightSorted) {
    return leftSorted - rightSorted;
  }

  return getSortableName(left).localeCompare(
    getSortableName(right),
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    },
  );
}
