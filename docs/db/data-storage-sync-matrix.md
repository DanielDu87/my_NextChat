# 数据存储、同步与更新总表

> 本文档以当前仓库代码为准（2026-07-02，运行时同步 schema `2026-06-28-api-config-backup-counts`）。
> 当前实现的云端主存储不是统一的 `sync_artifacts` 表，而是按数据类型拆分到了多个 PostgreSQL 表和 `app_settings` 的 JSONB 列中。

## 1. 当前实现总览

### 1.1 存储分层

| 存储层 | 当前用途 | 备注 |
| --- | --- | --- |
| `IndexedDB` | 前端业务数据本地工作副本 | Zustand 持久化主入口 |
| `localStorage` | 纯本地 UI 偏好和临时态 | 不参与云端同步 |
| PostgreSQL | 云端共享副本、认证、敏感配置、聊天规范化、绘图/文件二进制和配置备份 | 模型目录已下线独立表持久化（仅走 access-control JSONB） |

### 1.2 当前实际 PostgreSQL 表映射

| 数据/功能 | PostgreSQL 表 | 列/结构 | 代码入口 |
| --- | --- | --- | --- |
| 同步用户映射 | `app_users` | `external_id`、`id` | `sync-app-user.ts` |
| 聊天索引状态 | `app_settings` | `chat_settings -> '__chat-index-state__'` | `sync-store-repository.ts` |
| 聊天会话正文主表 | `conversations` + `messages` | 会话与消息规范化存储 | `chat-conversation-repository.ts` |
| 配置主 store | `app_settings` | `extra_settings -> 'app-config'` | `app-settings-repository.ts` |
| 模型缓存 | `app_settings` | `extra_settings -> 'model-cache-store'` | `app-settings-repository.ts` |
| 插件 store | `app_settings` | `plugin_settings -> 'chat-next-web-plugin'` | `app-settings-repository.ts` |
| 同步状态 | `app_settings` | `extra_settings -> 'sync'` | `app-settings-repository.ts` |
| Access store 公开部分 | `app_settings` | `security_settings -> 'access-control'` | `app-settings-repository.ts` |
| API 配置自动/手动备份 | `api_config_backup_settings` + `api_config_backups` | 备份设置、备份快照、checksum、profile_count | `api-config-backup-repository.ts` |
| Mask store | `app_settings` | `extra_settings -> 'mask-store'` | `app-settings-repository.ts` |
| Prompt store | `app_settings` | `extra_settings -> 'prompt-store'` | `app-settings-repository.ts` |
| 更新状态 | `app_settings` | `extra_settings -> 'chat-update'` | `app-settings-repository.ts` |
| 绘图记录 | `user_draw_stores` | `payload_json` | `draw-store-repository.ts` |
| 绘图图片（原图+缩略图） | `user_draw_images` | `data`/`thumb_data` (bytea)，按 `md5(data)` 去重 | `draw-image-repository.ts` |
| 上传/缓存文件 blob | `cache_file_blobs` + `user_cache_files` | 内容 blob 按 `content_type + content_md5` 去重，用户文件记录可过期或 pinned | `cache-file-repository.ts` |
| Access store 结构化 provider 配置 | `provider_configs` | 每个 profile 一行 | `provider-config-repository.ts` |
| Access store 密钥 | `provider_api_keys` | 每类 key 一行 | `provider-config-repository.ts` |
| 额外敏感配置加密存储 | `sync_secrets` | `encrypted_payload` | `sync-secrets.ts` |
| 站点访问口令 | `site_access_settings` | 单行 KV | `site-password.ts` |
| 登录 session | `auth_sessions` | `session_token_hash`、`expires_at`、`last_seen_at` | `auth.ts` |

> **注**：v4 优化（2026-06-11）下线了 `model_catalog / model_sync_runs / model_source_index_snapshots / user_model_refresh_states` 四张表，模型目录不再持久化到 PostgreSQL，模型刷新只更新 `app_settings.security_settings -> 'access-control'` JSONB 中的 `apiProfiles[*].cachedModels` 字段。

### 1.3 `app_settings` 列到 store 的固定映射

