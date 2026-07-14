# HANDOFF

记录最近 10 条关键修改。最新记录置顶，历史从新到旧排列。每条记录标题格式为 `## 序号. 【YYYY-MM-DD HH:MM】- 标题`，序号持续递增，最大 999，达到后从 1 开始。超过 10 条时自动删除底部最旧记录。实质修改完成并验证后更新一次，创建 commit 前核对并一起提交.

============================================================

## 89. 【2026-07-14 22:19】- 全量修复模型商图标回退与失效映射

### 修改内容

- 审计全部模型商图标映射后，修复 ChatGLM、Fireworks、Groq、Together、Yuto 等历史失效资源路径；未知模型与无本地官方图标的模型商不再错误显示 OpenAI 图标。
- `StepFun`、`StepFun AI`、`StepFun Al` 等全部变体统一显示为 StepFun，并使用同一个独立 StepFun 图标。
- 全部模型商分组统一经共享入口归一：同一品牌的上游别名、旧缓存名称和图标资源不再拆成多个分组。
- AiHubMix 模型获取由按 Key 权限返回 350 条的 `/v1/models` 改为官方完整目录 `/api/v1/models`，避免平台总数被错误截断。
- 多路径模型探测改为合并全部成功响应，并自动缓存模型数量最多的路径。
- 模型管理器和服务端同步均将余额查询管理 Key 作为模型获取兜底；Oc​​oolai 的 KAT 系列统一归入 Kwai Kolors。
- 多 Key 模型获取改为同一路径下的 Key 并发请求，并按每个 Key 的独立成功路径写入数据库缓存。
- 候选模型接口改用 5 秒超时；全部 Key 都命中独立缓存时只请求缓存路径，跳过 55 条通用回退。

### 实现方式

- ChatGLM 复用现有智谱官方图标；没有可用本地官方资源的 Fireworks、Groq、Together、Yuto、InternLM、Ocoolai 统一由共享 `Avatar` 渲染浅绿色默认图标。
- 移除 4 条指向不存在文件的配置映射与 `Other` 的 OpenAI 映射；全量脚本确认剩余 `PROVIDER_ICONS` 资源路径均存在。StepFun 的上游别名、旧缓存显示和筛选键均在共享规范表中收敛为同一名称与图标。
- `getCanonicalProviderKey()` 按本地资源确定稳定品牌键，`getModelVendorGroupName()` 供选择器、聊天菜单和设置下拉框统一使用；同一图标的别名与同一名称的图标均由静态审计双向校验。
- 前端代理和服务端同步共用 AiHubMix 完整目录策略，并补齐 `model_id / model_name` 数组识别；浏览器侧模型探测仅放行该固定项目内部目录路由。
- 前端和服务端都不再以首个成功接口作为唯一结果；模型按既有名称键去重合并，后续读取路径选择返回模型数最多的一条。
- 余额查询 Key 仅在请求内临时插入到模型 Key 与业务分组 Key 之间，不写回访问态或模型分组。Ocoolai 实测其余额 Key 可访问授权分组接口，6 个授权分组合计返回 1068 条模型；KAT / Kat Coder / Kat Dev 的新旧名称均收敛到 Kwai Kolors 官方图标。
- `provider_model_key_routes` 以供应商配置和 Key 的 SHA-256 指纹为唯一键保存路径、认证方式和模型数量；每次服务端同步先尝试这些路径。实测 Ocoolai 7 把 Key 并发请求约 8.1 秒，其中 4 把成功 Key 的 `/v1/models` 缓存均写入并成功读回。
- AihubMix 正式完整目录实测返回 807 条（忽略大小写后 799 条），OpenRouter 正式归一主路径 `/api/v1/models` 返回 343 条；YutoAPI 全量多 Key、多路径合并 849 条（忽略大小写后 848 条）。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false`、`git diff --check` 均通过。
- 图标路径全量审计输出 `ALL_PROVIDER_ICON_FILES_EXIST`；本地与 `nextchat-dev` 容器目标文件 SHA-256 一致。
- 全量核对 `156` 条供应商图标别名与 `77` 组图标资源，双向确认不存在名称或图标冲突。
- AiHubMix 浏览器模型探测和服务端完整目录读取均返回 `805` 个唯一模型；`/v1/models` 的 `350 → 349` 结果不再作为平台模型总数。
- Ocoolai 多路径实测中，同一 `/v1/models` 对不同已配置 Key 分别返回 219、558、262、9 个模型，验证必须跨 Key 合并，不能以首个成功结果作为平台总数。

### 潜在或遗留问题

- 无。

============================================================

## 88. 【2026-07-14 15:33】- 补齐 Kwai、SiliconFlow 与 StepFun 图标

### 修改内容

- Kwai Kolors、SiliconFlow、StepFun AI 的模型商分组和模型行均显示对应官方品牌图标。

### 实现方式

- Kwai Kolors 复用既有 Kwaipilot 官方图标，StepFun AI（兼容 `StepFun Al`）复用既有 StepFun 官方图标；新增 SiliconFlow 官方 favicon 封装的本地 SVG 图标。
- 图标映射和模型商归一化同时覆盖英文、空格和中文别名，保证新获取模型与旧缓存都可命中；StepFun 变体沿用既有铺满图标框规则。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 和 `git diff --check` 均通过。
- `http://127.0.0.1:3000/provider-icons/siliconflow-bg.svg` 返回 200；本地与 `nextchat-dev` 容器目标文件 SHA-256 一致。

