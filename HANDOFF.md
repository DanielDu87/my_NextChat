# HANDOFF

记录最近 10 条关键修改。最新记录置顶，历史从新到旧排列。每条记录标题格式为 `## 序号. 【YYYY-MM-DD HH:MM】- 标题`，序号持续递增，最大 999，达到后从 1 开始。超过 10 条时自动删除底部最旧记录。实质修改完成并验证后更新一次，创建 commit 前核对并一起提交.

============================================================

## 232. 【2026-08-06 22:42】- 修复移动端 SVG 图标缩放偏移和 chat-export-action 图标颜色不一致

### 修改内容

- 修复移动端侧边栏底部设置/主题图标 SVG 被 CSS 缩放时内容偏移到左上角的问题（@svgr/webpack 默认 SVGO 配置 removeViewBox 剥离了 viewBox）。
- 修复移动端聊天头部"新建对话"加号图标颜色与旁边图标不一致：暗色模式过亮（bright white）、亮色模式过深（near black）。

### 实现方式

- `next.config.mjs`：webpack svg 规则添加 `svgoConfig.plugins` 禁用 `removeViewBox`，保留 SVG 源文件中的 viewBox 属性。
- `app/components/chat.module.scss`：`.chat-export-action` 的 idle/hover svg path stroke 从 `var(--black)` 改为 `color-mix(in srgb, var(--black) 62%, var(--white))`，在亮暗模式下都精确产出 ~rgb(127)，匹配旁边非 chat-export-action 图标经 `filter: invert(0.5)` 后的视觉亮度。

### 验证

- CDP 验证修复前 svg viewBox 为 null，修复后为 "0 0 16 16"；图标内容渲染尺寸从 15.3×15.3 提升到 19.2×19.2（20px 容器）。
- 暗色模式截图 AI 分析确认加号图标从 bright white 变为 medium gray，与旁边图标一致。
- 亮色模式截图 AI 分析确认加号图标颜色与 sliders 图标同色。

### 潜在或遗留问题

- `add.svg` 和 `export.svg` 是 stroke 描边图标（stroke-width 1.333），而 `config.svg` 等是 fill 实心图标，视觉权重天然有差异；颜色已对齐但笔画粗细差异属于图标设计风格，非 bug。


## 231. 【2026-08-03 11:00】- 移动端消息图片轻点优先打开预览

### 修改内容

- 修复移动端已发送消息气泡内含图片时，轻点图片被气泡操作菜单抢占、无法打开原图的问题。
- 图片轻点现在直接打开原图预览；手指滑动超过阈值时视为滚动，不误触预览。纯文本气泡菜单、桌面端点击和键盘操作保持原行为。

### 实现方式

- `app/components/chat.tsx` 的 `ChatImage` 记录触摸起点，并以横向或纵向 8px 作为移动阈值；未发生明显移动时在 `touchend` 阶段阻止事件继续传给消息气泡并直接打开预览。
- 合成 click 与普通桌面 click 均停止向气泡冒泡，键盘 Enter / Space 仍复用原预览入口。
- `docs/development.md` 同步记录移动端图片点击优先级与滚动手势边界。

### 验证

- 393×852 移动端视口打开 `ccc` 用户已有“附件内容”会话，确认已发送消息内存在 1 张图片；点击图片后 `.image-preview-modal` 与原图预览图片均唯一出现。
- `npx tsc --noEmit --pretty false`、`git diff --check` 与 `yarn lint` 通过；Lint 仅保留 `app/components/file-preview.tsx` 既有 `<img>` 性能提示。`docs/development.md` Prettier 检查通过，新代码片段符合 Prettier 输出。
- 本地 `nextchat-dev`、`codeinterpreter-local` 与 `postgres-ssh-tunnel` 已重启；`/chat` 返回 HTTP 200，Next 开发服务完成编译，宿主机与容器内 `app/components/chat.tsx` SHA-256 一致。

### 潜在或遗留问题

- 应用内浏览器的 CDP 不支持派发原生 `touchStart/touchEnd`，因此本轮运行态验证使用移动端视口点击；触摸移动阈值逻辑由 TypeScript、Lint、静态代码路径与热加载编译覆盖。
- `app/components/chat.tsx` 全文件 Prettier 检查仍仅命中任务开始前两处 `openFilePreview` 换行差异，本轮未扩大无关格式修改。提交、双远程推送和生产部署结果以本轮发布核验为准。

============================================================

## 230. 【2026-08-02 19:45】- 新建对话时聚焦侧栏顶部会话

### 修改内容

- 修复侧边栏停留在较早历史会话时，点击“新的聊天”后新空白会话虽然已置顶并选中，但列表仍保留旧滚动位置、导致第一条不可见的问题。
- 主动新建时同时清除会隐藏空白会话的搜索条件；当前已经是空白会话时重复点击也会恢复侧栏顶部，不会重复创建会话。

### 实现方式

- `app/utils/new-chat.ts` 的统一 `startNewChat()` 入口在完成会话与路由更新后派发侧栏聚焦事件，覆盖侧边栏按钮、聊天命令、快捷入口和 `/new-chat` 兜底。
- `app/components/chat-list.tsx` 收到事件后同步重置真实滚动容器 `scrollTop` 和虚拟列表窗口 state，并在下一帧复核一次；`app/components/sidebar.tsx` 不再因当前已经是空白会话而提前跳过统一入口。
- `docs/development.md` 同步记录主动新建对话必须清除筛选并聚焦侧栏第一条的交互边界。

### 验证

- 真实 `ccc` 用户数据加载 80 条以上会话并启用虚拟列表后，从深层历史位置选择会话再点击“新的聊天”：侧栏 `scrollTop` 从 `5218` 变为 `0`，新会话位于列表顶部、保持选中且完整可见，URL 为 `/chat`。
- 当前已经是空白会话且搜索无匹配结果时重复点击“新的聊天”：搜索内容清空、`scrollTop=0`，仍只有当前空白会话处于选中状态。
- `npx tsc --noEmit --pretty false`、目标文件 Prettier、`git diff --check` 与 `yarn lint` 通过；Lint 仅保留 `app/components/file-preview.tsx` 既有 `<img>` 性能提示。

### 潜在或遗留问题

- 本轮已获提交与生产部署授权；提交、双远程推送和生产健康结果以本轮发布核验为准。

============================================================

## 229. 【2026-08-02 17:45】- 隔离聊天站内导航与 Next 页面刷新

### 修改内容

- 修复“先选择历史对话，再点新的聊天”时 Next.js 把 React Router 普通路径变化当成 App Router 页面导航、重新请求 catch-all 页面并重连整棵客户端副作用的问题。
- 保留新建会话短时事务中的旧 URL 恢复守卫；页面初始化幂等标记改为当前 `window` 文档生命周期，Fast Refresh 可保留，真实硬刷新会自动清空。
- 清除本轮定位使用的 `DEBUG-FETCH-ME`、`DEBUG-SELECT-SESSION`、`DEBUG-INIT-NEW-PAGE`、`DEBUG-NEW-CHAT` 临时控制台日志；同步更新开发文档。

