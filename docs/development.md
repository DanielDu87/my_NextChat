# NextChat 开发指南

> 本文档以当前代码为准（最后更新：2026-07-16）。开发过程中如发现内容与代码不一致，以代码为准并同步更新本文档。
>
> 相关文档：[README.md](../README.md)、[AGENTS.md](../AGENTS.md)、[CLAUDE.md](../CLAUDE.md)、[docs/db/nextchat-postgres-schema.sql](db/nextchat-postgres-schema.sql)。

## 对话失败自动故障转移

`app/store/chat.ts` 统一负责首次请求和后续候选请求；普通聊天不再区分“普通模式”和旧系列“自动模式”。请求遇到网络异常、非成功 HTTP、API 错误 payload 或空响应后，会清空失败正文并沿 `app/utils/chat-failover.ts` 生成的候选队列串行重试。当前模型之后，先尝试当前 API 供应商中与当前模型同厂商的其他模型，再按模型厂商显示名称首字母递增尝试当前供应商的其他厂商模型，最后按供应商显示名称首字母递增尝试其他供应商；其他供应商内部同样按模型厂商分组和模型选择器顺序展开。厂商归属统一使用 `getModelDisplayGroup()`，厂商与供应商名称排序使用 `compareProviderDisplayNames()`，每个厂商内的模型使用 `compareModelsBySeriesVersion()`，保证最新版本优先且与模型选择器显示逻辑一致。用户停止或页面中断时不继续跨模型重放；已执行工具调用后的失败会立即保留 blocked 状态并终止候选队列，不得重放原始请求或重复执行具有副作用的工具。

候选队列不读取 `type` / `types` / `features` / `capabilities` / `category` / `categories`，也不根据模型名称排除候选；所有名称有效且标记为可用的模型都可参与重试。助手消息的 `retryAttempts` 只持久化尝试序号、供应商、模型和 `trying` / `failed` / `success` 状态，不保存上游错误原因。

发送阶段必须从 `customModels` 中按原始供应商 ID 恢复全部已添加模型，不能为已经带 `custom_` 前缀的 ID 再重复增加前缀；否则候选队列会退化为只有当前模型。每个候选请求的临时 `modelConfig` 必须同时覆盖 `providerId` 和 `profileId`，不能继承首次请求的旧 Profile 身份，否则跨 API 候选会继续请求原 API 的 Base URL 和 Key。多 Key 请求只在真实 Key 数量范围内重试，最后一个 Key 失败后立即结束当前模型尝试并进入模型级故障转移，不得生成 `index-N` 虚拟分组；未配置备用 Key 的日志只表示跳过 Key 层重试，不影响模型和供应商故障转移。对话消息头像保存候选的最终模型厂商分组名称，复用 `getProviderIcon()` 显示与模型选择器一致的厂商图标；无法识别模型厂商时回退 API 供应商图标，最后才使用浅绿色默认图标。
多 Key 切换使用有上限的指数退避和随机抖动；退避定时器必须跟随当前请求的 `AbortController`。用户停止或请求超时时立即取消待执行的 Key 重试，定时器回调在发请求前再次检查终止信号，不得在已停止的 controller 上继续发起后续 Key 请求。每轮请求的超时器在连接关闭或出错时必须立即清除，不能跨轮次误中止后续 Key。

对话界面渲染助手头像时，以消息最终保存的 `model + providerId` 精确匹配运行时模型，并重新计算最终模型厂商分组；因此自动重试成功后的消息和缺少旧 `modelIcon` 字段的历史消息都会显示最后实际使用模型的厂商图标。消息头直接使用模型 `Avatar`，不再被会话 Mask 自定义头像覆盖；只有模型厂商和 API 供应商都没有本地图标映射时，才允许显示浅绿色默认图标。

空流式响应以及 Markdown 代码围栏包裹的结构化错误必须进入失败回调，不能作为助手正文完成当前候选。长时间重试期间即使后台同步替换了会话对象，每次候选开始、失败、流式更新和成功结果也必须按消息 ID 写回当前 store 的最新消息，保证界面完整显示全部 `retryAttempts` 和最终成功正文，不得停留在已脱离 store 的旧消息引用。

