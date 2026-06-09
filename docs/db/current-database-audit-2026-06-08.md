# NextChat 当前数据库审计报告

审计时间：2026-06-08 23:46:47 Asia/Shanghai

连接来源：当前运行中的 `nextchat-dev` 容器环境变量。

实际数据库：PostgreSQL `42.193.15.117:5432/nextchat`，连接用户 `dyx`。密码、token、API Key、站点密码哈希、消息正文均已脱敏或只统计长度。

本次只执行只读查询；没有删除、更新或迁移任何数据。

## 1. 总览

当前 `public` schema 共 25 张表。

| 表 | 行数 | 主要数据 | 当前代码使用位置 | 冗余判断 |
| --- | ---: | --- | --- | --- |
| `app_users` | 4 | 应用用户、登录账号、同步用户映射 | `app/utils/server/sync-app-user.ts:9`、`app/utils/server/auth.ts:176` | 核心表，不多余 |
| `app_settings` | 4 | 各用户前端 store 快照：聊天索引、插件、访问配置、面具/提示词/绘图等 | `app/utils/server/app-settings-repository.ts:60`、`app/utils/server/sync-store-repository.ts:314` | 核心表，不多余 |
| `auth_sessions` | 84 | 登录 session token 哈希、过期时间、最后访问时间 | `app/utils/server/auth.ts:224`、`app/utils/server/auth.ts:328`、`app/utils/server/auth.ts:439` | 当前认证正在使用，不多余；但 84 条均为 admin 活跃 session，数量偏多 |
| `conversations` | 171 | 归一化聊天会话元数据 | `app/utils/server/chat-conversation-repository.ts:134`、`app/utils/server/sync-store-repository.ts:483` | 核心表；其中 160 条为空且 `is_deleted=true`，是强清理候选 |
| `messages` | 73 | 归一化聊天消息内容 JSON 和文本索引 | `app/utils/server/chat-conversation-repository.ts:190`、`app/utils/server/chat-conversation-repository.ts:350` | 核心表，不多余 |
| `provider_configs` | 10 | 模型供应商配置、base URL、启用状态、请求配置 | `app/utils/server/provider-config-repository.ts:290`、`app/utils/server/provider-config-repository.ts:407` | 核心表；`single-user` 下有历史/重复配置 |
| `provider_api_keys` | 39 | provider API key 的密文、掩码、分组 | `app/utils/server/provider-config-repository.ts:333`、`app/utils/server/provider-config-repository.ts:347` | 核心表；`single-user` 下重复 key 较多 |
| `site_access_settings` | 1 | 站点访问密码哈希 | `app/utils/server/site-password.ts:58`、`app/utils/server/site-password.ts:102` | 正在使用，不多余 |
| `sync_secrets` | 2 | 同步用敏感 payload 密文，当前是 `access-control` 类 secret | `app/utils/server/sync-secrets.ts:111`、`app/utils/server/sync-secrets.ts:124` | 正在使用；`single-user` 一条疑似历史遗留 |
| `user_model_refresh_states` | 2 | 模型刷新状态快照 | `app/utils/server/model-refresh-state-repository.ts:6`、`app/utils/server/model-refresh-state-repository.ts:22` | 正在使用；`single-user` 一条历史状态可评估清理 |
| `user_provider_balance_snapshots` | 12 | provider 余额查询结果缓存 | `app/utils/server/provider-balance-repository.ts:6`、`app/utils/server/provider-balance-repository.ts:23` | 正在使用；部分 4 月旧 profile 快照疑似过期 |
| `message_attachments` | 0 | 设计中的消息附件表 | `app/utils/server/postgres.ts:358` 仅建表 | 空表；当前无写入路径，可视为功能预留 |
| `tags` | 0 | 设计中的会话标签表 | `app/utils/server/postgres.ts:373` 仅建表；`scripts/unify-user-id.ts` 只迁移 | 空表；当前主流程未使用 |
| `share_links` | 0 | 设计中的分享链接表 | `app/utils/server/postgres.ts:384` 仅建表；`scripts/unify-user-id.ts` 只迁移 | 空表；当前主流程未使用 |
| `model_catalog` | 0 | 模型目录规范化缓存 | `app/utils/server/model-catalog-repository.ts:35`、`app/api/db/health/route.ts:13` | 空表但有刷新/健康检查代码；如果不用模型刷新可清理，否则保留 |
| `model_aliases` | 0 | 模型别名 | `app/utils/server/postgres.ts:429` 仅建表 | 空表；当前无写入代码 |
| `model_sync_runs` | 0 | 模型刷新任务运行记录 | `app/utils/server/provider-model-sync.ts:224`、`scripts/sync-models-to-postgres.ts:118` | 空表但有刷新代码；不用模型刷新可清理 |
| `model_source_index_snapshots` | 0 | 模型来源索引快照 | `app/utils/server/model-source-index-repository.ts:9` | 空表但有写入代码；不用模型刷新可清理 |
| `user_custom_models` | 0 | v2 迁移计划拆出的用户自定义模型表 | `scripts/db-migrate-v2.sql:26` | 空表；当前运行时代码未读写 |
| `user_model_cache` | 0 | v2 迁移计划拆出的模型缓存表 | `scripts/db-migrate-v2.sql:40` | 空表；当前运行时代码未读写 |
| `user_plugins` | 0 | v2 迁移计划拆出的插件表 | `scripts/db-migrate-v2.sql:53` | 空表；当前运行时代码未读写 |
| `user_masks` | 0 | v2 迁移计划拆出的面具表 | `scripts/db-migrate-v2.sql:70` | 空表；当前运行时代码未读写 |
| `user_prompts` | 0 | v2 迁移计划拆出的提示词表 | `scripts/db-migrate-v2.sql:86` | 空表；当前运行时代码未读写 |
| `user_sd_tasks` | 0 | v2 迁移计划拆出的绘图任务表 | `scripts/db-migrate-v2.sql:98` | 空表；当前运行时代码未读写 |
| `user_app_update_state` | 0 | v2 迁移计划拆出的应用更新状态表 | `scripts/db-migrate-v2.sql:112` | 空表；当前运行时代码未读写 |