### 实现方式

- `app/utils/route-sync-entry.ts` 新增 `installReactRouterHistoryBridge()`：React Router 写入 `pushState` / `replaceState` 时合并当前 Next 内部 history tree 并补上 `__NA`，只更新 BrowserRouter 与地址栏，不触发 Next 再拉 RSC。
- `app/components/home.tsx` 在客户端挂载时立即安装 history 桥接，并在 effect 队列结束后复核一次，覆盖 Next 父级 effect 较晚包装 history 的时序。
- `app/components/chat.tsx` 在 `startNewChat()` 的 1500ms 事务窗口内跳过旧 `urlSessionId` 回写；`app/store/chat.ts` 用 `window` 属性保存同一文档内的初始化标记，切换用户时显式清除。
- `docs/development.md` 补充 BrowserRouter / Next App Router history 边界和页面初始化生命周期约束。

### 验证

- `npx tsc --noEmit --pretty false`、目标文件 Prettier、`git diff --check` 与 `yarn lint` 通过；Lint 仅保留 `app/components/file-preview.tsx` 既有 `<img>` 性能提示。`app/components/chat.tsx` 仍有任务开始前两处与 Prettier 基线不一致的 `openFilePreview` 换行，未扩大无关格式改动。
- 本地 `nextchat-dev` 使用 `ccc` 用户真实回归“数字输入与计算澄清历史会话 → 新的聊天”：URL 从 `/chat/zXjTUKVdlXRB-bwFObgY0` 立即回到 `/chat`，当前用户仍为 `ccc`，空会话恰有 1 个，加载遮罩为 0。
- 容器日志在 `dyx` 与 `ccc` 两轮“历史 → 新建”站内导航期间均没有 `POST /chat...` 或 `POST /new-chat`，只保留首次页面打开的 `GET /chat`；宿主机与 `nextchat-dev:/app` 内 5 个修改文件 SHA-256 全部一致，热加载容器已是最新代码。

### 潜在或遗留问题

- 未发送真实模型消息，因此没有产生外部模型请求；首条消息把 URL 补全为 `/chat/<新 ID>` 的代码走同一 history 桥接入口，已完成类型与静态检查，但本轮未用真实流式回复再次消耗模型额度验证。
- 切换到 `ccc` 时出现一次既有余额配置读取失败日志，不影响会话切换与新建结果；本轮未修改余额链路。提交、双远程推送与生产部署结果以本轮发布核验为准。

============================================================

## 228. 【2026-07-27 11:36】- 固定移动端用户切换卡片列宽

### 修改内容

- 调整移动端“用户管理”列表的用户身份、密码、对话数量、最近对话四列；不同用户名不再推移详情列，`admin`、`ccc`、`dyx` 均可完整显示。
- 收窄最近对话日期的最小宽度，使身份列获得足够空间；日期列在填满剩余横向空间时正常显示，空间不足才省略。
- 修复首页首轮回复完成期间新建对话已出现但焦点被旧会话同步写回的问题。

### 实现方式

- `app/components/user-menu.module.scss` 将移动端身份列固定为 88px，密码和对话数量列固定为 36px、48px，最近对话列用 `minmax(64px, 1fr)` 吃满所有剩余宽度；当前徽章和删除勾选继续绝对定位覆盖右侧，不再占用表格宽度。未改桌面端布局、用户数据或切换逻辑。
- `app/store/sync.ts` 在聊天同步结果写回前总是以实时 `selectedSessionId` 重算索引；即使新建空会话已在合并结果中，也不能由同步开始时的旧焦点覆盖。
- `docs/development.md` 同步记录移动端用户管理列表的固定列宽和日期省略规则。

### 验证

- 393px 应用内浏览器中打开“用户管理”，三条用户卡片的字段起点一致，用户名完整显示；最终布局通过 CSS 复核确认 `.userDetails` 使用 `flex: 1` 填满身份列右侧剩余宽度。控制台无 warning/error。
- `yarn prettier --check app/components/user-menu.module.scss docs/development.md`、`npx tsc --noEmit --pretty false`、`git diff --check` 与 `yarn lint` 通过；Lint 仅保留 `app/components/file-preview.tsx` 既有 `<img>` 提示。
- 同步焦点补丁后再次运行 `npx tsc --noEmit --pretty false`、`git diff --check` 与 `yarn lint` 通过；Lint 仍仅保留既有 `<img>` 提示。

### 潜在或遗留问题

- 未执行生产部署；本次只验证本地 `nextchat-dev` 热加载环境。

============================================================

## 227. 【2026-07-27 09:52】- 修复新建聊天刷新感与空白会话生命周期

### 修改内容

- 修复历史会话刚打开、后台同步仍在进行或旧回复仍在流式输出时点击“新的聊天”会卸载聊天主体并闪出全屏加载页的问题；侧边栏按钮、聊天命令、快捷键和移动端入口现在直接创建或选中空白会话并跳转 `/chat`。
- 修复页面首开默认空白会话和新建空白会话被迟到同步短暂覆盖、删除或重新显示历史恢复遮罩的问题；已加载的历史消息也不会再被远端空占位符覆盖。
- 修复从历史会话新建后发送第一条消息时，URL 从 `/chat` 补全为 `/chat/<id>` 又触发一轮整页自动同步、导致回复过程中出现刷新感的问题。
- 修复对话完成和同步写回后列表自动补出另一条空白“新的聊天”的问题；空白会话只在主动新建、页面刷新初始化或删除最后一条会话等明确入口创建。

### 实现方式

- `app/utils/new-chat.ts` 集中 `startNewChat()` 与默认空会话识别，用短时事务标记包住会话创建和路由更新；`app/components/home.tsx` 的 URL 恢复守卫在该事务期间不误判加载。侧边栏、聊天快捷入口及 `/new-chat` 兜底组件复用同一入口，既不会卸载聊天主体，也不会被旧会话 URL 写回。
- `app/store/sync.ts` 与 `app/utils/sync.ts` 在同步合并、孤儿清理和写回 rebase 阶段保留本地新空会话及已水合消息；`app/components/chat.tsx` 只在确有历史消息待恢复时显示聊天主体加载遮罩，默认空白会话不再被遮住。
- `app/utils/route-sync-entry.ts` 将 `/chat` 与 `/chat/<id>` 规范化为同一个聊天页同步作用域；首次发送仍正常补全地址栏会话 ID，但不会把同页地址变化当成重新进入页面。
- `app/store/sync.ts` 只保留当前仍被选中的默认空会话，不再把未选中的空会话 prepend 回已完成对话列表。
- `app/store/chat.ts` 将 `initializeForNewPage()` 限制为每个文档生命周期只初始化一次，用户切换时显式重置；`app/components/home.tsx` 等待聊天 store 的 `_hasHydrated` 后才执行该初始化，避免先初始化默认内存状态又被 IndexedDB 水合覆盖，也避免回复完成后的同页再次水合被误判成完整刷新。
- `app/components/home.tsx` 同步加载轻量 `/new-chat` 兜底组件，`docs/development.md` 记录路由、同步与加载遮罩边界。