### 潜在或遗留问题

- 无。

============================================================

## 87. 【2026-07-14 15:29】- 补充模型管理器获取状态日志

### 修改内容

- 手动获取或重新获取模型时，控制台显示当前平台的开始状态与最终获取数量。

### 实现方式

- `AddModelSelector` 在请求发起后输出 `[ModelManager] 🔄 正在获取 <平台> 平台的模型...`，取得并去重模型后输出 `[ModelManager] ✅ 已获取到 <平台> 平台的模型 <数量> 个`；不输出 API Key、请求地址或模型列表。
- 开发指南同步模型管理器控制台日志契约。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 和 `git diff --check` 均通过。
- 本地与 `nextchat-dev` 容器内 `app/components/add-model-modal.tsx` SHA-256 一致，热加载已同步。

### 潜在或遗留问题

- 无。

============================================================

## 86. 【2026-07-14 15:23】- 统一无图标模型商的默认图标

### 修改内容

- CherryIN 返回的 `Agent` 等没有固定分组图标的模型商分组及其模型行，统一显示浅绿色默认图标，不再显示首字母占位。

### 实现方式

- `Selector` 的未知分组图标分支复用既有 `Custom Models` 默认图标渲染；移除已经不会命中的首字母占位样式，不新增图标资源。
- README 与开发指南同步“没有本地图标资源即使用默认图标”的图标契约。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 和 `git diff --check` 均通过。
- 本地与 `nextchat-dev` 容器内 `app/components/ui-lib.tsx`、`app/components/ui-lib.module.scss` SHA-256 一致，热加载已同步。

### 潜在或遗留问题

- 无。

============================================================

## 85. 【2026-07-14 15:12】- 修复虚拟模型列表首个供应商标题重复

### 修改内容

- 修复模型数量达到虚拟列表阈值时，首个供应商分组同时显示真实分组行和吸附标题层的问题。

### 实现方式

