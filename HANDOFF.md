# HANDOFF

记录最近 10 条关键修改。最新记录置顶，历史从新到旧排列。每条记录标题格式为 `## 序号. 【YYYY-MM-DD HH:MM】- 标题`，序号持续递增，最大 999，达到后从 1 开始。超过 10 条时自动删除底部最旧记录。实质修改完成并验证后更新一次，创建 commit 前核对并一起提交。

============================================================

## 36. 【2026-07-12 17:30】- 修复 Query-Key 鉴权模式下的多 Key 重试失效缺陷

### 修改内容

- 修复自定义（OpenAI 兼容）提供商配置为 query-key 鉴权类型时，发生 API Key 轮询重试但请求 URL (chatPath) 中的密钥参数依然为旧密钥的 Bug。
- 在流式和非流式对话中，触发多 Key 故障转移时，确保不仅更新 Headers/x-api-key-query-value，同时也动态替换请求 URL 中的密钥 Query 参数。

### 实现方式

- app/utils/model-fetch-common.ts: 新增并导出 `replaceUrlQueryParam` 辅助函数，利用内置 URL API 安全地替换或添加路径中的 query 参数，同时兼容相对路径与绝对 URL。
- app/client/platforms/openai.ts: 导入 `replaceUrlQueryParam`。在非流式 retry 轮询中，若 authType 为 "query-key"，使用该函数对 chatPath 中的密钥参数进行实时替换更新。
- app/utils/chat.ts: 导入 `replaceUrlQueryParam`。在流式 retry 轮询 `onRetry` 回调中，若 authType 为 "query-key"，使用该函数更新外部闭包中的 chatPath 变量，保证新发起的 chatApi 携带更新后的密钥参数。

### 验证

- `yarn lint` 通过。
- 确认 TypeScript 语法无任何错误。

### 潜在或遗留问题

- 无。

============================================================

## 35. 【2026-07-12 17:15】- 优化模型获取的异常容错、进度日志与代码审计修复

### 修改内容

- 客户端模型获取新增缓存直连异常容错机制：当已缓存的成功路径获取失败时，将自动清除该无效路径缓存并自动 fallback 降级到全量探测以提升稳定性。
- 修复模型获取进度日志恒为 1/1 的问题：在 fetchJsonWithCandidates 中增加了 key 进度参数传递，真实反映多接口与多 key 的尝试顺序及进度。
- 简化 fetchAllJsonWithCandidates 方法：清除了 results 遗留数组及其他冗余死代码。
- 统一 Yuto/Ocoolai 的自定义反代域名识别逻辑：在 models.ts 和 provider-model-fetch.ts 中利用 isYutoProfileLike 和 isOcoolProfileLike 复合比对，支持自定义域名下的专有模型获取。
- 扩展 api-path-memory 接口，支持清除缓存路径。
- 修复 API 授权绕过漏洞（P0）：当 MODEL_SYNC_TOKEN 未配置时，仅在本地免登模式下允许直接访问 refresh 接口。
- 解决 providerSyncInFlight 竞态条件（P0）：在 syncProfileModels 中对 Promise 的设置和检测进行重构，避免并发下的重复触发。
- 解决缓存与密钥清除缺陷（P1/P2）：删除 `provider-model-repository.ts` 中更新缓存的 `coalesce` 函数以支持清除，并在 API key 变为空时从 `sync_secrets` 中删除旧密钥。
- 解决服务侧 Promise 缓存污染（P1）：将 `aihubmixCatalogMetadataMapPromise` 升级为 Map 缓存，针对不同 baseUrl 独立存储，避免跨服务商干扰。
- 解决 `persistSuccessfulFetch` 竞态（P1）：将标志变量置真语句移至函数最前，确保并发安全。

### 实现方式

- api-path-memory.ts: 增强 rememberModelListPath 支持当 path 为空时删除 modelListPath。
- models.ts & provider-model-fetch.ts: 传递 outerIndex, outerTotal, keyIndex, keyTotal 参数给 fetchJsonWithCandidates；并在直连路径失败后触发清除缓存并进行 collectAllModelPayloads 重试。
- app/api/db/models/refresh/route.ts: 校验 token 时判断 `process.env.NEXTCHAT_DISABLE_AUTH` 是否为 `"true"`。
- app/utils/provider-sync.ts: 将 lookup 和 set 原子整合，避免 concurrent overlaps。
- app/utils/server/sync-secrets.ts: 增加并导出 `deleteEncryptedSyncSecret` 方法。
- app/utils/server/provider-model-repository.ts: 去除 SQL 中 coalesce 占位符，且在 options.cachedModelApiKey 为空时调用 delete 秘钥方法。
- app/utils/server/provider-model-fetch.ts: 将 Promise 缓存升级为 Map，并在 `persistSuccessfulFetch` 最上方设置 flag。