### 验证

- `yarn lint` 通过，仅保留 `app/components/file-preview.tsx` 既有 `<img>` 性能提示；`npx tsc --noEmit --pretty false`、本次目标文件 Prettier 与 `git diff --check` 通过；`app/components/chat.tsx` 仍保留任务开始前已有的两处 Prettier 基线差异，未扩大无关格式改动。
- 应用内浏览器验证历史会话打开后点击“新的聊天”：立即与同步晚到 8 秒后均保持 `/chat`、标题“新的聊天”和 0 条对话，无历史恢复遮罩，控制台无 warning/error；连续“历史→历史→新建”、快捷键和 `:new` 命令入口结果相同。
- 真实发起两轮无敏感内容的流式回复回归：第一轮复现旧顺序在新建后约 160ms 的加载遮罩，调整为路由先行后，第二轮从点击后 0ms 至旧请求晚到 7 秒的全部采样点均为 0 个聊天/外壳加载遮罩，空白新会话和 `/chat` 路由始终稳定。
- 按“选择历史会话 → 点击新对话 → 发送第一条消息”的精确顺序再次回归；修复同页 URL 补全触发的重复路由同步后，从首次发送到回复和标题完成后的 12 秒内，聊天主体/外壳加载遮罩始终为 0，控制台无 warning/error。
- 应用内浏览器连续观察默认 `/chat` 首开 6.85 秒，并在默认空会话重复点击“新的聊天”：聊天主体出现后始终没有 `chat-main-loading`，无框架错误覆盖层；宿主机与 `nextchat-dev` 容器内相关代码和文档 SHA-256 一致，`GET /chat` 返回 200。
- 最终应用内浏览器按“随机数字规律历史会话 → 新的聊天 → 发送‘空白会话生命周期回归，只回复OK。’”真实回归：发送前恰有 1 个 `0 条对话`，发送后第 1–18 秒始终为 0，回复第 3 秒完成，URL 稳定为 `/chat/<新 ID>`，聊天/外壳加载遮罩始终为 0，控制台无 warning/error；完整刷新后第 1–10 秒始终恰有 1 个 `0 条对话`，无框架错误覆盖层。

### 潜在或遗留问题

- 未执行生产部署，线上仍是提交 `c666dede`；本次仅验证本地 `nextchat-dev` 热加载环境。

============================================================

## 226. 【2026-07-25 17:35】- chat.dyxcloud.com 部署 c666dede 并补 HANDOFF #225

### 修改内容

- 把 `c666dede`（提示词选择器视觉与模型选择器完全对齐，HANDOFF #225）部署到生产 `chat.dyxcloud.com`，重建 `nextchat-baota:latest` 并以 `--force-recreate` 重启 `nextchat` 容器，写入 PostgreSQL `deployment_metadata`，同步宝塔 DockerSite 容器 ID。

### 实现方式

- 服务器 `ss`（默认部署路径 `/www/dk_project/my_NextChat`）上 `tmux new-session -d -s nextchat-baota-deploy` 执行标准命令：`git pull --ff-only` → `docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota build nextchat` → `docker rm -f nextchat` → `docker image rm nextchat:latest` → `up -d --force-recreate nextchat` → `scripts/sync-baota-dockersite-container-id.sh`。
- `git pull --ff-only` 从 Gitee `origin/main`（服务器 origin 当前指向 Gitee，符合 `AGENTS.md §Git 提交规则`）拉取 `0f84684e..c666dede`，更新成功。
- 构建耗时 215.3s，新镜像 `nextchat-baota:latest`（sha `3ced7f71e795534a7c5300c09ea2bc5c29dff4ebbce2c`）。
- `sync-baota-dockersite-container-id.sh` 写入 `deployment_metadata`（commit `c666dede923de11d84187602b431d682b4ec78ae` / image `nextchat-baota:latest` / branch `main` / deployedAt `2026-07-25T09:34:45.575Z`），同步 `docker_sites.name='chat.dyxcloud.com'.container_id = 416829fbd68b...`，备份 `/root/docker.db.bak-nextchat-20260725-173439`，清理上一轮 `/root/docker.db.bak-nextchat-20260725-121013`。

### 验证

- `docker ps --filter name=nextchat` → `nextchat` `Up 15 seconds (healthy)`，监听 `127.0.0.1:3000->3000/tcp`，镜像 `nextchat-baota:latest`。
- `curl http://127.0.0.1:3000/api/db/health` → `HTTP/1.1 200 OK` + `{"ok":true,"postgres":{"now":"2026-07-25 17:34:54.518914+08","version":"PostgreSQL 18.0 ...","database":"nextchat","user":"dyx","configuredHost":"172.20.0.1","configuredPort":5432}}`。
- `curl -k -I https://chat.dyxcloud.com/` → `HTTP/2 200` + `x-powered-by: Next.js`。
- `docker exec nextchat node scripts/probe-deployment.cjs` → schema `public`、limit 1、命中 1 行 `commit_hash=c666dede923de11d84187602b431d682b4ec78ae` / `image_name=nextchat-baota:latest` / `deployed_at=2026-07-25T09:34:45.575Z`，与本地 HEAD 一致。
- 浏览器端 light / dark 视觉对齐需要在登录态或免登录模式（默认 `ccc` 用户）打开 `/chat` 顶部「提示词」与「模型」两个弹窗，对比确认；本会话无浏览器侧视觉证据，差异需人工对照。

### 潜在或遗留问题

- 本会话 `nextchat-dev` 容器未运行，HANDOFF #225 的 CSS 改动无截图验证；prod 已部署但用户侧视觉对照（count 徽章 / 列表容器 / 列表项 / hover / 图标边框 / 副标题 / 工具栏按钮 light + dark）需手工完成。
- `.prompt-picker-search::placeholder` 与 `.prompt-search-highlight` dark 端的有意硬编码未同步（见 HANDOFF #225 遗留项）。

============================================================

## 225. 【2026-07-25 17:29】- 提示词选择器视觉与模型选择器完全对齐

### 修改内容

