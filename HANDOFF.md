# HANDOFF

记录最近 10 条关键修改。最新记录置顶，历史从新到旧排列。每条记录标题格式为 `## 序号. 【YYYY-MM-DD HH:MM】- 标题`，序号持续递增，最大 999，达到后从 1 开始。超过 10 条时自动删除底部最旧记录。实质修改完成并验证后更新一次，创建 commit 前核对并一起提交.

============================================================

## 78. 【2026-07-14 09:59】- 收紧 stash 清理确认并统一修改后自动暂存

### 修改内容

- 将 stash 清理改为强制逐条、逐文件说明：执行 clear、drop 或 pop 前，必须用直白语言说明每个文件修改了什么，并取得用户针对本次具体清单的明确确认。
- 统一每轮修改完成并通过必要验证后执行一次 `git add -A`，同时保留敏感信息、真实 `.env`、临时产物和无关改动的范围检查。

### 实现方式

- 同步更新 `AGENTS.md`、`CLAUDE.md` 和 `GEMINI.md` 的 Git 授权边界；提交或任务完成不再构成 stash 删除预授权，自动暂存也不扩展为 commit、push 或部署授权。
- 全局规则仓库、提交脚本、规则审计、工具入口和长期记忆同步采用相同边界。

### 验证

- 规则仓库执行 `bash -n scripts/git-commit-push.sh`、`bash -n scripts/rules-audit.sh`、`bash scripts/rules-audit.sh` 和 `git diff --check`。
- NextChat 执行规则文本检查与 `git diff --check`；本次不改业务代码，不需要重启或重建开发容器。

### 潜在或遗留问题

- 当前本地仍保留 `stash@{0}: lint-staged automatic backup`，未执行 clear、drop 或 pop。

============================================================

## 77. 【2026-07-14 09:52】- 优化余额查询页移动端整体布局与对齐

### 修改内容

- 修复 `/balances` 移动端操作按钮只显示图标、标签与输入框被挤成窄列、余额文字在标题区逐字换行等问题。
- 将 API Key、User ID 和查询 URL 收敛为固定标签列加自适应输入列，保存、更新和全部查询按钮恢复图标与文字并撑满卡片。
- 按其他独立页面的移动端契约将主/副标题整体居中，关闭按钮固定在右上角；修复绿色操作按钮的文字偏右和刷新 SVG 视觉不居中。

### 实现方式

- `app/components/provider-balances.module.scss` 只在 `max-width: 700px` 断点内调整窗口标题与关闭按钮定位、卡片间距、标题换行、余额不换行、两列字段网格、User ID 独立行、全宽操作按钮和状态 URL 换行，桌面端规则不变。
- 余额页移动端操作按钮将图标容器和 SVG 统一为 `16px`，清除通用手机按钮中的 `margin: auto`，使图标+文字内容组整体水平居中且 SVG 垂直中心与按钮一致。
- `docs/provider-balance.md` 同步移动端布局契约。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 和 `git diff --check` 均通过。
- 浏览器在 `390px` 和 `360px` 手机视口实测：`360px` 下页面 `scrollWidth=360`，无横向溢出；全部查询按钮为 `336 × 44px`，保存/更新按钮为 `310 × 42px`，文字正常显示。
- `360px` 最终对齐数据：页面标题中心偏差 `0px`，关闭按钮右边距 `10px`；“全部查询”和“更新”的内容组水平中心偏差均为 `0px`，SVG 垂直中心偏差均为 `0px`；控制台无 error/warn。
- 本地与 `nextchat-dev` 容器内目标文件 SHA-256 一致。

### 潜在或遗留问题

- 全局壳层对小于 `350px` 的超窄视口仍有 `min-width: 350px` 限制；本次不扩大到其他页面的全局壳层规则。

============================================================

## 76. 【2026-07-14 09:35】- 统一余额查询状态文案与路径分隔符

### 修改内容