模型请求明确返回 HTTP 402，或响应错误码、错误文案表明余额、额度、配额、点数或计费状态不足时，视为当前 API 配置整体不可继续使用：记录触发该判断的失败模型后，跳过相同 `providerId` 的全部剩余候选，直接尝试下一个 API 供应商。普通 HTTP 403、模型无渠道、模型不存在、限流、网络错误和单模型权限错误不能单独触发供应商跳过，仍按当前供应商内部模型顺序继续故障转移。

模型获取、持久缓存和内存缓存必须保留供应商返回的完整模型列表，模型管理器浏览模式展示完整获取结果；“已添加”、聊天模型选择器和绘图模型选择器仅按用户主动添加结果展示，不再叠加模型名称、类别、能力或端点过滤。AihubMix 只补充目录顺序和供应商显示信息，不再请求、缓存或合并分类元数据；发布时间维护脚本也只维护发布时间，不再写入模型类别或能力字段。用户负责选择适合当前入口的模型。

首页控制台的 `[Sync] API配置已添加模型数量` 只统计 Config `customModels` 中带明确供应商后缀、当前已经添加到选择器的条目；不得使用模型缓存、接口完整数量或内存完整列表回退。模型获取页面的 `【模型总数】` 才表示上游接口返回的完整数量。

API 配置页的“导出全部配置”会按当前 `apiProfiles` 逐条调用同一套 `fetchFromProvider()` 模型获取逻辑，不直接复用旧缓存。每个 JSON 文件包含完整配置、最新模型数组、模型数量以及以最终 `vendor.name` 为键的 `groups` 模型分组；文件名按配置名称清理非法字符。浏览器支持 File System Access API 时，用户选择桌面作为父目录后会创建 `NextChat-API配置-*` 文件夹；不支持时回退为逐个下载 JSON 文件。

请求发送阶段允许保留图片、视频、语音等接口路由判断，因为它决定请求路径和参数格式；该判断不得用于模型获取、缓存、列表显示或故障转移候选过滤。

系列识别覆盖 GPT、OpenAI o 系列、Claude、Gemini、DeepSeek、豆包、Qwen、Llama、Mistral、Mixtral、Command R、ERNIE、ChatGLM/GLM、Spark、Baichuan、InternLM、混元、Moonshot/Kimi、MiniMax，并为其他带稳定名称前缀的模型提供兜底识别。同系列模型名按自然分段逐项比较：文字逐字符升序，对应位置的数字按数值降序；第二段及后续文字、数字必须继续参与比较，例如 `claude-3-7` 排在 `claude-3-5` 前，`alpha` 排在 `beta` 前。名称结束但另一侧仍有数字版本段时，缺失段按 `0` 处理，因此 `sonnet-4.6` 排在 `sonnet-4` 前。只有全部分段相同时才按完整名称稳定排序，不再用发布时间覆盖严格名称顺序。

`app/utils/model-series-order.ts` 是故障转移、聊天模型选择器和模型管理器共用的系列排序 owner。聊天选择器的 API Profile 菜单、模型管理器的 Profile 菜单，以及模型商分组均按显示名称首字母排序，例如 DeepSeek 位于 OpenAI 之前；每个分组内部调用 `compareModelsBySeriesVersion()`，浏览可添加模型和“已添加”模式不得分别维护另一套顺序。通用 `Selector` 仅在显式传入 `sortGroupsAlphabetically` 时启用该分组顺序，避免影响非模型选择器。

模型商分组必须显示公司或供应商品牌，不能以模型家族代替：Claude → Anthropic、Gemini/Gemma/Veo → Google、GPT/Codex → OpenAI、GLM/ChatGLM → Z.ai、Qwen/Wan → Alibaba、Grok → xAI、Kimi → Moonshot。兼容接口中的 `chatglm_*`、`gemini_omni`、`veo_query`、`wanx*`、`BAAI/*` 也执行相同归属规则；`auto` 等系统自动选择始终归入 `CUSTOM`。Ocoolai 的 17 个专有工具模型由共享白名单固定合并为 `Ocoolai`，不得按完整模型名拆成伪分组。