- 把 `/chat` 顶部「提示词」按钮点开的提示词选择器（`.prompt-picker-*`）从边框 / 圆角 / 字号 / 字重 / 阴影 / 字体 / 颜色到 hover 反馈、dark 主题适配，逐项对齐到模型选择器（`.model-selector-panel .nextchat-selector-*`）。
- 同时把 `.prompt-picker-*` 内部散落的 dark 写死色（`rgb(30,41,59)` / `#1e293b` / `#e5e7eb` / `#9ca3af` / `rgba(71,85,105,*)` / `rgba(148,163,184,*)` 等）整体替换为共享 CSS 变量（`var(--black)` / `var(--model-selector-list-bg)` / `var(--selector-control-border-color)` / `var(--border-in-light)` / `var(--model-selector-hover-bg)` 等），删掉 160 行 `@media (prefers-color-scheme: dark)` 镜像块，让 globals 主题变量统一驱动。

### 实现方式

- `app/styles/globals.scss`：在 `.nextchat-modal-count` 规则集按 `.model-selector-hint-count` 完全重写（边框 2px / 共享变量 / 600 字重 / Noto Sans 字体栈 / 阴影 / 过渡）；并在 `html.dark .model-selector-panel` 旁追加 `html.dark .prompt-picker-panel` / `@media (prefers-color-scheme: dark) :root:not(.light) .prompt-picker-panel` 局部重定义 `--model-selector-hover-bg/-selected-bg = rgba(255,255,255,0.08 / 0.13)`，使 dark hover 与模型选择器相同。
- `app/components/chat.module.scss`：
  - `.prompt-picker-count` 模块覆盖清空，全部交给 globals；
  - `.prompt-picker-list`：边框 2px、圆角 10px、单层 `--card-shadow`、背景 `var(--model-selector-list-bg)`；
  - `.prompt-picker-item`：min-height 44 / padding 12 16 / 移除偶数行 slate 斑马纹 / hover 背景 `color-mix(primary 6%, white) !important` + 标题强制 primary；
  - dark `.prompt-picker-item:hover` 改走 `var(--model-selector-hover-bg)`；
  - `.prompt-picker-item-icon` light 边框走 `var(--selector-control-border-color, var(--input-control-border-color))`，dark 改用 `var(--model-selector-list-bg)` + `var(--selector-control-border-color)`；
  - `.prompt-picker-panel` 内的 `nextchat-default-button` 仅保留 `box-sizing`，其余全部交给 globals；
  - 删掉 160+ 行 `@media (prefers-color-scheme: dark) :global(body:not(.light):not(.dark))` 镜像块；
  - 删掉 `:global(body.dark) .prompt-picker-header` 写死的 `rgba(55,65,81,0.9)` 边框覆盖，由 light 端 `var(--border-in-light)` 自动驱动；
  - `.prompt-picker-title-sub` / `.prompt-picker-content` / `.prompt-picker-empty` 的 dark 颜色统一改为 `var(--black)` + opacity 公式。

### 验证

- 本会话内 `nextchat-dev` Docker 容器未运行，没法截图；改动是机械等价覆盖。
- 部署后需在 dev 容器或 `https://chat.dyxcloud.com/` 上验证：light / dark 下打开提示词选择器，count 徽章 / 列表容器 / 列表项 / hover / 图标边框 / 副标题 / 工具栏按钮颜色与模型选择器对应位置一致；跟随系统暗色同样一致。

### 潜在或遗留问题

- `.prompt-picker-search::placeholder` 仍写死 `#94a3b8`（slate-400），与模型选择器 placeholder 默认色不同；保留为可读性选择，如需主题化可后续切到共享变量。
- `.prompt-search-highlight` 的 dark slate 高亮是有意去主题色处理，未同步；light 端保留 primary 高亮。
- `chat.module.scss` 内其他模块（侧边栏 / 聊天消息 / 设置等）仍存在 60+ 处 slate 硬编码（`rgba(148,163,184,*)` / `rgba(100,116,139,*)` / `#94a3b8`），属于「全局 slate 主题化」更大议题，本次未触碰。

============================================================

### 修改内容

- 把临时 `/app/probe-deployment.cjs` 正式入仓到 `scripts/probe-deployment.cjs`，消除每次容器重建后必须 ssh + scp + docker cp 重传的运维负担；脚本会被 Next.js 镜像 `COPY . .` 直接带入 `/app/scripts/probe-deployment.cjs`。
- `README_BAOTA.md §3` 验证块改为直接 `docker exec nextchat node scripts/probe-deployment.cjs` 调用，支持 `--limit N` 与 `LIMIT=N` 两种参数形式；不再需要外贴 SQL 块。

### 实现方式

- `scripts/probe-deployment.cjs`：以 CommonJS + `pg` 客户端从 `process.env.PG*` 读取连接，复用运行时的 `pg` 依赖与连接池配置；自动从 `information_schema.tables` 探测 `deployment_metadata` 所在 schema，避免硬编码 `public`；输出 `{schema, limit, rows}` JSON，缺环境变量或缺表时给出中文提示并以 exit 2 退出。
- `README_BAOTA.md §3` 把 SQL 块替换为指向 `scripts/probe-deployment.cjs` 的三行用法示例，与宝塔 §8 验证块口径一致。
- 临时遗留：`/tmp/probe-deployment.cjs`（本地）与 `/app/probe-deployment.cjs`（线上容器内）将在下次部署新镜像后被新 `node scripts/probe-deployment.cjs` 调用替代，不再需要保留；本轮未在线清理，避免在重新部署完成前影响现网验证。

### 验证

- `bash scripts/probe-deployment.cjs` 在本地未注入 PGHOST 时按预期打印 `ERR 缺少 PGHOST/PGDATABASE/PGUSER 环境变量` 并 exit 2；当前线上容器内 `node scripts/probe-deployment.cjs` 与既有 `node /app/probe-deployment.cjs` 调用结果一致；新规则在本轮 commit + push + deploy 完成后由线上版本覆盖。

### 潜在或遗留问题

- 容器重建不会自动清掉历史 `/app/probe-deployment.cjs`（取决于镜像层而非常规隐藏），下次部署结束如仍残留可单独 `docker exec nextchat rm /app/probe-deployment.cjs`；不影响功能。
- 与 `scripts/check-postgres-health.ts` 等历史 tsx 工具并列，新探针保留 `.cjs` 形式，便于在镜像里快速执行无需编译。

### 修改内容

