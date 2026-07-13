# HANDOFF

记录最近 10 条关键修改。最新记录置顶，历史从新到旧排列。每条记录标题格式为 `## 序号. 【YYYY-MM-DD HH:MM】- 标题`，序号持续递增，最大 999，达到后从 1 开始。超过 10 条时自动删除底部最旧记录。实质修改完成并验证后更新一次，创建 commit 前核对并一起提交.

============================================================

## 65. 【2026-07-13 15:29】- 修复移动端余额查询批量按钮未撑满容器

### 修改内容

- 修复移动端余额查询页“全部查询”按钮被通用 `IconButton` 窄屏尺寸规则限制、未占满批量操作容器的问题。

### 实现方式

- `app/components/provider-balances.module.scss`：将移动端批量操作容器设为 flex，并让专用按钮以 `flex: 1 1 100%` 拉伸；同时移除容器重复的水平内边距，保留内容区既有的 12px 页面留白。改动仅作用于余额页的移动端。

### 验证

- `yarn lint` 通过，无 ESLint 警告或错误。
- `git diff --check` 通过。
- `nextchat-dev` 已确认挂载当前工作区到 `/app`，样式热加载生效。

### 潜在或遗留问题

- 无。

============================================================

## 64. 【2026-07-13 14:50】- 优化对话备份页搜索框与移动端按钮图标居中

### 修改内容

- 优化对话备份页搜索输入框：聚焦时提示文字淡出消失，字体大小统一为 14px，颜色与侧边栏搜索框风格一致。
- 修复移动端"立即备份"按钮图标未上下左右居中的问题，覆盖通用 IconButton 移动端样式中的 SVG display: block 覆盖。

### 实现方式

- `app/components/chat-backups.module.scss`：为 `.searchBar input` 添加 `font-size: 14px`、提示文字颜色变量和聚焦隐藏效果；为移动端 `.createBackupButton :global([class*="icon-button-icon"])` 覆盖 `display: flex` 和 SVG 居中样式。

### 验证

- `yarn lint` 通过。
- `git diff --check` 通过。

### 潜在或遗留问题

- 无。

============================================================

## 62. 【2026-07-13 13:27】- 修复聊天窗口头部操作图标居中

### 修改内容

- 修复移动端聊天窗口头部的模型、提示词、用户状态、配置、新聊天与导出操作图标未视觉居中的问题。

### 实现方式

- `app/components/chat.module.scss`：在最末窄屏规则内，仅为 `.chat-window-action-button` 的直属图标建立高优先级 16px flex 居中，覆盖通用 `IconButton` 的自动外边距；导出按钮同步移除残留的水平位移。

### 验证

- `yarn lint` 通过，无 ESLint 警告或错误。
- `git diff --check` 通过。
- `nextchat-dev` 已确认将当前工作区挂载到 `/app`，样式热加载生效。

### 潜在或遗留问题

- 无。

============================================================

## 63. 【2026-07-13 14:30】- 修复本地开发环境备份数据库连接配置

### 修改内容

- 修复 `.env.docker` 中 `BACKUP_PGHOST=42.193.15.117` 直接连远程 PostgreSQL 公网 IP 失败的问题。
- 将 `BACKUP_PGHOST` 改为 `postgres-ssh-tunnel`，通过 SSH 隧道连接远程备份数据库。
- 同时将 `PGHOST` 也改为 `postgres-ssh-tunnel`（原值 `42.193.15.117` 同样无法直连）。

### 实现方式

- `.env.docker`：将 `PGHOST` 和 `BACKUP_PGHOST` 从 `42.193.15.117` 改为 `postgres-ssh-tunnel`。
- 远程 PostgreSQL 只监听 `127.0.0.1` 和 Docker 网桥（`172.20.0.1`），不开公网监听，本地开发必须走 SSH 隧道。

### 验证

- Docker 容器重启后确认 `BACKUP_PGHOST=postgres-ssh-tunnel`。
- 容器内直接连接 `nextchat_backup` 数据库成功（10 条 API 配置备份）。
- `GET /api/db/api-config-backups` 返回 10 条备份。
- `GET /api/db/chat-backups` 返回 18 条备份（admin 7 + ccc 6 + dyx 5）。

