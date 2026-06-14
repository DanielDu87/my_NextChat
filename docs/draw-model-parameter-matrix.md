# Draw 文生图模型参数矩阵

本表用于 Draw 页面按模型启用/禁用参数。原则：只启用官方文档明确支持、且当前 Draw 文生图界面能表达的字段；需要图片、蒙版、局部重绘、涂鸦或多轮编辑输入的字段暂不在 Draw 文生图页放开。

## 参数规则

| 供应商 | 模型匹配 | 启用参数 | 禁用/不发送 | 关键要求 |
| --- | --- | --- | --- | --- |
| OpenAI | `gpt-image-2`, `gpt-image-2-*` | `image_size`, `quality`, `output_format`, `background`, `output_compression`, `moderation`, `n` | `aspect_ratio`, `resolution`, `seed`, `style`, `negative_prompt`, `response_format`, `input_fidelity` | 官方支持 `auto/1024x1024/1536x1024/1024x1536`，且 `gpt-image-2` 还支持合法 `WIDTHxHEIGHT`：宽高需能被 16 整除（故不含 `1920x1080`），比例在 1:3 到 3:1 之间；超过 `2560x1440` 属实验尺寸，最大到 `3840x2160` 同级。`gpt-image-2` 不支持透明背景，`background` 仅 `auto/opaque`（`gpt-image-1.x` 仍支持 `transparent`）；不支持 `input_fidelity`（模型自动高保真）；始终返回 `b64_json`，无 URL；`prompt` 上限 32000 字符。 |
| OpenAI | `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini` | `image_size`, `quality`, `output_format`, `background`, `output_compression`, `moderation`, `n` | `aspect_ratio`, `resolution`, `seed`, `style`, `negative_prompt`, `response_format` | GPT image 1.x 尺寸按官方 `auto/1024x1024/1024x1536/1536x1024`，格式为 `png/webp/jpeg`。 |
| OpenAI | `dall-e-3` | `image_size`, `quality`, `style`, `response_format` | `output_format`, `background`, `seed`, `n`, `negative_prompt` | `size` 仅 `1024x1024/1792x1024/1024x1792`；`quality` 为 `standard/hd`；`style` 为 `vivid/natural`；`n` 固定 1；`response_format` 为 `url/b64_json`。 |
| OpenAI | `dall-e-2` | `image_size`, `n`, `response_format` | `quality`, `style`, `output_format`, `background`, `seed` | `size` 仅 `256x256/512x512/1024x1024`；`response_format` 为 `url/b64_json`。 |
| Google | `gemini-3.1-*-image` | `aspect_ratio`, `resolution`, `thinking_level` | `image_size`, `quality`, `seed`, `n`, `watermark` | 使用 Gemini `response_format.image`/`imageConfig`；官方 14 种比例 `1:1/1:4/1:8/2:3/3:2/3:4/4:1/4:3/4:5/5:4/8:1/9:16/16:9/21:9`（不含 `9:21`），分辨率为 `512/1K/2K/4K`。`thinking_level` 为 `minimal/high`，原生端点映射为 `generationConfig.thinkingConfig.thinkingLevel`（首字母大写）。 |
| Google | `gemini-3-pro-image*` | `aspect_ratio`, `resolution` | `image_size`, `quality`, `seed`, `n`, `watermark` | 使用 Gemini `response_format.image`/`imageConfig`；比例使用常规 10 项 `1:1/2:3/3:2/3:4/4:3/4:5/5:4/9:16/16:9/21:9`，分辨率为 `1K/2K/4K`。 |
| Google | `gemini-2.5-flash-image`, `nano-banana*` | `aspect_ratio` | `resolution`, `image_size`, `quality`, `seed`, `n`, `watermark` | 2.5 Flash Image 官方只配置横纵比，默认约 1024px 输出，不发送 `image_size`。 |
| Google | `imagen-*` | `aspect_ratio`, `resolution`, `person_generation`, `n` | `image_size`, `quality`, `seed`, `watermark` | `aspectRatio` 为 `1:1/3:4/4:3/9:16/16:9`；`imageSize` 为 `1K/2K`；`numberOfImages` 默认 1。 |
| 阿里云百炼 | `qwen-image-2.0*`, `qwen-image-2.0-pro*`, `irag-*` | `negative_prompt`, `image_size`, `n`, `prompt_extend`, `watermark`, `seed` | `aspect_ratio`, `resolution`, `quality`, `output_format` | `size` 发送为 `宽*高`；`seed` 范围 `[0,2147483647]`。 |
| 阿里云百炼 | `qwen-image`, `qwen-image-max*`, `qwen-image-plus*` | `negative_prompt`, `image_size`, `prompt_extend`, `watermark`, `seed` | `n`, `aspect_ratio`, `resolution`, `quality`, `output_format` | plus/max 系列按官方固定单张处理；尺寸使用官方枚举 `1664*928/1472*1104/1328*1328/1104*1472/928*1664`。 |
| 阿里云百炼 | `wan2.7-image-pro` | `resolution`, `n`, `thinking_mode`, `watermark`, `seed` | `negative_prompt`, `prompt_extend`, `image_size`, `aspect_ratio`, `quality`, `output_format` | `size` 支持 `1K/2K/4K`；`n` 为 1-4；`thinking_mode` 仅无输入图、非组图时有效。 |
| 阿里云百炼 | `wan2.7-image` | `resolution`, `n`, `thinking_mode`, `watermark`, `seed` | `negative_prompt`, `prompt_extend`, `image_size`, `aspect_ratio`, `quality`, `output_format` | 标准版只放开 `1K/2K`，不显示 `4K`。 |
| 阿里云百炼 | `wan2.6-t2i` | `negative_prompt`, `image_size`, `prompt_extend`, `watermark`, `seed` | `n`, `resolution`, `thinking_mode`, `aspect_ratio`, `quality`, `output_format` | 官方示例 `n` 固定 1；`size` 默认 `1280*1280`，使用推荐尺寸枚举。 |
| 阿里云百炼 | `wan2.6-image` | `negative_prompt`, `image_size`, `watermark`, `seed` | `n`, `prompt_extend`, `resolution`, `thinking_mode`, `output_format` | 该模型是生成与编辑一体接口；Draw 文生图只按 `enable_interleave=true`、`n=1` 的保守子集发送。 |
| 阿里云百炼 | `wan2.5-t2i-preview` | `negative_prompt`, `image_size`, `n`, `prompt_extend`, `watermark`, `seed` | `resolution`, `thinking_mode`, `quality`, `output_format` | 尺寸使用 2.5 推荐枚举；总像素和比例仍以官方限制为准。 |
| 阿里云百炼 | `wan2.2-t2i-*`, `wanx2.1-t2i-*`, `wanx2.0-t2i-*` | `negative_prompt`, `image_size`, `n`, `prompt_extend`, `watermark`, `seed` | `resolution`, `thinking_mode`, `quality`, `output_format` | 旧版文生图默认 `1024*1024`，使用通用推荐尺寸枚举。 |
| 阿里云百炼 | `wanx-v1` | `negative_prompt`, `image_size`, `style`, `n`, `seed` | `prompt_extend`, `watermark`, `resolution`, `thinking_mode`, `output_format` | `style` 仅官方枚举：`<auto>/<photography>/<portrait>/<3d cartoon>/<anime>/<oil painting>/<watercolor>/<sketch>/<chinese painting>/<flat illustration>`。 |
| 火山引擎/豆包 | `doubao-seedream-5-0-lite*`, `doubao-seedream-5.0-lite*` | `resolution`, `response_format`, `output_format`, `watermark`, `optimize_prompt_mode`, `web_search` | `aspect_ratio`, `image_size`, `quality`, `seed`, `guidance_scale`, `n` | 依据用户提供的 Seedream 官方快照：仅 5 lite 放开 `output_format` 和 `web_search`。 |
| 火山引擎/豆包 | `doubao-seedream-4-5*`, `doubao-seedream-4.5*` | `resolution`, `response_format`, `watermark`, `optimize_prompt_mode` | `output_format`, `aspect_ratio`, `image_size`, `quality`, `seed`, `guidance_scale`, `n` | `size` 支持 `2K/4K` 或指定宽高；提示词优化保守放开 `standard`。 |
| 火山引擎/豆包 | `doubao-seedream-4-0*`, `doubao-seedream-4.0*` | `resolution`, `response_format`, `watermark`, `optimize_prompt_mode` | `output_format`, `aspect_ratio`, `image_size`, `quality`, `seed`, `guidance_scale`, `n` | `size` 支持 `1K/2K/4K` 或指定宽高；提示词优化支持 `standard/fast`。 |
| 火山引擎/豆包 | `doubao-seedream-3-0-t2i*`, `doubao-seedream-3.0-t2i*` | `resolution`, `response_format`, `watermark`, `seed`, `guidance_scale` | `output_format`, `aspect_ratio`, `image_size`, `quality`, `n`, `web_search`, `optimize_prompt_mode` | `seed` 范围 `[-1,2147483647]`；`guidance_scale` 范围 `[1,10]`。 |
| Stability AI | `stable-image-*`, `core`, `ultra`, `sd3*` | `negative_prompt`, `aspect_ratio`, `output_format`, `seed`, `style_preset` | `image_size`, `resolution`, `quality`, `n`, `watermark` | Ultra/Core/SD3.5 文生图共同支持该子集；SD3.5 的 `mode/model/cfg_scale` 暂不暴露。 |
| FluxAPI/Mint | `flux-kontext-pro`, `flux-kontext-max` | `aspect_ratio`, `output_format`, `prompt_upsampling`, `safety_tolerance`, `enable_translation` | `image_size`, `seed`, `n`, `quality` | 快照字段为 `aspectRatio/outputFormat/promptUpsampling/safetyTolerance/enableTranslation`；比例仅 `21:9/16:9/4:3/1:1/3:4/9:16`；格式仅 `jpeg/png`；`safetyTolerance` 生成 0-6、默认 2；`enableTranslation` 默认开启，用于中文提示词自动翻译。 |
| BFL/Flux | `flux-2-*` | `image_size`, `output_format`, `safety_tolerance`, `seed` | `aspect_ratio`, `resolution`, `n`, `quality` | 使用宽高拆分发送；格式支持 `jpeg/png/webp`；`safety_tolerance` 为 0-5。 |
| BFL/Flux | `flux-1.1*` | `aspect_ratio`, `output_format`, `prompt_upsampling`, `safety_tolerance`, `seed` | `image_size`, `resolution`, `n`, `quality` | 与 FluxAPI/Mint 的 `flux-kontext-*` 分开判断，避免 camelCase/snake_case 混用。 |
| Ideogram | `ideogram-v4`, `ideogram/v4`, `v4` | `resolution`, `rendering_speed` | `prompt` 外的 v3 字段、`aspect_ratio`, `negative_prompt`, `n`, `seed`, `style_preset` | 官方 v4 文生图请求字段是 `text_prompt/json_prompt`，支持 23 个 2K `resolution`；`FLASH` 目前会 400，因此 UI 不显示。 |
| Ideogram | `ideogram-v3`, `ideogram/v3`, `V3`, `v3` | `negative_prompt`, `aspect_ratio`, `rendering_speed`, `style_type`, `magic_prompt`, `seed`, `n` | `resolution`, `image_size`, `quality`, `watermark`, `style_preset` | `aspect_ratio` 发送为 `1x1` 这种格式；`num_images` 范围官方为 1-8；`rendering_speed` 仅 `TURBO/DEFAULT/QUALITY`（`FLASH` 在 Generate 端点会 400，不开放）；`magic_prompt` 为 `AUTO/ON/OFF`；V3 官方风格字段为 `style_type`（`AUTO/GENERAL/REALISTIC/DESIGN`），不再使用旧版 `style_preset` 大预设表。 |
| 智谱 | `glm-image*` | `image_size`, `quality`, `watermark` | `aspect_ratio`, `resolution`, `seed`, `n`, `output_format` | `quality` 仅 `hd`；`watermark_enabled` 默认开启。 |
| 智谱 | `cogview-4*`, `cogview-3-flash` | `image_size`, `quality`, `watermark` | `aspect_ratio`, `resolution`, `seed`, `n`, `output_format` | 尺寸使用官方推荐枚举；`quality` 为 `standard/hd`。 |

