import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";

type PostgresEnv = {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  // 单条 SQL 超时（毫秒）。防止长查询占满连接池导致整站雪崩。
  statementTimeoutMs?: number;
  // 事务挂起超时（毫秒）。防止事务被遗忘导致连接被长期占用。
  idleInTxTimeoutMs?: number;
};

declare global {
  var __nextchatPostgresPool: Pool | undefined;
  var __nextchatSyncStorageSchemaReady: Promise<void> | undefined;
  var __nextchatSyncStorageSchemaVersion: string | undefined;
}

// 2026-07-09-force-reapply-conversations-deleted-at：旧容器可能在 deleted_at 列
// 加入迁移之前已经跑过 ensureSyncStorageSchema 并把缓存锁住，导致 ALTER TABLE …
// ADD COLUMN IF NOT EXISTS deleted_at 一直没有跑。bump 这个版本号会清掉
// globalThis.__nextchatSyncStorageSchemaReady，让下一次请求重新走一遍迁移；
// ADD COLUMN IF NOT EXISTS 幂等，旧库会补上缺失列，已有库是 no-op。
const SYNC_STORAGE_SCHEMA_VERSION =
  "2026-07-09-force-reapply-conversations-deleted-at";

function getPostgresErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const code = (error as any).code;
  return typeof code === "string" ? code : "";
}

function isRetryablePostgresError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown_error");
  const code = getPostgresErrorCode(error);
  if (
    [
      "ECONNREFUSED",
      "ECONNRESET",
      "ENETUNREACH",
      "ETIMEDOUT",
      "EHOSTUNREACH",
    ].includes(code)
  ) {
    return true;
  }
  const nestedErrors = Array.isArray((error as any)?.errors)
    ? ((error as any).errors as unknown[])
    : [];
  if (nestedErrors.some(isRetryablePostgresError)) {
    return true;
  }

  return [
    "Connection terminated unexpectedly",
    "Connection ended unexpectedly",
    "terminating connection due to administrator command",
    "Client has encountered a connection error and is not queryable",
    "database system is not accepting connections",
    "the database system is starting up",
    "too many clients already",
    "Connection terminated due to connection timeout",
    "tuple concurrently updated",
  ].some((pattern) => message.includes(pattern));
}

export function isPostgresTemporarilyUnavailableError(error: unknown) {
  const code = getPostgresErrorCode(error);
  if (["57P03", "53300"].includes(code)) return true;
  if (code.startsWith("08")) return true;
  return isRetryablePostgresError(error);
}

export async function withRetryablePostgresOperation<T>(
  operation: () => Promise<T>,
) {
  const maxRetries = Math.max(0, Number(process.env.PG_RETRY_COUNT ?? "3"));
  // 重试退避默认上限 5s（覆盖 PG 重启、容器漂移场景），并加入 ±20% jitter 防止惊群
  const baseDelayMs = Math.max(
    500,
    Number(process.env.PG_RETRY_BASE_DELAY_MS ?? "500"),
  );
  const maxDelayMs = Math.max(
    baseDelayMs,
    Number(process.env.PG_RETRY_MAX_DELAY_MS ?? "5000"),
  );
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isPostgresTemporarilyUnavailableError(error)) {
        throw error;
      }
      if (attempt >= maxRetries) {
        throw error;
      }

      const jitter = 0.8 + Math.random() * 0.4;
      const delay = Math.min(
        maxDelayMs,
        Math.round(baseDelayMs * (attempt + 1) * (attempt + 1) * jitter),
      );

      console.warn(
        `[Postgres] retry attempt=${
          attempt + 1
        }/${maxRetries} after ${delay}ms`,
        error instanceof Error ? error.message : String(error),
      );

      await closePostgresPool().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("unknown_error");
}

function toBoolean(value?: string) {
  if (!value) return false;
  return ["1", "true", "yes", "on", "require"].includes(value.toLowerCase());
}

