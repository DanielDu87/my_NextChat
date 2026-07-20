import { ServiceProvider } from "@/app/constant";

export type DrawParamKey =
  | "prompt"
  | "model"
  | "negative_prompt"
  | "aspect_ratio"
  | "image_size"
  | "quality"
  | "resolution"
  | "seed"
  | "guidance_scale"
  | "thinking_mode"
  | "thinking_level"
  | "prompt_extend"
  | "magic_prompt"
  | "optimize_prompt_mode"
  | "web_search"
  | "watermark"
  | "safety_tolerance"
  | "prompt_upsampling"
  | "enable_translation"
  | "n"
  | "rendering_speed"
  | "input_fidelity"
  | "moderation"
  | "output_format"
  | "response_format"
  | "background"
  | "output_compression"
  | "person_generation"
  | "style"
  | "style_preset"
  | "style_type";

export type DrawSelectOption = {
  name: string;
  value: string;
};

export type DrawNumberRange = {
  min?: number;
  max?: number;
  float?: boolean;
};

export type DrawParamRule = {
  family: string;
  provider: string;
  supported: Set<DrawParamKey>;
  defaults: Partial<Record<DrawParamKey, string | number | boolean>>;
  options: Partial<Record<DrawParamKey, DrawSelectOption[]>>;
  ranges: Partial<Record<DrawParamKey, DrawNumberRange>>;
};

export type DrawParamDefinition = {
  name: string;
  value: DrawParamKey;
  type: "select" | "number" | "textarea";
  default?: string | number | boolean;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  sub?: string;
  help?: string;
  min?: number;
  max?: number;
  float?: boolean;
  options?: DrawSelectOption[];
};

export const DRAW_PARAM_KEYS: DrawParamKey[] = [
  "prompt",
  "model",
  "negative_prompt",
  "aspect_ratio",
  "image_size",
  "quality",
  "resolution",
  "seed",
  "guidance_scale",
  "thinking_mode",
  "thinking_level",
  "prompt_extend",
  "magic_prompt",
  "optimize_prompt_mode",
  "web_search",
  "watermark",
  "safety_tolerance",
  "prompt_upsampling",
  "enable_translation",
  "n",
  "rendering_speed",
  "input_fidelity",
  "moderation",
  "output_format",
  "response_format",
  "background",
  "output_compression",
  "person_generation",
  "style",
  "style_preset",
  "style_type",
];

const ALWAYS_SUPPORTED: DrawParamKey[] = ["prompt", "model"];

const option = (value: string, name = value): DrawSelectOption => ({
  name,
  value,
});

const sizeOption = (value: string) => option(value, value.replace("x", " x "));

export const DRAW_ASPECT_RATIO_OPTIONS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "4:5",
  "5:4",
  "21:9",
  "9:21",
  "4:1",
  "1:4",
  "8:1",
  "1:8",
].map((value) => option(value));

export const DRAW_GEMINI_STANDARD_ASPECT_RATIO_OPTIONS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
].map((value) => option(value));

// Gemini 3.1 Flash Image（Nano Banana 2）官方支持的 14 种宽高比，
// 额外放开 4:1/8:1/1:4/1:8 这类超宽/超高比例，不支持 9:21。
export const DRAW_GEMINI_31_ASPECT_RATIO_OPTIONS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "4:5",
  "5:4",
  "21:9",
  "4:1",
  "1:4",
  "8:1",
  "1:8",
].map((value) => option(value));

// Gemini 3.1 Flash Image 的思考级别，minimal 为默认低延迟，high 用于复杂构图。
export const DRAW_GEMINI_THINKING_LEVEL_OPTIONS = [
  option("minimal", "快速"),
  option("high", "深度"),
];

export const DRAW_OPENAI_SIZE_OPTIONS = [
  option("auto", "自动"),
  option("1024x1024", "1024 x 1024"),
  option("1536x1024", "1536 x 1024"),
  option("1024x1536", "1024 x 1536"),
];

export const DRAW_OPENAI_GPT_IMAGE_2_SIZE_OPTIONS = [
  ...DRAW_OPENAI_SIZE_OPTIONS,
  option("1536x864", "1536 x 864"),
  option("864x1536", "864 x 1536"),
  option("2048x1152", "2048 x 1152"),
  option("1152x2048", "1152 x 2048"),
  option("2560x1440", "2560 x 1440"),
  option("1440x2560", "1440 x 2560"),
  option("2048x2048", "2048 x 2048"),
  option("3840x2160", "3840 x 2160"),
  option("2160x3840", "2160 x 3840"),
];

export const DRAW_DALLE_3_SIZE_OPTIONS = [
  option("1024x1024", "1024 x 1024"),
  option("1792x1024", "1792 x 1024"),
  option("1024x1792", "1024 x 1792"),
];

export const DRAW_DALLE_2_SIZE_OPTIONS = [
  option("256x256", "256 x 256"),
  option("512x512", "512 x 512"),
  option("1024x1024", "1024 x 1024"),
];

export const DRAW_QWEN_SIZE_OPTIONS = [
  option("2048x2048", "2048 x 2048"),
  option("2688x1536", "2688 x 1536"),
  option("1536x2688", "1536 x 2688"),
  option("2368x1728", "2368 x 1728"),
  option("1728x2368", "1728 x 2368"),
  option("1024x1024", "1024 x 1024"),
];

export const DRAW_QWEN_PLUS_SIZE_OPTIONS = [
  option("1664x928", "1664 x 928"),
  option("1472x1104", "1472 x 1104"),
  option("1328x1328", "1328 x 1328"),
  option("1104x1472", "1104 x 1472"),
  option("928x1664", "928 x 1664"),
];

export const DRAW_GLM_SIZE_OPTIONS = [
  option("1280x1280", "1280 x 1280"),
  option("1568x1056", "1568 x 1056"),
  option("1056x1568", "1056 x 1568"),
  option("1472x1088", "1472 x 1088"),
  option("1088x1472", "1088 x 1472"),
  option("1728x960", "1728 x 960"),
  option("960x1728", "960 x 1728"),
];

export const DRAW_COGVIEW_SIZE_OPTIONS = [
  option("1024x1024", "1024 x 1024"),
  option("768x1344", "768 x 1344"),
  option("864x1152", "864 x 1152"),
  option("1344x768", "1344 x 768"),
  option("1152x864", "1152 x 864"),
  option("1440x720", "1440 x 720"),
  option("720x1440", "720 x 1440"),
];

export const DRAW_FLUX_2_SIZE_OPTIONS = [
  option("1024x1024", "1024 x 1024"),
  option("1536x1024", "1536 x 1024"),
  option("1024x1536", "1024 x 1536"),
  option("2048x2048", "2048 x 2048"),
];

export const DRAW_FLUX_KONTEXT_ASPECT_RATIO_OPTIONS = [
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
].map((value) => option(value));

export const DRAW_RESOLUTION_OPTIONS = ["512", "1K", "2K", "4K"].map((value) =>
  option(value),
);

export const DRAW_GEMINI_3_PRO_RESOLUTION_OPTIONS = ["1K", "2K", "4K"].map(
  (value) => option(value),
);

export const DRAW_WAN_27_PRO_RESOLUTION_OPTIONS = ["1K", "2K", "4K"].map(
  (value) => option(value),
);

export const DRAW_WAN_27_RESOLUTION_OPTIONS = ["1K", "2K"].map((value) =>
  option(value),
);

export const DRAW_WAN_26_T2I_SIZE_OPTIONS = [
  "1280x1280",
  "800x1200",
  "1200x800",
  "960x1280",
  "1280x960",
  "720x1280",
  "1280x720",
  "1344x576",
].map(sizeOption);

export const DRAW_WAN_25_SIZE_OPTIONS = [
  "1280x1280",
  "1104x1472",
  "1472x1104",
  "960x1696",
  "1696x960",
].map(sizeOption);