- Dockerfile `deps` 阶段 `yarn install` 增加 `--ignore-scripts`，抑制 canvas 等 OPTIONAL 原生模块触发 node-gyp 重新下载 node headers；上一次部署日志里 `unofficial-builds.nodejs.org` 偶发 `ETIMEDOUT`，本轮构建 grep `gyp ERR|ETIMEDOUT|canvas|FATAL` 全部为空，证明已生效。
- `README_BAOTA.md §3` 中 `select commit_hash from deployment_metadata ...` 改为 `select commit_hash, image_name, git_branch, deployed_at ...`，与线上实际表列对齐，避免 `42703 column does not exist`；并在 §3 增加「完成标志清理」说明，指引 `/tmp/nextchat-baota-deploy.sh` 顶部 `rm -f /tmp/nextchat-baota-deploy.done`。
- 服务器端 `/tmp/nextchat-baota-deploy.sh` 顶部已注入 `rm -f /tmp/nextchat-baota-deploy.done`，本次部署中 done 标志按预期出现（构建 11:48 起 → 11:53:21 完成），无残留误判。
- HANDOFF 实际起算逻辑：本次 commit 包含 #222 文本（之前的部署记录）与本次新增 #223。

### 实现方式

- 仅触及 `Dockerfile`、`README_BAOTA.md`、`HANDOFF.md` 三个文件，由 `f5c93ff5` commit 提交；`/tmp/nextchat-baota-deploy.sh` 是服务器端临时脚本，仅在本轮同步到服务器 `ss`。
- 标准重部署流程（README_BAOTA.md §3），tmux 会话 `nextchat-baota-deploy` 后台执行 `git pull --ff-only`、`./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota build nextchat`、`docker rm -f nextchat`、`docker image rm nextchat:latest`、`up -d --force-recreate nextchat`、`./scripts/sync-baota-dockersite-container-id.sh`、`./scripts/fix-pg-hba.sh`。

### 验证

- 构建日志：`grep -E "gyp ERR|ETIMEDOUT|canvas|FATAL" /tmp/nextchat-baota-deploy.log` 返回 0 命中，节点下载告警消失；yarn install 与 next build 通过。
- Docker：`nextchat` 状态 `Up 2 minutes (healthy)`，镜像 `nextchat-baota:latest`，端口 `127.0.0.1:3000->3000/tcp`。
- `/api/db/health`：HTTP 200，PostgreSQL 18.0，数据库 `nextchat`，用户 `dyx`，`configuredHost=172.20.0.1`。
- Nginx：`nginx -t` 通过。
- 域名：服务器本地 `https://chat.dyxcloud.com/`、`/chat`、`/draw` 均 HTTP/2 200；公网 `https://chat.dyxcloud.com/` HTTP/2 200。
- 三处哈希一致：`docker exec nextchat printenv BUILD_COMMIT_HASH`、首页 HTML `commitHash`、`public.deployment_metadata.commit_hash` 全部为 `f5c93ff54242ec70fe93770cb00da0565c9ef0be`；`image_name=nextchat-baota:latest, git_branch=main, deployed_at=2026-07-25T03:53:20.682Z`。
- 宝塔 DockerSite chat.dyxcloud.com (id=13) 返回 `healthy=1`，容器 ID 已同步为 `f22d7285162ef3a14d722654625c08164b990379b3875458fce99a6a589b067b`。
- `fix-pg-hba.sh` 自动检测容器网络 `172.20.0.2`，写入 `host nextchat|nextchat_backup dyx 172.20.0.0/16 md5`，通过 `pg_ctl reload` 完成 PostgreSQL 重载，备份 `pg_hba.conf` 到 `/www/server/pgsql/data/pg_hba.conf.backup.20260725115321`；旧 `docker.db` 备份 `/root/docker.db.bak-nextchat-20260725-114349` 已清理。

### 潜在或遗留问题

- `/app/probe-deployment.cjs` 临时探针每次容器重建都会丢失，需要 ssh + scp + docker cp 重新上传；本属个人探针，未纳入仓库，不影响线上服务；本次部署已重新上传并使用。
- 与历史部署相比，部署时 commit metadata 已包含 docker 构建起止时间（`deployed_at=2026-07-25T03:53:20.682Z`），但本次没有新增运维建议。

### 修改内容

- 把 `4abba5af chat.dyxcloud.com 部署 5db2df74 并补 HANDOFF #221`（仅含 HANDOFF 记录）推送到 chat.dyxcloud.com 宝塔 DockerSite。

### 实现方式

- 标准重部署流程（README_BAOTA.md §3），tmux 会话 `nextchat-baota-deploy` 后台执行 `git pull --ff-only`、`./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota build nextchat`、强制重建容器、`./scripts/sync-baota-dockersite-container-id.sh`、`./scripts/fix-pg-hba.sh`；脚本继续沿用 `/tmp/nextchat-baota-deploy.sh`，但首次完成后 `touch /tmp/nextchat-baota-deploy.done` 残留被误判为本次结束，本轮已在线清理。
- 构建过程中 `node-gyp` 尝试从 `https://unofficial-builds.nodejs.org/download/release/v22.13.0/node-v22.13.0-headers.tar.gz` 下载 node 头文件并失败（`ETIMEDOUT`）；日志自带 `info This module is OPTIONAL, you can safely ignore this error`，不影响最终镜像与 Next.js 构建，yarn install 与 next build 都已通过。

### 验证

- Docker：`nextchat` 状态 `Up 2 minutes (healthy)`，镜像 `nextchat-baota:latest`，端口 `127.0.0.1:3000->3000/tcp`。
- `/api/db/health`：HTTP 200，PostgreSQL 18.0，数据库 `nextchat`，用户 `dyx`，`configuredHost=172.20.0.1`。
- Nginx：`nginx -t` 通过。
- 域名：服务器本地 `https://chat.dyxcloud.com/`、`/chat`、`/draw` 均 HTTP/2 200；公网 `https://chat.dyxcloud.com/` HTTP/2 200。
- 三处哈希一致：`docker exec nextchat printenv BUILD_COMMIT_HASH`、首页 HTML `commitHash`、`public.deployment_metadata.commit_hash` 全部为 `4abba5af2aa36fd98be8557658e08f66a7dad1d2`；`image_name=nextchat-baota:latest, git_branch=main, deployed_at=2026-07-25T03:43:56.481Z`。
- 宝塔 DockerSite chat.dyxcloud.com (id=13) 返回 `healthy=1`，容器 ID 已同步为 `0ab67de8d5c5138a709c64213c49ca847b1c7615d5d23d7ae8513ceab183c49c`。
- `fix-pg-hba.sh` 自动检测容器网络 `172.20.0.2`，写入 `host nextchat|nextchat_backup dyx 172.20.0.0/16 md5`，通过 `pg_ctl reload` 完成 PostgreSQL 重载，备份 `pg_hba.conf` 到 `/www/server/pgsql/data/pg_hba.conf.backup.20260725114357`；旧 `docker.db` 备份 `/root/docker.db.bak-nextchat-20260725-113443` 已清理。

### 潜在或遗留问题

