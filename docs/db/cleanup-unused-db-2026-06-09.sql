-- NextChat 当前库清理脚本
-- 生成时间：2026-06-09 Asia/Shanghai
-- 用途：删除已软删除且无消息的空对话，并删除当前为空且主流程不用的空表。
-- 注意：执行前先备份数据库；本脚本不清理 app_users/app_settings/provider*/sync_secrets 等有业务数据的表。

BEGIN;

-- 1. 删除已软删除且无消息的空壳对话。
DELETE FROM conversations c
WHERE c.is_deleted = true
  AND NOT EXISTS (
    SELECT 1
    FROM messages m
    WHERE m.conversation_id = c.id
  );

-- 2. 删除当前为空、且仅为历史/预留结构的表。
DROP TABLE IF EXISTS user_app_update_state CASCADE;
DROP TABLE IF EXISTS user_custom_models CASCADE;
DROP TABLE IF EXISTS user_model_cache CASCADE;
DROP TABLE IF EXISTS user_plugins CASCADE;
DROP TABLE IF EXISTS user_masks CASCADE;
DROP TABLE IF EXISTS user_prompts CASCADE;
DROP TABLE IF EXISTS user_sd_tasks CASCADE;

-- 3. 删除当前为空、当前主流程未写入或模型目录未启用的预留表。
DROP TABLE IF EXISTS message_attachments CASCADE;
DROP TABLE IF EXISTS tags CASCADE;
DROP TABLE IF EXISTS share_links CASCADE;
DROP TABLE IF EXISTS model_aliases CASCADE;
DROP TABLE IF EXISTS model_catalog CASCADE;
DROP TABLE IF EXISTS model_sync_runs CASCADE;
DROP TABLE IF EXISTS model_source_index_snapshots CASCADE;

COMMIT;
