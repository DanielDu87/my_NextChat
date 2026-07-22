# HANDOFF

记录最近 10 条关键修改。最新记录置顶，历史从新到旧排列。每条记录标题格式为 `## 序号. 【YYYY-MM-DD HH:MM】- 标题`，序号持续递增，最大 999，达到后从 1 开始。超过 10 条时自动删除底部最旧记录。实质修改完成并验证后更新一次，创建 commit 前核对并一起提交.

============================================================

## 203. 【2026-07-22 12:30】- API 配置页新增配置按钮桌面端固定在最右

### 修改内容

- `/api_config` 页"配置条目"卡片标题右侧的"新增配置"按钮在桌面端不再随副标题/容器宽度漂移到下方，按钮永远固定在标题右上角；移动端（≤900px）维持 column + 100% 宽度沾满，符合"电脑端右对齐、移动端沾满"的双端行为。

### 实现方式

- 根因不在 `.profileSectionTitle` 本身，而是 ListItem 多层 flex 容器链：ui-lib 的 `.list-item > .list-header` 默认 `max-width: 70% / flex-shrink: 0` 把标题容器限到 70%。ListItem 渲染时给标题容器加的是**全局类** `nextchat-list-header` / `nextchat-list-item-title`，但 ui-lib 内部的 `.list-header` 规则编译后变成 hash 类（如 `.ui-lib_list-header__xxx`），此前 `.sectionCard :global(.list-header)` 字面选择器**根本没命中**，全部被静默忽略。
- `api-config.module.scss` 改用匹配**全局类** `.nextchat-list-header` / `.nextchat-list-item-title`，并加 `!important` 压过 ui-lib 的 hash 类同特异性规则。
- `.sectionCard :global(.nextchat-list-header)`：`align-items: flex-start !important; max-width: 100% !important; flex-shrink: 1 !important; width: 100% !important; box-sizing: border-box !important`。
- `.sectionCard :global(.nextchat-list-item-title), .sectionCard :global(.nextchat-list-item-title) > div`：`width: 100% !important; min-width: 0 !important; max-width: 100% !important; box-sizing: border-box !important; overflow: visible !important; text-overflow: clip !important; white-space: normal !important`。
- `.profileSectionTitle` 加 `max-width:100%; box-sizing:border-box; position:relative`，按钮加 `position:relative; z-index:2`，锁定布局上下文与层叠，避免任何溢出与被遮罩问题。
- `@media screen and (max-width: 900px)` 块的 `.profileSectionTitle { flex-direction: column; ... width: 100% !important }` 不动，移动端保持"独占一行沾满"。
- 同步修复 `/backup/api_config` 页"配置备份历史"卡片的"立即备份"按钮：api-config-backups.module.scss 的 `.historyHeader` 加同款 `flex-wrap:nowrap/max-width:100%/box-sizing:border-box/position:relative`，按钮加 `flex:0 0 auto/flex-shrink:0/margin-left:auto/white-space:nowrap/position:relative/z-index:2`；并对 `.nextchat-hover-card` 内的 `:global(.nextchat-list-header)` / `:global(.nextchat-list-item-title)` 加与 api-config 同款的 `!important` 锁定规则。`@media (max-width: 700px)` 的 `.historyHeader { flex-direction: column }` 不动，保留移动端独占一行行为。
- 同步修复 `/backup/chat` 页"对话备份历史"卡片的"立即备份"按钮：chat-backups.module.scss 的 `.historyHeader` 加全套 `!important`（`display:flex/flex-direction:row/justify-content:space-between`）防止被覆盖；`.createBackupButton` 关键修复是去掉原 `margin-right:15px`（把按钮推向右 15px 而非最右）改为 `margin-left:auto !important; margin-right:0 !important`，并加 `flex:0 0 auto/flex-shrink:0/align-self:flex-start/white-space:nowrap/position:relative/z-index:2`；并对 `.content > ... :global([class*="list-item"]).hoverCard` 内的 `:global(.nextchat-list-header)` / `:global(.nextchat-list-item-title)` 加同款 `!important` 锁定规则。chat-backups 用的是 CSS Modules 自引用 `.hoverCard` 而非 `nextchat-hover-card` 全局类（与 api-config-backups 不同），CSS Modules 自引用 `.hoverCard` 能正确匹配编译后的 hash 类。
- 实际诉求仅是"按钮右缘贴齐下方表格的右边框"：之前对 `.profileTable` 去掉 `border / border-radius / padding` 的多改动属于误判，已撤回；表格的 1px 边框、14px 圆角、行 padding 恢复原样。按钮与表格右边框对齐通过上文 `:global(.nextchat-list-header/max-width:100% !important)` + 按钮 `margin-left:auto` 自动实现：`.profileTable` 是 `width:100%`，表格右外缘 = sectionCard 内容区右缘 = 按钮右缘（被 `margin-left:auto` 推到 `.profileSectionTitle` 右缘、而 `.profileSectionTitle` 与表格都受同一 sectionCard 内容区约束）。
- 用户管理菜单（`user-menu.tsx` manageList 三行）"密码 / 对话数 / 最近对话"三列上下对齐：`user-menu.module.scss` 的 `.userIdentity` 由 `flex-shrink:0/min-width:0` 改为 `flex:0 0 130px; min-width:130px; max-width:130px`。`.userDetails` 是 grid + fr 列宽列宽依赖容器剩余宽度；用户名长度不同时 `.userIdentity` 自然宽窄不一，导致每行 `.userDetails` 剩余宽度不同，fr 列宽错位。把 `.userIdentity` 三轴定宽 130px 后，三行 `.userDetails` 剩余宽度严格一致，grid fr 比例列宽自然对齐，上下三行每列左/右缘对齐。
- 移动端（≤600px）该区域同样修复：上面桌面端把 `.userIdentity` 锁 130px 后，移动端仍在窄屏下生效，导致 `.userDetails` 被压到只剩少量空间、"当前"徽章被 `.userDetails` 内容溢出覆盖。`@media screen and (max-width: 600px)` 块内：`.userIdentity` 改回 `flex:0 0 auto; min-width:0; max-width:none` 让其弹性收缩、`.userRow { padding-right:64px }` 给徽章和操作位留更多空间、`.userBadge { right:40px; z-index:2; pointer-events:none }` 贴右置顶、`.rowAction { right:2px; width:32px; z-index:3 }` 收紧操作位、`.userDetailWide` 加 `min-width:0; overflow:hidden` + `.userInfoValue` 用 `text-overflow:ellipsis` 防最近对话时间戳溢出覆盖徽章。后面用户反馈移动端右边部分太宽：`.userRow { padding-right: 64px }` 收紧到 `36px`、`.badge { right: 40px }` 调到 `38px`，让 `.userDetails` 视觉上更靠右、`.rowAction` 不显空。再后第三列 fr 过大导致最近对话时间戳不被 ellipsis 截断、反而覆盖"当前"徽章：移动端 `.userDetails` 第三列 `minmax(96px, 1.45fr)` 改为 `minmax(80px, 1.1fr)`，3 列 fr 比例 0.55:0.7:1.1（总和 2.35）让第三列占约 47%（之前 53.7%），最小宽从 96 降到 80，时间戳更易触发 ellipsis 截断，不再溢出覆盖徽章。再后用户要求徽章改相对定位靠右：移动端 `.badge` 与 `.rowAction` 都由 `position:absolute` 改为 `position:relative; top:auto; right:auto; transform:none`，`.userRow { padding-right:0 }`，`.rowAction { margin-left:auto; align-self:center }` 把徽章和操作位都用 flex 流自然排在行末靠右，徽章紧贴 `.userDetails` 右外侧、`.rowAction` 32px 在最右缘，不再 absolute 浮在上面导致覆盖。撤回，恢复绝对定位方案；最后 `.badge { right: 38px }` 用户反馈不够右，改为 `right: 6px` 几乎贴行末右缘、`.rowAction { right: 32px; width: 32px }` 让操作位左移 30px 让出徽章空间、`.badge z-index:3 / .rowAction z-index:2` 徽章浮在操作位之上避免视觉重叠、`.userRow { padding-right: 72px }` 保证 `.userDetails` 不与两个 absolute 元素重叠。再后用户反馈徽章导致其他元素移动（ccc 行徽章占位、其他行无徽章 DOM，子节点数不同 → flex 流布局不一致）：`user-menu.tsx` 两处 ListItem 把 `effectiveUser.id === managedUser.id && (<div className={styles.badge}>当前</div>)` 改为总是渲染 `<div className={clsx(styles.badge, { [styles.badgeActive]: ... })}>`，并在非当前用户行加 `aria-hidden="true"`；新增 `.badgeActive { visibility:visible; background:var(--primary); color:#ffffff; border-radius:999px }`，默认 `.badge` 在桌面端与移动端都 `visibility:hidden / color:transparent / background:transparent / width:30px; height:18px; box-sizing:border-box` 占位，确保三行子节点一致，徽章只对当前用户生效并显绿色，其余两行徽章隐形但仍占位，ccc 行 vs admin/dyx 行的 `.rowAction` 右缘位置严格对齐。