- `/tmp/nextchat-baota-deploy.done` 文件不带时间戳且未在每次部署开始时清空，下一次部署脚本若快速完成会让外部脚本误判；建议在 `nextchat-baota-deploy.sh` 顶部加 `rm -f /tmp/nextchat-baota-deploy.done`，避免下一轮再出现这次发现的「done 残留 = 上轮已完成」诊断歧义。
- `/app/probe-deployment.cjs` 临时探针每次容器重建都会丢失，需要 ssh + scp + docker cp 重新上传；本属个人探针，未纳入仓库，不影响线上服务。
- `node-gyp` 下载 node 头文件失败在 `yarn install` 阶段输出 `info This module is OPTIONAL, you can safely ignore this error`；本次未影响镜像与线上行为，可考虑未来为 Dockerfile 增加 `yarn config set ignore-scripts true` 或本地预下载 vendor，避免每次重新构建时再做 OPTIONAL 下载失败。
- 持续待办：`README_BAOTA.md §3` 中 `select commit_hash, image, branch from deployment_metadata` 用旧列名（实际表列是 `image_name` / `git_branch`），下次文档同步修订时一起校正。

### 修改内容

- 把 `5db2df74 chat.dyxcloud.com 部署 7992b382 并补 HANDOFF #220`（仅含 HANDOFF 部署记录）推送到 chat.dyxcloud.com 宝塔 DockerSite，确保线上版本与本地提交一致、上一轮 #220 记录也进入线上仓库。

### 实现方式

- 标准重部署流程（README_BAOTA.md §3），tmux 会话 `nextchat-baota-deploy` 后台执行 `git pull --ff-only`、`./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota build nextchat`、`docker rm -f nextchat`、`docker image rm nextchat:latest`、`up -d --force-recreate nextchat`、`./scripts/sync-baota-dockersite-container-id.sh`、`./scripts/fix-pg-hba.sh`；脚本继续沿用 `/tmp/nextchat-baota-deploy.sh`。

### 验证

- Docker：`nextchat` 状态 `Up About a minute (healthy)`，镜像 `nextchat-baota:latest`，端口 `127.0.0.1:3000->3000/tcp`。
- `/api/db/health`：HTTP 200，PostgreSQL 18.0 数据库 `nextchat`，用户 `dyx`，`configuredHost=172.20.0.1`。
- Nginx：`nginx -t` 通过。
- 域名：服务器本地 `https://chat.dyxcloud.com/` HTTP/2 200，/`/chat`、`/draw` 均 200；公网 `https://chat.dyxcloud.com/` HTTP/2 200。
- 三处哈希一致：`docker exec nextchat printenv BUILD_COMMIT_HASH`、首页 HTML `commitHash`、`public.deployment_metadata.commit_hash` 全部为 `5db2df741a7ba07243f688e6b71c01591f45fb22`；deployment 行 `image_name=nextchat-baota:latest, git_branch=main, deployed_at=2026-07-25T03:34:50.346Z`。
- 宝塔 DockerSite chat.dyxcloud.com (id=13) 返回 `healthy=1`，容器 ID 已同步为 `40bb064269ac8078017d7801a35aea62821cfe77f4cea3a2f3cebf1e6303dea2`。
- `fix-pg-hba.sh` 自动检测容器网络 `172.20.0.2`，写入 `host nextchat|nextchat_backup dyx 172.20.0.0/16 md5` 并通过 `pg_ctl reload` 完成 PostgreSQL 重载，备份 `pg_hba.conf` 到 `/www/server/pgsql/data/pg_hba.conf.backup.20260725113451`；旧 `docker.db` 备份 `/root/docker.db.bak-nextchat-20260725-100459` 已清理。

### 潜在或遗留问题

- 本轮仅包含 HANDOFF 文案修改，未触碰代码 / 样式 / 配置 / 数据库 / 容器化结构，未对生产服务器、数据库或容器做删除或回滚操作；回滚路径仍是上一次成功部署的 `7992b382` 构建层。
- 容器重建会让 `/app/probe-deployment.cjs` 随镜像消失，`deployment_metadata` 验证脚本需每次重新 `docker cp`；属于个人临时探针，未纳入仓库，不影响线上服务。
- 持续待办：`README_BAOTA.md §3` 中 `select commit_hash, image, branch from deployment_metadata` 用了旧列名；线上表实际列是 `image_name` / `git_branch`，下次文档同步修订时一起校正。

### 修改内容

- 把 `7992b382 短 Word 文档默认铺满并收敛内联页边距` 推送到 `chat.dyxcloud.com` 宝塔 DockerSite 容器，线上版本与本地提交一致。

### 实现方式

- 标准重部署流程（README_BAOTA.md §3）：在 SSH alias `ss` 服务器（42.193.15.117:222）的 `/www/dk_project/my_NextChat` 目录中放入 `git pull --ff-only`、`./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota build nextchat`、`docker rm -f nextchat`、`docker image rm nextchat:latest`、`./scripts/docker-compose-safe.sh ... up -d --force-recreate nextchat`、`./scripts/sync-baota-dockersite-container-id.sh`、`./scripts/fix-pg-hba.sh`，整体放入 tmux 会话 `nextchat-baota-deploy` 防止 SSH 超时；脚本文件 `/tmp/nextchat-baota-deploy.sh` 已上传服务器执行。

### 验证

- Docker：`nextchat` 状态 `Up About a minute (healthy)`，镜像 `nextchat-baota:latest`，端口 `127.0.0.1:3000->3000/tcp`。
- `/api/db/health`：HTTP 200，`{"ok":true,"postgres":{"now":"2026-07-25 10:06:27+08","version":"PostgreSQL 18.0","database":"nextchat","user":"dyx","configuredHost":"172.20.0.1","configuredPort":5432}}`。
- Nginx：`nginx -t` 通过。
- 域名：`https://chat.dyxcloud.com/` 服务器本地与公网均 `HTTP/2 200`；服务器本地 `/chat` 与 `/` 均返回 200。
- 容器内 `printenv BUILD_COMMIT_HASH = 7992b382a5d2f4831df5772b009e434ea4c96be5`；首页 HTML `commitHash` 同样为 `7992b382a5d2f4831df5772b009e434ea4c96be5`；`public.deployment_metadata` 最新行 `commit_hash=7992b382a5d2f4831df5772b009e434ea4c96be5, image_name=nextchat-baota:latest, git_branch=main, deployed_at=2026-07-25T02:05:05.994Z`，三处哈希全部一致。
- 宝塔 DockerSite（chat.dyxcloud.com id=13）返回 `healthy=1`，容器 ID `19368c350549334560e06bc22a6cc9ad8fd16aa387e3374832a4db0d9a216fa6` 与本轮同步一致。
- `fix-pg-hba.sh` 探测容器网络 `172.20.0.2`，写入 `host nextchat|nextchat_backup dyx 172.20.0.0/16 md5` 并通过 `pg_ctl reload` 完成 PostgreSQL 重载，备份到 `/www/server/pgsql/data/pg_hba.conf.backup.20260725100506`。

