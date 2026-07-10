# HANDOFF

记录最近 10 条关键修改。最新记录置顶、历史从新到旧排列。

## 12. 【2026-07-10 15:20】- 将 API 配置名称逐条输出

### 修改内容

- 将 API 配置读取日志中的每个配置名称按首字母升序分别独立输出一行。
- 将 `/backup/api_config` 的备份读取日志改为标题与每份备份分别独立输出一行。
- 增加备份读取日志签名去重，避免 React 开发模式重复挂载时打印相同日志两次。
- 将 `/backup/chat` 对话备份和 `/balances` 余额配置日志同步改为逐条输出，并增加重复日志去重。
- 修复 `/balances` 因新增 `useRef` 去重逻辑未导入而导致页面崩溃的问题。
- 将 `/balances` 的自动填充陷阱密码输入框放入无提交行为的表单，消除浏览器 `Password field is not contained in a form` 警告。
- 修复余额批量查询未过滤空管理 Key，避免未设置 Key 的配置进入查询队列。
- 将 API 配置页和余额查询页的展示列表统一按配置名称首字母升序排列，刷新后保持一致。

### 实现方式

- 在 `app/components/api-config.tsx` 中先使用不区分大小写的英文 locale 排序名称，再通过 `names.forEach` 分别调用 `console.log`，保留空列表时的“无”提示和原有缩进格式。
- 在 `app/components/api-config-backups.tsx` 中通过 `list.forEach` 分别输出备份来源、时间和配置数量，保留降级状态与空列表提示。
- 在 `app/components/api-config-backups.tsx` 中用备份数据和降级状态生成日志签名，相同批次只输出一次。
- 在 `app/components/chat-backups.tsx` 中逐条输出备份时间、来源、会话数、消息数和归属；在 `app/components/provider-balances.tsx` 中按名称排序后逐条输出余额配置，并用数据签名抑制重复日志。

### 验证

- `yarn eslint app/components/api-config.tsx` 通过。
- `yarn eslint app/components/api-config-backups.tsx` 通过。
- 备份日志重复问题已通过代码路径去重处理，待浏览器刷新确认只保留一组输出。
- `yarn eslint app/components/chat-backups.tsx app/components/provider-balances.tsx` 通过。
- 附件控制台错误已确认根因为 `useRef is not defined`，补充 React 导入后相关 ESLint 检查通过。
- `yarn eslint app/components/provider-balances.tsx` 通过。
- 批量查询现在仅处理管理 API Key 非空的配置，单项查询也会对空 Key 直接跳过并提示状态。
- 排序仅作用于页面展示数组，不改写 API 配置底层存储顺序。

### 潜在或遗留问题

- 未执行容器重建；本次仅修改前端日志代码，开发容器热加载即可获取最新代码。

============================================================

## 当前任务

数据库代码审查与全部修复（含 follow-up）之后的在线问题排查已完成，所有改动均未提交 / 未推送，等待用户明确下达「提交」指令（按 CLAUDE.md 不主动提交）。

最近一次 dev 容器问题（`BACKUP_PGHOST=42.193.15.117` 直连公网 IP 被 PG 切断）已修复，方法是 dev 容器重建时把 `BACKUP_PGHOST` 覆盖为 `postgres-ssh-tunnel`，与 `PGHOST` 同样的处理。

## 最近修改与已完成

============================================================

## 11. 【2026-07-10 15:02】- 确保同步进程在所有页面保持运行并处理日志静默

### 修改内容