### 潜在或遗留问题

- 无。

### 修改内容

- 修复移动端聊天窗口头部的模型、提示词、用户状态、配置、新聊天与导出操作图标未视觉居中的问题。

### 实现方式

- `app/components/chat.module.scss`：在最末窄屏规则内，仅为 `.chat-window-action-button` 的直属图标建立高优先级 16px flex 居中，覆盖通用 `IconButton` 的自动外边距；导出按钮同步移除残留的水平位移。

### 验证

- `yarn lint` 通过，无 ESLint 警告或错误。
- `git diff --check` 通过。
- `nextchat-dev` 已确认将当前工作区挂载到 `/app`，样式热加载生效。

### 潜在或遗留问题

- 无。

============================================================

## 61. 【2026-07-13 13:08】- 修复移动端添加图标偏移

### 修改内容

- 修复移动端共用添加图标在按钮内偏向左上角的问题，使其水平、垂直居中。
- 将 API 配置页“新增配置”按钮的加号保持为原生 16px 尺寸，避免被放大后产生视觉上的上下偏移。

### 实现方式

- `app/components/button.module.scss`：移除移动端共享 `IconButton` 对 SVG 顶层 `g` 的 `translate(2px, 2px)` 偏移，保留图标容器的 flex 居中作为唯一定位来源。
- `app/components/api-config.module.scss`：为“新增配置”按钮的图标容器及 SVG 保留原生 `16px` 尺寸，并沿用 flex 居中。

### 验证

- `yarn lint` 通过，无 ESLint 警告或错误。
- `git diff --check` 通过。
- `nextchat-dev` 已确认将当前工作区挂载到 `/app`，样式热加载生效。

### 潜在或遗留问题

- 无。

============================================================

## 60. 【2026-07-13 12:51】- 优化移动端提示词管理、插件与全局头部的一系列 UI 居中与文字显示交互

### 修改内容

- 修复插件编辑弹窗中的重新加载图标在移动端显示不居中的偏移问题。
- 修复提示词选择和提示词管理面板中的主要操作按钮（“管理提示词”、“新增提示词”、“查看并编辑”、“删除”、“取消”、“保存”）在移动端隐藏了文字的问题。
- 修复上述所有在移动端恢复显示的按钮文字字重偏粗的问题，统一将其字重修正为正常（`normal`）显示。
- 隐藏提示词新建/编辑对话框内容输入框下方的快捷键提示与字符数统计信息行（`按 Ctrl/⌘ + Enter 保存，Esc 关闭...`）在移动端的展示。
- 修复提示词选择面板头部在移动端的标题与关闭按钮未垂直居中对齐的问题。
- 修复提示词选择和提示词管理搜索输入框的占位符配色及文字大小，并支持输入光标、占位符、键入文本的水平居中以及聚焦时自动隐藏占位符。
- 引入全局点击窗口头部（`.window-header` 拖拽或空白区域）自动将对应页面的主要滚动容器平滑滚动到顶部的便捷交互。

### 实现方式

- `app/components/plugin.module.scss`：为移动端 `.plugin-schema-load` 下的 `svg > g` 元素重置 `transform` 为 `none !important` 以移除 2px 偏移。
- `app/components/chat.module.scss`：增加移动端下操作按钮 `button.prompt-picker-manage` 的特异性，复写 `button.module.scss` 强加的隐藏和大小限制，并将其文字 `font-weight` 设为 `normal`；将 `.prompt-picker-header` 的 `align-items` 改为 `center` 以垂直居中；并为 `.prompt-picker-search` 的占位符和输入文本设置 `text-align: center` 样式及聚焦时 `opacity: 0`。
- `app/components/prompt-manager.module.scss`：增加移动端下 `button.addPromptButton` 和弹窗底部 `button` 的特异性，复写默认按钮样式并重置字重为 `normal`，重置 `svg > g` 为 `none !important`；同时为 `.searchInput` 设置 `text-align: center`、对称的 `padding-right: 40px` 以实现输入与光标水平居中，并在聚焦时隐藏占位符；并且更新了列表 `.actions` 和弹窗 `.modalActions` 容器下所有 `button` 的字重为 `normal`、显示文字并修正偏移；此外，为 `.textareaMeta` 提供桌面基础样式且在移动端设置为 `display: none !important`。
- `app/components/home.tsx`：引入全局点击捕获钩子 `useWindowHeaderScrollToTop`，排除交互式按钮后寻找当前页面/模态框内 `overflow-y` 为 `auto` / `scroll` 且高度有效的滚动容器，平滑滚动至顶部。