### 验证

- `yarn lint` 通过。
- `npx tsc --noEmit --pretty false` 通过。
- `git diff --check` 通过。

### 潜在或遗留问题

- 无。

============================================================

## 29. 【2026-07-12 14:58】- 修复模型获取后首项顶部空白

### 修改内容

- 修复模型获取成功后，虚拟化模型列表首个模型上方出现大块空白的问题。

### 实现方式

- 将模型分组的 sticky 规则限定为非虚拟行，确保虚拟化分组继续使用绝对定位和自身的 `translateY` 位置。

### 验证

- `yarn lint` 通过，无 ESLint warning 或 error。
- `git diff --check` 通过。

### 潜在或遗留问题

- 无。

============================================================

## 28. 【2026-07-12 14:50】- 统一获取模型的最新优先自然排序

### 修改内容

- 获取后的模型列表改为最新发布日期优先；发布日期相同或未知时，按字母排序并让数字更大的版本排在前面。
- 在 `README.md` 的模型与供应商说明中同步记录该排序规则。

### 实现方式

- 在 `app/utils/model-published-at.ts` 的共享模型比较器中，移除接口返回顺序和远端 rank 的影响，统一使用发布日期与模型名数字分段比较；该比较器覆盖获取、缓存重建和模型选择器。

### 验证

- `yarn lint` 通过，无 ESLint warning 或 error。
- `git diff --check` 通过。
- 已确认 `nextchat-dev` 容器内存在本次排序实现。

### 潜在或遗留问题

- 无。

============================================================

## 27. 【2026-07-12 14:45】- 无模型供应商不显示遗留模型名称

### 修改内容

- 修复聊天页供应商按钮：当前供应商没有可选模型时，不再显示会话配置中遗留的模型名称。

### 实现方式

- 在 `app/components/chat.tsx` 中依据当前供应商的模型集合计算可用模型状态，仅在存在可选模型时才返回并渲染当前模型名；按钮标题随之只保留供应商名。

### 验证

- `yarn lint` 通过，无 ESLint warning 或 error。
- `git diff --check` 通过。
- 已确认 `nextchat-dev` 挂载当前工作区，且容器内存在本次判断代码。

### 潜在或遗留问题

- 无。

============================================================

## 26. 【2026-07-12 11:16】- 修复会话同步复核不一致与 Yuto 余额查询失败

### 修改内容

- 修复由于本地已剪枝（消息为空但 summary.messageCount > 0）且远端无记录的会话在同步过程中被排除在上传索引之外，但在本地合并状态中依然被保留，从而导致在同步完成后本地与远端同步会话计数复核不一致的问题。
- 修复因 server-side 的 `isYuto` 检查仅根据 base URL 进行匹配，在 baseUrl 存储不匹配的情况下导致 YutoAPI 被当作常规供应商执行查询，最终因无法通过 API Key 和 User ID 解析而报错 `balance_not_supported` 的问题。
- 优化 ToAPIs 的识别规则，添加 ID 及 Name 匹配以支持与 Yuto 类似的自定义 base URL 配置。
- 优化模型获取控制台日志输出：当尝试多个候选 API 路径时，隐藏冗长的单个候选路径 of 尝试与失败详细日志，改为只输出极其简化的 `[Fetch Models] 🔁 正在尝试模型接口：已尝试/总数` 进度，且在配置了多 key 轮询尝试时，在进度信息后追加输出当前尝试的 `第 key索引/总key数 个 key`。
- 修复模型选择器在开启虚拟化列表模式下，列表顶部首个元素上方出现大片空白 of 渲染问题。
- 规范并简化模型选择提示按钮的静态文本：将未获取模型时原本冗长的 “暂无缓存模型，可手动获取” 按钮文本在默认状态下也变更为简明的 “点击获取模型”（并移除了已不再需要的 hover 切换状态变量）。

### 实现方式