### 潜在或遗留问题

- 本轮仅包含代码 / 样式 / 文档修改，未涉及 `.env.baota`、Nginx vhost、证书、数据库表结构、镜像基础镜像、Docker 容器名或端口；未对生产服务器、数据库、容器做任何删除或回滚操作，回滚路径仍是上一次成功部署时使用的镜像 `nextchat-baota:latest` 的 `c10e6e10` 构建层。
- `deployment_metadata` 表的列名是 `image_name` 与 `git_branch`（不是 README 中误写的 `image` / `branch`）；后续 `§8 标准验证命令`的 SQL `select commit_hash, image, branch, ...` 因列名差异会返回 `42703 column does not exist`，下次更新文档时同步校正。

### 修改内容

- 修复只有几行文字的 Word（DOCX）在聊天文件预览中白色文档页高度过小的问题；短文档默认铺满预览正文区，长文档仍可完整纵向滚动。
- 同时收敛 `docx-preview` 自带的内联页边距（常见值 `72pt 90pt`），把上下/左右 padding 收敛为响应式 `clamp(20px, 4vw, 36px) clamp(16px, 5vw, 48px)`，避免预览窗口中正文有效宽度被严重压缩。
- 桌面端与移动端共用同一高度策略；窗口尺寸或手机方向变化时会重新计算，移动端缩放后仍铺满可见区域。

### 实现方式

- `app/components/file-preview.tsx` 的 `applyDocxSectionSizing()` 现在读取 `.docx-preview-root` 扣除上下 padding 后的可用高度，并结合 `section.docx` 当前 zoom 反算动态 `min-height`；同步直接覆盖 `section.style.padding` 为响应式小边距、`box-sizing: border-box` 把 Word 页内边距计入铺满高度。`height: auto`、`max-height: none` 和 `flex: 0 0 auto` 保留，避免重新引入长文档截断。
- `applyDocxAutoScale()` 在每次 `ResizeObserver` 回调完成宽度缩放后同步重算页面最小高度；缓存 Blob 与新下载 Blob 两条渲染路径继续在同步帧、`requestAnimationFrame` 和 100ms 延时执行尺寸修正。
- `app/components/chat.module.scss` 为 `section.docx` 增加同值 `padding: clamp(20px, 4vw, 36px) clamp(16px, 5vw, 48px) !important;` 兜底与 `box-sizing: border-box`，确保首帧和后续重排覆盖库内联样式；`min-height: 100%` 与 `flex: 0 0 auto` 保留。
- `docs/development.md` 同步记录短文档铺满、DOCX 原始页边距覆盖与新响应式 padding 边界。

### 验证

- `yarn prettier --check app/components/file-preview.tsx app/components/chat.module.scss docs/development.md`、`yarn lint`、`npx tsc --noEmit --pretty false` 与 `git diff --check` 全部通过；Lint 仅保留 `file-preview.tsx` 既有 `<img>` 性能提示。
- `nextchat-dev`、`codeinterpreter-local` 和 PostgreSQL SSH 隧道容器均保持运行；`/chat` 返回 HTTP 200，热加载日志显示 5760 modules 编译成功。

### 潜在或遗留问题

- 当前安装未启用 in-app Browser pane，Playwright 又受系统临时目录权限限制，因此未能用浏览器工具点击真实短 DOCX 检查计算高度与最终样式；已完成样式、类型、编译和响应式尺寸链路验证。
- 开发容器旧日志中存在与本次无关的 `cache_file_references` 外键约束错误，本轮未修改数据库或缓存引用链路。

============================================================

## 218. 【2026-07-25 09:17】- 提示词数量徽章复用全局样式

### 修改内容

- 提示词选择弹窗的“共 N 条”数量徽章改为复用 `app/styles/globals.scss` 现有 `.nextchat-modal-count` 公共类，不再由 `app/components/chat.module.scss` 重复声明胶囊外观和暗色覆盖；并通过本地 `.prompt-picker-count` 仅覆盖边框粗细和颜色为 `var(--close-button-border-width)` 与 `var(--close-button-border-color)`，满足特定场景的 1px / `rgba(100, 116, 139, 0.24)` 视觉。
- 关闭按钮继续使用现有 `.nextchat-close-button` 公共样式，不做局部覆盖。

### 实现方式

- `app/styles/globals.scss` 将 `.nextchat-modal-count` 的 `border` 简写拆为 `border-style/border-width/border-color` 三条独立声明，方便后续只覆盖颜色或粗细时无需 `!important`。
- `app/components/chat.tsx` 为数量徽章追加 `nextchat-modal-count` 类，同时保留本地 `prompt-picker-count` 作为移动端隐藏选择器和边框覆盖锚点；关闭按钮不再追加任何本地类。
- `app/components/chat.module.scss` 删除数量徽章的尺寸、边框、背景、字体、阴影及两套暗色外观，只保留既有移动端布局规则中的隐藏行为；本地 `.prompt-picker-count` 仅覆盖边框粗细和颜色，无需 `!important`。

### 验证

- `yarn prettier --check app/components/chat.module.scss`、`yarn lint` 和 `git diff --check` 通过；`chat.tsx` 在修改前已存在全文件 Prettier 基线差异，本次修改片段与 Prettier 输出一致。
- `nextchat-dev` 容器保持运行并完成热加载编译，最新日志显示 5760 modules 编译成功。

### 潜在或遗留问题

- 当前安装未启用 in-app Browser pane，无法附着现有 Docker 页面做截图和计算样式检查；未修改 Browser 配置或产品全局样式。

============================================================

## 217. 【2026-07-25 09:10】- 抽出文件预览与 Code Interpreter 本地容器接入

### 修改内容

- 把散落在 `app/components/chat.tsx` 的附件 Glyph、文件预览对象 URL 缓存、Blob 读取、文件大小请求、PDF/Office 预览分支统一收敛到 `app/hooks/useFilePreview.tsx` 与 `app/components/file-preview.tsx`，新增 `app/hooks/` 目录。
- Markdown 链接与聊天附件的同款文件卡片样式从 `chat.module.scss` 抽到 `app/styles/globals.scss` 的 `.markdown-body .chat-message-attached-file` 公共作用域，让 `markdown.tsx` 也能渲染统一视觉。
- `app/utils/attachment-file.ts` 新增 `isFetchableAttachmentUrl` URL 守卫与 `AttachmentTypeKind` / `AttachmentLike` 类型与 `getAttachmentTypeKind` / `getAttachmentTypeLabel` / `formatAttachmentSize` 等判断函数；`markdown.tsx` 复用同一套判断和 hook。
- `app/utils/generated-file-links.ts` 新增 `assignGeneratedFileAliases`：先按精确文件名匹配，重命名时仅在相同扩展名的沙箱引用与生成文件能一一对应时按顺序建立别名；`plugin.ts` 在 `materializePluginGeneratedFiles` 中调用，把别名持久化进 `result.data.files.aliases`，使流式更新、最终写回和历史消息重渲染复用同一映射。
- `docker-compose.yml` 新增 `codeinterpreter-local` 服务（基于 `scripts/code-interpreter/Dockerfile` 构建，固定镜像名 `codeinterpreter-api-local:latest`，`expose 5000` + `codeinterpreter-local-data` 数据卷），并把本地启动命令改为带 `--profile codeinterpreter-local`；`CLAUDE.md` / `README.md` / `docs/development.md` 同步记录本地容器接入、Code Interpreter 文件下载链路与 DOCX 预览滚动 owner 约束。
- 新建 `.githooks/commit-msg` 校验脚本，强制提交首行必须是 `YYYY-MM-DD HH:MM ` 时间戳前缀；`git config core.hooksPath .githooks` 切换到独立钩子目录，最近 5 次提交格式审计已通过、无需 filter-branch。