- `/balances` 余额查询成功提示中，成功文案与完整路径之间改用中文全角冒号 `：` 分隔。
- 自定义路径和自动路径的查询中提示统一为“正在查询余额...”。
- 自定义路径和自动路径的成功提示统一为“查询成功：完整 URL”。

### 实现方式

- `app/components/provider-balances.tsx` 将查询成功状态文字中原有的中点分隔符替换为中文冒号，并收敛查询中与查询成功的自定义/自动路径文案；URL 构造和查询逻辑保持不变。
- `docs/provider-balance.md` 同步查询中文案契约。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 和 `git diff --check` 均通过。
- `nextchat-dev` 开发容器正常运行，已核对本地与容器内目标文件。

### 潜在或遗留问题

- 无。

============================================================

## 75. 【2026-07-14 09:22】- 将余额查询成功勾替换为加大加粗 SVG

### 修改内容

- `/balances` 余额查询成功状态不再使用文字 `✓`，改为更大、更粗的 SVG 勾。
- 失败红叉、成功绿色和主页/对话页的普通余额样式均保持不变。

### 实现方式

- `app/components/provider-balances.tsx` 使用内联 `16 × 16` viewBox 路径绘制勾，采用 `2` 线宽及圆角线帽/连接，并通过 `currentColor` 继承成功绿色。
- `app/components/provider-balances.module.scss` 将 SVG 显示尺寸固定为 `18px`，与余额文字基线对齐；`docs/provider-balance.md` 同步图标形式。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 和 `git diff --check` 均通过。
- `nextchat-dev` 开发容器正常运行，已核对本地与容器内目标文件。

### 潜在或遗留问题

- 无。

============================================================

## 74. 【2026-07-14 09:15】- 限定余额状态颜色与勾叉仅用于余额查询页

### 修改内容

- `/balances` 余额查询页继续在查询成功时显示绿色余额和绿色勾，查询失败时显示红色余额和红色叉。
- 主页/对话页浮动余额恢复普通默认样式，不再显示查询状态颜色或勾叉图标。

### 实现方式

- `app/components/user-menu.tsx` 移除主页/对话浮层专用的 `idle / success / error` 视觉状态，保留本地缓存首屏读取、数据库校准、后台刷新和失败保留旧值逻辑。
- `app/components/user-menu.module.scss` 删除仅服务于主页状态颜色和勾叉的局部样式；`docs/provider-balance.md` 同步页面展示边界。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 和 `git diff --check` 均通过。
- `nextchat-dev` 开发容器正常运行，已核对本地与容器内目标文件。

### 潜在或遗留问题

- 无。

============================================================

## 73. 【2026-07-14 00:25】- 完整修复余额固定路径、自动探测与成功路径复用

### 修改内容

- 重新审计本地缓存、数据库配置、固定 URL、根地址自动探测、缓存路径直查、New-API-User、供应商专用逻辑、通用候选队列、成功落库和失败旧值保留全链路。
- 修复后半段候选路径不可达、自定义 URL 查询参数丢失、认证方式覆盖不全、固定 URL 成功认证未缓存、晴辰云成功路径写错、空值误判为 0、取消后仍重试和批量 30 秒提前截断等问题。
- 补齐“有路径固定查询、只填根地址自动探测、成功保存三元组并显示完整可编辑 URL”的统一契约。

### 实现方式