export const DRAW_WAN_LEGACY_SIZE_OPTIONS = [
  "1024x1024",
  "720x1280",
  "1280x720",
  "768x1152",
  "1152x768",
  "768x1024",
  "1024x768",
].map(sizeOption);

export const DRAW_WANX_V1_SIZE_OPTIONS = [
  "1024x1024",
  "720x1280",
  "768x1152",
  "1280x720",
].map(sizeOption);

export const DRAW_WANX_V1_STYLE_OPTIONS = [
  option("<auto>", "自动"),
  option("<photography>", "摄影"),
  option("<portrait>", "人像"),
  option("<3d cartoon>", "3D 卡通"),
  option("<anime>", "动画"),
  option("<oil painting>", "油画"),
  option("<watercolor>", "水彩"),
  option("<sketch>", "素描"),
  option("<chinese painting>", "中国画"),
  option("<flat illustration>", "扁平插画"),
];

export const DRAW_IMAGEN_RESOLUTION_OPTIONS = ["1K", "2K"].map((value) =>
  option(value),
);

export const DRAW_DOUBAO_SIZE_OPTIONS = [
  option("2048x2048", "2048 x 2048"),
  option("1024x1024", "1024 x 1024"),
];

export const DRAW_DOUBAO_5_SIZE_OPTIONS = [
  option("2048x2048", "2048 x 2048"),
  option("2K"),
  option("3K"),
  option("2560x1440", "2560 x 1440"),
  option("1440x2560", "1440 x 2560"),
  option("3072x3072", "3072 x 3072"),
];

export const DRAW_DOUBAO_45_SIZE_OPTIONS = [
  option("2048x2048", "2048 x 2048"),
  option("2K"),
  option("4K"),
  option("2560x1440", "2560 x 1440"),
  option("1440x2560", "1440 x 2560"),
  option("4096x4096", "4096 x 4096"),
];

export const DRAW_DOUBAO_40_SIZE_OPTIONS = [
  option("2048x2048", "2048 x 2048"),
  option("1K"),
  option("2K"),
  option("4K"),
  option("1280x720", "1280 x 720"),
  option("720x1280", "720 x 1280"),
  option("4096x4096", "4096 x 4096"),
];

export const DRAW_DOUBAO_30_SIZE_OPTIONS = [
  option("1024x1024", "1024 x 1024"),
  option("512x512", "512 x 512"),
  option("1536x1024", "1536 x 1024"),
  option("1024x1536", "1024 x 1536"),
  option("2048x2048", "2048 x 2048"),
];

export const DRAW_GPT_IMAGE_QUALITY_OPTIONS = [
  option("auto", "自动"),
  option("low", "低"),
  option("medium", "中"),
  option("high", "高"),
];

export const DRAW_DALLE_QUALITY_OPTIONS = [
  option("standard", "标准"),
  option("hd", "高清"),
];

export const DRAW_OUTPUT_FORMAT_OPTIONS = ["png", "jpeg", "webp"].map((value) =>
  option(value.toLowerCase(), value.toUpperCase()),
);

export const DRAW_DOUBAO_OUTPUT_FORMAT_OPTIONS = ["png", "jpeg"].map((value) =>
  option(value, value.toUpperCase()),
);

export const DRAW_RESPONSE_FORMAT_OPTIONS = [
  option("url", "URL"),
  option("b64_json", "Base64 JSON"),
];

export const DRAW_DOUBAO_OPTIMIZE_PROMPT_MODE_OPTIONS = [
  option("standard", "标准"),
  option("fast", "快速"),
];

export const DRAW_DOUBAO_STANDARD_PROMPT_MODE_OPTIONS = [
  option("standard", "标准"),
];

export const DRAW_OPENAI_BACKGROUND_OPTIONS = [
  option("auto", "自动"),
  option("opaque", "不透明"),
  option("transparent", "透明"),
];

// gpt-image-2 官方暂不支持透明背景，只保留 auto/opaque。
export const DRAW_GPT_IMAGE_2_BACKGROUND_OPTIONS = [
  option("auto", "自动"),
  option("opaque", "不透明"),
];

export const DRAW_DALLE_STYLE_OPTIONS = [
  option("vivid", "生动"),
  option("natural", "自然"),
];

export const DRAW_PERSON_GENERATION_OPTIONS = [
  option("allow_adult", "允许成人"),
  option("dont_allow", "不允许人物"),
  option("allow_all", "允许所有人物"),
];

export const DRAW_RENDERING_SPEED_OPTIONS = [
  option("DEFAULT", "默认"),
  option("FLASH", "Flash"),
  option("TURBO", "Turbo"),
  option("QUALITY", "Quality"),
];

// Ideogram V3/V4 渲染速度，官方 FLASH 档位在 Generate 端点会返回 400，不开放。
export const DRAW_IDEOGRAM_RENDERING_SPEED_OPTIONS = [
  option("DEFAULT", "默认"),
  option("TURBO", "Turbo"),
  option("QUALITY", "Quality"),
];

export const DRAW_IDEOGRAM_V4_RESOLUTION_OPTIONS = [
  "2048x2048",
  "1440x2880",
  "2880x1440",
  "1664x2496",
  "2496x1664",
  "1792x2240",
  "2240x1792",
  "1440x2560",
  "2560x1440",
  "1600x2560",
  "2560x1600",
  "1728x2304",
  "2304x1728",
  "1296x3168",
  "3168x1296",
  "1152x2944",
  "2944x1152",
  "1248x3328",
  "3328x1248",
  "1280x3072",
  "3072x1280",
  "1024x3072",
  "3072x1024",
].map(sizeOption);

export const DRAW_IDEOGRAM_V3_ASPECT_RATIO_OPTIONS = [
  "1:3",
  "3:1",
  "1:2",
  "2:1",
  "9:16",
  "16:9",
  "10:16",
  "16:10",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "1:1",
].map((value) => option(value));

// Ideogram V3 官方风格类型，仅 4 项；不同于旧版的 style_preset 大预设表。
export const DRAW_IDEOGRAM_V3_STYLE_TYPE_OPTIONS = [
  option("AUTO", "自动"),
  option("GENERAL", "通用"),
  option("REALISTIC", "写实"),
  option("DESIGN", "设计"),
];

// Ideogram V3 提示词增强开关，AUTO 由模型自动判断是否增强。
export const DRAW_IDEOGRAM_MAGIC_PROMPT_OPTIONS = [
  option("AUTO", "自动"),
  option("ON", "开启"),
  option("OFF", "关闭"),
];