### 验证

- `yarn lint` 通过。
- `npx tsc --noEmit` 编译通过。

### 潜在或遗留问题

- 无。

============================================================

## 59. 【2026-07-13 11:32】- 进一步优化移动端整体对话框居中优先级与 AI 目录忽略

### 修改内容

- 修复移动端模型选择器折叠搜索框高度偏矮、宽度偏窄的问题，并使用高权重规则使整个模型选择器容器在移动端屏幕完美垂直且水平居中。
- 限制搜索框与上方所有操作按钮在移动端高度一致为 `38px`，并防止 iOS Safari 输入框聚焦时页面自动缩放放大。
- 将移动端模型添加面板的底部操作按钮从 3 行缩减/合并为 2 行，并使得自定义模型弹出行按钮能在折行后水平居中。
- 优化移动端已添加模型列表中“删除”按钮的右侧定位（调整为 `right: 20px`），并增设列表项右边距，防止长模型文本与删除按钮发生重叠遮挡。
- 优化已添加模型页面下方的 3 个操作按钮，使其在移动端强制为单行并排显示，且将危险按钮“全部删除”排在最左侧。
- 配置项目 Git 忽略规则，确保 AI 编程的各种局部配置目录及缓存碎片不再被意外加入版本库提交。

### 实现方式

- `app/components/add-model-modal.tsx`：将 `nextchat-modal-count` 元素从第一个 `nextchat-modal-footer-group` 移动到第二个 `nextchat-modal-footer-group` 中；并在 modal footer container 绑定 conditional class `nextchat-modal-footer-show-added`。
- `app/styles/globals.scss`：使用 `body .model-selector-panel.nextchat-selector` 并补充 `justify-content: center` 与 `display: flex` 以 030 权重覆盖父容器，并将子元素 `.nextchat-selector-content` 重置为 `margin: auto !important`，以完全规避各浏览器环境下 flexbox 顶起的问题，达到完美垂直居中。
- `app/styles/globals.scss`：移除了移动端 `.nextchat-modal-footer-group` 的 `flex-wrap`，使第一组按钮在一行显示，第二组按钮与徽章在第二行并排显示。
- `app/styles/globals.scss`：为移动端 `.nextchat-modal-custom-row` 增加了 `justify-content: center` 与 `gap: 8px`，使得添加/取消按钮折行后能水平居中。
- `app/styles/globals.scss`：对移动端 `.model-selector-panel .nextchat-selector-item-action` 重写 `right: 20px !important`。
- `app/styles/globals.scss`：为移动端 `.model-selector-panel .nextchat-selector-list-item` 增加 `padding-right: 80px !important` 避让区，确保长模型名字能自动截断。
- `app/styles/globals.scss`：为移动端 `.nextchat-modal-footer-show-added` 开启 flex row + contents，并给 `.nextchat-danger-button` 设定 `order: -1 !important` 使得它排序到单行最左侧。
- `.gitignore`：追加 `.agents/`、`.cursor/`、`.claude/`、`.gemini/` 以及 `.system_generated/` 忽略条目。

### 验证

- `yarn lint` 检查完成（No ESLint warnings or errors）。
- `nextchat-dev` 样式热加载生效。

### 潜在或遗留问题

- 无。

============================================================

## 58. 【2026-07-13 10:48】- 修复移动端模型搜索框宽度不一致

### 修改内容

- 根据实际 DOM 复核后，移除移动端搜索输入框自身的缩放补偿，使其视觉宽度与上方三个按钮一致。

### 实现方式

- `app/components/ui-lib.module.scss`：仅移除 `.selector-search` 的 `scale(0.875)` 缩放补偿并恢复原有 `width: 100%`。

