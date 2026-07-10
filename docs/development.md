# NextChat 开发指南

> 本文档以当前代码为准（最后更新：2026-07-10）。开发过程中如发现内容与代码不一致，以代码为准并同步更新本文档。
>
> 相关文档：[README.md](../README.md)、[AGENTS.md](../AGENTS.md)、[CLAUDE.md](../CLAUDE.md)、[docs/db/data-storage-sync-matrix.md](db/data-storage-sync-matrix.md)、[docs/db/nextchat-postgres-schema.sql](db/nextchat-postgres-schema.sql)。

## 页面打开日志

四个核心页面在浏览器端打开时会立即向 DevTools Console 打印一条 `📋` 摘要日志，便于排查"页面打开后没看到配置/备份/余额"类问题时直接比对。日志都在客户端发起 `fetch` 并拿到响应后打印，不需要登录服务端容器。

### 输出格式

| 页面                 | 日志标签                 | 示例输出                                                                                                                                            |
| -------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api_config`        | `[API Config] 📋`        | `[API Config] 📋 已读取 API 配置（7 个）：AihubMix、Ocoolai、YutoAPI、ToAPI、DeepSeek、晴辰云、OpenRouter`                                          |
| `/backup/api_config` | `[API Config Backup] 📋` | `[API Config Backup] 📋 已读取 API 配置备份（10 条，最新 2026-07-09 23:33:22（auto，7 条配置））`                                                   |
| `/backup/chat`       | `[Chat Backup] 📋`       | `[Chat Backup] 📋 已读取对话备份（3 次，最新 2026-07-09 23:33:23（auto/incremental，122 个会话 / 356 条消息，归属 ccc），全站 8 次 / 181 个会话）`  |
| `/balances`          | `[Provider Balance] 📋`  | `[Provider Balance] 📋 已读取余额配置（7 个：Ocoolai、AihubMix、DeepSeek、OpenRouter、ToAPI、YutoAPI、晴辰云；已存管理 Key 6 个，已查过余额 7 个）` |

### 触发位置

- `/api_config`：`app/components/api-config.tsx` 的 `useEffect` 监听 `accessStore.apiProfiles` 变化；进入页面与配置变更都会重打。
- `/backup/api_config`：`app/components/api-config-backups.tsx` 的 `load()` 拿到 `/api/db/api-config-backups` 响应后。
- `/backup/chat`：`app/components/chat-backups.tsx` 的 `load()` 拿到 `/api/db/chat-backups` 响应后；同时打印全站 summary（`totalBackupCount` / `totalConversationCount`）。
- `/balances`：`app/components/provider-balances.tsx` 的 `load()` 拿到 `/api/db/provider-balance` 响应后；带 profile 名称、已存管理 Key 数和已查询余额数。

### 故障对照表

| 日志内容                                   | 含义                                | 排查方向                                                                               |
| ------------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------- |
| `已读取 API 配置（0 个）`                  | 当前用户没有 apiProfiles            | 检查 `DEFAULT_SYNC_USER_ID`、登录账号；服务端 `/api/db/sync/access-control` 是否被覆盖 |
| `已读取 API 配置备份（0 条，暂无备份）`    | 该用户在 `nextchat_backup` 库无备份 | 检查 `BACKUP_PG*` 环境变量、SSH 隧道；`degraded: true` 表示备份库连接失败              |
| `已读取对话备份（0 次）`                   | 该用户没有对话备份                  | 同上；admin 用户可看 `全站 X 次 / Y 个会话` 字段确认全站情况                           |
| `已读取余额配置（0 个）`                   | 没有 profile 可查                   | 先打开 `/api_config` 确认 `apiProfiles` 不为空；`provider-balance` API 是否可达        |
| 日志中 `降级返回`                          | 备份库临时不可达                    | 检查 `BACKUP_PGHOST/PORT/USER/PASSWORD`、`postgres-ssh-tunnel` 容器健康度              |
| 日志中 `已存管理 Key X 个` 比 profile 数少 | 部分 profile 缺管理 Key             | `/balances` 页面为对应 profile 补填即可，不影响 API 调用                               |

## Schema 版本与迁移

- 主业务库：`app/utils/server/postgres.ts` 的 `SYNC_STORAGE_SCHEMA_VERSION`，当前值 `"2026-07-09-force-reapply-conversations-deleted-at"`。
- 独立备份库：`app/utils/server/backup-postgres.ts` 的 `BACKUP_STORAGE_SCHEMA_VERSION`，当前值 `"2026-07-09-backup-database"`。
- 一旦在 `ensureSyncStorageSchema()` / `ensureBackupStorageSchema()` 内新增 `ALTER TABLE` 或 `CREATE TABLE`，**必须同步 bump** 上述版本号常量。否则旧容器在缓存锁住 `globalThis.__nextchatSyncStorageSchemaReady` / `__nextchatBackupStorageSchemaReady` 时不会重跑迁移，新结构永远不会落库。
- 完整 DDL 与历史变更：`docs/db/nextchat-postgres-schema.sql`。

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