export const DRAW_IDEOGRAM_STYLE_PRESET_OPTIONS = [
  option("", "默认"),
  option("80S_ILLUSTRATION", "80s Illustration"),
  option("90S_NOSTALGIA", "90s Nostalgia"),
  option("ABSTRACT_ORGANIC", "Abstract Organic"),
  option("ANALOG_NOSTALGIA", "Analog Nostalgia"),
  option("ART_BRUT", "Art Brut"),
  option("ART_DECO", "Art Deco"),
  option("ART_POSTER", "Art Poster"),
  option("AURA", "Aura"),
  option("AVANT_GARDE", "Avant Garde"),
  option("BAUHAUS", "Bauhaus"),
  option("BLUEPRINT", "Blueprint"),
  option("BLURRY_MOTION", "Blurry Motion"),
  option("BRIGHT_ART", "Bright Art"),
  option("C4D_CARTOON", "C4D Cartoon"),
  option("CHILDRENS_BOOK", "Children's Book"),
  option("COLLAGE", "Collage"),
  option("COLORING_BOOK_I", "Coloring Book I"),
  option("COLORING_BOOK_II", "Coloring Book II"),
  option("CUBISM", "Cubism"),
  option("DARK_AURA", "Dark Aura"),
  option("DOODLE", "Doodle"),
  option("DOUBLE_EXPOSURE", "Double Exposure"),
  option("DRAMATIC_CINEMA", "Dramatic Cinema"),
  option("EDITORIAL", "Editorial"),
  option("EMOTIONAL_MINIMAL", "Emotional Minimal"),
  option("ETHEREAL_PARTY", "Ethereal Party"),
  option("EXPIRED_FILM", "Expired Film"),
  option("FLAT_ART", "Flat Art"),
  option("FLAT_VECTOR", "Flat Vector"),
  option("FOREST_REVERIE", "Forest Reverie"),
  option("GEO_MINIMALIST", "Geo Minimalist"),
  option("GLASS_PRISM", "Glass Prism"),
  option("GOLDEN_HOUR", "Golden Hour"),
  option("GRAFFITI_I", "Graffiti I"),
  option("GRAFFITI_II", "Graffiti II"),
  option("HALFTONE_PRINT", "Halftone Print"),
  option("HIGH_CONTRAST", "High Contrast"),
  option("HIPPIE_ERA", "Hippie Era"),
  option("ICONIC", "Iconic"),
  option("JAPANDI_FUSION", "Japandi Fusion"),
  option("JAZZY", "Jazzy"),
  option("LONG_EXPOSURE", "Long Exposure"),
  option("MAGAZINE_EDITORIAL", "Magazine Editorial"),
  option("MINIMAL_ILLUSTRATION", "Minimal Illustration"),
  option("MIXED_MEDIA", "Mixed Media"),
  option("MONOCHROME", "Monochrome"),
  option("NIGHTLIFE", "Nightlife"),
  option("OIL_PAINTING", "Oil Painting"),
  option("OLD_CARTOONS", "Old Cartoons"),
  option("PAINT_GESTURE", "Paint Gesture"),
  option("POP_ART", "Pop Art"),
  option("RETRO_ETCHING", "Retro Etching"),
  option("RIVIERA_POP", "Riviera Pop"),
  option("SPOTLIGHT_80S", "Spotlight 80s"),
  option("STYLIZED_RED", "Stylized Red"),
  option("SURREAL_COLLAGE", "Surreal Collage"),
  option("TRAVEL_POSTER", "Travel Poster"),
  option("VINTAGE_GEO", "Vintage Geo"),
  option("VINTAGE_POSTER", "Vintage Poster"),
  option("WATERCOLOR", "Watercolor"),
  option("WEIRD", "Weird"),
  option("WOODBLOCK_PRINT", "Woodblock Print"),
];

export const DRAW_STABILITY_STYLE_PRESET_OPTIONS = [
  option("", "默认"),
  option("3d-model", "3D Model"),
  option("analog-film", "Analog Film"),
  option("anime", "Anime"),
  option("cinematic", "Cinematic"),
  option("comic-book", "Comic Book"),
  option("digital-art", "Digital Art"),
  option("enhance", "Enhance"),
  option("fantasy-art", "Fantasy Art"),
  option("isometric", "Isometric"),
  option("line-art", "Line Art"),
  option("low-poly", "Low Poly"),
  option("neon-punk", "Neon Punk"),
  option("origami", "Origami"),
  option("photographic", "Photographic"),
  option("pixel-art", "Pixel Art"),
  option("tile-texture", "Tile Texture"),
];

// Draw 页面与全局“参数设置”共用这一份字段定义；模型支持范围、默认值、
// 选项和数值边界继续由下方 DrawParamRule 动态覆盖，避免两个页面再次分叉。
export const DRAW_GENERATION_PARAM_DEFINITIONS: DrawParamDefinition[] = [
  {
    name: "否定提示词",
    value: "negative_prompt",
    type: "textarea",
    placeholder: "输入不希望出现在画面中的元素",
    rows: 3,
    sub: "写入不希望出现在画面中的元素。",
  },
  {
    name: "画面比例",
    value: "aspect_ratio",
    type: "select",
    default: "1:1",
    help: "控制生成图片的画面比例（Flux/Ideogram 等模型使用）。",
    options: DRAW_ASPECT_RATIO_OPTIONS,
  },
  {
    name: "图像尺寸",
    value: "image_size",
    type: "select",
    default: "1024x1024",
    help: "选择生成图片的宽高尺寸。",
    options: [
      sizeOption("1024x1024"),
      sizeOption("1024x1536"),
      sizeOption("1536x1024"),
      sizeOption("768x1344"),
      sizeOption("1344x768"),
      sizeOption("512x512"),
    ],
  },
  {
    name: "图像质量",
    value: "quality",
    type: "select",
    default: "auto",
    help: "控制生成质量，质量越高通常耗时或成本越高。",
    options: [
      ...DRAW_GPT_IMAGE_QUALITY_OPTIONS,
      option("standard", "标准"),
      option("hd", "高清"),
    ],
  },
  {
    name: "图片风格",
    value: "style",
    type: "select",
    default: "vivid",
    help: "按当前模型发送对应的图片风格参数。",
    options: DRAW_DALLE_STYLE_OPTIONS,
  },
  {
    name: "分辨率",
    value: "resolution",
    type: "select",
    default: "2K",
    help: "选择模型生成时使用的分辨率档位。",
    options: DRAW_RESOLUTION_OPTIONS,
  },
  {
    name: "背景",
    value: "background",
    type: "select",
    default: "auto",
    help: "GPT-Image 支持的背景参数。",
    options: DRAW_OPENAI_BACKGROUND_OPTIONS,
  },
  {
    name: "输出压缩",
    value: "output_compression",
    type: "number",
    default: 100,
    min: 0,
    max: 100,
    help: "GPT-Image 在 JPEG/WebP 输出时支持的压缩质量。",
  },
  {
    name: "人物生成",
    value: "person_generation",
    type: "select",
    default: "allow_adult",
    help: "Imagen 支持的人物生成策略。",
    options: DRAW_PERSON_GENERATION_OPTIONS,
  },
  {
    name: "Seed",
    value: "seed",
    type: "number",
    default: 0,
    min: 0,
    max: 4294967294,
    help: "相同 Seed 更容易复现接近的构图；0 表示自动。",
  },
  {
    name: "思考模式",
    value: "thinking_mode",
    type: "select",
    default: "true",
    help: "Wan2.7 系列支持思考模式，提升生成质量但增加耗时。",
    options: [option("true", "开启"), option("false", "关闭")],
  },
  {
    name: "思考级别",
    value: "thinking_level",
    type: "select",
    default: "minimal",
    help: "Gemini 3.1 Flash Image 支持，high 用于复杂构图但更慢。",
    options: DRAW_GEMINI_THINKING_LEVEL_OPTIONS,
  },
  {
    name: "提示词智能改写",
    value: "prompt_extend",
    type: "select",
    default: "true",
    help: "Qwen-Image、Wan2.6 支持提示词智能改写。",
    options: [option("true", "开启"), option("false", "关闭")],
  },
  {
    name: "提示词增强",
    value: "magic_prompt",
    type: "select",
    default: "AUTO",
    help: "Ideogram V3 提示词增强，AUTO 由模型自动判断。",
    options: DRAW_IDEOGRAM_MAGIC_PROMPT_OPTIONS,
  },
  {
    name: "水印",
    value: "watermark",
    type: "select",
    default: "false",
    help: "是否在生成的图片中添加水印。",
    options: [option("false", "关闭"), option("true", "开启")],
  },
  {
    name: "安全审核容忍度",
    value: "safety_tolerance",
    type: "number",
    default: 2,
    min: 0,
    max: 6,
    help: "Flux 模型安全审核宽松度，0 最严格，6 最宽松。",
  },
  {
    name: "提示词增强",
    value: "prompt_upsampling",
    type: "select",
    default: "false",
    help: "Flux-1.1-pro 是否对提示词进行增强优化。",
    options: [option("false", "关闭"), option("true", "开启")],
  },
  {
    name: "中文翻译",
    value: "enable_translation",
    type: "select",
    default: "true",
    help: "FluxAPI Kontext 是否启用中文提示词自动翻译。",
    options: [option("true", "开启"), option("false", "关闭")],
  },
  {
    name: "生成数量",
    value: "n",
    type: "number",
    default: 1,
    min: 1,
    max: 10,
    help: "一次生成图片数量（部分模型支持）。",
  },
  {
    name: "渲染速度/质量",
    value: "rendering_speed",
    type: "select",
    default: "DEFAULT",
    help: "Ideogram 渲染质量偏好。",
    options: DRAW_RENDERING_SPEED_OPTIONS,
  },
  {
    name: "保真度",
    value: "input_fidelity",
    type: "select",
    default: "low",
    help: "GPT-Image 图生图模式的输入保真度。",
    options: [option("low", "低"), option("high", "高")],
  },
  {
    name: "内容审核",
    value: "moderation",
    type: "select",
    default: "auto",
    help: "GPT-Image 内容审核严格程度。",
    options: [option("auto", "标准"), option("low", "宽松")],
  },
  {
    name: "输出格式",
    value: "output_format",
    type: "select",
    default: "png",
    help: "选择生成图片的保存格式。",
    options: DRAW_OUTPUT_FORMAT_OPTIONS,
  },
  {
    name: "返回格式",
    value: "response_format",
    type: "select",
    default: "url",
    help: "支持 URL 或 Base64 JSON 返回的模型使用。",
    options: DRAW_RESPONSE_FORMAT_OPTIONS,
  },
  {
    name: "指导系数",
    value: "guidance_scale",
    type: "number",
    default: 2.5,
    min: 1,
    max: 10,
    float: true,
    help: "Seedream 3.0 t2i 支持，范围 1-10。",
  },
  {
    name: "提示词优化模式",
    value: "optimize_prompt_mode",
    type: "select",
    default: "standard",
    help: "Seedream 4.0/4.5/5.0 lite 支持的提示词优化模式。",
    options: DRAW_DOUBAO_OPTIMIZE_PROMPT_MODE_OPTIONS,
  },
  {
    name: "联网搜索",
    value: "web_search",
    type: "select",
    default: "false",
    help: "Seedream 5.0 lite 支持的 web_search 工具。",
    options: [option("false", "关闭"), option("true", "开启")],
  },
  {
    name: "风格预设",
    value: "style_preset",
    type: "select",
    default: "",
    help: "Stability 图片生成支持的风格预设。",
    options: DRAW_STABILITY_STYLE_PRESET_OPTIONS,
  },
  {
    name: "风格类型",
    value: "style_type",
    type: "select",
    default: "AUTO",
    help: "Ideogram V3 官方风格类型。",
    options: DRAW_IDEOGRAM_V3_STYLE_TYPE_OPTIONS,
  },
];

