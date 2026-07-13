# HANDOFF

记录最近 10 条关键修改。最新记录置顶，历史从新到旧排列。每条记录标题格式为 `## 序号. 【YYYY-MM-DD HH:MM】- 标题`，序号持续递增，最大 999，达到后从 1 开始。超过 10 条时自动删除底部最旧记录。实质修改完成并验证后更新一次，创建 commit 前核对并一起提交.

============================================================

## 59. 【2026-07-13 11:28】- 进一步优化移动端整体对话框垂直居中规则优先级

### 修改内容

- 修复移动端模型选择器折叠搜索框高度偏矮、宽度偏窄的问题，并使用高权重规则使整个模型选择器容器在移动端屏幕完美垂直且水平居中。
- 限制搜索框与上方所有操作按钮在移动端高度一致为 `38px`，并防止 iOS Safari 输入框聚焦时页面自动缩放放大。
- 将移动端模型添加面板的底部操作按钮从 3 行缩减/合并为 2 行，并使得自定义模型弹出行按钮能在折行后水平居中。
- 优化移动端已添加模型列表中“删除”按钮的右侧定位（调整为 `right: 20px`），并增设列表项右边距，防止长模型文本与删除按钮发生重叠遮挡。
- 优化已添加模型页面下方的 3 个操作按钮，使其在移动端强制为单行并排显示，且将危险按钮“全部删除”排在最左侧。

### 实现方式

- `app/components/add-model-modal.tsx`：将 `nextchat-modal-count` 元素从第一个 `nextchat-modal-footer-group` 移动到第二个 `nextchat-modal-footer-group` 中；并在 modal footer container 绑定 conditional class `nextchat-modal-footer-show-added`。
- `app/styles/globals.scss`：使用 `body .model-selector-panel.nextchat-selector` 并补充 `justify-content: center` 与 `display: flex` 以 030 权重覆盖父容器，并将子元素 `.nextchat-selector-content` 重置为 `margin: auto !important`，以完全规避各浏览器环境下 flexbox 顶起的问题，达到完美垂直居中。
- `app/styles/globals.scss`：移除了移动端 `.nextchat-modal-footer-group` 的 `flex-wrap`，使第一组按钮在一行显示，第二组按钮与徽章在第二行并排显示。
- `app/styles/globals.scss`：为移动端 `.nextchat-modal-custom-row` 增加了 `justify-content: center` 与 `gap: 8px`，使得添加/取消按钮折行后能水平居中。
- `app/styles/globals.scss`：对移动端 `.model-selector-panel .nextchat-selector-item-action` 重写 `right: 20px !important`。
- `app/styles/globals.scss`：为移动端 `.model-selector-panel .nextchat-selector-list-item` 增加 `padding-right: 80px !important` 避让区，确保长模型名字能自动截断。
- `app/styles/globals.scss`：为移动端 `.nextchat-modal-footer-show-added` 开启 flex row + contents，并给 `.nextchat-danger-button` 设定 `order: -1 !important` 使得它排序到单行最左侧。

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

## 55. 【2026-07-13 10:20】- 隔离分用户对话本地缓存

### 修改内容

- 聊天 IndexedDB 缓存的索引 payload 增加用户归属校验，切换用户优先直接显示该用户已验证的本地缓存。
- 旧版无归属缓存不再被迁移到当前用户，避免历史全局缓存或错误迁移导致跨用户会话混合.
- 启动时先用已缓存的有效用户校正缓存 marker，避免鉴权复核前短暂展示上一个用户的聊天缓存。

### 实现方式

- `app/utils/chat-persist-storage.ts`：缓存格式升级为 v2，索引写入 ownerId，读取时同时校验缓存键与 ownerId；不删除不可信旧缓存，待该用户 download-only 同步后安全重建。
- `app/store/auth.ts`：模块启动时让聊天缓存 marker 与已缓存登录态的 effectiveUser 对齐。
- `docs/development.md`：补充用户隔离、缓存优先展示和旧缓存重建策略。

### 验证

- `yarn lint` 通过，无 ESLint warning 或 error。
- `npx tsc --noEmit --pretty false` 通过。
- `git diff --check` 通过。

### 潜在或遗留问题

- 首次遇到旧版无归属缓存时会跳过本地展示，待该用户同步完成后恢复为可直接展示的新格式缓存。

============================================================

## 54. 【2026-07-13 09:50】- 余额查询失败时清空展示值

### 修改内容

- 余额自动查询失败后，首页悬浮余额显示“无”，不再保留旧数字。
- 后台余额查询失败后，对应供应商余额显示“无”，不再回退到旧值或失败响应中的余额。

### 实现方式

- `app/components/user-menu.tsx`：自动刷新失败时清空当前余额状态。
- `app/components/provider-balances.tsx`：单项或批量查询失败时将该配置余额置空。

### 验证

- `yarn lint` 通过，无 ESLint warning 或 error。
- `git diff --check` 通过。

### 潜在或遗留问题

- 无。

============================================================

## 53. 【2026-07-13 09:40】- 微调供应商菜单视觉

### 修改内容

- 为供应商菜单项图标补充少量左右留白，避免图标紧贴按钮边缘或文字。
- 统一供应商菜单 hover 与已选中状态的边框颜色为主色。

### 实现方式

- `app/styles/globals.scss`：仅对供应商菜单图标外层增加 4px 水平 margin。
- `app/styles/globals.scss`：将模型选择器菜单 hover 边框 token 设为 `var(--primary)`。

### 验证

- `yarn lint` 通过，无 ESLint warning 或 error。
- `git diff --check` 通过。

### 潜在或遗留问题

- 无。

============================================================

## 52. 【2026-07-13 09:39】- 修复供应商图标容器异常撑宽

### 修改内容

- 修复供应商图标右侧出现大块空白的问题；图标容器不再占据文字可用宽度。

### 实现方式

- `app/styles/globals.scss`：移除误作用于所有供应商项 span 的 flex 规则，仅让供应商文字节点参与 flex 伸缩和截断。

### 验证

- `yarn lint` 通过，无 ESLint warning 或 error。
- `git diff --check` 通过。

### 潜在或遗留问题

- 无。

============================================================

## 51. 【2026-07-13 09:38】- 强制清除供应商图标与文字间隙

### 修改内容

- 清除供应商菜单图标与文字之间由共享菜单样式引入的横向 flex gap。

### 实现方式

- `app/styles/globals.scss`：对供应商菜单内的选项使用更具体的选择器和 `gap: 0 !important`，覆盖共享 `.nextchat-menu-option` 的 10px gap。

### 验证

- `yarn lint` 通过，无 ESLint warning 或 error。
- `git diff --check` 通过。

### 潜在或遗留问题

- 无。

============================================================

## 50. 【2026-07-13 09:36】- 收紧供应商项水平内边距

### 修改内容

- 进一步减少供应商菜单项的内部水平空白；移动端仍为勾选图标保留右侧安全空间。

### 实现方式

- `app/styles/globals.scss`：桌面端水平 padding 从 16px 降至 8px，移动端左侧 padding 从 12px 降至 8px。

### 验证

- `yarn lint` 通过，无 ESLint warning 或 error。
- `git diff --check` 通过。

### 潜在或遗留问题

- 无.

============================================================
