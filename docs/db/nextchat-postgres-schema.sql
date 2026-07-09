-- NextChat PostgreSQL schema
-- 与运行时 ensureSyncStorageSchema() + ensureBackupStorageSchema() + ensureAuthSchemaAndSeed() + ensureSitePasswordConfigured() 保持一致
-- 最后更新: 2026-07-09 (同步 schema 2026-07-09-backup-database：备份表改名并迁入独立备份数据库)
-- 历史变更: 2026-07-09 backup-database（备份表改为 backup_* 命名，由 BACKUP_DATABASE_URL / BACKUP_PG* 指向独立数据库）
-- 历史变更: 2026-07-06 chat-backups（新增按用户区分的对话增量备份）
-- 历史变更: 2026-07-06 deployment-metadata（新增成功部署版本记录）
-- 历史变更: 2026-07-04 补供应商余额表 provider_balance_configs
-- 历史变更: 2026-06-28 api-config-backup-counts（补文件缓存和 API 配置备份表）
-- 历史变更: 2026-06-22 draw-thumb-v1（user_draw_images.thumb_data + md5 唯一索引）
-- 历史变更: 2026-06-11 v4 优化（下线 4 张模型表 + 删除 3 个冗余索引 + 补 api_path/api_format/last_verified_at）

BEGIN;

CREATE OR REPLACE FUNCTION generate_uuid_v4()
RETURNS uuid AS $$
DECLARE
  raw text;
BEGIN
  raw := md5(random()::text || clock_timestamp()::text || txid_current()::text);
  RETURN (
    substr(raw, 1, 8) || '-' ||
    substr(raw, 9, 4) || '-' ||
    '4' || substr(raw, 14, 3) || '-' ||
    substr('89ab', (floor(random() * 4) + 1)::integer, 1) || substr(raw, 18, 3) || '-' ||
    substr(raw, 21, 12)
  )::uuid;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 核心业务表
-- ============================================================

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  external_id text UNIQUE,
  username text,
  password_hash text,
  display_name text,
  role text NOT NULL DEFAULT 'user',
  locale text DEFAULT 'zh-CN',
  timezone text DEFAULT 'Asia/Shanghai',
  is_active boolean NOT NULL DEFAULT true,
  last_chat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username_unique