function makeRule(
  family: string,
  provider: string,
  fields: DrawParamKey[],
  defaults: DrawParamRule["defaults"] = {},
  options: DrawParamRule["options"] = {},
  ranges: DrawParamRule["ranges"] = {},
): DrawParamRule {
  return {
    family,
    provider,
    supported: new Set([...ALWAYS_SUPPORTED, ...fields]),
    defaults: {
      prompt: "",
      model: "",
      ...defaults,
    },
    options,
    ranges,
  };
}

const OPENAI_GPT_IMAGE_RANGES: DrawParamRule["ranges"] = {
  n: { min: 1, max: 10 },
  output_compression: { min: 0, max: 100 },
};

const OPENAI_DALLE_2_RANGES: DrawParamRule["ranges"] = {
  n: { min: 1, max: 10 },
};

const GOOGLE_IMAGEN_RANGES: DrawParamRule["ranges"] = {
  n: { min: 1, max: 4 },
};

const ALIBABA_SEED_RANGE: DrawParamRule["ranges"] = {
  seed: { min: 0, max: 2147483647 },
};

const ALIBABA_GENERATE_4_RANGES: DrawParamRule["ranges"] = {
  ...ALIBABA_SEED_RANGE,
  n: { min: 1, max: 4 },
};

const QWEN_IMAGE_RANGES: DrawParamRule["ranges"] = {
  ...ALIBABA_SEED_RANGE,
  n: { min: 1, max: 6 },
};

const SEEDREAM_30_RANGES: DrawParamRule["ranges"] = {
  seed: { min: -1, max: 2147483647 },
  guidance_scale: { min: 1, max: 10, float: true },
};

const BFL_FLUX_2_RANGES: DrawParamRule["ranges"] = {
  safety_tolerance: { min: 0, max: 5 },
  seed: { min: 0 },
};

const BFL_FLUX_11_RANGES: DrawParamRule["ranges"] = {
  safety_tolerance: { min: 0, max: 6 },
  seed: { min: 0 },
};

const IDEOGRAM_V3_RANGES: DrawParamRule["ranges"] = {
  seed: { min: 0, max: 2147483647 },
  n: { min: 1, max: 8 },
};

const STABILITY_RANGES: DrawParamRule["ranges"] = {
  seed: { min: 0, max: 4294967294 },
};

const GENERIC_IMAGE_RANGES: DrawParamRule["ranges"] = {
  n: { min: 1, max: 10 },
};

export function normalizeDrawModelName(model: string) {
  const raw = String(model || "")
    .trim()
    .toLowerCase()
    .split("@")[0]
    .split(/[/:]/)
    .filter(Boolean)
    .pop()!;

  return String(raw || "")
    .replace(/[_\s]+/g, "-")
    .replace(/--+/g, "-");
}

function getNormalizedProvider(provider = "") {
  return String(provider || "")
    .trim()
    .toLowerCase();
}

function isOpenAIImage2Model(model: string) {
  return /^gpt-image-2(?:$|[-.])/.test(model);
}

function isOpenAIGptImageModel(model: string) {
  return /^gpt-image-\d/.test(model);
}

function isDalle3Model(model: string) {
  return (
    /^dall-?e-?3(?:$|[-.])/.test(model) || /^dalle-?3(?:$|[-.])/.test(model)
  );
}

function isDalle2Model(model: string) {
  return (
    /^dall-?e-?2(?:$|[-.])/.test(model) || /^dalle-?2(?:$|[-.])/.test(model)
  );
}

function isGeminiImageModel(model: string) {
  return (
    model.includes("nano-banana") ||
    (model.startsWith("gemini-") && model.includes("image"))
  );
}

function isGemini31ImageModel(model: string) {
  return (
    (model.startsWith("gemini-3.1-") && model.includes("image")) ||
    model.includes("nano-banana-2") ||
    model.includes("nano-banana2")
  );
}

function isGemini3ProImageModel(model: string) {
  return (
    /^gemini-3(?:[-.]0)?-pro-image(?:$|[-.])/.test(model) ||
    model.includes("nano-banana-pro")
  );
}

function isGemini25ImageModel(model: string) {
  return (
    (model.includes("nano-banana") &&
      !model.includes("nano-banana-pro") &&
      !model.includes("nano-banana-2") &&
      !model.includes("nano-banana2")) ||
    /^gemini-2[.-]5-flash-image(?:$|[-.])/.test(model)
  );
}

function isImagenModel(model: string) {
  return /^imagen(?:$|[-.])/.test(model);
}

function isWanModel(model: string) {
  return (
    model.startsWith("wan2.") ||
    model.startsWith("wan2-") ||
    model.startsWith("wanx")
  );
}

function isWanVersionModel(model: string, version: string, suffix: string) {
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^wan2[.-]${version}-${escapedSuffix}(?:$|[-.])`).test(
    model,
  );
}

function isWanxVersionModel(model: string, version: string, suffix: string) {
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^wanx2[.-]${version}-${escapedSuffix}(?:$|[-.])`).test(
    model,
  );
}