## 2. 实际字段清单

以下是当前数据库真实字段，不是文档推断。

| 表 | 字段 |
| --- | --- |
| `app_settings` | `user_id uuid PK/FK`, `chat_settings jsonb`, `plugin_settings jsonb`, `security_settings jsonb`, `extra_settings jsonb`, `created_at timestamptz`, `updated_at timestamptz` |
| `app_users` | `id uuid PK`, `external_id text UNIQUE`, `display_name text`, `locale text`, `timezone text`, `is_active boolean`, `created_at timestamptz`, `updated_at timestamptz`, `username text`, `password_hash text`, `role text`, `last_login_at timestamptz` |
| `auth_sessions` | `id uuid PK`, `user_id uuid FK`, `session_token_hash text UNIQUE`, `expires_at timestamptz`, `last_seen_at timestamptz`, `created_at timestamptz`, `updated_at timestamptz` |
| `conversations` | `id uuid PK`, `user_id uuid FK`, `external_session_id text`, `provider_config_id uuid FK`, `title text`, `model_name text`, `provider_name text`, `conversation_type text`, `is_archived boolean`, `is_pinned boolean`, `is_deleted boolean`, `metadata_json jsonb`, `created_at timestamptz`, `updated_at timestamptz`, `sort_order integer`, `last_summarize_index integer` |
| `messages` | `id uuid PK`, `conversation_id uuid FK`, `external_message_id text`, `seq integer`, `role text`, `status text`, `content_text text`, `content_json jsonb`, `created_at timestamptz`, `updated_at timestamptz`, `reasoning_text text`, `tool_calls jsonb`, `metadata_json jsonb` |
| `message_attachments` | `id uuid PK`, `message_id uuid FK`, `attachment_type text`, `file_name text`, `mime_type text`, `storage_kind text`, `storage_url text`, `file_size_bytes bigint`, `sha256 text`, `metadata_json jsonb`, `created_at timestamptz` |
| `provider_configs` | `id uuid PK`, `user_id uuid FK`, `provider_code text`, `provider_name text`, `provider_type text`, `base_url text`, `is_enabled boolean`, `is_default boolean`, `request_config jsonb`, `raw_payload jsonb`, `created_at timestamptz`, `updated_at timestamptz` |
| `provider_api_keys` | `id uuid PK`, `provider_config_id uuid FK`, `key_name text`, `key_scope text`, `api_key_group text`, `encrypted_secret text`, `masked_secret text`, `metadata_json jsonb`, `is_enabled boolean`, `expires_at timestamptz`, `created_at timestamptz`, `updated_at timestamptz` |
| `site_access_settings` | `setting_key text PK`, `password_hash text`, `created_at timestamptz`, `updated_at timestamptz` |
| `sync_secrets` | `id uuid PK`, `user_id text`, `secret_key text`, `encrypted_payload text`, `created_at timestamptz`, `updated_at timestamptz` |
| `user_model_refresh_states` | `user_id text PK`, `refresh_key text PK`, `payload_json jsonb`, `created_at timestamptz`, `updated_at timestamptz` |
| `user_provider_balance_snapshots` | `user_id text PK`, `balance_key text PK`, `payload_json jsonb`, `created_at timestamptz`, `updated_at timestamptz` |
| `tags` | `id uuid PK`, `user_id uuid FK`, `name text`, `color text`, `created_at timestamptz`, `updated_at timestamptz` |
| `share_links` | `id uuid PK`, `conversation_id uuid FK`, `created_by uuid FK`, `share_token text UNIQUE`, `permission text`, `expires_at timestamptz`, `metadata_json jsonb`, `created_at timestamptz`, `updated_at timestamptz` |
| `model_catalog` | `id uuid PK`, `provider_id text`, `provider_name text`, `source_file text`, `model_name text`, `display_name text`, `vendor_name text`, `vendor_icon text`, `model_type text`, `category text`, `category_source smallint`, `types jsonb`, `categories jsonb`, `features jsonb`, `capabilities jsonb`, `published_at_int integer`, `published_at_source text`, `published_at_url text`, `published_at_note text`, `is_available boolean`, `sort_order integer`, `api_key_group text`, `raw_payload jsonb`, `first_seen_at timestamptz`, `last_seen_at timestamptz`, `created_at timestamptz`, `updated_at timestamptz` |
| `model_aliases` | `id uuid PK`, `model_id uuid FK`, `alias_name text`, `alias_kind text`, `source text`, `created_at timestamptz` |
| `model_sync_runs` | `id uuid PK`, `trigger_source text`, `provider_id text`, `status text`, `summary_json jsonb`, `error_message text`, `started_at timestamptz`, `finished_at timestamptz`, `created_at timestamptz` |
| `model_source_index_snapshots` | `source_key text PK`, `payload_json jsonb`, `created_at timestamptz`, `updated_at timestamptz` |
| `user_custom_models` | `id uuid PK`, `user_id uuid FK`, `model_name text`, `provider_id text`, `display_name text`, `is_enabled boolean`, `sort_order integer`, `created_at timestamptz`, `updated_at timestamptz` |
| `user_model_cache` | `id uuid PK`, `user_id uuid FK`, `profile_id text`, `cached_models text`, `model_count integer`, `last_error text`, `updated_at timestamptz`, `created_at timestamptz` |
| `user_plugins` | `id uuid PK`, `user_id uuid FK`, `plugin_id text`, `plugin_name text`, `plugin_url text`, `auth_type text`, `auth_header text`, `auth_token text`, `is_enabled boolean`, `config_json jsonb`, `created_at timestamptz`, `updated_at timestamptz` |
| `user_masks` | `id uuid PK`, `user_id uuid FK`, `mask_id text`, `mask_name text`, `avatar text`, `lang text`, `is_builtin boolean`, `context_json jsonb`, `model_config jsonb`, `created_at timestamptz`, `updated_at timestamptz` |
| `user_prompts` | `id uuid PK`, `user_id uuid FK`, `prompt_id text`, `prompt_title text`, `prompt_content text`, `created_at timestamptz`, `updated_at timestamptz` |
| `user_sd_tasks` | `id uuid PK`, `user_id uuid FK`, `task_id integer`, `model_name text`, `status text`, `params_json jsonb`, `result_json jsonb`, `created_at timestamptz`, `updated_at timestamptz` |
| `user_app_update_state` | `user_id uuid PK/FK`, `last_update_time bigint`, `dismissed_version text`, `state_json jsonb`, `created_at timestamptz`, `updated_at timestamptz` |