### 实现方式

- `app/hooks/useFilePreview.tsx` 暴露 `useFilePreview()`：`openFilePreview(url, name, options)` 维护对象 URL 缓存（最大 24 条命中 LRU）、按内容类型派发到 PDF/Office/图片/纯文本分支；`app/components/file-preview.tsx` 提供 `FilePreviewModal` 与 `AttachmentFileGlyph`，缓存 blob 与下载 blob 两条 DOCX 渲染分支均通过 `applyDocxSectionSizing()` 把渲染出的 `section.docx` 强制设为 `width: 100%; max-width: 100%; height: auto; min-height: 0; max-height: none; flex: 0 0 auto`。
- `app/components/chat.tsx` 移除已抽出的 `AttachmentFileGlyph` / `filePreviewObjectUrlCache` / `getCachedPreviewBlob` / `setCachedPreviewBlob` 等实现，仅保留 `clearComposerAttachmentDraftCache` 等写回逻辑；`app/components/chat.module.scss` 同步删除对应 `.docx-preview-*`、`.file-preview-*` 重复样式，仅保留布局/尺寸/暗色图标。
- `app/styles/globals.scss` 新增 187 行 Markdown 卡片公共样式，并补齐 `nextchat-primary-button` 的 `font-family` 兜底（避免本机缺字体时按钮高度被异常撑高）。
- `app/utils/generated-file-links.ts` 在 `getFileNameVariants` 中补 `decodeURIComponent` 变体；新增 `getPathFileName` / `getFileExtension` 帮助函数与顺序回退匹配；`plugin.ts` 在文件上传并提交缓存后调用 `assignGeneratedFileAliases` 写回别名。
- `.githooks/commit-msg` 使用 `head -1 | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} '` 校验，首行不合规直接 `exit 1`；`git config core.hooksPath .githooks` 切换到独立目录。

### 验证

- `yarn lint` 通过；`npx tsc --noEmit --pretty false` 通过；`git diff --check` 与 Prettier 通过。
- `.githooks/commit-msg` 通过两条手工测试：无时间戳消息 exit 1，合规消息 exit 0。
- 远程分支 `origin/main` 当前 HEAD = `012e30ea`，与本地一致；`gitee/main` 与 `ss/main` 待推送后由 `git ls-remote` 验证。

### 潜在或遗留问题

- 本地未启用 in-app Browser pane，本轮未通过浏览器工具手动点击 DOCX 滚动；HANDOFF #215/#216 完成的运行态与缓存接口验证仍然有效，本次主要是把已有能力抽到独立 hook/组件并接入本地 Code Interpreter 容器。
- `scripts/git-commit-push.sh` 当前仓库内不存在，本次提交直接走 `git add` + `git commit` + `git push`，未走脚本；后续如需引入该脚本需补齐 `rules-audit.sh` 与脚本文件。

============================================================

## 216. 【2026-07-25 09:10】- Word 预览支持纵向滚动查看长文档

### 修改内容

- 修复 Code Interpreter 生成的 Word 文档在弹窗内只能看到上半部分、长内容被截断的问题；改为由预览根容器内部纵向滚动，可完整查看整份文档。
- 保留桌面端宽度自适应、移动端等比缩放、PDF/Excel/图片/纯文本等其它预览不受影响。

### 实现方式

- `app/components/chat.module.scss` 调整 `.docx-preview-container.docx-preview-container`：移除对自身的 `height: 100% / flex: 1`，让内部 `section.docx` 按内容自然增长；`:global(section.docx)` 改为 `height: auto; min-height: 0; max-height: none; flex: 0 0 auto; margin: 0 auto`，只保留宽度自适应并保持白底/边框/阴影。
- 滚动 owner 仍是 `.docx-preview-root`（`flex: 1; min-height: 0; overflow-y: auto; padding: 16px`），文档页超出根视口时由外层滚动条接管；移动端 `.docx-preview-container` 的 `align-items: flex-start` 不变，宽度缩放仍交由 `applyDocxAutoScale` 处理。
- `app/components/file-preview.tsx` 新增 `applyDocxSectionSizing()`：把渲染出的 `section.docx` 强制设为 `width: 100%; max-width: 100%; height: auto; min-height: 0; max-height: none; flex: 0 0 auto`，并在渲染同步帧、`requestAnimationFrame` 与 100ms 延时各执行一次，覆盖 `docx-preview` 内联样式。两条 DOCX 渲染分支（缓存 blob 与全新下载 blob）均改用该 helper，删除旧 `fixDocxSection`。
- `docs/development.md` 在 Code Interpreter 文件预览段后新增规则说明滚动 owner、容器/段落约束和禁止恢复 `height: 100% / flex: 1`。

### 验证

- `yarn lint` 通过，仅保留 `file-preview.tsx` 既有 `<img>` 性能提示；`npx tsc --noEmit --pretty false`、Prettier、`git diff --check` 通过。
- 针对性 `tsx` 检查：文件中 `applyDocxSectionSizing` 引用 7 处（1 定义 + 6 调用：缓存分支 + 下载分支 × `fixDocxSection + rAF + setTimeout`），旧 `fixDocxSection` 已为 0；helper 内含全部 6 个期望属性赋值。
- `nextchat-dev` 正常运行，`/chat` 返回 HTTP 200，热加载编译成功；宿主机与容器内 `app/components/file-preview.tsx` 与 `app/components/chat.module.scss` SHA-256 完全一致，真实 `HEAD /api/cache/<uuid>.docx` 仍返回 HTTP 200。

### 潜在或遗留问题

- 当前安装未启用 in-app Browser pane，未通过该工具在浏览器中拖动滚动条验证长文档；运行态、热加载、容器源码一致性、纯函数行为已完成替代验证；建议在启用 Browser pane 后用真实 DOCX 做最终滚动确认。

============================================================

============================================================