function isQwenImageModel(model: string) {
  return /^qwen-image(?:$|[-.])/.test(model);
}

function isSeedreamModel(model: string) {
  return /^(doubao-)?seedream(?:$|[-.])/.test(model);
}

function seedreamVersionKey(model: string) {
  const normalized = model.replace(/[._]+/g, "-");
  if (
    /(?:^|-)seedream-5-0(?:-|$)/.test(normalized) ||
    /(?:^|-)seedream-5-lite(?:-|$)/.test(normalized)
  ) {
    return "5-lite";
  }
  if (
    /(?:^|-)seedream-4-5(?:-|$)/.test(normalized) ||
    /(?:^|-)seedream-45(?:-|$)/.test(normalized)
  ) {
    return "4.5";
  }
  if (
    /(?:^|-)seedream-4-0(?:-|$)/.test(normalized) ||
    /(?:^|-)seedream-40(?:-|$)/.test(normalized)
  ) {
    return "4.0";
  }
  if (
    /(?:^|-)seedream-3-0(?:-|$)/.test(normalized) ||
    /(?:^|-)seedream-30(?:-|$)/.test(normalized)
  ) {
    return "3.0";
  }
  return "";
}

function isGlmImageModel(model: string) {
  return model === "glm-image" || model.startsWith("glm-image-");
}

function isCogViewModel(model: string) {
  return model.startsWith("cogview-");
}

export function getDrawModelFamily(model: string, provider = "") {
  const lowerModel = normalizeDrawModelName(model);
  const lowerProvider = getNormalizedProvider(provider);

  if (
    lowerProvider === ServiceProvider.Stability.toLowerCase() ||
    lowerModel.startsWith("stable-image") ||
    lowerModel === "core" ||
    lowerModel === "ultra" ||
    lowerModel.startsWith("sd3")
  ) {
    return "stability";
  }

  if (isOpenAIImage2Model(lowerModel)) return "openai-gpt-image-2";
  if (isOpenAIGptImageModel(lowerModel)) return "openai-gpt-image";
  if (isDalle3Model(lowerModel)) {
    return "openai-dall-e-3";
  }
  if (isDalle2Model(lowerModel)) {
    return "openai-dall-e-2";
  }
  if (isGemini31ImageModel(lowerModel)) {
    return "google-gemini-31-image";
  }
  if (isGemini3ProImageModel(lowerModel)) {
    return "google-gemini-3-pro-image";
  }
  if (isGemini25ImageModel(lowerModel)) {
    return "google-gemini-25-image";
  }
  if (isGeminiImageModel(lowerModel)) {
    return "google-gemini-image";
  }
  if (isImagenModel(lowerModel)) return "google-imagen";
  if (isWanVersionModel(lowerModel, "7", "image-pro")) {
    return "alibaba-wan-27-pro";
  }
  if (isWanVersionModel(lowerModel, "7", "image")) return "alibaba-wan-27";
  if (isWanVersionModel(lowerModel, "6", "t2i")) {
    return "alibaba-wan-26-t2i";
  }
  if (isWanVersionModel(lowerModel, "6", "image")) {
    return "alibaba-wan-26-image";
  }
  if (isWanVersionModel(lowerModel, "5", "t2i")) {
    return "alibaba-wan-25-t2i";
  }
  if (isWanVersionModel(lowerModel, "2", "t2i")) {
    return "alibaba-wan-22-t2i";
  }
  if (isWanxVersionModel(lowerModel, "1", "t2i")) {
    return "alibaba-wan-21-t2i";
  }
  if (isWanxVersionModel(lowerModel, "0", "t2i")) {
    return "alibaba-wan-20-t2i";
  }
  if (lowerModel === "wanx-v1") return "alibaba-wanx-v1";
  if (isWanModel(lowerModel)) {
    return "alibaba-wan";
  }
  if (
    lowerModel === "qwen-image" ||
    lowerModel.startsWith("qwen-image-max") ||
    lowerModel.startsWith("qwen-image-plus")
  ) {
    return "alibaba-qwen-fixed";
  }
  if (
    isQwenImageModel(lowerModel) ||
    lowerModel.startsWith("irag-") ||
    lowerModel.startsWith("ernie-irag-")
  ) {
    return "alibaba-qwen";
  }
  if (isSeedreamModel(lowerModel)) {
    switch (seedreamVersionKey(lowerModel)) {
      case "5-lite":
        return "bytedance-seedream-5-lite";
      case "4.5":
        return "bytedance-seedream-45";
      case "4.0":
        return "bytedance-seedream-40";
      case "3.0":
        return "bytedance-seedream-30";
      default:
        return "bytedance-seedream";
    }
  }
  if (lowerModel.startsWith("flux-2-")) return "bfl-flux-2";
  if (lowerModel.startsWith("flux-kontext-")) return "fluxapi-kontext";
  if (lowerModel.includes("flux-1.1")) {
    return "bfl-flux-aspect";
  }
  if (lowerModel === "v4" || lowerModel.includes("ideogram-v4")) {
    return "ideogram-v4";
  }
  if (
    lowerModel === "v3" ||
    lowerModel.includes("ideogram-v3") ||
    lowerModel.includes("ideogram")
  ) {
    return "ideogram-v3";
  }
  if (isGlmImageModel(lowerModel)) {
    return "zhipu-glm-image";
  }
  if (isCogViewModel(lowerModel)) return "zhipu-cogview";

  if (lowerProvider === ServiceProvider.Google.toLowerCase()) {
    if (lowerModel.includes("imagen")) return "google-imagen";
    if (isGemini31ImageModel(lowerModel)) return "google-gemini-31-image";
    if (isGemini3ProImageModel(lowerModel)) {
      return "google-gemini-3-pro-image";
    }
    if (isGemini25ImageModel(lowerModel)) return "google-gemini-25-image";
    if (lowerModel.includes("image") || lowerModel.includes("banana")) {
      return "google-gemini-image";
    }
  }

  if (lowerProvider === ServiceProvider.ByteDance.toLowerCase()) {
    if (lowerModel.includes("seedream")) {
      switch (seedreamVersionKey(lowerModel)) {
        case "5-lite":
          return "bytedance-seedream-5-lite";
        case "4.5":
          return "bytedance-seedream-45";
        case "4.0":
          return "bytedance-seedream-40";
        case "3.0":
          return "bytedance-seedream-30";
        default:
          return "bytedance-seedream";
      }
    }
  }

  if (lowerProvider === ServiceProvider.Alibaba.toLowerCase()) {
    if (lowerModel.includes("qwen") && lowerModel.includes("image")) {
      return "alibaba-qwen";
    }
    if (lowerModel.includes("wan")) return "alibaba-wan";
  }

  if (lowerProvider === ServiceProvider.ChatGLM.toLowerCase()) {
    if (lowerModel.includes("cogview")) return "zhipu-cogview";
    if (lowerModel.includes("image")) return "zhipu-glm-image";
  }

  return "generic-openai-compatible";
}