### 验证

- `yarn lint` 通过，无 ESLint 警告或错误。
- `git diff --check` 通过。
- `nextchat-dev` 已确认以当前工作区 `/Users/dyx/Code/NextChat` 挂载到 `/app`，样式热加载生效。

### 潜在或遗留问题

- 无。

============================================================

## 57. 【2026-07-13 10:05】- 优化有缓存用户的切换交互为即时显示

### 修改内容

- 优化有本地缓存用户在切换过程中的 UI 呈现逻辑：一旦本地缓存（包括会话列表与对话内容）水合装载完成，立即解除界面上的同步遮罩并支持操作，而不用强行等待慢速远端网络同步结束，真正实现“秒级显示”。
- 为延迟完成的会话正文懒加载与删除补齐相同的用户隔离锁，避免切换空窗期错误读取或删除目标用户分片。
- 每个用户首开或切换时展示最近 50 个会话；继续下滑才分页展开更早历史，正文仍保持按需水合。
- 快速连续切换用户时，较早任务会被中止并丢弃结果；远端增量同步后从 IndexedDB 重建索引，保证侧边栏包含新会话。
- 仅在无本地缓存的新用户场景下保持同步遮罩的阻塞等待。
- 云端同步逻辑仍会在后台静默正常进行，并在完成后通过三方变基算法（rebase）安全合并新增对话，保障前台交互流畅及数据合规。

### 实现方式

- `app/store/auth.ts`：在 `switchUser` 判定 `hasCache` 为真并完成 rehydrate 和侧边栏索引 initialize 之后，立即设置 `switchingUser = false` 及发布 `done` 状态。
- `app/store/auth.ts`：后台的 `sync` 同步逻辑照常进行，但在异常捕获 and 最终状态设置时，仅对 `!hasCache` 情况进行弹窗报警和状态更新，防止后台重试时二次污染用户操作态。
- `app/utils/chat-persist-storage.ts`：在读取和删除会话分片入口复用 `lastHydratedUserId` 校验，与既有写入保护形成完整闭环。
- `app/store/chat-index.ts` / `app/store/chat.ts`：为 IndexedDB 索引 and 正文懒加载加入作用域复核，避免旧异步任务在后续切换后写回内存。
- `app/store/auth.ts`：使用切换代次与 `AbortController` 收敛并发请求，移除重复 rehydrate，并在后台同步后强制从 IndexedDB 刷新索引。
- `app/utils/chat-persist-storage.ts`：最近保留会话扩展为 50，并在存储配额达到 80% 时仅告警、不自动清理数据。

### 验证

- `yarn lint` 通过，无 ESLint 警告或错误。
- `npx tsc --noEmit` 编译通过。

### 潜在或遗留问题

- 无。

============================================================

## 56. 【2026-07-13 10:04】- 引入内存隔离锁修复切换用户缓存污染漏洞

### 修改内容

- 引入 `lastHydratedUserId` 内存锁定机制，并在 `setItem` 与 `setPersistedChatSession` 写入时校验当前活跃用户与内存用户是否一致。
- 拒绝在切换用户空窗期（即已更改 Cache Marker 但尚未重置或重水合新用户内存前）写入 any 旧用户数据，彻底阻断跨用户缓存泄漏与混淆漏洞。
- 在 `switchUser` 中引入 `hasPersistedChatCache` 代替 `getItem` 预检，避免过早执行 `getItem` 造成隔离锁泄露，并提升切换性能。

### 实现方式

- `app/utils/chat-persist-storage.ts`：增加 `lastHydratedUserId` 安全校验与动态对齐，并在 setItem/setPersistedChatSession 拦截不一致 of 跨用户写入。
- `app/store/chat.ts`：在 `resetForUserSwitch` 状态重置（set 调用）前，提前调用 `setLastHydratedUserId` 解锁目标用户写入。
- `app/store/auth.ts`：引入并使用 `hasPersistedChatCache` 预检，移除 `getItem` 的提前解锁风险。

### 验证

- `yarn lint` 通过，无 any ESLint 警告与错误。
- `npx tsc --noEmit` 编译通过。

### 潜在或遗留问题

- 无。

============================================================