## 3. 实际 schema 与文档 schema 差异

`docs/db/nextchat-postgres-schema.sql` 是更完整的目标 schema，但当前真实库不是完全一致：

- `app_settings` 当前只有 `user_id/chat_settings/plugin_settings/security_settings/extra_settings/created_at/updated_at`，没有文档中的 `ui_settings/model_settings/sync_settings`。
- `app_users` 当前多了认证字段：`username/password_hash/role/last_login_at`，来自 `app/utils/server/auth.ts:306` 到 `app/utils/server/auth.ts:320`。
- `provider_configs` 当前没有文档里的 `api_path/api_format`。
- `auth_sessions` 当前使用 `session_token_hash`，没有文档里的明文 `session_token/refresh_token/ip/user_agent`。
- `conversations` 当前有 `sort_order/last_summarize_index`，但没有文档里的 `summary/system_prompt/deleted_at`；`scripts/db-migrate-v2.sql` 里曾计划添加 `memory_prompt/stat_json`，当前库里也不存在。
- `messages` 当前没有 `model_name/provider_name/token_usage`，但有 `reasoning_text/tool_calls/metadata_json`。
- 文档里的 `auth_accounts/usage_logs/audit_logs/model_sync_cache/model_unmatched` 当前库不存在。

结论：当前库是“运行时代码最小 schema + 部分 v2 迁移残留表”，不是完整文档 schema。

