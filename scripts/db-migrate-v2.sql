-- ============================================================
-- NextChat 数据库重构迁移脚本 v2
-- 执行时间: 2026-05-15
-- 备份目录: db-backup-20260514-165123
-- ============================================================

BEGIN;

-- ============================================================
-- 第一步：删除空表（无数据，无需迁移）
-- ============================================================

DROP TABLE IF EXISTS message_attachments CASCADE;
DROP TABLE IF EXISTS model_aliases CASCADE;
DROP TABLE IF EXISTS model_catalog CASCADE;
DROP TABLE IF EXISTS model_source_index_snapshots CASCADE;
DROP TABLE IF EXISTS model_sync_runs CASCADE;
DROP TABLE IF EXISTS share_links CASCADE;
DROP TABLE IF EXISTS tags CASCADE;

-- ============================================================
-- 第二步：创建新表
-- ============================================================

-- 用户手动添加的模型（原 app_settings.model_settings['app-config'].customModels）
CREATE TABLE IF NOT EXISTS user_custom_models (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  model_name    text        NOT NULL,
  provider_id   text        NOT NULL DEFAULT '',
  display_name  text,
  is_enabled    boolean     NOT NULL DEFAULT true,
  sort_order    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, model_name, provider_id)
);

-- 模型缓存（原 app_settings.model_settings['model-cache-store']）
CREATE TABLE IF NOT EXISTS user_model_cache (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  profile_id    text        NOT NULL,
  cached_models text,
  model_count   integer     NOT NULL DEFAULT 0,
  last_error    text,
  updated_at    timestamptz NOT NULL DEFAULT NOW(),
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, profile_id)
);

-- 插件配置（原 app_settings.plugin_settings['chat-next-web-plugin']）
CREATE TABLE IF NOT EXISTS user_plugins (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  plugin_id     text        NOT NULL,
  plugin_name   text,
  plugin_url    text,
  auth_type     text,
  auth_header   text,
  auth_token    text,
  is_enabled    boolean     NOT NULL DEFAULT true,
  config_json   jsonb       NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, plugin_id)
);

-- 面具（原 app_settings.extra_settings['mask-store']）
CREATE TABLE IF NOT EXISTS user_masks (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  mask_id       text        NOT NULL,
  mask_name     text,
  avatar        text,
  lang          text        NOT NULL DEFAULT 'cn',
  is_builtin    boolean     NOT NULL DEFAULT false,
  context_json  jsonb       NOT NULL DEFAULT '[]',
  model_config  jsonb       NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, mask_id)
);

-- 提示词（原 app_settings.extra_settings['prompt-store']）
CREATE TABLE IF NOT EXISTS user_prompts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  prompt_id     text        NOT NULL,
  prompt_title  text,
  prompt_content text,
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, prompt_id)
);

-- 绘图任务（原 app_settings.extra_settings['sd-list']）
CREATE TABLE IF NOT EXISTS user_sd_tasks (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  task_id       integer     NOT NULL,
  model_name    text,
  status        text        NOT NULL DEFAULT 'done',
  params_json   jsonb       NOT NULL DEFAULT '{}',
  result_json   jsonb       NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, task_id)
);

