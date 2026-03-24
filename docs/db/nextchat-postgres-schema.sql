-- NextChat PostgreSQL schema
-- 适用于用户、对话、消息、设置、API 配置、模型目录、同步缓存、用量和审计场景

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

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  external_id text UNIQUE,
  email text,
  display_name text,
  avatar_url text,
  locale text DEFAULT 'zh-CN',
  timezone text DEFAULT 'Asia/Shanghai',
  is_active boolean NOT NULL DEFAULT true,
  profile_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_accounts (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  profile_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  session_token text NOT NULL UNIQUE,
  refresh_token text,
  ip inet,
  user_agent text,
  expires_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  ui_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  chat_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  plugin_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  sync_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  security_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  extra_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
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

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  external_session_id text,
  provider_config_id uuid REFERENCES provider_configs(id) ON DELETE SET NULL,
  title text,
  summary text,
  system_prompt text,
  model_name text,
  provider_name text,
  conversation_type text NOT NULL DEFAULT 'chat',
  is_archived boolean NOT NULL DEFAULT false,
  is_pinned boolean NOT NULL DEFAULT false,
  is_deleted boolean NOT NULL DEFAULT false,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_user_external_session_id
ON conversations(user_id, external_session_id)
WHERE external_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  external_message_id text,
  seq integer NOT NULL,
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  status text NOT NULL DEFAULT 'done',
  model_name text,
  provider_name text,
  content_text text,
  content_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  reasoning_text text,
  tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb,
  token_usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, seq)
);

CREATE TABLE IF NOT EXISTS message_attachments (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  attachment_type text NOT NULL,
  file_name text,
  mime_type text,
  storage_kind text NOT NULL DEFAULT 'object_storage',
  storage_url text,
  file_size_bytes bigint,
  sha256 text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS share_links (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  share_token text NOT NULL UNIQUE,
  permission text NOT NULL DEFAULT 'read_only',
  expires_at timestamptz,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_catalog (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  provider_id text NOT NULL,
  provider_name text,
  source_file text,
  model_name text NOT NULL,
  display_name text,
  vendor_name text,
  vendor_icon text,
  model_type text,
  category text,
  category_source smallint,
  types jsonb NOT NULL DEFAULT '[]'::jsonb,
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  published_at_int integer,
  published_at_source text,
  published_at_url text,
  published_at_note text,
  is_available boolean NOT NULL DEFAULT true,
  sort_order integer,
  api_key_group text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT NOW(),
  last_seen_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, model_name)
);

CREATE TABLE IF NOT EXISTS model_aliases (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  model_id uuid NOT NULL REFERENCES model_catalog(id) ON DELETE CASCADE,
  alias_name text NOT NULL,
  alias_kind text NOT NULL DEFAULT 'display',
  source text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (model_id, alias_name)
);

CREATE TABLE IF NOT EXISTS model_sync_runs (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  trigger_source text NOT NULL DEFAULT 'manual',
  provider_id text,
  status text NOT NULL DEFAULT 'running',
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT NOW(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_sync_cache (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  provider_id text NOT NULL,
  model_name text NOT NULL,
  published_at_int integer,
  published_at_source text,
  published_at_url text,
  published_at_note text,
  attempted_family text,
  sources_tried jsonb NOT NULL DEFAULT '[]'::jsonb,
  cache_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, model_name)
);

CREATE TABLE IF NOT EXISTS model_unmatched (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  provider_id text NOT NULL,
  model_name text NOT NULL,
  vendor_name text,
  attempted_family text,
  reason text,
  sources_tried jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT NOW(),
  last_seen_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, model_name)
);

CREATE TABLE IF NOT EXISTS sync_secrets (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  user_id text NOT NULL,
  secret_key text NOT NULL,
  encrypted_payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, secret_key)
);

CREATE TABLE IF NOT EXISTS user_model_refresh_states (
  user_id text NOT NULL,
  refresh_key text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, refresh_key)
);

CREATE TABLE IF NOT EXISTS user_provider_balance_snapshots (
  user_id text NOT NULL,
  balance_key text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, balance_key)
);