## 4. 用户与数据分布

| 用户 external_id | 角色 | 登录账号 | settings | session | active session | conversations | messages | provider configs | provider keys | 说明 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `user:admin` | admin | `admin` | 1 | 84 | 84 | 144 | 68 | 4 | 11 | 当前 `.env.docker` 默认同步用户，主数据集中在这里 |
| `single-user` | user | 无 | 1 | 0 | 0 | 0 | 0 | 6 | 28 | 历史同步 ID，保留 provider、密文、余额和刷新状态 |
| `user:dyx` | user | `dyx` | 1 | 0 | 0 | 1 | 3 | 0 | 0 | 有少量聊天数据 |
| `user:ccc` | user | `ccc` | 1 | 0 | 0 | 26 | 2 | 0 | 0 | 有大量空删除对话 |

`.env.docker` 和当前容器的 `DEFAULT_SYNC_USER_ID/NEXT_PUBLIC_DEFAULT_SYNC_USER_ID` 都是 `user:admin`。因此 `single-user` 很可能是旧部署或本地 `.env.local` 时代遗留，但删除前要确认没有其他运行环境仍用 `single-user`。

## 5. app_settings 数据

当前 4 个用户各 1 行：

| 用户 | chat_settings | plugin_settings | security_settings | extra_settings |
| --- | --- | --- | --- | --- |
| `user:admin` | `__chat-index-state__`，约 40KB | `chat-next-web-plugin`，约 6.8KB | `access-control`，约 1.9KB | `sd-list/app-config/mask-store/chat-update/prompt-store`，约 3.6KB |
| `user:ccc` | `__chat-index-state__`，约 6.3KB | 同上 | 同上 | 同上 |
| `user:dyx` | `__chat-index-state__`，约 0.9KB | 同上 | 同上 | 同上 |
| `single-user` | 空 `{}` | 同上 | `access-control`，约 1.1KB | 同上 |

