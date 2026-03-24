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
};

declare global {
  var __nextchatPostgresPool: Pool | undefined;
  var __nextchatSyncStorageSchemaReady: Promise<void> | undefined;
}

function isRetryablePostgresError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown_error");

  return [
    "Connection terminated unexpectedly",
    "Connection ended unexpectedly",
    "terminating connection due to administrator command",
    "Client has encountered a connection error and is not queryable",
  ].some((pattern) => message.includes(pattern));
}

export async function withRetryablePostgresOperation<T>(
  operation: () => Promise<T>,
) {
  try {
    return await operation();
  } catch (error) {
    if (!isRetryablePostgresError(error)) {
      throw error;
    }

    console.warn(
      "[Postgres] retry operation after reconnect",
      error instanceof Error ? error.message : String(error),
    );

    await closePostgresPool().catch(() => {});
    return operation();
  }
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
      ssl: env.ssl ? { rejectUnauthorized: false } : undefined,
    });

    pool.on("error", (error) => {
      console.error(
        "[Postgres] pool error",
        error instanceof Error ? error.message : String(error),
      );

      if (globalThis.__nextchatPostgresPool === pool) {
        globalThis.__nextchatPostgresPool = undefined;
      }

      void pool.end().catch(() => {});
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
  const client = await getPostgresPool().connect();
  try {
    return await handler(client);
  } finally {
    client.release();
  }
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
  if (!globalThis.__nextchatPostgresPool) return;
  const pool = globalThis.__nextchatPostgresPool;
  globalThis.__nextchatPostgresPool = undefined;
  await pool.end();
}

export async function ensureSyncStorageSchema() {
  if (!globalThis.__nextchatSyncStorageSchemaReady) {
    globalThis.__nextchatSyncStorageSchemaReady = withPgClient(
      async (client) => {
        await client.query(`
        create or replace function generate_uuid_v4()
        returns uuid as $$
        declare
          raw text;
        begin
          raw := md5(random()::text || clock_timestamp()::text || txid_current()::text);
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
          email text,
          display_name text,
          avatar_url text,
          locale text default 'zh-CN',
          timezone text default 'Asia/Shanghai',
          is_active boolean not null default true,
          profile_json jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
        await client.query(`
        create table if not exists provider_configs (
          id uuid primary key default generate_uuid_v4(),
          user_id uuid not null references app_users(id) on delete cascade,
          provider_code text not null,
          provider_name text not null,
          provider_type text not null,
          base_url text,
          api_path text,
          api_format text,
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
          last_verified_at timestamptz,
          expires_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          unique (provider_config_id, key_name)
        )
      `);
        await client.query(`
        create table if not exists app_settings (
          user_id uuid primary key references app_users(id) on delete cascade,
          ui_settings jsonb not null default '{}'::jsonb,
          chat_settings jsonb not null default '{}'::jsonb,
          model_settings jsonb not null default '{}'::jsonb,
          plugin_settings jsonb not null default '{}'::jsonb,
          sync_settings jsonb not null default '{}'::jsonb,
          security_settings jsonb not null default '{}'::jsonb,
          extra_settings jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
        await client.query(`
        create index if not exists idx_provider_configs_user_id
        on provider_configs(user_id)
      `);
        await client.query(`
        create index if not exists idx_provider_api_keys_provider_config_id
        on provider_api_keys(provider_config_id)
      `);
        await client.query(`
        create table if not exists user_chat_state_indexes (
          user_id text primary key,
          payload_json jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
        await client.query(`
        create table if not exists user_chat_state_sessions (
          user_id text not null,
          session_id text not null,
          payload_json jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          primary key (user_id, session_id)
        )
      `);
        await client.query(`
        create table if not exists user_model_refresh_states (
          user_id text not null,
          refresh_key text not null,
          payload_json jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          primary key (user_id, refresh_key)
        )
      `);
        await client.query(`
        create table if not exists user_provider_balance_snapshots (
          user_id text not null,
          balance_key text not null,
          payload_json jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          primary key (user_id, balance_key)
        )
      `);
        await client.query(`
        create table if not exists model_source_index_snapshots (
          source_key text primary key,
          payload_json jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
        await client.query(`
        create index if not exists idx_user_chat_state_sessions_user_updated
        on user_chat_state_sessions(user_id, updated_at desc)
      `);
        await client.query(`
        create index if not exists idx_user_model_refresh_states_user_updated
        on user_model_refresh_states(user_id, updated_at desc)
      `);
        await client.query(`
        create index if not exists idx_user_provider_balance_snapshots_user_updated
        on user_provider_balance_snapshots(user_id, updated_at desc)
      `);
        await client.query(`
        create or replace trigger trg_app_settings_updated_at
        before update on app_settings
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
        create or replace trigger trg_user_chat_state_indexes_updated_at
        before update on user_chat_state_indexes
        for each row execute function set_updated_at()
      `);
        await client.query(`
        create or replace trigger trg_user_chat_state_sessions_updated_at
        before update on user_chat_state_sessions
        for each row execute function set_updated_at()
      `);
        await client.query(`
        create or replace trigger trg_user_model_refresh_states_updated_at
        before update on user_model_refresh_states
        for each row execute function set_updated_at()
      `);
        await client.query(`
        create or replace trigger trg_user_provider_balance_snapshots_updated_at
        before update on user_provider_balance_snapshots
        for each row execute function set_updated_at()
      `);
        await client.query(`
        create or replace trigger trg_model_source_index_snapshots_updated_at
        before update on model_source_index_snapshots
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
      },
    ).catch((error) => {
      globalThis.__nextchatSyncStorageSchemaReady = undefined;
      throw error;
    });
  }

  await globalThis.__nextchatSyncStorageSchemaReady;
}

export type PgResult<T extends QueryResultRow = QueryResultRow> =
  QueryResult<T>;