CREATE TABLE IF NOT EXISTS model_source_index_snapshots (
  source_key text PRIMARY KEY,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage_logs (
  id uuid PRIMARY KEY DEFAULT generate_uuid_v4(),
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  provider_config_id uuid REFERENCES provider_configs(id) ON DELETE SET NULL,
  model_name text,
  provider_name text,
  request_id text,
  request_tokens integer,
  response_tokens integer,
  cached_tokens integer,
  reasoning_tokens integer,
  total_tokens integer,
  cost numeric(18, 8),
  latency_ms integer,
  is_success boolean NOT NULL DEFAULT true,
  error_code text,
  error_message text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  actor_type text NOT NULL DEFAULT 'user',
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  changes_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_accounts_user_id ON auth_accounts(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email_lower ON app_users (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_provider_configs_user_id ON provider_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_provider_api_keys_provider_config_id ON provider_api_keys(provider_config_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_updated_at ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_provider_config_id ON conversations(provider_config_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_model_catalog_vendor_name ON model_catalog(vendor_name);
CREATE INDEX IF NOT EXISTS idx_model_catalog_published_at_int ON model_catalog(published_at_int DESC);
CREATE INDEX IF NOT EXISTS idx_model_catalog_raw_payload_gin ON model_catalog USING gin(raw_payload);
CREATE INDEX IF NOT EXISTS idx_model_catalog_features_gin ON model_catalog USING gin(features);
CREATE INDEX IF NOT EXISTS idx_model_catalog_capabilities_gin ON model_catalog USING gin(capabilities);
CREATE INDEX IF NOT EXISTS idx_model_sync_runs_provider_started_at ON model_sync_runs(provider_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_sync_cache_updated_at ON model_sync_cache(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_unmatched_last_seen_at ON model_unmatched(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_secrets_user_updated ON sync_secrets(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_model_refresh_states_user_updated ON user_model_refresh_states(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_provider_balance_snapshots_user_updated ON user_provider_balance_snapshots(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_created_at ON usage_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_model_created_at ON usage_logs(model_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created_at ON audit_logs(user_id, created_at DESC);

CREATE OR REPLACE TRIGGER trg_app_users_updated_at
BEFORE UPDATE ON app_users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_auth_accounts_updated_at
BEFORE UPDATE ON auth_accounts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_auth_sessions_updated_at
BEFORE UPDATE ON auth_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_app_settings_updated_at
BEFORE UPDATE ON app_settings
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

CREATE OR REPLACE TRIGGER trg_tags_updated_at
BEFORE UPDATE ON tags
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_share_links_updated_at
BEFORE UPDATE ON share_links
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_model_catalog_updated_at
BEFORE UPDATE ON model_catalog
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_model_sync_cache_updated_at
BEFORE UPDATE ON model_sync_cache
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_model_unmatched_updated_at
BEFORE UPDATE ON model_unmatched
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_sync_secrets_updated_at
BEFORE UPDATE ON sync_secrets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_user_model_refresh_states_updated_at
BEFORE UPDATE ON user_model_refresh_states
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_user_provider_balance_snapshots_updated_at
BEFORE UPDATE ON user_provider_balance_snapshots
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_model_source_index_snapshots_updated_at
BEFORE UPDATE ON model_source_index_snapshots
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE app_users IS '用户主表';
COMMENT ON TABLE app_settings IS '用户全局设置，适合存前端配置和偏好';
COMMENT ON TABLE provider_configs IS '模型供应商配置';
COMMENT ON TABLE provider_api_keys IS '供应商 API 密钥和分组';
COMMENT ON TABLE conversations IS '对话主表';
COMMENT ON TABLE messages IS '消息表';
COMMENT ON TABLE model_catalog IS '模型目录和归一化元数据';
COMMENT ON TABLE model_sync_cache IS '模型发布时间和来源缓存';
COMMENT ON TABLE model_unmatched IS '仍未命中的模型记录';
COMMENT ON TABLE user_model_refresh_states IS '用户模型刷新状态';
COMMENT ON TABLE user_provider_balance_snapshots IS '用户供应商余额快照';
COMMENT ON TABLE model_source_index_snapshots IS '模型来源索引快照';
COMMENT ON TABLE sync_secrets IS '同步用敏感数据密文存储';
COMMENT ON TABLE usage_logs IS '调用用量与成本日志';
COMMENT ON TABLE audit_logs IS '审计日志';

COMMIT;