| Store Key | 表 | 列 | JSON 子 key |
| --- | --- | --- | --- |
| `app-config` | `app_settings` | `extra_settings` | `app-config` |
| `model-cache-store` | `app_settings` | `extra_settings` | `model-cache-store` |
| `chat-next-web-plugin` | `app_settings` | `plugin_settings` | `chat-next-web-plugin` |
| `sync` | `app_settings` | `extra_settings` | `sync` |
| `access-control` | `app_settings` | `security_settings` | `access-control` |
| `mask-store` | `app_settings` | `extra_settings` | `mask-store` |
| `prompt-store` | `app_settings` | `extra_settings` | `prompt-store` |
| `chat-update` | `app_settings` | `extra_settings` | `chat-update` |
| `draw-list` | `user_draw_stores` | `payload_json` | `draw-list` |
| API 配置备份 | `api_config_backups` | `payload_json` | 由 `/api/db/api-config-backups` 管理，不是 Zustand store |

> **变更说明**：v4 优化后，`app-config` / `model-cache-store` / `sync` 三个 store 不再独占 `model_settings` / `sync_settings` 列（已并入 `extra_settings`）；`app_settings` 现在只有 4 个固定列：`chat_settings / plugin_settings / security_settings / extra_settings`。

### 1.4 不对应 PostgreSQL 表的存储

| 数据 | 存储介质 | 实际落点 |
| --- | --- | --- |
| 本地业务缓存 | `IndexedDB` | `nextchat-local-cache.state-cache` |
| 页面宽度 | `localStorage` | `sidebarWidth` |
| 语言 | `localStorage` | `lang` |
| 横幅关闭状态 | `localStorage` | `bannerDismissed` |
| 输入草稿 | `localStorage` | `unfinished-input-*` |

## 2. 数据分类总表

| 数据类型 | 典型 key / 表 | 本地存储 | 云端存储 | 页面加载策略 | 手动同步策略 | 自动更新来源 |
| --- | --- | --- | --- | --- | --- | --- |
| 对话数据 | `chat-next-web-store` | `IndexedDB` | PostgreSQL `app_settings.chat_settings` + `conversations` + `messages` | 先读本地，再检查云端版本；云端变更且本地无脏数据时下载 | `保存并同步` 上传本地；`从数据库下载` 覆盖本地 | 无外部来源 |
| 插件数据 | `chat-next-web-plugin` | `IndexedDB` | PostgreSQL `app_settings.plugin_settings` | 同上 | 同上 | 无外部来源 |
| API / 平台配置 | `access-control` | `IndexedDB` | PostgreSQL `app_settings.security_settings` + `provider_configs` + `provider_api_keys` + `sync_secrets` | 先读本地，再检查云端版本 | 同上 | 用户手动保存、同步按钮 |
| 模型配置 | `app-config` | `IndexedDB` | PostgreSQL `app_settings.extra_settings` | 先读本地，再检查云端版本 | 同上 | 模型刷新任务会回写 `access-control.apiProfiles[*].cachedModels`；`app-config.models` 上传前会被剥离 |
| 模型缓存 | `model-cache-store` | `IndexedDB` | PostgreSQL `app_settings.extra_settings` | API 配置页优先读本地缓存，不自动刷新模型 | 点击"获取模型数据"或"保存并同步"时更新 | 模型刷新任务、模型获取按钮、服务端刷新脚本 |
| Mask | `mask-store` | `IndexedDB` | PostgreSQL `app_settings.extra_settings` | 同上 | 同上 | 无外部来源 |
| Prompt | `prompt-store` | `IndexedDB` | PostgreSQL `app_settings.extra_settings` | 先读本地，再检查云端版本 | 同上 | 无外部来源 |
| 更新状态 | `chat-update` | `IndexedDB` | PostgreSQL `app_settings.extra_settings` | 先读本地，再检查云端版本 | 同上 | 无外部来源 |
| 绘图记录 | `draw-list` | `IndexedDB` | PostgreSQL `user_draw_stores.payload_json` | 先读本地，再检查云端版本 | 同上 | 无外部来源 |
| 绘图图片 | 图片记录中的 URL/ID | IndexedDB 只保存引用 | PostgreSQL `user_draw_images` | 打开历史或图片时按需读取 | 通过 `/api/db/draw-image` 上传/读取 | 生成图片、历史恢复 |
| 上传文件缓存 | `/api/cache/*` 返回的 file id/url | 本地只保存引用 | PostgreSQL `cache_file_blobs` + `user_cache_files` | 消息渲染或请求时按需 resolve | 由上传/commit 接口写入 | 文件上传、图片/附件处理 |
| API 配置备份 | `api-config-backups` | 无独立本地 store | PostgreSQL `api_config_backups` | API 配置备份页实时读取 | 手动备份、自动备份、恢复前备份 | Access store PUT 自动触发 |
| 同步元信息 | `sync` | `IndexedDB` | PostgreSQL `app_settings.extra_settings` | 本地直接读取 | 随同步动作更新 | `/api/db/sync-meta` |
| 页面宽度 | `sidebarWidth` | `localStorage` | 无 | 只读本地 | 不参与云端同步 | 无 |
| 语言 | `lang` | `localStorage` | 无 | 只读本地 | 不参与云端同步 | 无 |
| 横幅关闭状态 | `bannerDismissed` | `localStorage` | 无 | 只读本地 | 不参与云端同步 | 无 |
| 输入草稿 | `unfinished-input-*` | `localStorage` | 无 | 只读本地 | 不参与云端同步 | 无 |