- 在 `app/store/sync.ts` 中，为 `syncChatStore` 及其重试/合并的每个返回分支添加 `expectedRemoteSessionCount` 字段，并在复核步骤中优先使用它代替重新计算的 count。
- 在 `app/api/db/provider-balance/route.ts` 与 `app/utils/server/provider-balance.ts` 中，为 `isYuto` 和 `isToApis` 新增 `profile.id` 与 `profile.name` 的复合特征识别判定。
- 在 `app/utils/models.ts` 的 `FetchJsonOptions` 中增加 `outerIndex` / `outerTotal` 支持，在 `fetchJsonWithCandidates` 循环尝试中，过滤掉冗长的 `尝试失败` 和 url 载荷的控制台输出，只打印单行 `🔁 正在尝试模型接口：1/35` 进度（包含多 key 情况下的 key 进度），并在 `fetchAllJsonWithCandidates` 调用时传入正确 outerIndex。
- 在 `app/styles/globals.scss` 中，为 `.model-selector-panel .nextchat-selector-virtual-row` 规则强制设定 `position: absolute !important`，以覆盖全局 `.nextchat-selector-group` 因 `!important` 附带的 `position: sticky` 导致的虚拟列表布局塌陷和空白问题。
- 在 `app/components/add-model-modal.tsx` 中，删除了已不再使用的 `fetchHovered` 状态，并直接把未获取模型时的按钮默认文本从 `{fetchHovered ? "点击获取模型" : "暂无缓存模型，可手动获取"}` 改为 `"点击获取模型"`。

### 验证

- `PATH=$PATH:/usr/local/bin:/opt/homebrew/bin npx next lint` 检查通过，项目内无任何 ESLint 警告与错误。
- 确认代码编译成功。

### 潜在或遗留问题

- 无。

============================================================

## 25. 【2026-07-12 10:44】- 修复模型选择器删除按钮垂直居中与样式规范化

### 修改内容

- 解决模型选择列表中“删除”按钮在包含无动效/无悬浮规则（`nextchat-no-hover-motion`）下没有垂直居中的问题，使其恢复完美垂直居中。
- 移为了删除按钮的冗余本地边框与 hover 边框样式，改为完全复用公共危险按钮类（`nextchat-danger-button`）的边框、背景及 hover 状态，并彻底消除 hover/active 时的位置跳变。
- 规范化模型管理弹窗 footer 区域（`nextchat-modal-footer`）以及自定义输入行中的按钮样式：通过组合 `nextchat-pill-button` 与公共按钮类（`nextchat-default-button`、`nextchat-danger-button`、`nextchat-green-button`），在保留原有的紧凑药丸尺寸与字体的同时，使其外观边框 和 hover 效果完全复用公共类的主题样式。
- 解决公共危险/绿色按钮（如 `button.nextchat-danger-button`）因标签类组合选择器特异性（specificity）较高而强制覆盖药丸圆角的问题，确保所有药丸按钮形状保持高度一致。
- 优化了模型列表 header 中的“暂无缓存模型，可手动获取”按钮，使其在 hover 时将文本动态变更为“点击获取模型”，同时保持原有的 `var(--primary)` 颜色不变，不被常规 default 按钮的 hover 黑色覆盖。
- 解决本地开发 Docker 容器内通过宿主机代理 `host.docker.internal:7890` 失败导致 502/模型获取失败的问题，将其修改为不通过容器代理直接连接。

### 实现方式

- 在 `app/components/ui-lib.tsx` 中，将右侧操作按钮的公共基础类从 `nextchat-default-button` 变更为 `nextchat-danger-button`。
- 在 `app/components/ui-lib.module.scss` 中，删除了 `.selector-item-action` 上的本地 border、background、color、border-radius 属性，以及 `:hover` 与 `:active` 下的 redundancy 样式覆盖。
- 在 `app/components/add-model-modal.tsx` 中，为 `AddModelSelector` 组件新增 `fetchHovered` 状态，并为“暂无缓存模型，可手动获取”按钮监听 `onMouseEnter` 与 `onMouseLeave` 事件以动态切换显示文本。
- 在 `app/styles/globals.scss` 中，将 `.model-selector-hint-fetch` 按钮 hover/active/focus-visible 状态下的颜色设定为 `var(--primary) !important`，覆盖了 `nextchat-default-button` 的 hover 黑色。
- 在 `app/styles/globals.scss` 中，在 `.nextchat-selector.nextchat-no-hover-motion` 的 `transform: none !important` 规则中，通过 `:not(.nextchat-selector-item-action)` 伪类将删除按钮排除在外。
- 显式声明并强化无动效/无悬浮规则及其各状态（hover/focus/active）下的删除操作的垂直定位规则（`transform: translateY(-50%) !important`），确保在 any 交互状态下都保持垂直居中，不被其他全局或局部的 `none` 定位覆盖。
- 保留 `add-model-modal.tsx` 弹窗底部和自定义表单按钮上的 `nextchat-pill-button` 类名（以维持原有 30px 高度、999px 药丸圆角和 14px 加粗字体），同时使其与对应的公共基础类（`nextchat-default-button` / `nextchat-danger-button` / `nextchat-green-button`）良好配合，继承其边框及 hover 边框表现。
- 在 `app/styles/globals.scss` 中，为 `.nextchat-pill-button` 规则补充了 `button.nextchat-pill-button` 选择器以提升 CSS 特异性权重，解决 `button.nextchat-danger-button` 因包含 `button` 标签选择器而高优覆盖 `border-radius: 999px !important` 从而导致危险药丸按钮形状变回 10px 矩形直角的问题。
- 更新了 `app/styles/globals.scss` 中移动端媒体查询规则，使 `.nextchat-modal-footer-group` 下的普通 `button` 也能正确适配 100% 宽度。
- 修改了 `.env.docker` 文件，注释掉了 `HTTP_PROXY`、`HTTPS_PROXY` 和 `ALL_PROXY` 代理环境变量配置，并在宿主机上执行了容器重启操作。