export function getPostgresEnv(): PostgresEnv {
  const port = Number(process.env.PGPORT ?? "5432");
  const max = Number(process.env.PGPOOL_MAX ?? "10");
  const idleTimeoutMillis = Number(process.env.PG_IDLE_TIMEOUT_MS ?? "30000");
  const connectionTimeoutMillis = Number(
    process.env.PG_CONNECT_TIMEOUT_MS ?? "10000",
  );
  // 单条 SQL 默认 30s 上限；事务挂起默认 60s 上限。均可通过环境变量覆盖。
  const statementTimeoutMs = Number(
    process.env.PG_STATEMENT_TIMEOUT_MS ?? "30000",
  );
  const idleInTxTimeoutMs = Number(
    process.env.PG_IDLE_IN_TX_TIMEOUT_MS ?? "60000",
  );

  return {
    connectionString: process.env.DATABASE_URL,
    host: process.env.PGHOST,
    port: Number.isFinite(port) ? port : 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: toBoolean(process.env.PGSSL ?? process.env.PGSSLMODE),
    max: Number.isFinite(max) ? max : 10,
    idleTimeoutMillis: Number.isFinite(idleTimeoutMillis)
      ? idleTimeoutMillis
      : 30000,
    connectionTimeoutMillis: Number.isFinite(connectionTimeoutMillis)
      ? connectionTimeoutMillis
      : 10000,
    statementTimeoutMs: Number.isFinite(statementTimeoutMs)
      ? statementTimeoutMs
      : 30000,
    idleInTxTimeoutMs: Number.isFinite(idleInTxTimeoutMs)
      ? idleInTxTimeoutMs
      : 60000,
  };
}

export function isPostgresEnabled() {
  const env = getPostgresEnv();
  return !!(env.connectionString || (env.host && env.database && env.user));
}

export function getPostgresPool() {
  if (!isPostgresEnabled()) {
    throw new Error(
      "[Postgres] 缺少数据库配置，请设置 DATABASE_URL 或 PGHOST/PGDATABASE/PGUSER/PGPASSWORD",
    );
  }

  if (!globalThis.__nextchatPostgresPool) {
    const env = getPostgresEnv();
    const pool = new Pool({
      connectionString: env.connectionString,
      host: env.host,
      port: env.port,
      database: env.database,
      user: env.user,
      password: env.password,
      max: env.max,
      idleTimeoutMillis: env.idleTimeoutMillis,
      connectionTimeoutMillis: env.connectionTimeoutMillis,
      ssl: env.ssl
        ? // 默认校验证书以避免中间人攻击；仅当显式设置 PGSSL_REJECT_UNAUTHORIZED=false 时
          // 才关闭证书校验（用于 SSH 隧道等场景；CLAUDE.md 中本项目默认走 SSH 隧道连远程 PG）
          process.env.PGSSL_REJECT_UNAUTHORIZED === "false"
          ? { rejectUnauthorized: false }
          : { rejectUnauthorized: true }
        : undefined,
      // 全局应用 statement_timeout / idle_in_transaction_session_timeout，
      // 防止单条长查询占满连接池导致整站雪崩。
      statement_timeout: env.statementTimeoutMs,
      query_timeout: env.statementTimeoutMs,
      idle_in_transaction_session_timeout: env.idleInTxTimeoutMs,
    });

    pool.on("error", (error) => {
      console.error(
        "[Postgres] pool error",
        error instanceof Error ? error.message : String(error),
      );

      if (globalThis.__nextchatPostgresPool === pool) {
        globalThis.__nextchatPostgresPool = undefined;
      }
    });

    globalThis.__nextchatPostgresPool = pool;
  }

  return globalThis.__nextchatPostgresPool;
}

export async function pgQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return withRetryablePostgresOperation(() =>
    getPostgresPool().query<T>(text, params),
  );
}

export async function withPgClient<T>(
  handler: (client: PoolClient) => Promise<T>,
) {
  return withRetryablePostgresOperation(async () => {
    const client = await getPostgresPool().connect();
    try {
      return await handler(client);
    } finally {
      client.release();
    }
  });
}