ON app_users(lower(username))
WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  session_token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS app_settings (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  chat_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  plugin_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  security_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  extra_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_draw_stores (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_draw_images (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  data bytea NOT NULL,
  thumb_data bytea,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- 按用户 + 创建时间倒序检索绘画图片
CREATE INDEX IF NOT EXISTS idx_user_draw_images_user_created_at
ON user_draw_images(user_id, created_at DESC);

-- 按 (user_id, content_type, md5(data)) 去重，防止重复上传同一张原图
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_draw_images_user_content_data
ON user_draw_images(user_id, content_type, md5(data));

CREATE TABLE IF NOT EXISTS cache_file_blobs (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  content_type text NOT NULL,
  content_md5 text NOT NULL,
  size_bytes integer NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (content_type, content_md5)
);

CREATE INDEX IF NOT EXISTS idx_cache_file_blobs_content_md5
ON cache_file_blobs(content_type, content_md5);

CREATE TABLE IF NOT EXISTS user_cache_files (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_ext text NOT NULL DEFAULT '',
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  data bytea,
  blob_id uuid REFERENCES cache_file_blobs(id) ON DELETE RESTRICT,
  content_md5 text,
  is_pinned boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL DEFAULT (NOW() + interval '3 days'),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_cache_files_user_created_at
ON user_cache_files(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_cache_files_user_expires_at
ON user_cache_files(user_id, expires_at)
WHERE is_pinned = false;

CREATE INDEX IF NOT EXISTS idx_user_cache_files_blob_id
ON user_cache_files(blob_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_cache_files_user_content_data
ON user_cache_files(user_id, content_type, md5(data))
WHERE blob_id IS NULL AND data IS NOT NULL;

CREATE TABLE IF NOT EXISTS site_access_settings (
  setting_key text PRIMARY KEY,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deployment_metadata (
  commit_hash text PRIMARY KEY,
  commit_date bigint NOT NULL,
  git_branch text NOT NULL,
  image_name text NOT NULL,
  deployed_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provider_configs (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  provider_code text NOT NULL,
  provider_name text NOT NULL,
  provider_type text NOT NULL,
  base_url text,
  api_path text,
  api_format text,
  is_enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  request_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider_code)
);

-- 已删除 idx_provider_configs_user_id（与上面 unique(user_id, provider_code) 前缀冗余）
-- 由复合 unique 索引前缀自动满足 where user_id = $1 查询

CREATE TABLE IF NOT EXISTS provider_api_keys (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  provider_config_id uuid NOT NULL REFERENCES provider_configs(id) ON DELETE CASCADE,
  key_name text NOT NULL,
  key_scope text,
  api_key_group text,
  encrypted_secret text,
  masked_secret text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_enabled boolean NOT NULL DEFAULT true,
  last_verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (provider_config_id, key_name)
);

-- 已删除 idx_provider_api_keys_provider_config_id（与上面 unique(provider_config_id, key_name) 前缀冗余）

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  external_session_id text,
  provider_config_id uuid REFERENCES provider_configs(id) ON DELETE SET NULL,
  title text,
  model_name text,
  provider_name text,
  conversation_type text NOT NULL DEFAULT 'chat',
  is_archived boolean NOT NULL DEFAULT false,
  is_pinned boolean NOT NULL DEFAULT false,
  is_deleted boolean NOT NULL DEFAULT false,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_user_external_session_id
ON conversations(user_id, external_session_id)
WHERE external_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  external_message_id text,
  seq integer NOT NULL,
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  status text NOT NULL DEFAULT 'done',
  content_text text,
  content_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  reasoning_text text,
  tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, seq)
);

-- 已删除 idx_messages_conversation_seq（与上面 unique(conversation_id, seq) 完全重复）
-- unique 约束自带等价的 B-tree 索引，升序/降序差异在 PG 11+ 双向扫描都支持

-- ============================================================
-- 同步与加密
-- ============================================================

CREATE TABLE IF NOT EXISTS sync_secrets (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  user_id text NOT NULL,
  secret_key text NOT NULL,
  encrypted_payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, secret_key)
);

CREATE INDEX IF NOT EXISTS idx_sync_secrets_user_updated
ON sync_secrets(user_id, updated_at DESC);

-- ============================================================
-- 备份数据库：以下 backup_* 表由 ensureBackupStorageSchema() 在 BACKUP_DATABASE_URL / BACKUP_PG* 指向的独立数据库中创建
-- ============================================================

CREATE TABLE IF NOT EXISTS backup_api_config_settings (
  user_id uuid PRIMARY KEY,
  external_user_id text,
  enabled boolean NOT NULL DEFAULT true,
  interval_minutes integer NOT NULL DEFAULT 1440 CHECK (interval_minutes >= 1),
  max_backups integer NOT NULL DEFAULT 10 CHECK (max_backups >= 1),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS backup_api_config_snapshots (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  user_id uuid NOT NULL,
  external_user_id text,
  source text NOT NULL CHECK (source IN ('auto', 'manual', 'pre_restore')),
  payload_json jsonb NOT NULL,
  checksum text NOT NULL,
  profile_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_api_config_snapshots_user_created
ON backup_api_config_snapshots(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS backup_chat_settings (
  user_id uuid PRIMARY KEY,
  external_user_id text,
  enabled boolean NOT NULL DEFAULT true,
  interval_minutes integer NOT NULL DEFAULT 1440 CHECK (interval_minutes >= 1),
  max_backups integer NOT NULL DEFAULT 30 CHECK (max_backups >= 1),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS backup_chat_runs (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  user_id uuid NOT NULL,
  external_user_id text,
  source text NOT NULL CHECK (source IN ('manual', 'auto')),
  mode text NOT NULL DEFAULT 'incremental' CHECK (mode IN ('full', 'incremental')),
  from_watermark timestamptz,
  to_watermark timestamptz NOT NULL DEFAULT NOW(),
  session_count integer NOT NULL DEFAULT 0,
  message_count integer NOT NULL DEFAULT 0,
  checksum text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_chat_runs_user_created
ON backup_chat_runs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS backup_chat_conversation_snapshots (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  backup_id uuid NOT NULL REFERENCES backup_chat_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  external_user_id text,
  external_session_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  message_count integer NOT NULL DEFAULT 0,
  session_payload jsonb NOT NULL,
  checksum text NOT NULL,
  updated_at_snapshot timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (backup_id, external_session_id)
);

CREATE INDEX IF NOT EXISTS idx_backup_chat_snapshots_backup
ON backup_chat_conversation_snapshots(backup_id, external_session_id);

CREATE INDEX IF NOT EXISTS idx_backup_chat_snapshots_user_session
ON backup_chat_conversation_snapshots(user_id, external_session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_balance_configs (
  provider_config_id uuid PRIMARY KEY REFERENCES provider_configs(id) ON DELETE CASCADE,
  encrypted_management_key text,
  masked_management_key text,
  balance_snapshot jsonb,
  last_error text,
  queried_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 触发器：自动更新 updated_at
-- ============================================================

CREATE OR REPLACE TRIGGER trg_app_users_updated_at
BEFORE UPDATE ON app_users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_auth_sessions_updated_at
BEFORE UPDATE ON auth_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_app_settings_updated_at
BEFORE UPDATE ON app_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_user_draw_stores_updated_at
BEFORE UPDATE ON user_draw_stores
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_provider_configs_updated_at
BEFORE UPDATE ON provider_configs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_provider_api_keys_updated_at
BEFORE UPDATE ON provider_api_keys
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_conversations_updated_at
BEFORE UPDATE ON conversations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_messages_updated_at
BEFORE UPDATE ON messages
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_sync_secrets_updated_at
BEFORE UPDATE ON sync_secrets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_backup_api_config_settings_updated_at
BEFORE UPDATE ON backup_api_config_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_backup_chat_settings_updated_at
BEFORE UPDATE ON backup_chat_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_provider_balance_configs_updated_at
BEFORE UPDATE ON provider_balance_configs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 表注释
-- ============================================================

COMMENT ON TABLE app_users IS '用户主表';
COMMENT ON TABLE auth_sessions IS '登录会话（token 哈希存储）';
COMMENT ON TABLE app_settings IS '用户全局设置（JSONB key-value store）';
COMMENT ON TABLE site_access_settings IS '站点访问密码';
COMMENT ON TABLE deployment_metadata IS '部署成功后记录的实际线上 Git 版本';
COMMENT ON TABLE user_draw_stores IS '绘画任务历史（payload_json 存 draw-list 快照）';
COMMENT ON TABLE user_draw_images IS '绘画生成图片二进制（data=原图 bytea，thumb_data=缩略图 bytea，按 md5 去重）';
COMMENT ON TABLE cache_file_blobs IS '上传文件内容 blob（按 content_type + content_md5 去重）';
COMMENT ON TABLE user_cache_files IS '用户上传/缓存文件记录（可过期或 pinned，引用 cache_file_blobs）';
COMMENT ON TABLE provider_configs IS '模型供应商配置';
COMMENT ON TABLE provider_api_keys IS '供应商 API 密钥和分组';
COMMENT ON TABLE conversations IS '对话主表（删除走物理删除，is_deleted 仅作历史标记）';
COMMENT ON TABLE messages IS '消息表（关联 conversation，cascade delete）';
COMMENT ON TABLE sync_secrets IS '同步用敏感数据密文存储';
COMMENT ON TABLE backup_api_config_settings IS '备份数据库中的 API 配置自动备份设置';
COMMENT ON TABLE backup_api_config_snapshots IS '备份数据库中的 API 配置备份快照';
COMMENT ON TABLE backup_chat_settings IS '备份数据库中的对话增量备份设置';
COMMENT ON TABLE backup_chat_runs IS '备份数据库中按用户区分的对话备份批次';
COMMENT ON TABLE backup_chat_conversation_snapshots IS '备份数据库中对话备份批次的完整会话快照';
COMMENT ON TABLE provider_balance_configs IS '供应商余额快照 + 加密存储的管理 API Key';

COMMIT;