## 3. 页面加载规则表

| 页面 / 模块 | 先读本地 | 云端检查内容 | 何时下载云端正文 | 是否直接访问供应商 API |
| --- | --- | --- | --- | --- |
| 聊天页 | 是 | `chat-next-web-store` 的 `updatedAt/checksum` | 云端版本不同且本地无冲突时 | 否 |
| API 配置页 | 是 | `app-config`、`access-control`、`model-cache-store` 的 `updatedAt/checksum` | 云端版本不同且本地无冲突时 | 否，只有点击模型获取/刷新时才访问供应商或后端刷新接口 |
| 插件页 | 是 | `chat-next-web-plugin` 的 `updatedAt/checksum` | 云端版本不同且本地无冲突时 | 否 |
| Prompt / Mask 页 | 是 | 对应 store 的 `updatedAt/checksum` | 云端版本不同且本地无冲突时 | 否 |
| 绘图页 | 是 | `draw-list` 的 `updatedAt/checksum` | 云端版本不同且本地无冲突时 | 生成图片时访问对应供应商代理 |

## 4. 手动同步动作表

| 操作 | 本地数据 | 云端数据 | 结果 |
| --- | --- | --- | --- |
| 保存并同步 | 作为源数据 | 被本地覆盖 | 上传完成后刷新本地记录的云端版本信息 |
| 上传到数据库 | 作为源数据 | 被本地覆盖 | 只上传，不下载 |
| 从数据库下载 | 被云端覆盖 | 作为源数据 | 强制用云端快照覆盖本地 |
| 页面自动校验 | 先本地渲染 | 只检查版本 | 仅当版本不同才下载正文 |

## 5. 保存并同步时的合并策略表

| 数据类型 | 典型 key / 表 | 保存并同步策略 | 说明 |
| --- | --- | --- | --- |
| 对话数据 | `chat-next-web-store` | 双向合并 | 按会话和消息去重，避免覆盖历史对话 |
| 插件数据 | `chat-next-web-plugin` | 双向合并 | 按插件 key 合并 |
| API Profiles | `access-control.apiProfiles` | 双向合并 | 按 profile `id` 合并 |
| 模型缓存 | `model-cache-store.profiles` | 双向合并 | 按 profile `id` 合并，`updatedAt` 较新的缓存优先 |
| 模型集合 | `access-control.apiProfiles[*].cachedModels` / `model-cache-store` | 双向合并 | `app-config.models` 不再作为云端持久化字段，上传前会被剥离 |
| 页面主设置 | `app-config` 其他字段 | 本地覆盖云端 | 以当前设备用户显式保存的设置为准 |
| Prompt | `prompt-store` | 双向合并 | 按 key 合并 |
| Mask | `mask-store` | 双向合并 | 按 key / id 合并 |
| 绘图记录 | `draw-list` | 双向合并 | 按记录 id 合并 |
| 更新状态 | `chat-update` | 云端覆盖本地 | 控制面状态不做本地优先 merge |
| API 配置备份 | `api_config_backups` | 服务端追加/恢复 | 不参与通用 store merge；Access store 保存会按设置自动备份 |
| 同步元信息 | `sync` | 云端覆盖本地 | 版本状态由云端与本地校验流程驱动 |
| 页面宽度 / 语言 / 草稿 | `sidebarWidth`、`lang`、`unfinished-input-*` | 不参与云端同步 | 始终只保留本地 |