模型商筛选菜单必须按 `getGroupFilterLabel()` 产生的最终可见名称排序，不能按后端原始分组键排序。`getModelVendorGroupName()` 是选择器、聊天模型菜单和设置模型下拉框共用的唯一分组名称入口：同一 `PROVIDER_ICONS` 本地图标资源的全部别名必须收敛到同一个可见名称，且同一个可见名称不得映射到不同图标。保留“全部模型商”入口；旧缓存或供应商元数据中的中文模型商品牌映射为 Qwen、Doubao、Z.ai、iFLYTEK Spark、Tencent Hunyuan、ERNIE、01.AI 等官方英文名称，并保留 FLUX、NVIDIA、MiniMax 等官方大小写。新名称只作为原图标路径的别名，不替换图标文件；没有本地图标资源的模型商在分组和模型行统一使用 `public/llm-icons/default.png` 的项目内置浅绿色默认图标，不得回退成 OpenAI 图标。

ElevenLabs、Mureka 与 SiliconFlow 的分组和模型行使用 `public/provider-icons/elevenlabs.svg`、`public/provider-icons/mureka.png`、`public/provider-icons/siliconflow-bg.svg` 官方品牌资源；Kwai Kolors 复用既有 Kwaipilot 官方图标，ChatGLM 复用智谱官方图标。`StepFun`、`StepFun AI`、`StepFun Al`、`StepFun-AI`、`Step Fun` 与“阶跃”在新获取、旧缓存、分组显示和筛选中统一为 `StepFun`，并统一使用 `public/provider-icons/stepfun.png`；该图标与 Suno 在模型商筛选菜单和模型明细行复用 `selector-group-filter-icon-frame`。`selector-group-filter-icon-image-fill` 铺满 `32px` 父容器后再按 `1.14` 放大，由父容器圆角裁切资源自带的透明留白，使图形紧贴边框且不修改图标文件。任何没有本地官方资源或曾指向失效资源的模型商（当前包括 Fireworks、Groq、Together、Yuto、InternLM、Ocoolai）在模型管理器、选择器与会话头像中统一使用 `public/llm-icons/default.png` 浅绿色默认图标，禁止回退成 OpenAI 图标。

模型获取页保存了完整 `modelFetchUrl` 时，客户端请求优先使用该 URL 和模型获取专用 Key；旧配置及既有同步缓存继续保留原有兼容链路，不能因新字段缺失而停止获取。余额页保存完整查询 URL 时按该 URL 请求；根路径或仅带查询参数的有效 `http/https` URL 同样视为已保存端点。旧配置仍保留既有兼容读取方式，不能因新校验误提示“未保存 URL”。日志应保留配置名称、模型数量、状态和耗时等业务数据，但必须脱敏访问码、密码、认证头及 URL 查询参数中的凭据。