当前代码仍主要把插件、访问配置、面具、提示词、绘图等放在 `app_settings` JSONB 里。`scripts/db-migrate-v2.sql` 计划把这些拆到 `user_*` 表，但真实库里的 `user_*` 表全空，说明拆表迁移没有成为当前运行主路径。

## 6. provider 配置与密钥

`provider_configs` 共有 10 行：

| 用户 | provider_code | provider_name | enabled | key 数 | 说明 |
| --- | --- | --- | --- | ---: | --- |
| `user:admin` | `default_aihubmix_profile` | AihubMix | false | 3 | 默认配置 |
| `user:admin` | `default_ocool_profile` | Ocoolai | false | 1 | 默认配置 |
| `user:admin` | `default_toapis_profile` | ToAPIs | false | 1 | 默认配置 |
| `user:admin` | `default_yuto_profile` | YutoAPI | true | 6 | 当前启用 |
| `single-user` | `default_aihubmix_profile` | AihubMix | false | 3 | 历史配置 |
| `single-user` | `default_ocool_profile` | Ocoolai | false | 6 | 历史配置 |
| `single-user` | `default_toapis_profile` | ToAPIs | false | 1 | 历史配置 |
| `single-user` | `default_yuto_profile` | YutoAPI | true | 6 | 历史配置 |
| `single-user` | `profile_1780380100468_tr221d` | Custom 14:01:40 | false | 6 | 疑似临时/复制配置 |
| `single-user` | `profile_1780380107592_gu4hl6` | Custom 14:01:47 | false | 6 | 疑似临时/复制配置 |

`provider_api_keys` 共有 39 行。所有密钥都有 `encrypted_secret`，报告中只保留 `masked_secret`。`single-user` 下 28 行，`user:admin` 下 11 行。`single-user` 的两个 `profile_178038...` 各复制了 `default/group:*` 6 组 key，是最明显的重复数据候选。

## 7. 会话与消息数据

`conversations` 共有 171 行：

| 状态 | 数量 |
| --- | ---: |
| 总对话 | 171 |
| 未删除且有消息 | 11 |
| 空对话 | 160 |
| 空且 `is_deleted=true` | 160 |
| 删除但仍有消息 | 0 |

按用户分布：

| 用户 | 总对话 | 空对话 | 有消息 | 删除 |
| --- | ---: | ---: | ---: | ---: |
| `user:admin` | 144 | 135 | 9 | 135 |
| `user:ccc` | 26 | 25 | 1 | 25 |
| `user:dyx` | 1 | 0 | 1 | 0 |

空删除对话的来源可以从代码解释：`app/utils/server/sync-store-repository.ts:480` 到 `app/utils/server/sync-store-repository.ts:492` 会把“不在当前索引中且没有消息”的会话软删除；`app/utils/server/chat-conversation-repository.ts:288` 到 `app/utils/server/chat-conversation-repository.ts:307` 删除指定会话时也会清掉消息。当前没有看到自动物理删除空壳对话的逻辑。

`messages` 共有 73 行：

| role | status | 数量 | 空 content_text | 文本总长度 |
| --- | --- | ---: | ---: | ---: |
| assistant | done | 36 | 0 | 33601 |
| user | done | 37 | 4 | 1325 |

4 条 user 消息 `content_text` 为空，但 `content_json` 可能仍含结构化内容；不建议仅凭 `content_text=''` 删除。

## 8. 认证与站点访问

`auth_sessions` 共有 84 行，全部属于 `user:admin`，全部尚未过期：

- 第一条创建：2026-05-17 00:48:14 +08
- 最新创建：2026-06-08 23:28:39 +08
- 最近访问：2026-06-08 23:31:13 +08
- 最晚过期：2026-07-08 23:28:39 +08

认证代码会在初始化时删除过期 session：`app/utils/server/auth.ts:351` 到 `app/utils/server/auth.ts:354`。因此当前没有过期垃圾 session。84 条活跃 session 可能只是多浏览器/多次登录残留，如果想强制重新登录，可以按确认后的策略清理旧 session。