export async function withPgTransaction<T>(
  handler: (client: PoolClient) => Promise<T>,
) {
  return withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await handler(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function pgHealthcheck() {
  const env = getPostgresEnv();
  const result = await pgQuery<{
    now: string;
    version: string;
    current_database: string;
    current_user: string;
  }>(
    `select
      now()::text as now,
      version() as version,
      current_database() as current_database,
      current_user as current_user`,
  );
  const row = result.rows[0];

  return {
    now: row.now,
    version: row.version,
    database: row.current_database,
    user: row.current_user,
    configuredHost: env.host ?? "(from DATABASE_URL)",
    configuredPort: env.port ?? 5432,
  };
}

export async function closePostgresPool() {
  const pool = globalThis.__nextchatPostgresPool;
  if (!pool) return;
  // 先清空全局引用再 end()，避免 end() 期间并发请求基于「全局为空」判断
  // 错误地创建第二个池导致连接翻倍。
  globalThis.__nextchatPostgresPool = undefined;
  try {
    await pool.end();
  } catch (error) {
    console.warn(
      "[Postgres] pool.end() 失败",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function ensureSyncStorageSchema() {
  if (
    globalThis.__nextchatSyncStorageSchemaVersion !==
    SYNC_STORAGE_SCHEMA_VERSION
  ) {
    globalThis.__nextchatSyncStorageSchemaReady = undefined;
  }

  if (!globalThis.__nextchatSyncStorageSchemaReady) {
    globalThis.__nextchatSyncStorageSchemaReady = withPgClient(
      async (client) => {
        await client.query(`
        create or replace function generate_uuid_v4()
        returns uuid as $$
        declare
          raw text;
        begin
          raw := md5(random()::text || clock_timestamp()::text || pg_current_xact_id()::text);
          return (
            substr(raw, 1, 8) || '-' ||
            substr(raw, 9, 4) || '-' ||
            '4' || substr(raw, 14, 3) || '-' ||
            substr('89ab', (floor(random() * 4) + 1)::integer, 1) || substr(raw, 18, 3) || '-' ||
            substr(raw, 21, 12)
          )::uuid;
        end;
        $$ language plpgsql
      `);
        await client.query(`
        create or replace function set_updated_at()
        returns trigger as $$
        begin
          new.updated_at = now();
          return new;
        end;
        $$ language plpgsql
      `);
        await client.query(`
        create table if not exists app_users (
          id uuid primary key default generate_uuid_v4(),
          external_id text unique,
          display_name text,
          locale text default 'zh-CN',
          timezone text default 'Asia/Shanghai',
          is_active boolean not null default true,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
        await client.query(`
        alter table app_users
        add column if not exists last_chat_at timestamptz
      `);
        await client.query(`
        alter table app_users
        drop column if exists last_login_at
      `);
        await client.query(`
        create table if not exists provider_configs (
          id uuid primary key default generate_uuid_v4(),
          user_id uuid not null references app_users(id) on delete cascade,
          provider_code text not null,
          provider_name text not null,
          provider_type text not null,
          base_url text,
          is_enabled boolean not null default true,
          is_default boolean not null default false,
          request_config jsonb not null default '{}'::jsonb,
          raw_payload jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          unique (user_id, provider_code)
        )
      `);
        await client.query(`
        create table if not exists provider_api_keys (
          id uuid primary key default generate_uuid_v4(),
          provider_config_id uuid not null references provider_configs(id) on delete cascade,
          key_name text not null,
          key_scope text,
          api_key_group text,
          encrypted_secret text,
          masked_secret text,
          metadata_json jsonb not null default '{}'::jsonb,
          is_enabled boolean not null default true,
          expires_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          unique (provider_config_id, key_name)
        )
      `);
        await client.query(`
        create table if not exists app_settings (
          user_id uuid primary key references app_users(id) on delete cascade,
          chat_settings jsonb not null default '{}'::jsonb,
          plugin_settings jsonb not null default '{}'::jsonb,
          security_settings jsonb not null default '{}'::jsonb,
          extra_settings jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
        await client.query(`
        create table if not exists deployment_metadata (
          commit_hash text primary key,
          commit_date bigint not null,
          git_branch text not null,
          image_name text not null,
          deployed_at timestamptz not null default now()
        )
      `);
        await client.query(`
        alter table app_settings
        add column if not exists chat_settings jsonb not null default '{}'::jsonb
      `);
        await client.query(`
        alter table app_settings
        add column if not exists plugin_settings jsonb not null default '{}'::jsonb
      `);
        await client.query(`
        alter table app_settings
        add column if not exists security_settings jsonb not null default '{}'::jsonb
      `);
        await client.query(`
        alter table app_settings
        add column if not exists extra_settings jsonb not null default '{}'::jsonb
      `);
        await client.query(`
        create table if not exists user_draw_stores (
          user_id uuid primary key references app_users(id) on delete cascade,
          payload_json jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
        await client.query(`
        insert into user_draw_stores (
          user_id,
          payload_json,
          created_at,
          updated_at
        )
        select
          user_id,
          coalesce(extra_settings -> 'draw-list', extra_settings -> 'sd-list'),
          created_at,
          updated_at
        from app_settings
        where (extra_settings ? 'draw-list' or extra_settings ? 'sd-list')
          and coalesce(extra_settings -> 'draw-list', extra_settings -> 'sd-list') is not null
        on conflict (user_id) do nothing
      `);
        await client.query(`
        create table if not exists user_draw_images (
          id uuid primary key default generate_uuid_v4(),
          user_id uuid not null references app_users(id) on delete cascade,
          content_type text not null,
          size_bytes integer not null,
          data bytea not null,
          thumb_data bytea,
          created_at timestamptz not null default now()
        )
      `);
        await client.query(`
        create index if not exists idx_user_draw_images_user_created_at
        on user_draw_images(user_id, created_at desc)
      `);
        // 迁移：添加 thumb_data 列到 user_draw_images（已有表）
        await client.query(`
        alter table user_draw_images
        add column if not exists thumb_data bytea
      `);
        // 删除完全重复的数据记录
        await client.query(`
        delete from user_draw_images
        where id in (
          select id from (
            select id, row_number() over (
              partition by user_id, content_type, data
              order by created_at desc
            ) as rn
            from user_draw_images
          ) dup
          where dup.rn > 1
        )
      `);
        // 防止未来插入重复数据
        await client.query(`
        create unique index if not exists idx_user_draw_images_user_content_data
        on user_draw_images(user_id, content_type, md5(data))
      `);
        await client.query(`
        create table if not exists cache_file_blobs (
          id uuid primary key default generate_uuid_v4(),
          content_type text not null,
          content_md5 text not null,
          size_bytes integer not null,
          data bytea not null,
          created_at timestamptz not null default now(),
          unique (content_type, content_md5)
        )
      `);
        await client.query(`
        create table if not exists user_cache_files (
          id uuid primary key default generate_uuid_v4(),
          user_id uuid not null references app_users(id) on delete cascade,
          file_name text not null,
          file_ext text not null default '',
          content_type text not null,
          size_bytes integer not null,
          data bytea not null,
          is_pinned boolean not null default false,
          expires_at timestamptz not null default (now() + interval '3 days'),
          created_at timestamptz not null default now()
        )
      `);
        await client.query(`
        alter table user_cache_files
        add column if not exists blob_id uuid references cache_file_blobs(id) on delete restrict
      `);
        await client.query(`
        alter table user_cache_files
        add column if not exists content_md5 text
      `);
        await client.query(`
        alter table user_cache_files
        alter column data drop not null
      `);
        await client.query(`
        alter table user_cache_files
        add column if not exists is_pinned boolean not null default false
      `);
        await client.query(`
        alter table user_cache_files
        add column if not exists expires_at timestamptz not null default (now() + interval '3 days')
      `);
        await client.query(`
        create index if not exists idx_user_cache_files_user_created_at
        on user_cache_files(user_id, created_at desc)
      `);
        await client.query(`
        create index if not exists idx_user_cache_files_user_expires_at
        on user_cache_files(user_id, expires_at)
        where is_pinned = false
      `);
        await client.query(`
        update user_cache_files
        set content_md5 = md5(data)
        where content_md5 is null
          and data is not null
      `);
        await client.query(`
        insert into cache_file_blobs (content_type, content_md5, size_bytes, data)
        select distinct on (content_type, content_md5)
          content_type,
          content_md5,
          size_bytes,
          data
        from user_cache_files
        where blob_id is null
          and content_md5 is not null
          and data is not null
        order by content_type, content_md5, is_pinned desc, created_at asc
        on conflict (content_type, content_md5) do nothing
      `);
        await client.query(`
        update user_cache_files f
        set blob_id = b.id
        from cache_file_blobs b
        where f.blob_id is null
          and f.content_type = b.content_type
          and f.content_md5 = b.content_md5
      `);
        await client.query(`
        update user_cache_files
        set data = null
        where blob_id is not null
          and data is not null
      `);
        await client.query(`
        create index if not exists idx_user_cache_files_blob_id
        on user_cache_files(blob_id)
      `);
        // 缓存文件引用追踪表：替代 LIKE 全表扫 messages.content_json/metadata_json
        // 写入消息时按 cache_file_id upsert；删除缓存文件前查此表判断是否仍被引用。
        await client.query(`
        create table if not exists cache_file_references (
          cache_file_id uuid not null references user_cache_files(id) on delete cascade,
          user_id uuid not null references app_users(id) on delete cascade,
          message_id uuid references messages(id) on delete cascade,
          last_seen_at timestamptz not null default now(),
          primary key (cache_file_id, message_id)
        )
      `);
        await client.query(`
        create index if not exists idx_cache_file_references_cache_file_id
        on cache_file_references(cache_file_id)
      `);
        await client.query(`
        create index if not exists idx_cache_file_references_user_id
        on cache_file_references(user_id)
      `);
        await client.query(`
        create index if not exists idx_cache_file_blobs_content_md5
        on cache_file_blobs(content_type, content_md5)
      `);
        await client.query(`
        drop index if exists idx_user_cache_files_user_content_data
      `);
        await client.query(`
        delete from user_cache_files
        where id in (
          select id from (
            select id, row_number() over (
              partition by user_id, content_type, md5(data)
              order by created_at desc
            ) as rn
            from user_cache_files
            where blob_id is null
              and data is not null
          ) dup
          where dup.rn > 1
        )
      `);
        await client.query(`
        create unique index if not exists idx_user_cache_files_user_content_data
        on user_cache_files(user_id, content_type, md5(data))
        where blob_id is null and data is not null
      `);
        await client.query(`
        create table if not exists conversations (
          id uuid primary key default generate_uuid_v4(),
          user_id uuid not null references app_users(id) on delete cascade,
          external_session_id text,
          provider_config_id uuid references provider_configs(id) on delete set null,
          title text,
          model_name text,
          provider_name text,
          conversation_type text not null default 'chat',
          is_archived boolean not null default false,
          is_pinned boolean not null default false,
          is_deleted boolean not null default false,
          metadata_json jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
        await client.query(`
        alter table conversations
        add column if not exists external_session_id text
      `);
        // 软删除专用时间戳：与 is_deleted 配对使用，便于增量备份识别最近被删除的会话
        await client.query(`
        alter table conversations
        add column if not exists deleted_at timestamptz
      `);
        await client.query(`
        create index if not exists idx_conversations_user_deleted_at
        on conversations(user_id, deleted_at)
        where is_deleted = true
      `);
        await client.query(`
        create unique index if not exists idx_conversations_user_external_session_id
        on conversations(user_id, external_session_id)
        where external_session_id is not null
      `);
        await client.query(`
        create table if not exists messages (
          id uuid primary key default generate_uuid_v4(),
          conversation_id uuid not null references conversations(id) on delete cascade,
          external_message_id text,
          seq integer not null,
          role text not null check (role in ('system', 'user', 'assistant', 'tool')),
          status text not null default 'done',
          content_text text,
          content_json jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          unique (conversation_id, seq)
        )
      `);
        await client.query(`
        alter table messages
        add column if not exists external_message_id text
      `);
        await client.query(`
        alter table messages
        add column if not exists reasoning_text text
      `);
        await client.query(`
        alter table messages
        add column if not exists tool_calls jsonb not null default '[]'::jsonb
      `);
        await client.query(`
        alter table messages
        add column if not exists metadata_json jsonb not null default '{}'::jsonb
      `);
        // 删除与 messages.unique (conversation_id, seq) 完全重复的旧索引
        // 该 unique 约束自带等价 B-tree 索引，升序/降序差异在 PG 11+ 双向扫描都支持
        await client.query(`
        drop index if exists idx_messages_conversation_seq
      `);
        // 删除与 provider_configs.unique (user_id, provider_code) 前缀冗余的旧索引
        // 复合 unique 已可被 where user_id = $1 命中
        await client.query(`
        drop index if exists idx_provider_configs_user_id
      `);
        // 删除与 provider_api_keys.unique (provider_config_id, key_name) 前缀冗余的旧索引
        await client.query(`
        drop index if exists idx_provider_api_keys_provider_config_id
      `);
        // provider_configs 补齐历史预留列 api_path / api_format（unify-user-id 脚本依赖）
        await client.query(`
        alter table provider_configs
        add column if not exists api_path text
      `);
        await client.query(`
        alter table provider_configs
        add column if not exists api_format text
      `);
        // provider_api_keys 补齐历史预留列 last_verified_at（unify-user-id 脚本依赖）
        await client.query(`
        alter table provider_api_keys
        add column if not exists last_verified_at timestamptz
      `);
        await client.query(`
        create table if not exists provider_balance_configs (
          provider_config_id uuid primary key references provider_configs(id) on delete cascade,
          encrypted_management_key text,
          masked_management_key text,
          balance_snapshot jsonb,
          last_error text,
          queried_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
        await client.query(`
        create index if not exists idx_conversations_user_updated
        on conversations(user_id, updated_at desc)
      `);
        await client.query(`
        create or replace trigger trg_app_settings_updated_at
        before update on app_settings
        for each row execute function set_updated_at()
      `);
        await client.query(`
        create or replace trigger trg_user_draw_stores_updated_at
        before update on user_draw_stores
        for each row execute function set_updated_at()
      `);
        await client.query(`
        create or replace trigger trg_app_users_updated_at
        before update on app_users
        for each row execute function set_updated_at()
      `);
        await client.query(`
        create or replace trigger trg_provider_configs_updated_at
        before update on provider_configs
        for each row execute function set_updated_at()
      `);
        await client.query(`
        create or replace trigger trg_provider_api_keys_updated_at
        before update on provider_api_keys
        for each row execute function set_updated_at()
      `);
        await client.query(`
        create or replace trigger trg_conversations_updated_at
        before update on conversations
        for each row execute function set_updated_at()
      `);
        await client.query(`
        create or replace trigger trg_messages_updated_at
        before update on messages
        for each row execute function set_updated_at()
      `);
        await client.query(`
        create table if not exists sync_secrets (
          id uuid primary key default generate_uuid_v4(),
          user_id text not null,
          secret_key text not null,
          encrypted_payload text not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          unique (user_id, secret_key)
        )
      `);
        await client.query(`
        create index if not exists idx_sync_secrets_user_updated
        on sync_secrets(user_id, updated_at desc)
      `);
        await client.query(`
        create or replace trigger trg_sync_secrets_updated_at
        before update on sync_secrets
        for each row execute function set_updated_at()
      `);
        globalThis.__nextchatSyncStorageSchemaVersion =
          SYNC_STORAGE_SCHEMA_VERSION;
      },
    ).catch((error) => {
      globalThis.__nextchatSyncStorageSchemaReady = undefined;
      globalThis.__nextchatSyncStorageSchemaVersion = undefined;
      if (isRetryablePostgresError(error)) {
        void closePostgresPool().catch(() => {});
      }
      throw error;
    });
  }

  await globalThis.__nextchatSyncStorageSchemaReady;
}

declare global {
  var __nextchatLegacyBackupTablesCleaned: boolean | undefined;
}

// 主业务库中已迁移到独立备份库（backup-postgres.ts）的旧备份表，
// 保留会造成数据孤儿。下一次自动备份触发时调用本函数一次性清理。
const LEGACY_MAIN_DB_BACKUP_TABLES = [
  "chat_backup_conversation_snapshots",
  "chat_backup_runs",
  "chat_backup_settings",
  "api_config_backups",
  "api_config_backup_settings",
];

/**
 * 一次性清理主业务库里已迁移到独立备份库的旧备份表。
 * 进程内用全局标记只执行一次，drop 语句自带 if exists，重复调用安全；
 * 只删除固定白名单里的旧备份表，不触碰其它数据，失败只记录日志不抛出。
 */
export async function cleanupLegacyMainDbBackupTables() {
  if (globalThis.__nextchatLegacyBackupTablesCleaned) return;
  try {
    await ensureSyncStorageSchema();
    for (const table of LEGACY_MAIN_DB_BACKUP_TABLES) {
      // 表名来自固定常量白名单，非用户输入，无注入风险
      await pgQuery(`drop table if exists ${table} cascade`);
    }
    globalThis.__nextchatLegacyBackupTablesCleaned = true;
    console.log(
      "[Backup Cleanup] 已清理主业务库遗留的旧备份表",
      LEGACY_MAIN_DB_BACKUP_TABLES,
    );
  } catch (error) {
    console.error(
      "[Backup Cleanup] 清理主业务库遗留旧备份表失败",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export type PgResult<T extends QueryResultRow = QueryResultRow> =
  QueryResult<T>;