### 验证

- 待人工确认：浏览器 ≥ 901px 宽度打开 `/api_config`，左侧标题文案无论长短，"新增配置"按钮都固定在右上；≤ 900px 宽度下按钮仍沾满整行居中。

============================================================

## 202. 【2026-07-22 11:50】- 修复 MCP client.ts 阻断 next build 的类型递归

### 修改内容

- 部署时 `next build` 在 `app/mcp/client.ts:54` 失败：`Type instantiation is excessively deep and possibly infinite`（TS2589）。仓库历史 TypeScript 错误（CLAUDE.md 中也提及）但 `next build` 默认做类型校验所以会卡住构建。
- 用具名 schema + 收窄方法签名绕过 `Client extends Protocol<Request, Notification, Result>` 多层泛型递归推断。

### 实现方式

- `app/mcp/client.ts` 的 `executeRequest` 导入 `McpResponseMessageSchema`（仓库已有 `z.ZodType<McpResponseMessage>`），把 `client.request(request, z.any())` 替换为 `client.request(request, McpResponseMessageSchema)`。
- 由于 MCP SDK `Protocol.request<T extends AnySchema>` 的 `T` 在多层继承下仍会触发 TS2589，进一步把 `client.request` 通过 `as unknown as` 收窄成本地具名函数 `(req, schema) => Promise<...>`，TS 不再重新推断 `Protocol` 类的递归泛型。
- 返回类型标注为 `Promise<z.infer<typeof McpResponseMessageSchema>>` 与原行为兼容（原来 `z.any()` 解出也是 `unknown`）。