- 固定标题层始终覆盖当前真实虚拟分组行，并使用与估算分组高度一致的负边距抵消占位；滚动过程不再在临界点插入或移除标题层。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false`、`git diff --check` 均通过。
- 本地与 `nextchat-dev` 容器内 `app/components/ui-lib.tsx`、`app/styles/globals.scss` SHA-256 一致，热加载已同步。

### 潜在或遗留问题

- 无。

============================================================

## 84. 【2026-07-14 14:16】- 全量核验已配置模型商的模型归属

### 修改内容

- 只读数据库中全部模型商配置并调用既有服务端模型获取逻辑：YutoAPI 829、AihubMix 350、CherryIN 159、ToAPI 115、OpenRouter 344、晴辰云 9 个模型均已核验；DeepSeek、Ocoolai 的当前接口不可用，未写入或变更其配置。
- 合并上游 `vendor_id` 与声明厂商字段带来的同义分组：Alibaba/阿里巴巴、ByteDance/字节跳动、Zhipu/智谱、01.AI/零一万物、iFLYTEK Spark/讯飞、FLUX/Flux、MiniMax/Minimax、DeepSeek/Deepseek 均统一为标准厂商名。
- 修复 Ocoolai 将完整模型 ID 写入 `owned_by` 时产生伪模型商的问题；无可识别厂商的自定义供应商模型统一回退至该配置模型商，而非 Custom。
- 晴辰云等自定义模型商返回的 `auto`、`automatic`、`default`、`system` 与“自动/默认/系统”系统选择模型固定归入 Custom，以最高优先级覆盖 `vendor_id / developer_id / owned_by` 等上游字段和模型商兜底，并使用浅绿色默认图标。
- 模型管理器不再隐藏 `CUSTOM` 筛选项，Auto 等系统选择模型可在“全部模型商”菜单中直接筛选；“已添加/Added”仍保持隐藏。
- 修复大量模型触发虚拟列表后分组标题高度为 0 且未渲染的问题；列表中恢复真实供应商标题与数量，固定标题层继续随滚动显示当前分组。

### 实现方式

- 新增共享模型商归属器，前端获取、旧缓存归一化与服务端同步在读取模型商 ID、上游 `vendor / developer / owned_by / owner / organization` 声明后均走同一规范表；无声明的官方直连模型自动回退到其模型商。
- 不过滤、不隐藏模型，不修改数据库配置或模型接口缓存；仅修正展示分组元数据与 MiniMax 官方大小写。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 和 `git diff --check` 均通过。
- 实际获取结果中，YutoAPI 829 个模型归入 28 个标准模型商，AihubMix、CherryIN、OpenRouter、晴辰云也均无未归类模型；ToAPI 新增 Nano Banana、Veo、Sora、HappyHorse、Seedance 通用前缀后由 13 个未归类降为 0。Kimi 18 个均处于 Moonshot，DeepSeek 21 个均使用标准名称。
- 使用生产容器的有效 Key 实测 Ocoolai 4 个有效分组共返回 609 个去重模型；声明值等于模型 ID 的断言已覆盖，避免生成按完整模型名拆分的伪分组。

### 潜在或遗留问题

- DeepSeek 返回“未找到可用的模型接口”，Ocoolai 现有密钥请求返回 401；两者待接口或密钥恢复后会自动使用同一套归一规则。

============================================================

## 83. 【2026-07-14 14:07】- 补全直连模型的供应商归属推断

### 修改内容

- 审计并补齐缺少上游 `vendor_id` 时容易落入 Custom 的直连模型 ID：Seed/Seedream、QVQ、Yi、Spark、Command、Baichuan、InternLM、Jamba、BGE、LongCat、Ling/Ring，以及精确 `o1/o3/o4/o5`。
- 补齐常见命名空间前缀，避免 OpenRouter/OcoolAI 形式的 `author/model` 因作者别名产生伪模型商分组。

### 实现方式

- 前端模型获取与服务端模型同步维持逐条一致的官方归属规则；仅补充分组元数据，不过滤模型、不变更请求路由或模型数量。
- 使用当前供应商官方资料核对 Kimi、豆包 Seed、GLM、Wan、MiniMax、ERNIE 等现行模型命名，并同步 README 与开发文档。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 和 `git diff --check` 均通过。
- 针对性静态脚本确认 13 类直连模型 ID 在前端和服务端获取路径都具备相同归属规则。

### 潜在或遗留问题

- 未调用真实上游模型列表接口，避免消耗额度或改变现有缓存；下次正常获取模型时会按新规则归属。

============================================================

## 82. 【2026-07-14 14:03】- 统一 Custom 模型的浅绿色默认图标

### 修改内容

- Custom 分组及其模型行（包括 Auto 等归入该分组的模型）统一使用项目内置的浅绿色 OpenAI 风格默认图标，不再在模型行显示字母占位。

### 实现方式

- `Selector` 复用既有 `app/icons/llm-icons/default.svg`，仅为 Custom / Other 这类通用分组增加模型行图标分支；其他缺少本地图标的模型商仍使用首字母占位。
- README 与开发文档同步该例外，未新增或删除图标资源。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 和 `git diff --check` 均通过。
- 静态检查确认 Custom 模型行直接复用 `Custom Models` 的浅绿色默认图标渲染分支。

### 潜在或遗留问题

- 无。

============================================================

## 81. 【2026-07-14 14:00】- 规范晴辰云 Kimi 模型的模型商归属

### 修改内容

- 修复晴辰云获取的 `kimi-k2.5`、`kimi-k2.6` 被归入 Custom 分组的问题，统一显示在 Moonshot 分组。

### 实现方式

- 前端模型获取和服务端模型同步的供应商推断规则均将 `kimi-` 前缀归属为 Moonshot，保证新获取结果、缓存规范与服务端同步一致。
- README 与开发文档同步模型商归属契约，不改变模型数量、筛选逻辑或请求路由。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 和 `git diff --check` 均通过。
- 静态断言确认前端与服务端都包含 `kimi-` → Moonshot 规则；直接 Node 加载测试受项目 SCSS 模块链限制，未执行。

### 潜在或遗留问题

- 无。

============================================================

## 80. 【2026-07-14 11:03】- 将旧自动模式替换为全局聊天故障转移

### 修改内容

- 删除 GPT、DeepSeek、豆包系列旧自动模式的开关、配置、同步字段和专用候选逻辑；自动故障转移改为所有聊天请求默认启用，不提供按钮或设置。
- 首次请求失败后隐藏上游错误正文，先按模型名称尝试当前供应商的其他聊天模型，再按供应商名称、模型名称尝试其他供应商；每次尝试在消息区独占一行显示状态、供应商和模型。
- 重试候选不再按名称、类别、能力或端点排除模型；所有名称有效且标记为可用的模型都可参与重试，候选成功后立即更新全局模型、当前会话和同步状态。
- 控制台重试日志统一为 `🔄 / ✅ / ❌ / ⏹️`，合并重复的请求开始日志并精简错误原因；多 Key 候选失败和余额请求取消不再按控制台错误展开长调用栈。
- 重试状态 UI 改为复用插件状态行：去掉卡片边框、背景和状态色，统一显示为灰色 `<对话尝试中> / <对话尝试失败> / <对话尝试成功> 供应商 / 模型`。
- 候选顺序增加当前模型系列优先：同系列模型跨供应商按版本从新到旧尝试，相同版本的后缀名称按字母顺序排列；系列耗尽后再恢复当前供应商优先及供应商/模型字母顺序。
- 模型选择器、模型管理器的浏览模式和“已添加”模式统一使用同一系列排序；API Profile 与模型商分组按显示名称首字母排列，例如 DeepSeek 在 OpenAI 之前。
- 模型商筛选菜单改为按最终可见名称排序；保留“全部模型商”入口，旧中文分组和供应商品牌统一显示为 Qwen、Doubao、Z.ai、iFLYTEK Spark、Tencent Hunyuan、ERNIE、01.AI、Hailuo AI 等官方英文名称，并继续映射到原图标文件。
- 修复 Yuto 缺失 `vendor_id` 时把斜杠前完整模型名当模型商的问题；客户端旧缓存与新获取结果都会把 Act Two/Aleph/Gen3/Gen4 归入 Runway、Eleven/Scribe/Dubbing 归入 ElevenLabs、Flux Tools 归入 Flux，并统一 Midjourney、Mureka、Luma、Suno、PixVerse、Viggle、Cursor、Xiaomi、MiniMax、Google、Alibaba、StepFun、Nvidia 等官方英文归属，不减少模型数量。
- 修复 Yuto 的 Kling 模型在旧缓存中按版本拆成多个伪模型商的问题；54 个 `kling-* / kling_*` 模型统一归入官方英文分组 Kling AI，Yuto 原始 `vendor_id=33 / 快手` 同步规范为 Kling AI。
- 修复 Yuto 的 Vidu 模型在旧缓存中按 `Viduq1 / Viduq2 / Viduq3` 等版本拆分的问题；26 个 `vidu2.0 / viduq*` 模型统一归入 Vidu。
- 根据各模型官方资料复核最近新增的供应商映射；归属保持不变，显示名称修正为官方大小写 FLUX、NVIDIA。ElevenLabs、Mureka 等没有本地图标资源的模型行改用供应商首字母占位，不再错误显示 OpenAI 图标。
- 为 ElevenLabs、Mureka 补充官方品牌图标并接入分组与模型行；StepFun、Suno 图标内容保持不变，仅调整为铺满父级圆角矩形。
- 模型获取、缓存、模型管理器、聊天模型选择器和绘图模型管理器全部使用完整模型列表，不再按模型名称、类别、能力或端点隐藏模型，最终由用户自行选择。
- 删除通用模型分类、独立绘图分类和自动过滤报告；AihubMix 不再请求或缓存分类元数据，发布时间维护脚本不再写入分类字段。请求发送阶段的接口路由判断继续保留，但不得参与列表过滤。

### 实现方式

- 新增 `app/utils/chat-failover.ts` 统一负责候选收集、同供应商优先和跨供应商字母排序；`app/store/chat.ts` 复用既有请求回调框架串行执行候选并记录精简重试状态。
- `app/components/chat.tsx` 与对应样式新增重试状态列表；Config Store 升级到 4.7 并迁移删除旧字段。
- 删除 `app/utils/auto-model.ts`、`app/utils/chat-session-model.ts`，同步更新 README、开发指南和代码导航文档。
- 临时 API Profile 不再输出时序不准确的“请求结束”日志；多 Key 日志去掉重复的“正在尝试 / 请求开始”两行，并隐藏 Request ID。
- 修复重试样式误嵌套在 `.chat-message-status` 内导致选择器无法命中的问题；重试行与插件行合并到同一个 `.chat-message-tools` 容器并统一复用 `.chat-message-tool`，消除两个独立容器造成的上下间距差异。
- `chat-failover.ts` 新增无配置的系列识别与版本排序；只改变候选队列顺序，不恢复旧自动模式的开关、系列配置或同步字段。
- 新增 `model-series-order.ts` 作为共享排序 owner；聊天选择器与模型管理器复用同一比较器，模型管理器的远端结果、持久缓存和内存缓存读取都会重新规范顺序；`Selector` 通过局部 `sortGroupsAlphabetically` 开关启用模型商字母排序，不改变其他选择器。
- `Selector` 的模型商菜单改为先规范最终显示名称再排序，分组标题同样使用英文显示名；`PROVIDER_ICONS` 仅增加新英文名称到既有资源路径的别名，未修改任何图标文件。
- Kling 归属同时接入前端模型获取、服务端模型同步和旧缓存读取归一化；`快手 / Kuaishou / Kling` 可见名称统一为 Kling AI，并继续复用既有 `/provider-icons/kuaishou.png`。
- Vidu 系列名称归属同样接入前端获取、服务端同步和旧缓存读取归一化，继续复用既有 Vidu 图标映射。
- `Selector` 模型行仅在供应商命中本地图标映射时渲染图片；未命中时复用分组首字母样式，虚拟列表与普通列表使用同一个图标决策函数。
- `PROVIDER_ICONS` 新增 ElevenLabs、Mureka 映射；模型商筛选菜单只对 StepFun、Suno 增加局部铺满类，不改变其他供应商图标尺寸。
- StepFun、Suno 的模型明细行不再走普通 `30px` Avatar，改为与模型商菜单复用同一个 `32px` 圆角图标框和铺满规则；其他模型行保持原尺寸。
- 根据实际截图继续修正 StepFun、Suno 图标资源自带透明留白：只在既有圆角框内将图片放大 `1.14` 倍并居中裁切，使图形紧贴边框，不修改原图标文件。
- 保留模型商总入口的内部哨兵值 `All`，避免它被英文名称归一逻辑转换成普通分组；“全部模型商”在顶部按钮和展开菜单中继续不显示图标。
- `chat-failover.ts` 只负责候选排序和供应商切换，不再承担模型过滤；聊天与绘图模型管理器都不传入类别过滤器，浏览模式、“已添加”模式和删除操作均处理当前供应商完整模型列表。
- 删除 `model-category-rules.ts`、`model-classification.ts`、`image-generation-model.ts` 和 `model-auto-filter-report.ts`；同步移除前后端端点分类补充、AihubMix 分类缓存及发布时间维护脚本的分类合并逻辑。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false`、`git diff --check` 均通过。
- 针对性脚本验证当前供应商优先、供应商/模型字母排序，以及所有名称有效且可用的模型均可进入候选队列。
- 系列排序脚本验证 GPT 候选跨供应商按 5.7、5.6、5.5 从新到旧排列；同为 5.6 时按 alpha、luna、zeta 字母顺序排列，系列之后才进入非系列字母队列，Pro/Coder 仍被排除。
- 共享排序脚本验证 API Profile 按 Anthropic、DeepSeek、OpenAI 排列；GPT 模型按 5.7、5.6-alpha、5.6-luna、5.6-zeta、5.5 排列，聊天选择器、模型管理器浏览模式与“已添加”模式均复用这一规则。
- 英文名称与图标别名脚本验证 8 个中文旧分组映射正确，可见名称按 01.AI、Doubao、ERNIE、Hailuo AI、iFLYTEK Spark、Qwen、Tencent Hunyuan、Z.ai 排列，且全部继续指向修改前的图标路径；“全部模型商”保持不变。
- 使用 Yuto 真实 `/api/pricing` 验证完整获取 829 个模型；模型管理器与各模型选择入口不再执行类别过滤，自动故障转移候选也不再排除媒体、视觉、语音或代码模型。
- 对 Yuto 829 个真实模型中的 161 个缺失供应商记录做归属验证，全部归并到 17 个真实模型商，未留下 Act Two、Aleph2、Eleven Flash、Gen4 Image、Flux Tools 等伪模型商分组。
- Yuto 真实接口核对 54 个 Kling 模型均为 `vendor_id=33`；名称归一化结果只有 Kling AI 一个分组，模型总数保持 54。
- Yuto 真实接口核对 26 个 Vidu 模型均为 `vendor_id=35 / Vidu`；名称归一化结果只有 Vidu 一个分组，模型总数保持 26。
- 结合各厂商官方文档与 Yuto 当前 829 个模型复核最近新增规则：Runway 12、ElevenLabs 16、Kling AI 54、FLUX 17、Mureka 25、Vidu 26、MiniMax 2、NVIDIA 1 等规则均只命中对应系列；普通列表和虚拟列表均不再为缺失本地图标的供应商渲染 OpenAI 图标。
- ElevenLabs、Mureka 新图标与 StepFun、Suno 既有图标均通过开发服务返回 200；本地与 `nextchat-dev` 容器内图标映射、选择器样式及两个新增资源 SHA-256 一致，四图并排预览确认资源可正常渲染。
- StepFun、Suno 的菜单与模型明细行静态核对均进入同一个图标框渲染分支；`yarn lint`、`npx tsc --noEmit --pretty false`、`git diff --check` 通过，容器内 `ui-lib.tsx`、`ui-lib.module.scss` 与本地一致。
- StepFun、Suno 按 `1.14` 放大后的并排裁切预览确认白色间隙已消除且内部标志完整；开发首页返回 200，容器内 `ui-lib.module.scss` 与本地一致。
- `nextchat-dev` 正常运行，宿主机与容器内共享排序、故障转移、聊天选择器和模型管理器等 5 个目标文件 SHA-256 一致，`http://127.0.0.1:3000/` 返回 200，热加载编译日志无错误。
- 重试 UI 已核对直接复用 `.chat-message-tools .chat-message-tool`；本地与容器内 `chat.module.scss` SHA-256 一致。浏览器控制连接不可用，本轮未声称完成截图级视觉验证。

### 潜在或遗留问题

- 未执行真实上游 API 故障注入，避免消耗或扰动现有供应商调用；请求回调、候选顺序和状态转换已通过静态与独立逻辑验证。

============================================================
