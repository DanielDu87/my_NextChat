-- NextChat 当前库清理脚本
-- 最后更新: 2026-06-11
-- 用途：
--   1. 物理删除所有软删除的对话（is_deleted=true，不保留任何内容）
--   2. 删除当前为空且主流程不用的空表
-- 注意：执行前先备份数据库；本脚本不清理有业务数据的核心表。

BEGIN;

-- 1. 物理删除所有 is_deleted=true 的对话（CASCADE 自动删除关联消息和附件）
DELETE FROM conversations
WHERE is_deleted = true;

-- 2. 删除当前为空、且仅为历史/预留结构的表（与 scripts/drop-unused-db-tables.ts 保持一致）
DROP TABLE IF EXISTS user_app_update_state CASCADE;
DROP TABLE IF EXISTS user_custom_models CASCADE;
DROP TABLE IF EXISTS user_model_cache CASCADE;
DROP TABLE IF EXISTS user_plugins CASCADE;
DROP TABLE IF EXISTS user_masks CASCADE;
DROP TABLE IF EXISTS user_prompts CASCADE;
DROP TABLE IF EXISTS user_sd_tasks CASCADE;

DROP TABLE IF EXISTS message_attachments CASCADE;
DROP TABLE IF EXISTS tags CASCADE;
DROP TABLE IF EXISTS share_links CASCADE;
DROP TABLE IF EXISTS model_aliases CASCADE;

COMMIT;