### 验证

- 本地 `npx tsc --noEmit --pretty false` 已不再报 `mcp/client.ts` 的 TS2589 / TS2345；其余 chat.tsx 未使用变量属于历史遗留，本次不动。
- 待生产服务器 `git pull` 后重新执行 `docker compose up -d --build`，确认 `next build` 通过、容器重启、`https://chat.dyxcloud.com` 能打开。

============================================================

## 201. 【2026-07-22 00:40】- 对话记录图片附件加描边

### 修改内容

- 对话记录里的图片附件加上与文件附件卡片一致的描边（`1px solid color-mix(in srgb, var(--black) 24%, transparent)`），light/dark 通过 color-mix 自适应，视觉与其他附件统一。

### 实现方式

- `chat.module.scss` 的 `.chat-message-attached-image`（图片外层 wrapper，含 `overflow:hidden` 裁剪圆角）加 `border` + `box-sizing: border-box`；内层 `<img>` 已有 `object-fit: cover` 与 `border-radius: inherit`，描边显示在外沿、图片在内部被裁剪。

### 验证

- 待人工确认：对话记录中用户发送的图片附件四周有与文件卡片一致的细描边，light/dark 都清晰。

============================================================

## 200. 【2026-07-22 00:30】- Word 预览移动端按容器宽度自动缩放