模型商归属不属于模型类别过滤。`app/utils/model-vendor-normalize.ts` 是前端获取、旧缓存归一化与服务端同步共用的厂商名称规范入口：先读取上游模型对象中的 `vendor / developer / owned_by / owner / organization` 等声明字段，并规范为现有模型商分组；声明值若与当前模型 ID 相同，说明上游误把模型名填进 `owned_by`，必须忽略并回退模型 ID 推断；这些字段为空或仅为 Custom、Unknown、System 等通用占位时，同样使用模型 ID 与命名空间推断；官方直连或自定义配置的模型仍无法识别时回退其配置的模型商。Ocoolai 旧缓存若把格式化后的完整模型 ID 写进 `vendor.name`，加载时也必须重新归属：`net- / network-` 前缀会先剥离再推断，`net-gpt-*`、`net-glm-*`、`nano_banana / nano-banana-*`、BCE Reranker 等不再生成伪分组；命名空间为路由商但斜杠后为真实模型 ID 时优先按后者归类，例如 `Ascend / Azure / HiSpeed / ocoolAI / ocoolAl` 的 DeepSeek 模型归入 DeepSeek；OpenAI 的 Babbage / Davinci / Text Embedding、Google 的 Gecko / Embedding-001、智谱的 CodeGeeX / ChatGLM、Luma Video 与 Alibaba Z-Image 等也归入各自厂商。没有可识别上游厂商的 Ocoolai 专有模型才统一归入 `Ocoolai`。Yuto 缺失 `vendor_id` 的模型必须按已知官方模型系列补齐模型商，且客户端加载旧缓存时也要重新规范：Act Two、Aleph、Gen3/Gen4 → Runway，Eleven/Scribe/Dubbing → ElevenLabs，Flux Tools → FLUX，Kling 全系列 → Kling AI，`vidu2.0 / viduq*` 全系列 → Vidu，Moonshot/Kimi 全系列 → Moonshot；`Seed / Seedream / Seedance` → ByteDance，QVQ/Wan/HappyHorse → Alibaba，Yi → 01.AI，Spark → iFLYTEK Spark，Command → Cohere，Baichuan → Baichuan，InternLM → InternLM，Jamba → AI21，BGE → BAAI，LongCat → Meituan，Ling/Ring → InclusionAI。并覆盖 Midjourney、Mureka、Luma、Suno、PixVerse、Viggle、Cursor Composer、Xiaomi MiMo、MiniMax Image、Google Veo/Gemma/Nano Banana、Alibaba Wan、StepFun、Nvidia Nemotron。Yuto 当前返回的 Kling `vendor_id=33 / 快手` 统一显示为 Kling AI，Vidu 系列的 `vendor_id=35` 保持官方英文名称 Vidu；无法识别的命名空间才允许使用斜杠前缀兜底。补充归属不得删除或隐藏任何模型。

模型名精确为 `auto`、`automatic`、`default`、`system` 或“自动/默认/系统”时属于系统自动选择，不代表上游模型商；必须在所有自定义模型商下固定归入 Custom，并以最高优先级覆盖上游返回的 `vendor_id / developer_id / owned_by` 等字段和配置模型商兜底规则。Custom 分组和模型行统一使用项目内置浅绿色默认图标。

模型管理器“全部模型商”筛选必须展示 `CUSTOM`，便于筛选 Auto 等系统选择模型；仅“已添加/Added”作为状态分组继续隐藏。

模型管理器手动获取或重新获取当前 API Profile 的模型时，控制台使用现有 `[ModelManager]` 格式输出两条状态日志：`🔄 正在获取 <平台> 平台的模型...`，成功后输出 `✅ 已获取到 <平台> 平台的模型 <数量> 个`。仅在取得至少一个模型后输出成功日志，不输出 API Key、请求地址或模型完整列表。

模型选择器达到虚拟列表阈值后，分组行仍必须保留估算高度并渲染在模型列表中；固定标题层覆盖当前真实分组行，并抵消自身布局占位，避免首个或切换中的供应商标题重复或闪烁，固定标题层不能替代真实的供应商分组边界。

重试状态 UI 与插件状态行共用同一个 `.chat-message-tools` 容器和 `.chat-message-tool` 行：使用相同的灰色 `12px` 文字、行高、上下间距、左侧缩进和移动端归零规则，不额外绘制卡片、边框或彩色状态。每个候选独占一行，格式为 `<对话尝试中> 供应商 / 模型`、`<对话尝试失败> 供应商 / 模型` 或 `<对话尝试成功> 供应商 / 模型`。

工具真正开始执行前的 `onBeforeTool` 必须立即按消息 ID 将工具写回当前 Chat Store，不能等待工具返回或后续模型正文才刷新 UI；`onAfterTool` 同样立即写回成功或失败结果。搜索工具一旦出现在当前助手消息的工具列表中，只要该消息仍处于 `streaming` 状态，搜索工具行就持续显示三点省略号动画；工具返回不能提前隐藏，只有整条回答成功、失败或被停止后才隐藏。动画在亮色主题使用页面 `var(--primary)` 主题蓝色，暗色主题固定使用中性浅灰 `#c8cbd2`。