- `provider-balance.ts`（服务端）：候选队列改为高频路径全认证覆盖、全部 142 个声明路径可达、剩余组合补齐并去重，单 Key 上限 320；固定路径补齐 Query-Key 与缓存认证优先，解析器严格过滤空值和布尔值。
- `provider-balance.ts`（客户端共享）：统一 URL 是否含路径及完整 URL 拆分逻辑，前端与 API route 使用同一判断。
- `route.ts`：保留自定义 URL 查询参数；根地址改为在指定域名探测；固定、根地址和普通自动模式成功后都保存 `cached_path / cached_base_url / cached_auth_type`。
- `provider-balances.tsx`：根地址探测成功后显示完整成功 URL；移除会截断完整服务端队列的前端 30 秒批量总超时。
- 同步更新 `README.md` 与 `docs/provider-balance.md`。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false`、`git diff --check` 和 5 组共享 URL 构造测试均通过。
- 无数据库写入的模拟上游测试通过：6 组解析边界、固定 URL 查询参数、New-API-User、缓存路径单请求短路、320 次上限、142 条唯一路径、5 种高频认证、晴辰云真实 `/portal/models` 路径和取消停止重试。
- 只读数据库核验 8 个 Profile 均有管理 Key，旧记录中的缺失缓存三元组会在下一次成功查询自动补齐；未执行真实余额 POST。
- 本地与 `nextchat-dev` 容器内 4 个核心文件 SHA-256 完全一致，最近运行日志无匹配错误。

### 潜在或遗留问题

- 无。

============================================================

## 72. 【2026-07-14 00:09】- 恢复余额本地缓存优先与后台数据库校准

### 修改内容

- 余额页和对话页恢复本地余额缓存优先，页面打开时同步显示已有余额，后台再读取数据库并更新缓存与 UI。
- 手动或既有自动余额查询成功后同步写入缓存；数据库返回无余额时清空对应旧快照，数据库失败时继续保留缓存显示。

### 实现方式

- `app/utils/provider-balance.ts` 新增全局 Profile 余额快照缓存，只持久化 Profile ID、名称、Base URL、是否存在管理 Key 和余额，不保存管理 Key、User ID 或完整查询配置。
- `provider-balances.tsx` 以结构化缓存和旧版 `nextchat:provider-balance:shared:<profileId>` 为首屏来源，后台 GET 数据库后以数据库结果为准并回写新缓存；页面首开仍不请求上游余额接口。
- `user-menu.tsx` 先按 Profile ID 或供应商名称显示缓存，再解析数据库标准 ID、读取数据库余额并允许既有刷新信号继续查询。
- `README.md` 与 `docs/provider-balance.md` 同步缓存边界、数据顺序和敏感字段限制。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 与 `git diff --check` 均通过。
- 浏览器建立缓存后重新进入 `/balances`，React 基础挂载后约 131ms 显示 8 条余额；测试未点击查询按钮、未触发上游余额写入。
- 本地与 `nextchat-dev` 容器内 3 个核心文件 SHA-256 完全一致，开发容器正在使用最新代码。

### 潜在或遗留问题

- 无。

============================================================

## 71. 【2026-07-13 23:58】- 增加余额查询成功勾与失败叉状态反馈

### 修改内容

- 余额页查询成功后在绿色余额文字左侧显示绿色勾，查询失败后在红色余额文字左侧显示红色叉；默认数据库余额继续使用蓝色且不显示图标。
- 对话页余额刷新同步使用相同反馈；失败时仍保留数据库旧余额，只把旧值和叉显示为红色。

### 实现方式

- `provider-balances.tsx` 与对应 CSS Module 根据本次查询状态渲染 `✓` / `×`，状态符号继承余额文字颜色，保持文字与图标一致。
- `user-menu.tsx` 增加仅驻留当前页面的 `idle / success / error` 查询状态，对话页首次数据库读取保持默认蓝色，自动刷新完成后再切换成功或失败反馈。
- `docs/provider-balance.md` 同步余额页和对话页的颜色、符号及旧值保留契约。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 与 `git diff --check` 均通过。
- 浏览器确认 `/balances` 首开不自动查询，8 个数据库余额正常显示，默认余额计算颜色为 `rgb(29, 147, 171)`；未擅自触发会写远程数据库的真实余额查询。
- 本地与 `nextchat-dev` 容器内 4 个目标组件和样式文件 SHA-256 完全一致，容器正在使用最新代码。

### 潜在或遗留问题

- 无。

============================================================

## 70. 【2026-07-13 23:53】- 恢复全局 API Profile 同步与模型缓存链路

### 修改内容

- 修复 `/api/db/sync/access-control` PUT 因旧 `ON CONFLICT (user_id, provider_code)` 与全局数据库唯一约束不一致而返回 500。
- 恢复被清除 stash 中遗漏的全局 Profile 读写、模型成功路径缓存与全局缓存 Key 逻辑，并补齐 stash 当时未覆盖的同步元数据查询和 Schema 文档。
- 修复对话页数据库旧余额读取与自动查询互相取消的竞态，固定先读取数据库旧值再启动刷新。

### 实现方式

- `provider-config-repository.ts`：以全局 `provider_code` 完成集合覆盖、upsert、API Key 写入和 Profile 读取，不再依赖 `provider_configs.user_id`。
- `provider-model-fetch.ts`、`provider-model-repository.ts`、`provider-model-sync.ts`：模型成功路径按全局 Profile 读写，对应密钥统一保存到 `sync_secrets.user_id='global'`。
- `sync-store-repository.ts`：access-control 版本时间读取全局供应商与 Key 更新时间；`postgres.ts`、Schema SQL、README 和余额文档同步全局数据契约。
- `user-menu.tsx`：数据库标准 ID 解析并读取旧余额完成后才设置可查询 ID，消除初始读取与自动刷新竞态。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 与 `git diff --check` 均通过。
- 本地热加载后 access-control 自动 PUT 连续成功，服务端不再出现唯一约束或 500；数据库仍保留 8 个全局 Profile、17 条 API Key、8 份余额配置及 8 个全局模型缓存密钥。
- 只读核验数据库唯一约束为 `UNIQUE (provider_code)`，8 个 Profile 均保留模型成功路径、余额、管理 Key 和完整余额 URL。
- 与清除前悬空 stash `d23a207` 对比：恢复其 3 组遗漏的全局化代码，并额外修复同步元数据、Schema 文档和余额读取竞态。

### 潜在或遗留问题

- 浏览器新建标签因本地开发页持续后台请求多次触发导航超时；接口、服务端日志、数据库状态、Lint 和类型检查均已完成验证。未提交、未推送、未部署。

============================================================

## 69. 【2026-07-13 23:26】- 修复余额查询数据库 Profile 数据源分裂

### 修改内容

- 修复余额页“全部更新”和对话页自动刷新对数据库 Profile 返回 `provider_not_found` 的问题。
- 统一余额配置读取、单项查询、批量查询和对话页余额刷新使用数据库中的标准 Profile ID 与查询配置。

### 实现方式

- `app/api/db/provider-balance/route.ts`：GET、PUT、POST 均以全局数据库余额配置校验 Profile；POST 在当前访问态不存在同 ID Profile 时，使用数据库名称、Base URL、管理 Key 和余额配置构造查询 Profile。
- `app/utils/provider-balance.ts`、`app/components/user-menu.tsx`：对话页先精确匹配数据库 Profile ID，旧对话或本地 ID 不一致时按供应商名称解析标准 ID，解析成功后才读取和刷新余额。
- `docs/provider-balance.md`：同步记录数据库标准 ID 解析与服务端全局数据库 Profile 回退逻辑。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 与 `git diff --check` 均通过。
- 本地接口使用 GET 返回的 8 个数据库 Profile 逐项 POST 查询全部成功，无 `provider_not_found`；YutoAPI、AihubMix、CherryIN、DeepSeek、Ocoolai、OpenRouter、ToAPI、晴辰云均返回新余额和完整成功路径。
- 浏览器实测对话页显示数据库中的 YutoAPI 余额 `$84.35`；余额页点击“全部查询”后 8 个供应商均保留有效新余额且无失败状态；`nextchat-dev` 热加载当前工作区代码。

### 潜在或遗留问题

- 未提交、未推送、未部署；等待用户明确指令。

============================================================