-- 应用更新状态（原 app_settings.extra_settings['chat-update']）
CREATE TABLE IF NOT EXISTS user_app_update_state (
  user_id           uuid        PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  last_update_time  bigint      NOT NULL DEFAULT 0,
  dismissed_version text,
  state_json        jsonb       NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 第三步：迁移 app_settings 数据到新表
-- ============================================================

-- 3.1 迁移 model-cache-store
INSERT INTO user_model_cache (user_id, profile_id, cached_models, model_count, last_error, updated_at)
SELECT
  u.id AS user_id,
  profile_key AS profile_id,
  profile_val->>'cachedModels' AS cached_models,
  COALESCE((profile_val->>'modelCount')::integer, 0) AS model_count,
  profile_val->>'lastError' AS last_error,
  COALESCE(
    to_timestamp((profile_val->>'updatedAt')::bigint / 1000),
    NOW()
  ) AS updated_at
FROM app_settings s
JOIN app_users u ON u.id = s.user_id,
LATERAL jsonb_each(
  COALESCE(s.model_settings->'model-cache-store'->'state'->'profiles', '{}')
) AS kv(profile_key, profile_val)
WHERE s.model_settings ? 'model-cache-store'
ON CONFLICT (user_id, profile_id) DO UPDATE SET
  cached_models = EXCLUDED.cached_models,
  model_count   = EXCLUDED.model_count,
  last_error    = EXCLUDED.last_error,
  updated_at    = EXCLUDED.updated_at;

-- 3.2 迁移 plugin-store
INSERT INTO user_plugins (user_id, plugin_id, plugin_name, plugin_url, is_enabled, config_json)
SELECT
  u.id AS user_id,
  plugin_val->>'id' AS plugin_id,
  COALESCE(plugin_val->>'name', plugin_val->>'title') AS plugin_name,
  plugin_val->>'schema' AS plugin_url,
  true AS is_enabled,
  plugin_val AS config_json
FROM app_settings s
JOIN app_users u ON u.id = s.user_id,
LATERAL jsonb_each(
  COALESCE(s.plugin_settings->'chat-next-web-plugin'->'state'->'plugins', '{}')
) AS kv(plugin_key, plugin_val)
WHERE s.plugin_settings ? 'chat-next-web-plugin'
  AND plugin_val->>'id' IS NOT NULL
ON CONFLICT (user_id, plugin_id) DO NOTHING;

-- 3.3 迁移 mask-store
INSERT INTO user_masks (user_id, mask_id, mask_name, avatar, lang, is_builtin, context_json, model_config)
SELECT
  u.id AS user_id,
  mask_val->>'id' AS mask_id,
  mask_val->>'name' AS mask_name,
  mask_val->>'avatar' AS avatar,
  COALESCE(mask_val->>'lang', 'cn') AS lang,
  COALESCE((mask_val->>'builtin')::boolean, false) AS is_builtin,
  COALESCE(mask_val->'context', '[]') AS context_json,
  COALESCE(mask_val->'modelConfig', '{}') AS model_config
FROM app_settings s
JOIN app_users u ON u.id = s.user_id,
LATERAL jsonb_each(
  COALESCE(s.extra_settings->'mask-store'->'state'->'masks', '{}')
) AS kv(mask_key, mask_val)
WHERE s.extra_settings ? 'mask-store'
ON CONFLICT (user_id, mask_id) DO NOTHING;

-- 3.4 迁移 prompt-store
INSERT INTO user_prompts (user_id, prompt_id, prompt_title, prompt_content)
SELECT
  u.id AS user_id,
  prompt_val->>'id' AS prompt_id,
  prompt_val->>'title' AS prompt_title,
  prompt_val->>'content' AS prompt_content
FROM app_settings s
JOIN app_users u ON u.id = s.user_id,
LATERAL jsonb_each(
  COALESCE(s.extra_settings->'prompt-store'->'state'->'prompts', '{}')
) AS kv(prompt_key, prompt_val)
WHERE s.extra_settings ? 'prompt-store'
ON CONFLICT (user_id, prompt_id) DO NOTHING;

-- 3.5 迁移 sd-list
INSERT INTO user_sd_tasks (user_id, task_id, model_name, status, params_json, result_json)
SELECT
  u.id AS user_id,
  COALESCE((item->>'id')::integer, 0) AS task_id,
  item->>'currentModel' AS model_name,
  COALESCE(item->>'status', 'done') AS status,
  COALESCE(item->'params', '{}') AS params_json,
  item AS result_json
FROM app_settings s
JOIN app_users u ON u.id = s.user_id,
LATERAL jsonb_array_elements(
  COALESCE(s.extra_settings->'sd-list'->'state'->'draw', '[]')
) AS item
WHERE s.extra_settings ? 'sd-list'
  AND jsonb_array_length(COALESCE(s.extra_settings->'sd-list'->'state'->'draw', '[]')) > 0
ON CONFLICT (user_id, task_id) DO NOTHING;

-- 3.6 迁移 chat-update
INSERT INTO user_app_update_state (user_id, last_update_time, state_json)
SELECT
  u.id AS user_id,
  COALESCE((s.extra_settings->'chat-update'->'state'->>'lastUpdateTime')::bigint, 0) AS last_update_time,
  COALESCE(s.extra_settings->'chat-update'->'state', '{}') AS state_json
FROM app_settings s
JOIN app_users u ON u.id = s.user_id
WHERE s.extra_settings ? 'chat-update'
ON CONFLICT (user_id) DO UPDATE SET
  last_update_time = EXCLUDED.last_update_time,
  state_json       = EXCLUDED.state_json,
  updated_at       = NOW();

-- ============================================================
-- 第四步：优化 conversations 表
-- ============================================================

-- 添加 sort_order 列（替代 metadata_json._syncIndexOrder）
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS memory_prompt text,
  ADD COLUMN IF NOT EXISTS last_summarize_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stat_json jsonb NOT NULL DEFAULT '{}';

-- 从 metadata_json 迁移字段到独立列
UPDATE conversations SET
  sort_order            = COALESCE((metadata_json->>'_syncIndexOrder')::integer, 0),
  memory_prompt         = metadata_json->>'memoryPrompt',
  last_summarize_index  = COALESCE((metadata_json->>'lastSummarizeIndex')::integer, 0),
  stat_json             = COALESCE(metadata_json->'stat', '{}')
WHERE metadata_json IS NOT NULL AND metadata_json != '{}';

-- ============================================================
-- 第五步：清理 app_settings 表（保留 security_settings 和 sync_settings）
-- 只保留 access-control（API密钥公开部分）和 sync（同步状态）
-- ============================================================

UPDATE app_settings SET
  chat_settings   = '{}',
  model_settings  = '{}',
  plugin_settings = '{}',
  extra_settings  = '{}';

-- ============================================================
-- 第六步：创建索引
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_user_custom_models_user_id ON user_custom_models(user_id);
CREATE INDEX IF NOT EXISTS idx_user_model_cache_user_id ON user_model_cache(user_id);
CREATE INDEX IF NOT EXISTS idx_user_plugins_user_id ON user_plugins(user_id);
CREATE INDEX IF NOT EXISTS idx_user_masks_user_id ON user_masks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_prompts_user_id ON user_prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sd_tasks_user_id ON user_sd_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id_sort ON conversations(user_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_conversations_external_session_id ON conversations(external_session_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

COMMIT;