## 模型名判断优化

- 先把模型名统一小写，并兼容 `provider/model`、`provider:model`、下划线和空格。
- 先匹配精确版本，再进入供应商兜底。例如 `wan2.7-image-pro` 和 `wan2.7-image` 分开，避免标准版误显示 `4K`。
- Gemini 别名也分层：`nano-banana-pro` 归 Gemini 3 Pro，`nano-banana-2` 归 Gemini 3.1，普通 `nano-banana` 才归 Gemini 2.5 Flash Image。
- `ideogram-v4` 在 `includes("ideogram")` 之前匹配，避免被误判为 v3。
- 未能精确归类的 `seedream-*`、`wan*` 走保守子集，只发送通用字段。

## 已核对来源

- OpenAI Images API: https://developers.openai.com/api/reference/resources/images
- OpenAI Image generation 指南（gpt-image-2 尺寸约束、不支持透明背景、moderation）：用户提供的 `Image generation _ OpenAI API.mhtml` / `Image generation _ OpenAI API2.mhtml`
- Google Gemini image generation: https://ai.google.dev/gemini-api/docs/image-generation（用户提供的 MHTML 快照，确认 Nano Banana 2 的 14 种比例、`thinkingLevel`、`response_format.image`）
- Google Imagen: https://ai.google.dev/gemini-api/docs/imagen
- AiHubMix GPT Image / Ideogram V3 / Gemini 新「智绘」（Imagen、Nano Banana 调用方式）：用户提供的 AiHubMix Documentation Hub/Hub2/Hub3/Hub5 MHTML 快照
- Nano Banana 2 开发文档（参数速查、思考模式、14 种比例）：用户提供的 `Nano Banana 2 Development Documentation Complete Guide ... .mhtml`
- 多平台图像/视频生成 API 参数调用手册（Ideogram V4 / Seedream / Wan / Qwen / Imagen / FLUX.2 / FluxAPI Kontext，2026-06-14）：用户提供的 `图像视频生成API参数调用手册_Ideogram_Seedream_Wan_Qwen_Imagen_FLUX_2026-06-14.docx`
- GPT Image-1.5（Leonardo 平台封装，确认尺寸与 quality 枚举）：用户提供的 `GPT Image-1.5.mhtml`
- Gemini 2.5 Flash Image 技术规范（确认支持的 10 种宽高比）：用户提供的 `Gemini 2.5 Flash 图片 _ Gemini Enterprise Agent Platform ... .mhtml`
- 智谱图像生成 API: https://docs.bigmodel.cn/api-reference/模型-api/图像生成
- Ideogram v4/v3 Generate: https://developer.ideogram.ai/api-reference/api-reference/generate-v4 和 https://developer.ideogram.ai/api-reference/api-reference/generate-v3
- BFL Flux 2 / Flux 1.1: https://docs.bfl.ml/api-reference/models/generate-or-edit-an-image-with-flux2-%5Bflex%5D-recommended-for-editing 和 https://docs.bfl.ml/flux_models/flux_1_1_pro
- Stability AI API Reference: 用户提供的 `/Users/dyx/Downloads/Stability AI - Developer Platform.mhtml`
- FluxAPI/Mint Generate or Edit Image: 用户提供的 `/Users/dyx/Downloads/Generate or Edit Image - Mint Starter Kit.mhtml`
- 阿里云百炼 Qwen-Image: https://help.aliyun.com/zh/model-studio/qwen-image-api
- 阿里云百炼 Wan 系列：用户提供的 Wan 2.7、Wan 2.6、Wan 2.1/V2、Wanx v1、局部重绘、涂鸦、通用编辑 MHTML 快照
- 火山引擎 Seedream：用户提供的 `/Users/dyx/Downloads/图片生成（Seedream 系列模型）--AI 数据湖服务-火山引擎.mhtml`

## 暂未在 Draw 文生图页启用

- 阿里局部重绘、涂鸦作画、通用图像编辑：需要输入图、蒙版、涂鸦图或编辑模式，当前 Draw 文生图页没有这些输入控件。
- Ideogram v4 `json_prompt`、Ideogram v3 `color_palette/style_codes/style_reference_images/character_reference_images`：需要结构化编辑器或文件上传，暂不启用。
- FluxAPI `enableTranslation/uploadCn/inputImage/webhookUrl/watermark`：当前 Draw 只覆盖文生图即时生成主路径。
