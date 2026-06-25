-- NextChat PostgreSQL schema
-- 与运行时 ensureSyncStorageSchema() + ensureAuthSchemaAndSeed() + ensureSitePasswordConfigured() 保持一致
-- 最后更新: 2026-06-22 (draw-thumb-v1：新增 user_draw_images 表，存储绘画原图 data + 缩略图 thumb_data)
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

CREATE TABLE IF NOT EXISTS site_access_settings (
  setting_key text PRIMARY KEY,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
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

-- ============================================================
-- 表注释
-- ============================================================

COMMENT ON TABLE app_users IS '用户主表';
COMMENT ON TABLE auth_sessions IS '登录会话（token 哈希存储）';
COMMENT ON TABLE app_settings IS '用户全局设置（JSONB key-value store）';
COMMENT ON TABLE site_access_settings IS '站点访问密码';
COMMENT ON TABLE user_draw_stores IS '绘画任务历史（payload_json 存 draw-list 快照）';
COMMENT ON TABLE user_draw_images IS '绘画生成图片二进制（data=原图 bytea，thumb_data=缩略图 bytea，按 md5 去重）';
COMMENT ON TABLE provider_configs IS '模型供应商配置';
COMMENT ON TABLE provider_api_keys IS '供应商 API 密钥和分组';
COMMENT ON TABLE conversations IS '对话主表（删除走物理删除，is_deleted 仅作历史标记）';
COMMENT ON TABLE messages IS '消息表（关联 conversation，cascade delete）';
COMMENT ON TABLE sync_secrets IS '同步用敏感数据密文存储';

COMMIT;