## 6. 自动刷新/同步说明

- `app/components/auto-sync.tsx` 在每次页面加载时会驱动一次 `syncStore.autoSync()`，先完成"本地优先"展示，再自动同步会话、非模型业务数据和 `model-cache-store`。
- 自动同步不会触发模型刷新，也不会自动同步 `app-config.models`；页面会在拿到 `model-cache-store` 后重建本地模型列表。
- `API 配置页` 页面打开时只展示本地模型缓存，不自动刷新模型；模型刷新只会在点击"获取模型数据"或"保存并同步"时触发。

## 7. 云端版本判断表

| 判断项 | 来源 | 用途 |
| --- | --- | --- |
| `updatedAt` | PostgreSQL 各目标表的 `updated_at` | 判断云端快照是否变更 |
| `checksum` | `md5(payload_json::text)` 或对应 JSONB 子对象 | 判断内容是否真的变化 |
| `sizeBytes` | `pg_column_size(payload_json)` 或对应 JSONB 子对象 | 辅助诊断和日志展示 |
| `validatedAt` | 本地 `sync.database.cacheMeta` | 记录最近一次版本校验时间 |

## 8. 模型更新链路表

| 环节 | 来源 | 写入目标 | 触发方式 |
| --- | --- | --- | --- |
| 供应商实时拉取 | AihubMix / YutoAPI / Ocoolai / 未来新增供应商 | 内存结果 | 后台脚本或受控接口 |
| 归一化模型数据 | 服务端模型拉取器 | `SyncedLLMModel[]` | 拉取后立即处理 |
| Access store 持久化 | 归一化模型结果 | PostgreSQL `app_settings.security_settings -> 'access-control'` 的 `apiProfiles[*].cachedModels` | `refreshConfiguredProviderModels` 编排 |
| 前端模型快照更新 | 归一化模型结果 | PostgreSQL `app_settings.extra_settings -> 'app-config'` | 同上 |
| 前端模型缓存更新 | 归一化模型结果 | PostgreSQL `app_settings.extra_settings -> 'model-cache-store'` | 同上 |
| 页面本地更新 | 云端版本变化 | `IndexedDB` (`app-config` + `model-cache-store`) | 下次页面版本校验时按需下载 |

> **变更说明**：v4 优化（2026-06-11）后，模型数据**不再**写入 `model_catalog` / `model_sync_runs`，全部收敛到 `app_settings` JSONB 中。这降低了 schema 复杂度、避免了冗余索引、加速了模型刷新的事务提交。

## 9. 模型供应商自动更新兼容策略

| 场景 | 是否需要改代码 | 说明 |
| --- | --- | --- |
| 新增一个 OpenAI 兼容供应商 profile | 否 | 只要 `apiProfiles` 中配置了 `baseUrl + apiKey`，且接口兼容 `/models` 或 `/pricing`，自动纳入刷新 |
| 新增一个已知内置供应商 | 通常否 | 若走默认 OpenAI 兼容策略即可直接纳入 |
| 新增一个接口完全不兼容的新供应商 | 是 | 只需要在服务端拉取注册表里补一个 adapter，不需要改同步主流程 |
| 已有供应商接口偶发返回较少模型 | 当前会按本次结果写入 | 下一步建议补"收缩保护"策略，避免误删过多模型 |

## 10. 当前关键实现文件

| 逻辑 | 文件 |
| --- | --- |
| 本地业务持久化 | [indexeddb-state-storage.ts](../../app/utils/indexeddb-state-storage.ts) |
| Zustand 持久化入口 | [store.ts](../../app/utils/store.ts) |
| 云端版本元信息接口 | [route.ts](../../app/api/db/sync-meta/route.ts) |
| 云端 store 快照接口 | [route.ts](../../app/api/db/sync/[key]/route.ts) |
| 聊天增量同步接口 | [route.ts](../../app/api/db/chat-sync/route.ts) |
| 同步元信息状态 | [sync.ts](../../app/store/sync.ts) |
| API 配置页本地优先逻辑 | [api-config.tsx](../../app/components/api-config.tsx) |
| 服务端模型拉取 | [provider-model-fetch.ts](../../app/utils/server/provider-model-fetch.ts) |
| 服务端模型刷新编排 | [provider-model-sync.ts](../../app/utils/server/provider-model-sync.ts) |
| 本地模型缓存 Store | [model-cache.ts](../../app/store/model-cache.ts) |
| 模型刷新接口 | [route.ts](../../app/api/db/models/refresh/route.ts) |
| 同步规则说明 | [local-first-sync-rules.md](local-first-sync-rules.md) |
| PostgreSQL 完整 schema | [nextchat-postgres-schema.sql](nextchat-postgres-schema.sql) |
| 绘图历史存储 | [draw-store-repository.ts](../../app/utils/server/draw-store-repository.ts) |
| 绘图图片存取（原图+缩略图） | [draw-image-repository.ts](../../app/utils/server/draw-image-repository.ts) |
| 迁移优化脚本 | [optimize-2026-06-11.sql](optimize-2026-06-11.sql) |

