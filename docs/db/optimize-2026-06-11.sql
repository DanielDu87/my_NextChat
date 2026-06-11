-- ============================================================
-- NextChat v4 优化迁移脚本 (2026-06-11)
-- ============================================================
-- 用途:
--   1. 删除 3 个与 unique 约束重复 / 前缀冗余的索引
--   2. 补齐 unify-user-id.ts 依赖的列
--   3. 下线 last_login_at (已由 last_chat_at 替代)
--   4. 兜底删除 4 张已下线模型表
--   5. 兜底删除 11 张历史/预留空表
--   6. 兜底删除 app_settings 中已合并的历史列
--
-- 设计原则:
--   - 全部使用 IF EXISTS / IF NOT EXISTS，可重复运行
--   - 不影响 app_users、app_settings、auth_sessions、provider_configs、provider_api_keys、conversations、messages、sync_secrets、site_access_settings 等核心表的数据
--   - 兜底 DDL 失败时不会被 abort（与 ensureSyncStorageSchema 保持一致）
--   - 不在脚本中执行任何 SELECT/UPDATE/DELETE 业务数据，只做结构变更
--
-- 建议执行顺序:
--   1. 先在只读副本执行所有 SELECT 验证脚本
--   2. 在维护窗口执行本脚本
--   3. 执行后重启 nextchat 服务，让 ensureSyncStorageSchema() 确认 schema 版本同步
-- ============================================================

\set ON_ERROR_STOP on
begin;

-- ============================================================
-- 1) 删除 3 个冗余索引
-- ============================================================

-- 1.1 idx_messages_conversation_seq 与 messages.unique (conversation_id, seq) 完全重复
drop index if exists idx_messages_conversation_seq;

-- 1.2 idx_provider_configs_user_id 与 provider_configs.unique (user_id, provider_code) 前缀冗余
drop index if exists idx_provider_configs_user_id;

-- 1.3 idx_provider_api_keys_provider_config_id 与 provider_api_keys.unique (provider_config_id, key_name) 前缀冗余
drop index if exists idx_provider_api_keys_provider_config_id;

-- ============================================================
-- 2) 补齐 unify-user-id.ts 依赖的列
-- ============================================================

-- 2.1 provider_configs.api_path（scripts/unify-user-id.ts select 依赖）
alter table provider_configs
  add column if not exists api_path text;

-- 2.2 provider_configs.api_format（scripts/unify-user-id.ts select 依赖）
alter table provider_configs
  add column if not exists api_format text;

-- 2.3 provider_api_keys.last_verified_at（scripts/unify-user-id.ts select 依赖）
alter table provider_api_keys
  add column if not exists last_verified_at timestamptz;

-- ============================================================
-- 3) 下线 last_login_at (已由 last_chat_at 替代)
-- ============================================================

-- 3.1 app_users.last_login_at 已被 last_chat_at 替代，移除旧列
alter table app_users
  drop column if exists last_login_at;

-- ============================================================
-- 4) 兜底删除 4 张已下线模型表
-- ============================================================
-- 4 张表已在 v4 优化中从运行时代码和 schema 文档中移除
-- 仅在历史库中可能残留时清理

drop table if exists user_model_refresh_states cascade;
drop table if exists model_catalog cascade;
drop table if exists model_sync_runs cascade;
drop table if exists model_source_index_snapshots cascade;

-- ============================================================
-- 5) 兜底删除 11 张历史/预留空表
-- ============================================================
-- 这些表来自 scripts/db-migrate-v2.sql，是 app_settings 拆表的预留
-- 当前运行时代码从未读写；统一清理

drop table if exists user_app_update_state cascade;
drop table if exists user_custom_models cascade;
drop table if exists user_model_cache cascade;
drop table if exists user_plugins cascade;
drop table if exists user_masks cascade;
drop table if exists user_prompts cascade;
drop table if exists user_sd_tasks cascade;
drop table if exists message_attachments cascade;
drop table if exists tags cascade;
drop table if exists share_links cascade;
drop table if exists model_aliases cascade;

-- ============================================================
-- 6) 兜底删除 app_settings 中已合并的历史列
-- ============================================================
-- ui_settings / model_settings / sync_settings 已在 v4 优化中并入 extra_settings
-- 仅在历史库中可能残留时清理

alter table app_settings drop column if exists ui_settings;
alter table app_settings drop column if exists model_settings;
alter table app_settings drop column if exists sync_settings;

-- ============================================================
-- 7) 软删除空壳会话（可选，建议在维护窗口手工执行）
-- ============================================================
-- 该段仅作为参考，不在本脚本默认执行；避免误删仍在被前端缓存引用的会话
-- 如确认需要执行，请手工 uncomment:
--
-- delete from conversations
-- where is_deleted = true
--   and not exists (
--     select 1 from messages m where m.conversation_id = conversations.id
--   );

commit;

-- ============================================================
-- 执行后验证（只读）
-- ============================================================
-- 1) 验证 3 个索引已删除
--    select indexname from pg_indexes
--    where schemaname='public'
--      and indexname in (
--        'idx_messages_conversation_seq',
--        'idx_provider_configs_user_id',
--        'idx_provider_api_keys_provider_config_id'
--      );
--    期望: 0 行
--
-- 2) 验证 3 个新列已就位
--    select column_name from information_schema.columns
--    where table_schema='public'
--      and table_name in ('provider_configs','provider_api_keys')
--      and column_name in ('api_path','api_format','last_verified_at')
--    order by table_name, column_name;
--    期望: 3 行
--
-- 3) 验证 last_login_at 已 drop
--    select column_name from information_schema.columns
--    where table_schema='public' and table_name='app_users' and column_name='last_login_at';
--    期望: 0 行
--
-- 4) 验证 4 张模型表已 drop
--    select table_name from information_schema.tables
--    where table_schema='public'
--      and table_name in (
--        'user_model_refresh_states','model_catalog','model_sync_runs','model_source_index_snapshots'
--      );
--    期望: 0 行
--
-- 5) 验证 11 张历史/预留表已 drop
--    select table_name from information_schema.tables
--    where table_schema='public'
--      and table_name in (
--        'user_app_update_state','user_custom_models','user_model_cache',
--        'user_plugins','user_masks','user_prompts','user_sd_tasks',
--        'message_attachments','tags','share_links','model_aliases'
--      );
--    期望: 0 行
--
-- 6) 验证 app_settings 历史列已 drop
--    select column_name from information_schema.columns
--    where table_schema='public' and table_name='app_settings'
--      and column_name in ('ui_settings','model_settings','sync_settings');
--    期望: 0 行
--
-- 7) 验证 ensureSyncStorageSchema 输出 schemaVersion 已切到 2026-06-11-sync-storage-v4
--    curl http://127.0.0.1:3000/api/db/health
--    期望: 响应中包含 "schemaVersion": "2026-06-11-sync-storage-v4"