export function getDrawModelParamRule(
  model: string,
  provider = "",
): DrawParamRule {
  const family = getDrawModelFamily(model, provider);

  switch (family) {
    case "openai-gpt-image-2":
      return makeRule(
        family,
        provider,
        [
          "image_size",
          "quality",
          "output_format",
          "background",
          "output_compression",
          "moderation",
          "n",
        ],
        {
          image_size: "auto",
          quality: "auto",
          output_format: "png",
          background: "auto",
          output_compression: 100,
          moderation: "auto",
          n: 1,
        },
        {
          image_size: DRAW_OPENAI_GPT_IMAGE_2_SIZE_OPTIONS,
          quality: DRAW_GPT_IMAGE_QUALITY_OPTIONS,
          output_format: DRAW_OUTPUT_FORMAT_OPTIONS,
          background: DRAW_GPT_IMAGE_2_BACKGROUND_OPTIONS,
          moderation: [option("auto", "标准"), option("low", "宽松")],
        },
        OPENAI_GPT_IMAGE_RANGES,
      );
    case "openai-gpt-image":
      return makeRule(
        family,
        provider,
        [
          "image_size",
          "quality",
          "output_format",
          "background",
          "output_compression",
          "moderation",
          "n",
        ],
        {
          image_size: "auto",
          quality: "auto",
          output_format: "png",
          background: "auto",
          output_compression: 100,
          moderation: "auto",
          n: 1,
        },
        {
          image_size: DRAW_OPENAI_SIZE_OPTIONS,
          quality: DRAW_GPT_IMAGE_QUALITY_OPTIONS,
          output_format: DRAW_OUTPUT_FORMAT_OPTIONS,
          background: DRAW_OPENAI_BACKGROUND_OPTIONS,
          moderation: [option("auto", "标准"), option("low", "宽松")],
        },
        OPENAI_GPT_IMAGE_RANGES,
      );
    case "openai-dall-e-3":
      return makeRule(
        family,
        provider,
        ["image_size", "quality", "style", "response_format"],
        {
          image_size: "1024x1024",
          quality: "standard",
          style: "vivid",
          response_format: "url",
        },
        {
          image_size: DRAW_DALLE_3_SIZE_OPTIONS,
          quality: DRAW_DALLE_QUALITY_OPTIONS,
          style: DRAW_DALLE_STYLE_OPTIONS,
          response_format: DRAW_RESPONSE_FORMAT_OPTIONS,
        },
      );
    case "openai-dall-e-2":
      return makeRule(
        family,
        provider,
        ["image_size", "n", "response_format"],
        {
          image_size: "1024x1024",
          n: 1,
          response_format: "url",
        },
        {
          image_size: DRAW_DALLE_2_SIZE_OPTIONS,
          response_format: DRAW_RESPONSE_FORMAT_OPTIONS,
        },
        OPENAI_DALLE_2_RANGES,
      );
    case "google-gemini-31-image":
      return makeRule(
        family,
        provider,
        ["aspect_ratio", "resolution", "thinking_level"],
        {
          aspect_ratio: "1:1",
          resolution: "1K",
          thinking_level: "minimal",
        },
        {
          aspect_ratio: DRAW_GEMINI_31_ASPECT_RATIO_OPTIONS,
          resolution: DRAW_RESOLUTION_OPTIONS,
          thinking_level: DRAW_GEMINI_THINKING_LEVEL_OPTIONS,
        },
      );
    case "google-gemini-3-pro-image":
      return makeRule(
        family,
        provider,
        ["aspect_ratio", "resolution"],
        {
          aspect_ratio: "1:1",
          resolution: "1K",
        },
        {
          aspect_ratio: DRAW_GEMINI_STANDARD_ASPECT_RATIO_OPTIONS,
          resolution: DRAW_GEMINI_3_PRO_RESOLUTION_OPTIONS,
        },
      );
    case "google-gemini-25-image":
    case "google-gemini-image":
      return makeRule(
        family,
        provider,
        ["aspect_ratio"],
        {
          aspect_ratio: "1:1",
        },
        {
          aspect_ratio: DRAW_GEMINI_STANDARD_ASPECT_RATIO_OPTIONS,
        },
      );
    case "google-imagen":
      return makeRule(
        family,
        provider,
        ["aspect_ratio", "resolution", "person_generation", "n"],
        {
          aspect_ratio: "1:1",
          resolution: "1K",
          person_generation: "allow_adult",
          n: 1,
        },
        {
          aspect_ratio: ["1:1", "3:4", "4:3", "9:16", "16:9"].map((value) =>
            option(value),
          ),
          resolution: DRAW_IMAGEN_RESOLUTION_OPTIONS,
          person_generation: DRAW_PERSON_GENERATION_OPTIONS,
        },
        GOOGLE_IMAGEN_RANGES,
      );
    case "alibaba-wan-27-pro":
      return makeRule(
        family,
        provider,
        ["resolution", "n", "thinking_mode", "watermark", "seed"],
        {
          resolution: "2K",
          n: 1,
          thinking_mode: "true",
          watermark: "false",
          seed: 0,
        },
        {
          resolution: DRAW_WAN_27_PRO_RESOLUTION_OPTIONS,
          thinking_mode: [option("true", "开启"), option("false", "关闭")],
          watermark: [option("false", "关闭"), option("true", "开启")],
        },
        ALIBABA_GENERATE_4_RANGES,
      );
    case "alibaba-wan-27":
      return makeRule(
        family,
        provider,
        ["resolution", "n", "thinking_mode", "watermark", "seed"],
        {
          resolution: "2K",
          n: 1,
          thinking_mode: "true",
          watermark: "false",
          seed: 0,
        },
        {
          resolution: DRAW_WAN_27_RESOLUTION_OPTIONS,
          thinking_mode: [option("true", "开启"), option("false", "关闭")],
          watermark: [option("false", "关闭"), option("true", "开启")],
        },
        ALIBABA_GENERATE_4_RANGES,
      );
    case "alibaba-wan-26-t2i":
      return makeRule(
        family,
        provider,
        ["negative_prompt", "image_size", "prompt_extend", "watermark", "seed"],
        {
          image_size: "1280x1280",
          prompt_extend: "true",
          watermark: "false",
          seed: 0,
        },
        {
          image_size: DRAW_WAN_26_T2I_SIZE_OPTIONS,
          prompt_extend: [option("true", "开启"), option("false", "关闭")],
          watermark: [option("false", "关闭"), option("true", "开启")],
        },
        ALIBABA_SEED_RANGE,
      );
    case "alibaba-wan-26-image":
      return makeRule(
        family,
        provider,
        ["negative_prompt", "image_size", "watermark", "seed"],
        {
          image_size: "1280x1280",
          watermark: "false",
          seed: 0,
        },
        {
          image_size: DRAW_WAN_26_T2I_SIZE_OPTIONS,
          watermark: [option("false", "关闭"), option("true", "开启")],
        },
        ALIBABA_SEED_RANGE,
      );
    case "alibaba-wan-25-t2i":
      return makeRule(
        family,
        provider,
        [
          "negative_prompt",
          "image_size",
          "n",
          "prompt_extend",
          "watermark",
          "seed",
        ],
        {
          image_size: "1280x1280",
          n: 1,
          prompt_extend: "true",
          watermark: "false",
          seed: 0,
        },
        {
          image_size: DRAW_WAN_25_SIZE_OPTIONS,
          prompt_extend: [option("true", "开启"), option("false", "关闭")],
          watermark: [option("false", "关闭"), option("true", "开启")],
        },
        ALIBABA_GENERATE_4_RANGES,
      );
    case "alibaba-wan-22-t2i":
    case "alibaba-wan-21-t2i":
    case "alibaba-wan-20-t2i":
      return makeRule(
        family,
        provider,
        [
          "negative_prompt",
          "image_size",
          "n",
          "prompt_extend",
          "watermark",
          "seed",
        ],
        {
          image_size: "1024x1024",
          n: 1,
          prompt_extend: "true",
          watermark: "false",
          seed: 0,
        },
        {
          image_size: DRAW_WAN_LEGACY_SIZE_OPTIONS,
          watermark: [option("false", "关闭"), option("true", "开启")],
        },
        ALIBABA_GENERATE_4_RANGES,
      );
    case "alibaba-wanx-v1":
      return makeRule(
        family,
        provider,
        ["negative_prompt", "image_size", "style", "n", "seed"],
        {
          image_size: "1024x1024",
          style: "<auto>",
          n: 1,
          seed: 0,
        },
        {
          image_size: DRAW_WANX_V1_SIZE_OPTIONS,
          style: DRAW_WANX_V1_STYLE_OPTIONS,
        },
        ALIBABA_GENERATE_4_RANGES,
      );
    case "alibaba-wan":
      return makeRule(
        family,
        provider,
        ["negative_prompt", "image_size", "watermark", "seed"],
        {
          image_size: "1024x1024",
          watermark: "false",
          seed: 0,
        },
        {
          image_size: DRAW_WAN_LEGACY_SIZE_OPTIONS,
          prompt_extend: [option("true", "开启"), option("false", "关闭")],
          watermark: [option("false", "关闭"), option("true", "开启")],
        },
        ALIBABA_SEED_RANGE,
      );
    case "alibaba-qwen-fixed":
      return makeRule(
        family,
        provider,
        ["negative_prompt", "image_size", "prompt_extend", "watermark", "seed"],
        {
          image_size: "1328x1328",
          prompt_extend: "true",
          watermark: "false",
          seed: 0,
        },
        {
          image_size: DRAW_QWEN_PLUS_SIZE_OPTIONS,
          prompt_extend: [option("true", "开启"), option("false", "关闭")],
          watermark: [option("false", "关闭"), option("true", "开启")],
        },
        ALIBABA_SEED_RANGE,
      );
    case "alibaba-qwen":
      return makeRule(
        family,
        provider,
        [
          "negative_prompt",
          "image_size",
          "n",
          "prompt_extend",
          "watermark",
          "seed",
        ],
        {
          image_size: "2048x2048",
          n: 1,
          prompt_extend: "true",
          watermark: "false",
          seed: 0,
        },
        {
          image_size: DRAW_QWEN_SIZE_OPTIONS,
          prompt_extend: [option("true", "开启"), option("false", "关闭")],
          watermark: [option("false", "关闭"), option("true", "开启")],
        },
        QWEN_IMAGE_RANGES,
      );
    case "bytedance-seedream-5-lite":
      return makeRule(
        family,
        provider,
        [
          "resolution",
          "response_format",
          "output_format",
          "watermark",
          "optimize_prompt_mode",
          "web_search",
        ],
        {
          resolution: "2048x2048",
          response_format: "url",
          output_format: "jpeg",
          watermark: "true",
          optimize_prompt_mode: "standard",
          web_search: "false",
        },
        {
          resolution: DRAW_DOUBAO_5_SIZE_OPTIONS,
          response_format: DRAW_RESPONSE_FORMAT_OPTIONS,
          output_format: DRAW_DOUBAO_OUTPUT_FORMAT_OPTIONS,
          watermark: [option("true", "开启"), option("false", "关闭")],
          optimize_prompt_mode: DRAW_DOUBAO_STANDARD_PROMPT_MODE_OPTIONS,
          web_search: [option("false", "关闭"), option("true", "开启")],
        },
      );
    case "bytedance-seedream-45":
      return makeRule(
        family,
        provider,
        ["resolution", "response_format", "watermark", "optimize_prompt_mode"],
        {
          resolution: "2048x2048",
          response_format: "url",
          watermark: "true",
          optimize_prompt_mode: "standard",
        },
        {
          resolution: DRAW_DOUBAO_45_SIZE_OPTIONS,
          response_format: DRAW_RESPONSE_FORMAT_OPTIONS,
          watermark: [option("true", "开启"), option("false", "关闭")],
          optimize_prompt_mode: DRAW_DOUBAO_STANDARD_PROMPT_MODE_OPTIONS,
        },
      );
    case "bytedance-seedream-40":
      return makeRule(
        family,
        provider,
        ["resolution", "response_format", "watermark", "optimize_prompt_mode"],
        {
          resolution: "2048x2048",
          response_format: "url",
          watermark: "true",
          optimize_prompt_mode: "standard",
        },
        {
          resolution: DRAW_DOUBAO_40_SIZE_OPTIONS,
          response_format: DRAW_RESPONSE_FORMAT_OPTIONS,
          watermark: [option("true", "开启"), option("false", "关闭")],
          optimize_prompt_mode: DRAW_DOUBAO_OPTIMIZE_PROMPT_MODE_OPTIONS,
        },
      );
    case "bytedance-seedream-30":
      return makeRule(
        family,
        provider,
        [
          "resolution",
          "response_format",
          "watermark",
          "seed",
          "guidance_scale",
        ],
        {
          resolution: "1024x1024",
          response_format: "url",
          watermark: "true",
          seed: -1,
          guidance_scale: 2.5,
        },
        {
          resolution: DRAW_DOUBAO_30_SIZE_OPTIONS,
          response_format: DRAW_RESPONSE_FORMAT_OPTIONS,
          watermark: [option("true", "开启"), option("false", "关闭")],
        },
        SEEDREAM_30_RANGES,
      );
    case "bytedance-seedream":
      return makeRule(
        family,
        provider,
        ["resolution", "response_format", "watermark"],
        {
          resolution: "2048x2048",
          response_format: "url",
          watermark: "true",
        },
        {
          resolution: DRAW_DOUBAO_SIZE_OPTIONS,
          response_format: DRAW_RESPONSE_FORMAT_OPTIONS,
          watermark: [option("true", "开启"), option("false", "关闭")],
        },
      );
    case "bfl-flux-2":
      return makeRule(
        family,
        provider,
        ["image_size", "output_format", "safety_tolerance", "seed"],
        {
          image_size: "1024x1024",
          output_format: "jpeg",
          safety_tolerance: 2,
          seed: 0,
        },
        {
          image_size: DRAW_FLUX_2_SIZE_OPTIONS,
          output_format: DRAW_OUTPUT_FORMAT_OPTIONS,
        },
        BFL_FLUX_2_RANGES,
      );
    case "bfl-flux-aspect":
      return makeRule(
        family,
        provider,
        [
          "aspect_ratio",
          "output_format",
          "prompt_upsampling",
          "safety_tolerance",
          "seed",
        ],
        {
          aspect_ratio: "1:1",
          output_format: "jpeg",
          prompt_upsampling: "false",
          safety_tolerance: 2,
          seed: 0,
        },
        {
          aspect_ratio: DRAW_ASPECT_RATIO_OPTIONS,
          output_format: DRAW_OUTPUT_FORMAT_OPTIONS.filter(
            (item) => item.value !== "webp",
          ),
          prompt_upsampling: [option("false", "关闭"), option("true", "开启")],
        },
        BFL_FLUX_11_RANGES,
      );
    case "fluxapi-kontext":
      return makeRule(
        family,
        provider,
        [
          "aspect_ratio",
          "output_format",
          "prompt_upsampling",
          "safety_tolerance",
          "enable_translation",
        ],
        {
          aspect_ratio: "16:9",
          output_format: "jpeg",
          prompt_upsampling: "false",
          safety_tolerance: 2,
          enable_translation: "true",
        },
        {
          aspect_ratio: DRAW_FLUX_KONTEXT_ASPECT_RATIO_OPTIONS,
          output_format: DRAW_OUTPUT_FORMAT_OPTIONS.filter(
            (item) => item.value !== "webp",
          ),
          prompt_upsampling: [option("false", "关闭"), option("true", "开启")],
          enable_translation: [option("true", "开启"), option("false", "关闭")],
        },
        {
          safety_tolerance: { min: 0, max: 6 },
        },
      );
    case "ideogram-v4":
      return makeRule(
        family,
        provider,
        ["resolution", "rendering_speed"],
        {
          resolution: "2048x2048",
          rendering_speed: "DEFAULT",
        },
        {
          resolution: DRAW_IDEOGRAM_V4_RESOLUTION_OPTIONS,
          rendering_speed: DRAW_IDEOGRAM_RENDERING_SPEED_OPTIONS,
        },
      );
    case "ideogram-v3":
      return makeRule(
        family,
        provider,
        [
          "negative_prompt",
          "aspect_ratio",
          "rendering_speed",
          "style_type",
          "magic_prompt",
          "seed",
          "n",
        ],
        {
          aspect_ratio: "1:1",
          rendering_speed: "DEFAULT",
          style_type: "AUTO",
          magic_prompt: "AUTO",
          seed: 0,
          n: 1,
        },
        {
          aspect_ratio: DRAW_IDEOGRAM_V3_ASPECT_RATIO_OPTIONS,
          rendering_speed: DRAW_IDEOGRAM_RENDERING_SPEED_OPTIONS,
          style_type: DRAW_IDEOGRAM_V3_STYLE_TYPE_OPTIONS,
          magic_prompt: DRAW_IDEOGRAM_MAGIC_PROMPT_OPTIONS,
        },
        IDEOGRAM_V3_RANGES,
      );
    case "zhipu-glm-image":
      return makeRule(
        family,
        provider,
        ["image_size", "quality", "watermark"],
        {
          image_size: "1280x1280",
          quality: "hd",
          watermark: "true",
        },
        {
          image_size: DRAW_GLM_SIZE_OPTIONS,
          quality: [option("hd", "高清")],
          watermark: [option("true", "开启"), option("false", "关闭")],
        },
      );
    case "zhipu-cogview":
      return makeRule(
        family,
        provider,
        ["image_size", "quality", "watermark"],
        {
          image_size: "1024x1024",
          quality: "standard",
          watermark: "true",
        },
        {
          image_size: DRAW_COGVIEW_SIZE_OPTIONS,
          quality: [option("standard", "标准"), option("hd", "高清")],
          watermark: [option("true", "开启"), option("false", "关闭")],
        },
      );
    case "stability":
      return makeRule(
        family,
        provider,
        [
          "negative_prompt",
          "aspect_ratio",
          "output_format",
          "seed",
          "style_preset",
        ],
        {
          aspect_ratio: "1:1",
          output_format: "png",
          seed: 0,
          style_preset: "",
        },
        {
          aspect_ratio: [
            "16:9",
            "1:1",
            "21:9",
            "2:3",
            "3:2",
            "4:5",
            "5:4",
            "9:16",
            "9:21",
          ].map((value) => option(value)),
          output_format: DRAW_OUTPUT_FORMAT_OPTIONS,
          style_preset: DRAW_STABILITY_STYLE_PRESET_OPTIONS,
        },
        STABILITY_RANGES,
      );
    default:
      return makeRule(
        family,
        provider,
        ["image_size", "quality", "n"],
        {
          image_size: "1024x1024",
          quality: "standard",
          n: 1,
        },
        {
          image_size: [
            option("1024x1024", "1024 x 1024"),
            option("1024x1536", "1024 x 1536"),
            option("1536x1024", "1536 x 1024"),
            option("768x1344", "768 x 1344"),
            option("1344x768", "1344 x 768"),
            option("512x512", "512 x 512"),
          ],
          quality: [
            option("standard", "标准"),
            option("hd", "高清"),
            option("high", "高质量"),
          ],
        },
        GENERIC_IMAGE_RANGES,
      );
  }
}