### 修改内容

- Word（docx）预览页在窄容器（尤其移动端）下自动等比缩放适配宽度，不再横向溢出/滚动，也不再用写死的 `zoom: 0.72`。桌面端容器足够宽时 scale=1，不缩放，排版与真实文档一致。

### 实现方式

- `chat.tsx` 新增 `docxRootRef` 与 `applyDocxAutoScale`：docx-preview 渲染出的页面是固定 pt 宽度、无法回流，先把 `section.docx` 的 `zoom` 还原为 1 测量自然宽度，再按 `docx-preview-root` 可用宽度（clientWidth − 左右 padding）计算 `zoom = available / pageWidth`（仅在 pageWidth > available 时缩小）。
- 用 `ResizeObserver` 观察 root，渲染完成（loading 结束）后及容器尺寸变化（旋转屏幕、弹窗改尺寸）时重新适配；无 ResizeObserver 时降级为一次性计算。
- `chat.module.scss` 移动端媒体查询移除 `.docx-preview-container section.docx` 的写死 `zoom: 0.72` 与 `padding-left/right: 12px !important`，缩放全权交给 JS，保持与桌面一致的真实排版。

### 验证

- 待人工确认：移动端（或窄窗口）打开 docx 预览，页面自动缩小铺满宽度、无横向滚动；旋转屏幕后重新适配；桌面端不缩放。

============================================================

## 199. 【2026-07-22 00:20】- Word/Excel 预览内容部分 light/dark 统一白底黑字

### 修改内容

- Word 文档页与 Excel 表格单元格（仅「内容部分」）在 light 与 dark 主题下统一保持白底黑字；标题栏、元信息栏、工作表标签、外围画布仍按主题走深色。
- 根因：暗色主题里 `--white: rgb(30,30,30)`、`--black: rgb(187,187,187)`，之前 Excel 内容规则用 `var(--white)/var(--black)`，暗色下被反转成深底浅字。
- 附带修复：dark 主题下预览标题栏与元信息栏下方的两条「白线」——原 `border-bottom-color: var(--border-in-light)` 把颜色设成了完整 shorthand（无效值被忽略），回退到基础 `border-bottom: rgba(255,255,255,0.192)` 亮线；改为有效的 `rgba(255,255,255,0.06)` 细分隔线。

### 实现方式

- `chat.module.scss` 把 `.xlsx-preview-sheet` 的 `table/td/th` 底色与文字色从 `var(--white)/var(--black)` 改为字面量 `#fff` / `#1f2937`，与主题无关。
- 删除两个暗色块（`:global(.dark)` 与 `@media prefers-color-scheme: dark`）里对 `.xlsx-preview-sheet` 内容的深色覆盖，只保留暗色下略深的表格阴影。
- `section.docx` 显式加 `background: #fff` 兜底（docx-preview 本身默认白底黑字，暗色不反转）。
- 两个暗色块的 `.file-preview-header` / `.file-preview-meta-bar` 的 `border-bottom-color` 改为 `rgba(255,255,255,0.06)`。

### 验证

- 待人工确认：dark 主题下打开 Excel、Word 预览，单元格/文档页为白底黑字，周边容器仍是深色。

============================================================

## 198. 【2026-07-22 00:10】- 文件预览标题栏图标与对话记录图标统一

### 修改内容

- 文件预览左上角（及加载/错误状态卡片）的类型图标改为与对话记录中的附件图标完全一致：字形用 `AttachmentFileGlyph`，底色按类型正确显示（文档蓝 `#3b82f6`、表格绿 `#34a853`、PDF 红 `#ef4444`）。
- 修复前：预览标题栏把 `attach-file-icon` 与 `attach-file-{typeKind}` 放在同一元素，导致 `.attach-file-{kind} .attach-file-icon` 后代选择器不命中，底色统一回退成默认蓝色（Excel/PDF 颜色错误）。

### 实现方式