候选成功后必须走全局模型的 localStorage-first 链路：先将成功候选写入当前会话的手动模型选择记录和 `nextchat:global-model-config`，再更新当前会话、Config Store 与 Access Store，最后后台同步 `Config` / `Access` / `Chat`。因此当前消息、页面顶部模型选择器、下一轮请求、后续新对话和跨用户默认模型都会立即切换到成功候选；旧的会话级手动选择记录不能覆盖自动重试成功结果。对话页余额栏必须优先使用最近一次重试成功消息保存的 `profileId` / `providerId`，不能在会话配置异步同步期间继续显示原 API 的余额；回复完成后触发的自动余额查询也必须查询并写回该成功 API 对应的 Profile。API 切换或状态同步导致在途余额请求被主动取消时，必须释放对应刷新信号，让稳定后的最终 Profile 自动重新查询，不能把已取消请求误记为已完成。对话页自动余额查询在刷新信号稳定 250ms 后再发起，成功后必须通过统一 `[Chat]` 日志输出最终 Profile 和余额值。自动重试始终启用，不提供按钮、设置项或人工上限。

自动标题和手动“刷新标题”只使用当前对话最终保存的模型及其 API 配置，不再固定使用 `gpt-4o-mini`，也不为标题生成切换其他模型或其他供应商。主对话发生故障转移时，必须先把成功候选写入当前会话和全局模型，再触发标题生成，保证标题请求使用刚刚验证可用的最终模型；自动或手动标题遇到 `Failed to fetch`、网络错误或空连接等瞬时网络异常时，在同一模型和同一 API 上等待 400ms 后重试一次，不得借此切换候选。每个会话同时只允许一个自动或手动标题请求，页面初始化和正文水合安排的延迟补全在该会话仍有主对话请求或标题请求时跳过。标题请求开始时记录消息数量、最后消息 ID / 时间和最终模型、`providerId`、`profileId`；返回时任一身份发生变化都视为过期结果并禁止写回。手动刷新也必须在请求配置中显式传递当前最终 `providerId` / `profileId`，并保留请求锁、版本校验、网络重试、页面提示与完整日志逻辑；桌面端隐藏“刷新标题”按钮，移动端同位置的“新建聊天”按钮保持显示。标题成功时必须原子更新 `session.topic` 与 `session.mask.name`，防止后续同步用旧 Mask 名称覆盖页面，并通过统一 `[Chat]` 日志输出 Store 中的最终 Profile、模型和标题；标题请求最终失败时保留现有回退标题，不影响已经成功的主对话和模型选择状态。标题上下文只包含非错误且正文非空的消息。

历史内存摘要同样只使用当前对话最终保存的模型及其 API 配置，不再查找 `gpt-4o-mini` 或回退 AihubMix。每个会话同时只允许一个摘要请求；摘要输入只读取该目标会话的旧内存和最早一批尚未摘要的有效消息，按 `historyMessageCount` 与 `compressMessageLengthThreshold` 分批推进 `lastSummarizeIndex`，不能再用回复输出参数 `max_tokens` 裁剪输入或直接跳到会话末尾。摘要请求固定非流式并使用独立的 1000 Token 输出上限；流式/临时结果只保存在局部变量中，只有 HTTP 200、正文非空且不是 API 错误 payload 时，才一次性提交 `memoryPrompt` 与索引，失败时保留原摘要和原索引供后续重试。各平台客户端必须让请求级配置覆盖当前打开会话配置，保证后台处理非当前会话时仍使用目标会话的模型参数。该优化不修改会话持久化结构，也不重算、清空或迁移已有 `memoryPrompt`、`lastSummarizeIndex`、`clearContextIndex`；旧会话继续按原字段恢复上下文，只有达到下一次摘要阈值时才从原索引继续增量摘要。

控制台日志统一使用 `🔄 对话请求尝试`、`✅ 对话请求尝试成功`、`❌ 对话请求尝试失败`、`⏹️ 对话请求已停止`。预期中的模型和多 Key 分组故障转移使用普通日志级别，避免浏览器为每次候选失败展开告警调用栈；请求日志只保留尝试序号、供应商、模型和精简原因，不输出上游完整错误正文或 Request ID。临时 API Profile 只服务于同步生成请求参数，不再输出容易被误解为请求生命周期的“请求结束”日志。余额刷新被组件卸载或模型切换主动取消时按 `⏹️` 调试日志记录，不作为查询错误。