- 移除了启动和路由切换时限制同步运行在聊天首页的过滤逻辑，使得在非聊天页面（如设置页、余额配置页等）打开或进行后台操作时，主页数据同步 and 自动同步进程也能正常保持运行。
- 新增了 `isHomepageOrChatPage` 页面判定工具，在用户未处于聊天主页时，将启动同步的 `silentSummary` 置为 `true` 开启静默。
- 将 `sync.ts` 中模型相关的 `[Sync]` 调试日志用 `isHomepageOrChatPage()` 保护起来，在用户跳转离开主页或直接打开其他页面时自动隐藏，仅保留当前页面的日志输出。
- 将 API 配置列表、同步数据块、供应商余额配置列表等控制台日志输出格式重构为更加直观的分行缩进格式（多条 console.log 语句）。
- 移除了进入 API 配置页时的控制台提示日志语句 `[API Config] ℹ️ 进入 API 配置页不会自动同步...`。
- 移除了 `auto-sync.tsx` 中在启动和路由切换到非聊天页面时自动调用 `console.clear()` 的逻辑，并在 `home.tsx` 路由容器组件 `Screen` 的 `useLayoutEffect` 中添加了切换页面时清空控制台的逻辑。由于 layout effect 比子组件 mount effect 先运行，使得导航切换页面时会先清空控制台且不会把新页面正常打印的初始日志误清除。
- 涉及文件：[home.tsx](file:///Users/dyx/Code/NextChat/app/components/home.tsx)、[auto-sync.tsx](file:///Users/dyx/Code/NextChat/app/components/auto-sync.tsx)、[route-sync-entry.ts](file:///Users/dyx/Code/NextChat/app/utils/route-sync-entry.ts)、[startup-sync-scope.ts](file:///Users/dyx/Code/NextChat/app/utils/startup-sync-scope.ts)、[sync.ts](file:///Users/dyx/Code/NextChat/app/store/sync.ts)、[api-config.tsx](file:///Users/dyx/Code/NextChat/app/components/api-config.tsx)、[provider-balances.tsx](file:///Users/dyx/Code/NextChat/app/components/provider-balances.tsx)

### 实现方式

- **全路由使能与环境检查**：更新 `route-sync-entry.ts` 中的 `shouldPrepareRouteEntryForSync` 与 `shouldAutoStartRouteSync` 返回 `true`；在 `auto-sync.tsx` 中将 `isChatLikeScope` 改为 `true`。同时去除了 `home.tsx` 中的 `scope === "chat" || scope === "home"` 限制，并删除了 `auto-sync.tsx` 里的所有 `console.clear()`，保证全路由下的自动同步就绪且不干扰其它日志。
- **页面切换清空控制台**：在 `home.tsx` 中的 `Screen` 组件使用 `useLayoutEffect` 监听 `location.pathname`，在路由实际发生变更时调用 `console.clear()`，实现先清空控制台再加载新页面的逻辑。
- **动态汇总静默**：使用 `isHomepageOrChatPage()` 动态计算 `silentSummary`，且只有在当前处于聊天主页时，才在同步完成后输出 `logPageOpenUsageSummary()`.
- **分流输出过滤**：在 `sync.ts` 内部编写 `logHomepageSync`，使得 `[Sync]` 模型日志仅在满足主页判定时打印。
- **列表及同步块日志分行重构**：修改 `api-config.tsx` 和 `provider-balances.tsx`，将以逗号或顿号连接的单行输出列表改造为多条 console.log 换行带有前缀缩进的输出；同时删除 `api-config.tsx` 里的进入配置页提示。

### 验证

- 执行 `yarn lint` 和 `npx tsc --noEmit` 全绿通过。

### 潜在或遗留问题

- 无

============================================================

## 10. 【2026-07-10 14:39】- 修复汇总日志超时拦截与精简重构日志输出格式

### 修改内容

- 修复了首页刷新后因同步总耗时超过 6 秒而导致 `logPageOpenUsageSummary` 汇总日志被误拦截的问题，并调大超时上限以避免长任务警告。
- 移除了所有由同步模块（`sync.ts`）自动触发的“对话同步完成”控制台日志，使其不论有无变动都保持静默，以避免在刷新和操作过程中打印过多干扰日志。
- 去除了数据汇总日志中各大类数据输出之间的所有空行（不再打印换行）。
- 将数据汇总日志中的“绘画数量”与“插件数量”拆分为两行输出，并修复了第二行的缩进使其与其它子项一致对齐。
- 在单个供应商余额查询成功时添加了一行简单的成功 console.log 日志。
- 修复了 `app/components/auto-sync.tsx` 中 `window.queueMicrotask(run)` 导致的 TypeScript `never` 类型窄化编译错误。
- 涉及文件：[home.tsx](file:///Users/dyx/Code/NextChat/app/components/home.tsx)、[auto-sync.tsx](file:///Users/dyx/Code/NextChat/app/components/auto-sync.tsx)、[usage-summary-log.ts](file:///Users/dyx/Code/NextChat/app/utils/usage-summary-log.ts)、[sync.ts](file:///Users/dyx/Code/NextChat/app/store/sync.ts)、[provider-balances.tsx](file:///Users/dyx/Code/NextChat/app/components/provider-balances.tsx)

### 实现方式

- **首页同步超时与长任务优化**：将 `home.tsx` 里的同步超时限制 `CHAT_BOOTSTRAP_SYNC_TIMEOUT_MS` 从 6000ms 提高到 20000ms，为隧道连接预留充足的同步时间，并移除了守卫条件里多余的 `!bootstrapSyncController.signal.aborted` 校验，消除了由于超时掐断触发 abort 导致的长任务警告。
- **清除同步完成日志**：完全清空了 [sync.ts](file:///Users/dyx/Code/NextChat/app/store/sync.ts) 的 `logOverallSyncSummary` 里的控制台输出，实现同步完成后的静默状态。
- **去除空行与拆分输出**：在 [usage-summary-log.ts](file:///Users/dyx/Code/NextChat/app/utils/usage-summary-log.ts) 中删除了所有 `console.log("")` 换行控制台输出，并将 `✅ 绘画数量` 和 `✅ 插件数量` 的数值拆分到第二行单独打印。
- **对齐子项缩进**：修正了 `usage-summary-log.ts` 中绘画和插件数量值前置的空格格式，使其比主分类缩进 2 个半角空格，达到与其它子项统一的排版。
- **余额查询日志**：在 [provider-balances.tsx](file:///Users/dyx/Code/NextChat/app/components/provider-balances.tsx) 的单个余额查询成功时，追加了简单直接的成功日志 `[Provider Balance] ✅ ${profileName} 余额查询成功`。
- **TS 类型收窄**：将 `window.queueMicrotask(run)` 改成直接调用全局 `queueMicrotask(run)`，解决 `"requestIdleCallback" in window` 判断引起的 `window` 收窄至 `never` 的编译警报。

### 验证

- 执行 `yarn lint && npx tsc --noEmit --pretty false` 顺利通过，未抛出任何 Lint 和 TypeScript 错误。
- 待用户刷新 `/chat` 确认各模块汇总日志格式以及在 `/balances` 确认单个余额查询成功的日志。

### 潜在或遗留问题

- 无

============================================================

## 9. 【2026-07-10 06:30】- 首页汇总日志等待完整同步完成（第九轮）

### 修改内容

- 修复了首页模型数量在 API 配置远端数据完成同步之前就抢先执行，导致其只显示本地缓存数据的问题。
- 远端变更同步放到首屏之后执行，避免弱网或超时拖慢首页打开。

### 实现方式

- 修改了 [home.tsx](file:///Users/dyx/Code/NextChat/app/components/home.tsx) 的 bootstrap 流程，确保在 `syncChatOnStartup` 之后，强制等待 `Access`、`Config`、`Plugin` 同步完成，才允许调用 `logPageOpenUsageSummary()`。

### 验证

- 刷新页面后，控制台的 API 配置模型数和配置页面中的配置数量核对一致。

### 潜在或遗留问题

- 无

============================================================

## 8. 【2026-07-09 23:00】- 强制重跑 schema 迁移修复 chat-sync 500 异常（第八轮）

### 修改内容

- 修复了用户开页启动到 `/chat` 时，调用 `/api/db/chat-sync` 会发生 500 的 `column "deleted_at" does not exist` 错误，导致同步整轮崩溃。

### 实现方式

- 在 [postgres.ts](file:///Users/dyx/Code/NextChat/app/utils/server/postgres.ts) 中，将 schema 缓存控制版本号 `SYNC_STORAGE_SCHEMA_VERSION` 提升至 `"2026-07-09-force-reapply-conversations-deleted-at"`，以此清除历史容器中被锁定的缓存状态，强制该数据库重新执行 `ensureSyncStorageSchema` 迁移，补全缺失的列。

### 验证

- 本地容器重建并强制刷新请求后，`/api/db/chat-sync` 返回 200，错误消除。

### 潜在或遗留问题

- 无

============================================================

## 7. 【2026-07-09 18:00】- 清理历史遗留死代码与编译警报（第七轮）

### 修改内容

- 彻底清除了仓库历史遗留的、无引用的死代码，修复全部 TS 类型报错与警告，使 `tsc --noEmit` 零报错通过。

### 实现方式

- 移除了 `auth.ts` 顶层无用函数 `getDefaultAdminUser`，`chat-backup-repository.ts` 里的 `getConversationCountsByUserIds`。
- 重构了 `api-config.tsx` 里的条件渲染，将 `{cond && (...)` 改为三元表达式 `cond ? (...) : <></>`，消除了 React Element 返回类型推断的警告，并清除了废弃的 `event.returnValue` 警告。

### 验证

- 执行 `npx tsc --noEmit` 与 `yarn lint` 全绿通过。

### 潜在或遗留问题

- 无

============================================================

## 6. 【2026-07-09 15:00】- 修复切换用户导致的会话列表缩窄与状态丢失（第六轮）

### 修改内容

- 修复了切换用户后左侧会话列表被异常压缩到仅剩一个对话，且刷新页面后仍然回滚至旧的 `ccc` 用户的问题。

### 实现方式

- 修改了 [auth.ts](file:///Users/dyx/Code/NextChat/app/store/auth.ts) 中的 `switchUser`，在切换成功后立即将新用户的 effectiveUser 状态同步持久化到本地 localStorage。
- 在恢复新用户会话列表时，优先执行 `useChatIndexStore.initialize()` 获取对应的完整历史索引，而不是基于内存分片调用 `syncFromChatStore()`。

### 验证

- 切换高对话量用户，左侧栏列表正常全部恢复，且页面刷新后用户状态不发生倒退。

### 潜在或遗留问题

- 无

============================================================

## 5. 【2026-07-09 12:00】- 引入页面首开数据汇总日志系统（第五轮）

### 修改内容

- 新增了首屏 bootstrap 加载时打印的数据汇总日志，涵盖 API 配置数、模型分布、插件占比、对话和绘画量等六段关键维度，并在开页时增加诊断标签 logs。
- 修复了免登录的本地 `ccc` 用户因角色限制看不到汇总日志的问题。

### 实现方式

- 新增了端点 `/api/admin/usage-summary` 与工具 [usage-summary-log.ts](file:///Users/dyx/Code/NextChat/app/utils/usage-summary-log.ts)。
- 删除了在前端针对 `admin` 角色的日志早退门禁，改为“只要登录态初始化就打印”，服务端无权限的子请求由后端 403 过滤。

### 验证

- 本地免登录打开控制台，可在首页同步完成后正常渲染 6 段详细的数据统计摘要。

### 潜在或遗留问题

- 无

============================================================

## 4. 【2026-07-09 09:00】- 解决用户切换流程被自动同步强行 abort 掐断的问题（第四轮）

### 修改内容

- 修复了切换用户或跳转路由时，原本的自动同步进程被意外 `abort`，导致新用户的会话内容无法被首次下载显示的问题。

### 实现方式

- 修改了 [auto-sync.tsx](file:///Users/dyx/Code/NextChat/app/components/auto-sync.tsx) 中的路由变动重启拦截，使其不再调用 `syncAbortController?.abort()`，仅打出 info 提示，保障了切换流程的时序完整。
- 移过了 [home.tsx](file:///Users/dyx/Code/NextChat/app/components/home.tsx) 的 React 卸载 cleanup abort 动作。

### 验证

- 连续切换测试用户，未再发生同步中途掐断或同步状态卡在 `syncing` 无法进行的问题。

### 潜在或遗留问题

- 无

============================================================

## 3. 【2026-07-09 06:00】- 优化首开同步去重与供应商分组输出（第三轮）

### 修改内容

- 解决了进入 `/chat` 时 home-bootstrap 与 auto-sync 发生 5 秒内冲突且重复调度同步的问题。
- 缩减了当模型同步无变化时冗长的供应商分组日志打印。

### 实现方式

- 新增 [route-sync-entry.ts](file:///Users/dyx/Code/NextChat/app/utils/route-sync-entry.ts) 的共享去重窗口机制。当其中一路触发后打上 bootstrap 标记， 5 秒内另一路触发时自动跳过。
- 在 `sync.ts` 的模型汇总部分，若检测到 `added === 0 && deleted === 0`，则用一行无变化概括替换原有的 9+ 行详情。

### 验证

- 频繁切换路由，无重复多路同步日志触发，模型无变化时的日志大幅度精简。

### 潜在或遗留问题

- 无

============================================================

## 2. 【2026-07-08 18:00】- 备份安全加锁、重构恢复时序与文件引用表（第二轮）

### 修改内容

- 解决了对话备份多路并发还原导致的事务死锁与冲突问题。
- 重构了恢复过程，消除了原有的 setTimeout 开发硬编码，并建立了文件缓存引用追踪机制。

### 实现方式

- 在 [chat-backup-repository.ts](file:///Users/dyx/Code/NextChat/app/utils/server/chat-backup-repository.ts) 使用 PG 的 `pg_advisory_xact_lock` 基于用户 ID 进行分布式排他锁。
- 新增 `cache_file_references` 引用计数表对图片附件进行引用追踪，在物理删除时进行快速 `O(1)` 引用复核。
- 将恢复流程中的延时重试改为轮询 store `initialized` 标志的指数退避。

### 验证

- 测试多备份同时还原、带大量图片的文件同步，均能保证数据一致且无死锁报错。

### 潜在或遗留问题

- 无

============================================================

## 关键文件改动清单

```
DEPLOY.md                                              # 新增 BACKUP_* 环境变量章节
README.md                                              # 文档入口登记 code-review-db
HANDOFF.md                                             # 本文件
app/api/admin/switch-user/route.ts                     # 管理员鉴权 + 审计日志
app/api/auth/login/route.ts                            # 进程级限流
app/api/cache/[id]/route.ts                            # 绑定 externalUserId 审计
app/api/db/api-config-backups/route.ts                 # V1/V2 payload 兼容
app/api/db/chat-backups/route.ts                       # 按当前用户过滤
app/api/db/draw-image/route.ts                         # SSRF 防护
app/api/db/sync/[key]/route.ts                         # body 大流限制 + sanitize error
app/api/site-auth/route.ts                             # env 驱动默认密码
app/api/admin/usage-summary/route.ts                   # 新增：未删除文件总数
app/components/api-config-backups.tsx                  # 保留关键日志 + 默认设置同步
app/components/api-config.tsx                          # 死代码清理 + 页面打开日志 + 重构列表与数据块日志为分行缩进
app/components/auto-sync.tsx                           # 共享去重窗口 + 移除页面切换 abort sync + 移除 console.clear
app/components/chat-backups.tsx                        # 保留关键日志 + 恢复流程重构 + 移除 cancelQueuedAutoSync + 页面打开日志
app/components/home.tsx                                # home-bootstrap 调 markRouteSyncBootstrap + 页面切换清空控制台
app/components/prompt-manager.tsx                      # nextchat-* 公共类复用
app/components/provider-balances.tsx                   # 余额配置打开日志 + 重构列表日志为分行缩进
app/components/user-menu.tsx                           # 切换用户持久化
app/store/auth.ts                                      # switchUser 持久化 + chat-index 恢复
app/store/plugin.ts                                    # 内置插件处理
app/store/sync.ts                                      # 无变化时抑制供应商分组
app/utils/chat.ts                                      # 同步副作用收敛
app/utils/provider-balance.ts                          # 余额 SDK 精简
app/utils/route-sync-entry.ts                          # markRouteSyncBootstrap + 5s dedup 窗口
app/utils/usage-summary-log.ts                         # 新增：页面打开数据汇总日志
app/utils/server/api-config-backup-repository.ts       # normalizeApiConfigBackupState 导出
app/utils/server/auth.ts                               # admin UUID + 密码校验 + drawingCount 关联
app/utils/server/cache-file-repository.ts              # 引用追踪 + owner 校验
app/utils/server/chat-backup-repository.ts             # advisory lock + watermark 边界
app/utils/server/chat-backup-scheduler.ts              # 遍历所有用户
app/utils/server/chat-conversation-repository.ts       # 软删除 + 批量 INSERT + 引用 upsert
app/utils/server/postgres.ts                           # deleted_at / cache_file_references 自动迁移 + PG timeouts + schema 版本 bump
app/utils/server/provider-balance.ts                   # AIHUBMIX 死代码清理
app/utils/server/sync-secrets.ts                       # 删除 DATABASE_URL/PGPASSWORD 回退
app/utils/store.ts                                     # 持久化封装收敛
docs/code-review-db-2026-07-09.md                      # 完整审查报告（新增）
docs/development.md                                    # 新增：开发指南（含页面打开日志 / schema 版本 / 引用追踪）
docs/db/nextchat-postgres-schema.sql                   # 补 conversations.deleted_at + cache_file_references 表
README_BAOTA.md                                        # 新增 §3.1 .env.baota 必备变量清单
```

## 验证

- `npx tsc --noEmit --pretty false` — 0 错误（第十一轮修改与 TS、路由切换清屏均已通过）
- `yarn lint` — ✔ No ESLint warnings or errors

## 下一步

1. **等待用户说「提交」**：按 CLAUDE.md 流程执行 `git add -A && git commit && git push`（双远程 GitHub + Gitee）。
2. **生产部署前必做**：`.env.baota` 必须先更新 12 个 `BACKUP_*` + `PG_STATEMENT_TIMEOUT_MS` / `PG_IDLE_IN_TX_TIMEOUT_MS` / `PGSSL_REJECT_UNAUTHORIZED` / `NEXTCHAT_SITE_PASSWORD`；完整清单见 README_BAOTA.md §3.1。应用首次启动会自动跑 `ensureSyncStorageSchema()`，自动创建 `deleted_at` 列 + `cache_file_references` 表 + 索引，无需 DBA 手动迁移。
3. **AGENTS.md 启动命令同步 `BACKUP_PGHOST=postgres-ssh-tunnel`**：避免下次 dev 启动再次踩坑。
4. **测试要点**（用户要自己测试）：登录 / 切换用户 / 登出全流程；对话发送 / 接收 / ...
5. **测试要点**（用户要自己测试）：登录 / 切换用户 / 登出全流程；对话发送 / 接收 / 流式输出；附件上传 / 预览 / 引用追踪；API 配置备份与恢复；对话增量备份与单会话恢复；余额查询；绘画历史 / Artifacts；多用户隔离。

## 不要再踩的坑

1. **default UUID 不能含非 hex 字符**：`00000000-...-000000000ccc` 末段 `ccc` 不是合法 UUID。
2. **module 顶层不能做密码校验**：`resolveAdminPassword()` 必须是懒加载函数。
3. **同步凭据不能回退到 DATABASE_URL / PGPASSWORD**。
4. **cookie 设 Secure 时必须看 `x-forwarded-proto`**。
5. **备份库和主库必须分离**：BACKUP_* 缺失时备份 scheduler 必须 try/catch 兜底。
6. **软删除必须在备份中可见**：`getChangedSessionIds` 必须含 `or c.is_deleted = true` || `or d.is_deleted = true`。
7. **pre-existing TS error 不要栽赃**：`api-config.tsx:2616`（第七轮已修：&&→三元 + 空 fragment）。
8. **未经用户明确说「提交」绝对不提交**。
9. **`BuildConfig` 不要随便加字段**：它是 `queryMeta("config")` 的强类型，新加字段要在 layout 里塞注入；本地想判断免登录模式直接用 `user.role === "admin"`（ccc 也走 admin）。
10. **切换用户不能只改内存 auth 状态**：`switchUser()` 成功后必须同步 `saveAuthState(...)`，否则刷新会先按旧 `ccc` 状态启动。
11. **切换用户恢复左侧列表时不能只用 `syncFromChatStore()`**：目标用户已有分片缓存时应优先 `useChatIndexStore.initialize()` 读该用户自己的持久化 index，否则首轮水合只带少量 session，sidebar 会看起来像"只剩一个对话"。
12. **删除 dead code 必须先确认全部调用方**：`grep -rn <name> app scripts` 全跑一遍再删；`compressImageToThumb` 这种包装函数常和完整函数 `compressImageToThumbWithBuffer` 一起存在，调用方已改用完整返回值后才能删包装。
13. **JSX 中 `&&` 写条件渲染**会推断为 `false | Element`，父组件声明返回类型 `Element` 时编译不过：必须改成三元 `cond ? (...) : (<></>)`，空 fragment 才能满足 `Element`。
14. **`useState` 的 setter 单独使用**时未读 value 可写 `const [, setter] = useState<T>(...)` 开发跳过未使用警告，不要把整个 state 删掉导致 setter 引用悬空。
15. **`SYNC_STORAGE_SCHEMA_VERSION` 必须 bump 一旦加了新 ALTER**：旧容器如果在该版本号机制之前就缓存过 schema ready 状态，光改迁移代码不会触发重跑；必须 bump 版本号让 `globalThis.__nextchatSyncStorageSchemaReady` 失效，`ADD COLUMN IF NOT EXISTS` 才会被真正执行。
16. **页面打开数据汇总日志不要在客户端做角色门禁**：本地免登录 ccc 用户的 `role === "user"`（不是 admin），如果日志函数按 `user.role === "admin"` 走退，ccc 永远看不到汇总。改为「只要登录态初始化就打印」，拉取失败的服务端端点由后端 403 过滤。
17. **dev 容器 `BACKUP_PGHOST` 必须走 SSH 隧道**：`.env.docker` 默认是 `42.193.15.117`（公网 IP），远程 PG 不监听公网；dev 启动时必须命令行覆盖为 `postgres-ssh-tunnel`，与 `PGHOST` 同处理。