- `chat.tsx` 把 4 处标题栏 `FileTypeIcon` 及 `FilePreviewState` 卡片图标改为与对话记录一致的结构：类型类放在父级 `div`，`.attach-file-icon` 作为子级，内部用 `<AttachmentFileGlyph typeKind={...}>`。这样复用既有 `.attach-file-{kind} .attach-file-icon`（底色）与 `.attach-file-{kind} .attach-file-glyph`（字形）规则，无需改 CSS。

### 验证

- 待人工确认：Word / Excel / PDF 预览标题栏左上角图标与对话记录中同类型附件图标的形状和颜色一致。

============================================================

## 197. 【2026-07-22 00:00】- 修复文件预览正文区被 ui-lib 40vh 截断的空白

### 修改内容

- 文件预览弹窗（Word / Excel / PDF）正文区被截断到 `40vh`、下方露出大片空白的问题统一修复。
- 根因（由用户 computed style 定位）：ui-lib 的 `.modal-container .modal-content { max-height: 40vh; padding: 20px }` 与本组件 `.file-preview-modal .modal-content` 覆盖同为 (0,2,0) 特异性，源码顺序打平后 40vh 生效，导致 720px 弹窗内正文区只有 40vh 高。此前误判为 flex 子元素未撑满，实为内容盒被 40vh 封顶，内部再 flex 也无效。

### 实现方式

- `chat.tsx` 将 docx 与 spreadsheet 拆成不同弹窗类，docx 用新增 `file-preview-modal-document`。
- `chat.module.scss` 新增统一规则 `.file-preview-modal.file-preview-modal :global(.modal-content)`：双写类名把特异性提到 (0,3,0)，稳定覆盖 `max-height: none; padding: 0`。PDF / Excel / Word 三种预览弹窗都带 `.file-preview-modal`，一并生效，正文盒不再被 40vh 截断。
- docx 高度链：`height: min(720px, calc(var(--full-height, 100dvh) - 48px))` + `file-preview-root height:100%` + `file-preview-body flex:1`（灰色兜底底色）+ `docx-preview-root flex:1 1 auto; min-height:0` 撑满画布。
- PDF：`.file-preview-frame`（object/iframe）原为固定 `height: min(640px, ...)` + `flex:0 0 auto`，撑不满更高的包装器、下方留白；改为 `flex:1 1 auto; height:100%; min-height:0` 撑满正文区。
- `file-preview-state-card` 用 `margin:auto` 垂直居中。

### 验证

- 用户已确认 Word 正常。待确认 Excel、PDF 硬刷新后正文区铺满、无空白。

============================================================

## 196. 【2026-07-21 23:34】- 统一附件图标与 Office 深色预览画布

### 修改内容

- PDF 附件改为与 Word 文档图标相同的文件页轮廓和尺寸，仅以红色背景与 `PDF` 标识区分；已发送附件、输入框附件、上传中状态与预览标题均复用同一实现。
- 任意主题下，Word 的实际文档页与 Excel 的表格单元格均使用白底深字；深色主题下 Excel 工作表容器与表格外留白为浅灰，工作表标签区使用深灰底与绿色当前项，弹窗容器、文件名、类型和大小等区域均沿用当前主题。
- PDF 预览弹窗在刷新后直接以视口高度建立确定的高度链并显式设定最小高度，避免 portal 内 `--full-height: 100%` 失去参照后按浏览器默认高度塌缩并留下大块空白。

### 实现方式

- `AttachmentFileGlyph` 统一选择 PDF 专属标识或既有文件页字形，减少同一附件在不同展示位置的视觉差异。
- Office 模态预览仅覆盖 DOCX 的实际页面和 Excel 的表格/单元格色；Word 页面在浅色主题也显式固定纯白，Excel 工作表容器使用浅灰、工作表标签使用深色主题色与深灰蓝分隔线，避免内容留白或元信息栏被错误改为浅色；深色标题与元信息栏的分隔线改用低对比度灰色。
- 弹窗高度改为 `100vh` / `100dvh` 直接计算、强制覆盖 UI 库高度并保留同值最小高度；`modal-content`、预览根节点和内容区都建立确定的 `flex: 1 1 0` 高度链，预览包装器占满内容区，`object` 和其 iframe fallback 绝对定位铺满包装器，彻底隔离浏览器替换元素的默认高度。