export function isDrawParamSupported(
  model: string,
  field: string,
  provider = "",
) {
  return getDrawModelParamRule(model, provider).supported.has(
    field as DrawParamKey,
  );
}

export function getDrawParamOptions(
  model: string,
  field: string,
  fallbackOptions: DrawSelectOption[] = [],
  provider = "",
) {
  const rule = getDrawModelParamRule(model, provider);
  return rule.options[field as DrawParamKey] || fallbackOptions;
}

export function getDrawParamDefault(
  model: string,
  field: string,
  fallbackDefault: unknown = "",
  provider = "",
) {
  const rule = getDrawModelParamRule(model, provider);
  const key = field as DrawParamKey;
  if (!rule.supported.has(key)) return "";
  if (Object.prototype.hasOwnProperty.call(rule.defaults, key)) {
    return rule.defaults[key];
  }
  return fallbackDefault;
}

export function getDrawParamRange(
  model: string,
  field: string,
  fallbackRange: DrawNumberRange = {},
  provider = "",
) {
  const rule = getDrawModelParamRule(model, provider);
  const key = field as DrawParamKey;
  return {
    ...fallbackRange,
    ...(rule.ranges[key] || {}),
  };
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

function normalizeNumberValue(
  value: unknown,
  range: DrawNumberRange | undefined,
) {
  if (!range || !hasValue(value)) return value;

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return value;

  let nextValue = range.float ? numericValue : Math.trunc(numericValue);
  if (typeof range.min === "number") {
    nextValue = Math.max(range.min, nextValue);
  }
  if (typeof range.max === "number") {
    nextValue = Math.min(range.max, nextValue);
  }

  return nextValue;
}

function normalizeOptionValue(
  value: unknown,
  options: DrawSelectOption[] | undefined,
  fallback: unknown,
) {
  if (!options?.length) return hasValue(value) ? value : fallback;
  const normalizedValue = String(value ?? "");
  if (options.some((item) => item.value === normalizedValue)) {
    return normalizedValue;
  }
  const fallbackValue = String(fallback ?? "");
  if (options.some((item) => item.value === fallbackValue)) {
    return fallbackValue;
  }
  return options[0].value;
}

export function sanitizeDrawParams(
  model: string,
  params: Record<string, unknown> = {},
  provider = "",
) {
  const rule = getDrawModelParamRule(model, provider);
  const next: Record<string, unknown> = { ...params };

  for (const key of DRAW_PARAM_KEYS) {
    if (!rule.supported.has(key)) {
      next[key] = "";
      continue;
    }

    const fallback = getDrawParamDefault(model, key, next[key], provider);
    if (!hasValue(next[key])) {
      next[key] = fallback;
    }

    if (rule.options[key]) {
      next[key] = normalizeOptionValue(next[key], rule.options[key], fallback);
    }

    if (rule.ranges[key]) {
      next[key] = normalizeNumberValue(next[key], rule.ranges[key]);
    }
  }

  next.model = model;
  return next;
}

export function pickSupportedDrawParams(
  model: string,
  params: Record<string, unknown> = {},
  provider = "",
) {
  const rule = getDrawModelParamRule(model, provider);
  const picked: Record<string, unknown> = {};

  for (const key of DRAW_PARAM_KEYS) {
    if (!rule.supported.has(key)) continue;
    const value = params[key];
    if (!hasValue(value)) continue;
    picked[key] = value;
  }

  return picked;
}

export function parseDrawImageSize(size: unknown) {
  const matched = String(size || "").match(/^(\d+)[x*](\d+)$/i);
  if (!matched) return null;
  return {
    width: Number(matched[1]),
    height: Number(matched[2]),
  };
}

export function toDashScopeSize(size: unknown) {
  return String(size || "").replace(/^(\d+)x(\d+)$/i, "$1*$2");
}

export function normalizeOpenAICompatibleImageQuality(
  model: string,
  quality: unknown,
) {
  const lowerModel = normalizeDrawModelName(model);
  const value = String(quality || "").toLowerCase();

  if (lowerModel.startsWith("gpt-image-")) {
    if (["low", "medium", "high", "auto"].includes(value)) return value;
    if (value === "hd") return "high";
    return "auto";
  }

  if (lowerModel === "dall-e-3" || lowerModel === "dalle-3") {
    if (value === "hd" || value === "high") return "hd";
    return "standard";
  }

  if (lowerModel === "dall-e-2" || lowerModel === "dalle-2") {
    return "";
  }

  if (["standard", "hd", "high", "medium", "low", "auto"].includes(value)) {
    return value;
  }

  return "standard";
}

export function toBooleanParam(value: unknown) {
  return value === true || String(value).toLowerCase() === "true";
}