### 验证

- `PATH=$PATH:/usr/local/bin:/opt/homebrew/bin npx next lint` 执行通过，无 ESLint 警告或错误。
- `git diff --check` 通过。
- 在 `nextchat-dev` 容器内运行 `wget -S --spider https://gptapi.asia` 验证成功返回 `200 OK`，无需通过宿主机代理即可正常请求 API 接口。

### 潜在或遗留问题

- 无。als.scss` 中，在 `.nextchat-selector.nextchat-no-hover-motion` 的 `transform: none !important` 规则中，通过 `:not(.nextchat-selector-item-action)` 伪类将删除按钮排除在外。
- 显式声明并强化无动效/无悬浮规则及其各状态（hover/focus/active）下的删除操作的垂直定位规则（`transform: translateY(-50%) !important`），确保在 any 交互状态下都保持垂直居中，不被其他全局或局部的 `none` 定位覆盖。
- 保留 `add-model-modal.tsx` 弹窗底部和自定义表单按钮上的 `nextchat-pill-button` 类名（以维持原有 30px 高度、999px 药丸圆角和 14px 加粗字体），同时使其与对应的公共基础类（`nextchat-default-button` / `nextchat-danger-button` / `nextchat-green-button`）良好配合，继承其边框及 hover 边框表现。
- 在 `app/styles/globals.scss` 中，为 `.nextchat-pill-button` 规则补充了 `button.nextchat-pill-button` 选择器以提升 CSS 特异性权重，解决 `button.nextchat-danger-button` 因包含 `button` 标签选择器而高优覆盖 `border-radius: 999px !important` 从而导致危险药丸按钮形状变回 10px 矩形直角的问题。
- 更新了 `app/styles/globals.scss` 中移动端媒体查询规则，使 `.nextchat-modal-footer-group` 下的普通 `button` 也能正确适配 100% 宽度。

### 验证

- `PATH=$PATH:/usr/local/bin:/opt/homebrew/bin npx next lint` 执行通过，无 ESLint 警告或错误。
- `git diff --check` 通过。

### 潜在或遗留问题

- 无。

============================================================

## 24. 【2026-07-12 09:29】- 调整模型选择器文字与操作对齐

### 修改内容

- 模型搜索框的“搜索模型...”提示文字改为常规字重，已输入文字保持原有样式。
- “暂无缓存模型，可手动获取”按钮在 hover、focus 与 active 时保持原有文字颜色。
- 模型列表右侧“删除”按钮恢复垂直居中。

### 实现方式

- 仅为 `nextchat-selector-search-input` 的 `::placeholder` 设置 `font-weight: 400`。
- 为 `model-selector-hint-fetch` 精确覆盖交互状态的文字颜色，不影响边框和背景反馈。
- 恢复 `nextchat-selector-item-action` 的静态 `translateY(-50%)` 定位，避免被无 hover 动效规则覆盖。

### 验证

- `yarn lint` 通过，无 ESLint warning 或 error。
- `git diff --check` 通过。

### 潜在或遗留问题

- 无。

============================================================

## 23. 【2026-07-12 09:27】- 强制居中模型选择器获取模型标题

### 修改内容

- 将“正在获取 YutoAPI 模型”等标题改为满宽水平居中，保留原有下方间距。

### 实现方式

- 为标题容器添加满宽约束，统一 flex 与文本居中；保留桌面端与移动端原有的下方内边距。

### 验证

- `yarn lint` 通过，无 ESLint warning 或 error。
- `git diff --check` 通过。

### 潜在或遗留问题

- 无。

============================================================

## 22. 【2026-07-12 09:16】- 移除模型选中项的额外边框

### 修改内容

- 已选中的模型列表项不再显示额外主题色边框，仅保留选中背景和勾选图标。

### 实现方式

- 移除模型列表选中态的 2px 内描边，父容器的 2px 外框保持不变。

### 验证

- `yarn lint` 通过，无 ESLint warning 或 error.
- `git diff --check` 通过。

### 潜在或遗留问题

- 无。