### 验证

- `yarn lint` 与 `git diff --check` 通过；`nextchat-dev` 和 `postgres-ssh-tunnel` 均处于运行状态，开发容器通过挂载读取当前源码。
- 本地聊天页已确认已发送 PDF 附件输出 `attach-file-pdf-glyph`，点击 `123(1).pdf` 能打开 PDF 预览并显示同一图标。

### 潜在或遗留问题

- 浏览器截图通道未正常绘制本地聊天界面，未取得可用视觉截图；请在深色主题下分别打开现有 Word 与 Excel 附件进行最终人工确认。

============================================================

## 195. 【2026-07-21 22:25】- 收敛附件原文件与视觉 PDF 输入边界

### 修改内容

- 原生 OpenAI Responses 现在仅发送最新用户消息的原始附件；历史附件继续以受限提取文本参与上下文，不再在每轮请求重复占用文件额度。
- 文字层不足 120 字符的 PDF 保留已提取短文本，并为非原生 OpenAI Provider 追加视觉页；原生 OpenAI 只使用原始 `input_file`，避免与渲染页重复输入。
- 视觉 PDF 返回总页数、实际渲染页数和截断/失败状态；模型与用户均会收到“未完整读取”的明确提示。停止按钮会取消浏览器中的附件提取请求。

### 实现方式

- `/api/cache/extract` 以 `visualFallback` 标记短文字 PDF，`ChatMessageAttachedFile.requiresVisualInput` 让文本与视觉输入可同时保留。
- `/api/cache/visualize` 为页数上限、超时、渲染失败、文件缺失和不支持类型返回结构化状态；调用方把限制作为临时请求内容拼入模型上下文，并显示提示。
- 附件准备控制器的 `AbortSignal` 透传到 `/api/cache/extract` 请求；Responses 输入仅从最新用户消息读取可直传文件。

### 验证

- `yarn lint` 通过，`git diff --check` 通过。
- `npx tsc --noEmit --pretty false` 仍只报既有 `app/mcp/client.ts` 的两项 Zod 泛型错误，附件改动未产生新的 TypeScript 报错。

### 潜在或遗留问题

- 未发送真实文件或模型请求，避免未经单独确认上传用户内容或消耗 API 额度；请用超过 9 页的扫描 PDF、短文字 PDF 和带历史附件的连续追问进行端到端确认。

============================================================

## 194. 【2026-07-21 22:20】- 手动停止完整终止对话故障转移

### 修改内容

- 点击助手回复的停止图标后，当前消息不再把中断误判为失败，也不会继续尝试其他模型。
- 用户停止覆盖附件准备、迟到创建的请求控制器、当前模型请求和后续全部故障转移候选；正常上游超时、网络和响应错误仍维持自动重试。
- README 与开发文档同步说明手动停止和自动容错的行为边界。

### 实现方式

- 故障转移链路按消息 ID 从当前 Chat Store 实时读取 `manualStopped`，不再读取异步调用开始时捕获的旧会话快照；每次进入候选前再次硬拦截。
- 控制器晚于停止操作才创建时立即中断，避免重试间隙遗留在途请求；只有用户停止才终止候选循环，Provider 的超时 Abort 继续作为可重试失败处理。

### 验证

- `docker exec nextchat-dev yarn lint`、`npx prettier --check app/store/chat.ts README.md docs/development.md` 和 `git diff --check` 通过；`/chat` 返回 `HTTP 200`。
- 浏览器以 `ccc` 用户加载 `/chat`，页面正常渲染且没有应用错误；仅有项目既有 React Router v7 future flag 警告。
- `npx tsc --noEmit --pretty false` 仍只报既有 `app/mcp/client.ts` 两项 Zod 泛型错误。

### 潜在或遗留问题

- 未发送真实模型请求，避免未经单独确认消耗 API 额度；请用一个会触发自动回退的模型实际点击停止，确认不再出现下一候选状态行。

============================================================