## 11. 文档与代码差异说明

### 11.1 已下线、当前主流程不再使用的表（v4 优化确认）

| 表名 | 下线原因 | 下线方式 |
| --- | --- | --- |
| `user_model_refresh_states` | 仅被 1 个 API 路由和 1 个脚本使用，下线后改用 `provider-model-sync.ts` 内存结果 | `postgres.ts` 不再 create；repository 文件已删除 |
| `model_catalog` | 已被 `app_settings.security_settings` 替代，重复写模型数据 | 同上 |
| `model_sync_runs` | 缺乏应用层读取路径，仅运营参考，可由日志替代 | 同上 |
| `model_source_index_snapshots` | 唯一读取函数未被主流程使用 | 同上 |

**说明**：上述 4 张表的 DDL 已从 `nextchat-postgres-schema.sql` 移除；如果生产 `information_schema.tables` 仍存在，参见 `optimize-2026-06-11.sql` 中的 `drop table if exists ... cascade`。

### 11.2 索引变更（v4 优化确认）

| 索引 | 变更 | 原因 |
| --- | --- | --- |
| `idx_messages_conversation_seq` | 删除 | 与 `messages.unique (conversation_id, seq)` 完全重复 |
| `idx_provider_configs_user_id` | 删除 | 与 `provider_configs.unique (user_id, provider_code)` 前缀冗余 |
| `idx_provider_api_keys_provider_config_id` | 删除 | 与 `provider_api_keys.unique (provider_config_id, key_name)` 前缀冗余 |
| `idx_conversations_user_updated` | 新增 | 同步主入口 `order by updated_at desc` 所需 |

### 11.3 列变更（v4 优化确认）

| 列 | 变更 | 原因 |
| --- | --- | --- |
| `app_users.last_login_at` | drop column | 已被 `last_chat_at` 替代 |
| `provider_configs.api_path` | add column | `scripts/unify-user-id.ts` 依赖 |
| `provider_configs.api_format` | add column | `scripts/unify-user-id.ts` 依赖 |
| `provider_api_keys.last_verified_at` | add column | `scripts/unify-user-id.ts` 依赖 |
| `messages.reasoning_text` | add column | 新增，主动写入 |
| `messages.tool_calls` | add column | 新增，主动写入 |
| `messages.metadata_json` | add column | 新增，主动写入 |

## 12. 当前建议优化项

### 12.1 高优先级

- 继续把 `extra_settings` 中增长过快的 store 拆出来（mask-store / prompt-store / draw-list 任一单行 > 1MB 时立即拆）。
- 为 `access-control.apiProfiles[*].cachedModels` 增加版本号，避免大型缓存结构写入时阻塞行。
- 增加 `pg_cron` 或外部定时任务清理 `auth_sessions.expires_at <= now()`，避免启动时全表扫描。

### 12.2 中优先级

- 聊天数据已收敛到 `conversations` / `messages` + `app_settings.chat_settings`，后续如需继续优化，可再考虑把索引状态进一步并入更明确的聊天专用设置模型。
- `access-control` 当前已经收敛为结构化 provider 数据写 `provider_configs` / `provider_api_keys` / `sync_secrets`，`app_settings` 只保留非结构化补充配置；后续需要保持这条边界不被重新打破。

### 12.3 低优先级

- `provider_configs` / `provider_api_keys` 可补充更多唯一约束和审计字段，便于排查 profile 变更。
- 给 `app_users.username` 增加长度 CHECK 约束。