## 页面打开日志

四个核心页面在浏览器端打开时会立即向 DevTools Console 打印一条 `📋` 摘要日志，便于排查"页面打开后没看到配置/备份/余额"类问题时直接比对。日志都在客户端发起 `fetch` 并拿到响应后打印，不需要登录服务端容器。

### 输出格式

| 页面                 | 日志标签                 | 示例输出                                                                                                                                            |
| -------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api_config`        | `[API Config] 📋`        | `[API Config] 📋 已读取 API 配置（7 个）：AihubMix、Ocoolai、YutoAPI、ToAPI、DeepSeek、晴辰云、OpenRouter`                                          |
| `/backup/api_config` | `[API Config Backup] 📋` | `[API Config Backup] 📋 已读取 API 配置备份（10 条，最新 2026-07-09 23:33:22（auto，7 条配置））`                                                   |
| `/backup/chat`       | `[Chat Backup] 📋`       | `[Chat Backup] 📋 已读取对话备份（3 个批次）：2026-07-09 23:33:23（auto/incremental，2 个用户，181 个会话 / 520 条消息；ccc 122 个会话，alice 59 个会话）` |
| `/balances`          | `[Provider Balance] 📋`  | `[Provider Balance] 📋 已读取余额配置（7 个：Ocoolai、AihubMix、DeepSeek、OpenRouter、ToAPI、YutoAPI、晴辰云；已存管理 Key 6 个，已查过余额 7 个）` |

### 触发位置

- `/api_config`：`app/components/api-config.tsx` 的 `useEffect` 监听 `accessStore.apiProfiles` 变化；进入页面与配置变更都会重打。
- `/backup/api_config`：`app/components/api-config-backups.tsx` 的 `load()` 拿到 `/api/db/api-config-backups` 响应后。
- `/backup/chat`：`app/components/chat-backups.tsx` 的 `load()` 拿到 `/api/db/chat-backups` 响应后；任何登录用户均读取全局备份批次。新建手动备份和自动扫描轮次以 `backup_chat_runs.batch_id` 聚合，`backup_chat_batches` 与 `backup_chat_batch_members` 另行记录每位用户的创建、跳过或失败结果；历史 `batch_id IS NULL` 的单用户记录保持独立显示，不与其他旧记录猜测合并。
- `/balances`：`app/components/provider-balances.tsx` 的 `load()` 拿到 `/api/db/provider-balance` 响应后；带 profile 名称、已存管理 Key 数和已查询余额数。

### 故障对照表

| 日志内容                                    | 含义                                | 排查方向                                                                               |
| ------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------- |
| `已读取 API 配置（0 个）`                   | 当前用户没有 apiProfiles            | 检查 `DEFAULT_SYNC_USER_ID`、登录账号；服务端 `/api/db/sync/access-control` 是否被覆盖 |
| `已读取 API 配置备份（0 条，暂无备份）`     | 该用户在 `nextchat_backup` 库无备份 | 检查 `BACKUP_PG*` 环境变量、SSH 隧道；`degraded: true` 表示备份库连接失败              |
| `已读取对话备份（0 个批次）`                | 全局没有对话备份                    | 检查 `BACKUP_PG*` 环境变量、SSH 隧道和备份库连接                                       |
| `已读取余额配置（0 个）`                    | 没有 profile 可查                   | 先打开 `/api_config` 确认 `apiProfiles` 不为空；`provider-balance` API 是否可达        |
| 日志中 `降级返回`                           | 备份库临时不可达                    | 检查 `BACKUP_PGHOST/PORT/USER/PASSWORD`、SSH 隧道；`postgres-ssh-tunnel` 容器健康度    |
| `password authentication failed`            | 备份库密码错误                      | 检查 `.env.baota` 中 `BACKUP_PGPASSWORD` 与备份库实际密码是否一致                      |
| `no pg_hba.conf entry for host "172.x.x.x"` | PostgreSQL 不允许该 IP 连接         | 检查服务器 `/www/server/pgsql/data/pg_hba.conf`，必须包含容器 IP 网段的 `md5` 规则     |
| 日志中 `已存管理 Key X 个` 比 profile 数少  | 部分 profile 缺管理 Key             | `/balances` 页面为对应 profile 补填即可，不影响 API 调用                               |

## Schema 版本与迁移

- 主业务库：`app/utils/server/postgres.ts` 的 `SYNC_STORAGE_SCHEMA_VERSION`，当前值 `"2026-07-14-provider-model-key-route-cache"`。
- 独立备份库：`app/utils/server/backup-postgres.ts` 的 `BACKUP_STORAGE_SCHEMA_VERSION`，当前值 `"2026-07-16-chat-backup-batch-audit"`。
- 一旦在 `ensureSyncStorageSchema()` / `ensureBackupStorageSchema()` 内新增 `ALTER TABLE` 或 `CREATE TABLE`，**必须同步 bump** 上述版本号常量。否则旧容器在缓存锁住 `globalThis.__nextchatSyncStorageSchemaReady` / `__nextchatBackupStorageSchemaReady` 时不会重跑迁移，新结构永远不会落库。
- 完整 DDL 与历史变更：`docs/db/nextchat-postgres-schema.sql`。

## 模型获取、分组与缓存

- 网页模型获取统一从 `/model-fetch` 手动执行。每个 API 配置必须显式保存 `modelFetchUrl` 与 `modelFetchApiKey`；模型管理器不再复用余额 Key，也不再自动猜测供应商模型路径。模型获取页面进入时仅输出一次当前配置概览；单个获取与全部并发获取继续输出本次操作的结果日志。专用 Key 继续通过 `provider_api_keys` 的 `model-fetch` 密钥项加密保存，URL 保存在 `provider_configs.request_config.modelFetchUrl`。
- 每个 API 配置成功获取完整模型列表后，系统会自动移除该配置下不在最新结果中的新式 `+模型@供应商`、禁用 `-模型@供应商` 及历史 `模型@供应商` 条目，并立即同步 Config；其他配置及没有供应商后缀的全局手写模型不受影响，获取失败时不执行清理。
- 模型获取成功且 Config 清理同步完成后，控制台输出 `【模型清理】无需清理（0 个）`，或输出需要清理数、已清理数并用 `【清理模型】` 逐行列出名称；批量获取也保留该清理结果，但不恢复公司分组和完整模型明细。

- 配置了 `modelFetchUrl` 后，获取器只请求该完整 URL，并且只使用 `modelFetchApiKey`；不得加入业务 Key、分组 Key、余额 Key、历史路径或通用候选，也不得在失败后自动改换路径。指定 URL 可以与供应商 Base URL 使用不同域名，代理目标以指定 URL 的 origin 为准。单个获取失败只报告错误并保留现有模型缓存；“全部获取”对所有已完整配置的供应商并发执行。
- 模型商归属的共享规范入口是 `app/utils/model-vendor-normalize.ts`，前端模型列表、持久化旧缓存和服务端同步应保持同一规则；上游真实声明优先，缺失时才按模型 ID 推断。
- Ocoolai 历史缓存若把完整模型 ID 写入 `vendor.name`，加载时会重新推断；`net/network` 仅视为路由前缀，斜杠命名空间会继续检查后续真实模型段。无法识别的旧条目回退到 Ocoolai，不生成按模型 ID 拆分的伪供应商。
- 模型管理器、聊天选择器和绘图选择器不按能力或端点隐藏已获取模型；排序和分组只改变展示元数据，不删除上游结果。

## 引用追踪与软删除

- `cache_file_references(cache_file_id, user_id, message_id, last_seen_at)`：消息写入时 `replaceConversationMessages` 批量 upsert，删除缓存文件前 `removeOwnedCacheFile` 先查此表（O(1)），仅当旧消息未登记时回退 LIKE 兜底。
- `conversations.deleted_at timestamptz`：与 `is_deleted` 配对的软删除时间戳，partial 索引 `idx_conversations_user_deleted_at WHERE is_deleted = true` 给增量备份识别最近被删除的会话使用。
- 相关代码：`app/utils/server/cache-file-repository.ts`、`app/utils/server/chat-conversation-repository.ts`、`app/utils/server/chat-backup-repository.ts`（`getChangedSessionIds` 含 `or c.is_deleted = true`）。

## 首屏数据汇总日志（admin / 本地免登录 ccc）

`app/utils/usage-summary-log.ts` 的 `logPageOpenUsageSummary()` 在 `home.tsx` 首次 bootstrap 完成聊天、API 配置、模型设置和插件同步后调用一次；因此首页控制台读取的是本轮同步后的最终快照，而不是首屏水合中的本地缓存。固定输出以下五类数据：

- `/api/admin/users` → 分用户对话数与总绘画数
- `useAccessStore.apiProfiles` + `useModelCacheStore.profiles` → 每个 API 配置的模型数
- `usePluginStore.plugins` + `deletedPluginIds` + `BUILTIN_PLUGIN_ID_SET` → 活跃插件总数
- `app/store/sync.ts` → 当前用户的对话同步结果（新增、删除、当前、本地、远端数量）

底层其他 store 的同步过程日志保持静默；聊天页后台余额刷新成功时也不输出首页噪声，余额页面的手动查询日志不受影响。

注意：日志函数不要按 `user.role === "admin"` 早退——本地免登录 `ccc` 用户的 `role` 是 `"user"` 不是 `"admin"`，按角色门禁会导致 ccc 永远看不到汇总。

## 路由切换同步去重

`app/utils/route-sync-entry.ts` 提供 `markRouteSyncBootstrap()` / `shouldSkipAutoSyncByRecentBootstrap()` / `resetRouteSyncBootstrap()` 共享去重窗口（默认 5 秒）。`home.tsx` 的 home-bootstrap 在调用 `syncChatOnStartup` 前调 `markRouteSyncBootstrap("home-bootstrap")`；`auto-sync.tsx` 的 `attemptAutoSync` 用 `shouldSkipAutoSyncByRecentBootstrap()` 判定，命中即跳过；路由切换时 `resetRouteSyncBootstrap()` 清空窗口。

切换用户与路由切换时**不再** abort sync（`shouldCancelForRouteChange` 已返回 `false`、home.tsx 的 useEffect cleanup 只设 `cancelled`），避免把目标用户的首次同步掐断造成「新用户看不到对话」。

## 对话本地缓存与用户切换

聊天列表与最近会话正文保存在浏览器 IndexedDB，缓存键和索引 payload 都绑定当前有效用户 ID。每个用户首开或切换时先展示最近 50 个会话；继续下滑时按页展开更早历史，会话正文仍按需读取。切换用户时先恢复该用户已经验证归属的本地缓存，再以 `downloadOnlyChat` 静默拉取该用户远端增量。缓存读、写和分片删除都受当前内存已水合用户锁保护，旧用户遗留的异步任务不能访问或修改目标用户分片；切换代次会丢弃较早异步任务的结果，避免快速连续切换回写旧状态。远端增量完成后始终从 IndexedDB 重建侧边栏索引，确保新会话即时可见。旧版没有用户归属标记的缓存不会再迁移或直接展示，以免把任一账号的历史会话混入另一个账号；它会在该用户下一次同步后以带归属的新缓存格式重建。浏览器缓存用量达到可用配额的 80% 时仅记录一次预警，不自动删除任何本地历史。

会话正文异步水合期间允许用户立即发送消息。水合结果写回内存前必须检查会话是否已被本地交互更新；若已更新，则以消息 ID 合并持久化历史和水合期间新增或更新的消息，并保留当前会话配置，禁止旧快照覆盖刚发送的用户消息。

聊天页随首屏直接加载 Markdown 渲染器。用户提交后必须在同一次状态更新中立即显示真实用户正文，以及带模型头像和三点动画的助手回复区域；助手占位消息只用于界面反馈，构造模型请求上下文时必须按消息 ID 排除。不得把渲染器代码分片的加载占位省略号显示在用户消息中；三点动画只用于尚未收到正文的助手回复或明确的后台工具状态。