`site_access_settings` 1 行：`setting_key='site-password'`，保存站点访问密码哈希。该表由 `app/utils/server/site-password.ts:58` 创建并在 `app/utils/server/site-password.ts:102` 读取，正在使用，不能视为多余。

## 9. 模型与余额快照

`user_model_refresh_states` 2 行：

| user_id | refresh_key | model_count | finishedAt | 判断 |
| --- | --- | ---: | --- | --- |
| `user:admin` | latest | 2644 | 2026-05-12 | 当前用户状态，可保留 |
| `single-user` | latest | 2576 | 2026-04-08 | 历史同步 ID，若不用可清 |

`user_provider_balance_snapshots` 12 行：

- `user:admin` 10 行，包含 4 个默认 provider 当前/近期快照，以及 4 月份的 `profile_177...` 历史 profile/local 快照。
- `single-user` 2 行，更新时间为 2026-05-29。
- 旧 `profile_177...` 和 `single-user` 快照属于可清理候选；默认 provider 的近期快照可保留。

`model_catalog/model_sync_runs/model_source_index_snapshots/model_aliases` 当前均为空。模型刷新相关代码仍存在，所以如果你后续会跑 `/api/db/models/refresh` 或 `db:sync-models`，应保留 `model_catalog/model_sync_runs/model_source_index_snapshots`；如果确认不用模型目录持久化，这些空表可以删除。

## 10. 空表与多余表判断

强候选空表，当前运行时代码未读写：

- `user_custom_models`
- `user_model_cache`
- `user_plugins`
- `user_masks`
- `user_prompts`
- `user_sd_tasks`
- `user_app_update_state`

这些表来自 `scripts/db-migrate-v2.sql`，用于把 `app_settings` 的 JSONB 拆表，但当前代码仍从 `app_settings` 读写，真实表也全空。

功能预留空表，当前主流程未写入：

- `message_attachments`
- `tags`
- `share_links`
- `model_aliases`

模型刷新预留空表：

- `model_catalog`
- `model_sync_runs`
- `model_source_index_snapshots`

注意：`scripts/drop-unused-db-tables.ts:3` 把 `auth_sessions` 也列为 `UNUSED_TABLES`，但当前认证代码明确读写 `auth_sessions`。这说明该脚本已经与当前代码状态不一致，不能直接执行。

## 11. 建议清理顺序

不要直接执行删除，先备份并确认。

1. 优先清理 `conversations` 中 160 条 `is_deleted=true` 且无消息的空壳会话。
   这些行不会出现在当前聊天索引中，且没有消息；属于最明确的冗余数据。

2. 确认是否彻底废弃 `single-user`。
   如果生产和本地都统一使用 `user:admin`，可考虑清理 `single-user` 对应的 `app_settings/provider_configs/provider_api_keys/sync_secrets/user_model_refresh_states/user_provider_balance_snapshots`。但 `.env.local` 仍写着 `single-user`，删除前要确认没有进程使用这套配置。

3. 清理 `single-user` 下两个 `profile_178038...` provider 配置。
   这两条 disabled，且 key 组大量复制，疑似临时测试数据。

4. 清理旧余额快照。
   `user:admin` 下 `profile_177...` 和 `local:*` 的 4 月快照，以及 `single-user` 的 5 月快照，如果 UI 不再展示这些 profile，可删除。

5. 空表分批处理。
   如果目标是保持 schema 简洁，可以删除 v2 拆表空表；如果短期还会继续做拆表迁移，则保留。

## 12. 不建议清理的表

- `app_users`
- `app_settings`
- `auth_sessions`
- `provider_configs`
- `provider_api_keys`
- `conversations`
- `messages`
- `site_access_settings`
- `sync_secrets`
- `user_model_refresh_states`
- `user_provider_balance_snapshots`

这些表都有当前代码读写路径或当前有效数据。即使其中有局部历史数据，也不应按整表删除。
