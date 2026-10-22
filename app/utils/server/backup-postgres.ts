import { Pool, type PoolClient, type QueryResultRow } from "pg";
import {
  getPostgresEnv,
  isPostgresTemporarilyUnavailableError,
  shouldResetPoolForError,
} from "./postgres";

type BackupPostgresEnv = {
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
  var __nextchatBackupPostgresPool: Pool | undefined;
  var __nextchatBackupStorageSchemaReady: Promise<void> | undefined;
  var __nextchatBackupStorageSchemaVersion: string | undefined;
}

const BACKUP_STORAGE_SCHEMA_VERSION = "2026-07-16-chat-backup-batch-audit";

function toBoolean(value?: string) {
  if (!value) return false;
  return ["1", "true", "yes", "on", "require"].includes(value.toLowerCase());
}

function resolveBackupEnv(): BackupPostgresEnv {
  const mainEnv = getPostgresEnv();
  const port = Number(process.env.BACKUP_PGPORT ?? mainEnv.port ?? "5432");
  const max = Number(process.env.BACKUP_PGPOOL_MAX ?? mainEnv.max ?? "10");
  const idleTimeoutMillis = Number(
    process.env.BACKUP_PG_IDLE_TIMEOUT_MS ??
      mainEnv.idleTimeoutMillis ??
      "30000",
  );
  const connectionTimeoutMillis = Number(
    process.env.BACKUP_PG_CONNECT_TIMEOUT_MS ??
      mainEnv.connectionTimeoutMillis ??
      "10000",
  );

  return {
    connectionString: process.env.BACKUP_DATABASE_URL,
    host: process.env.BACKUP_PGHOST,
    port: Number.isFinite(port) ? port : 5432,
    database: process.env.BACKUP_PGDATABASE,
    user: process.env.BACKUP_PGUSER,
    password: process.env.BACKUP_PGPASSWORD,
    ssl: toBoolean(process.env.BACKUP_PGSSL ?? process.env.BACKUP_PGSSLMODE),
    max: Number.isFinite(max) ? max : 10,
    idleTimeoutMillis: Number.isFinite(idleTimeoutMillis)
      ? idleTimeoutMillis
      : 30000,
    connectionTimeoutMillis: Number.isFinite(connectionTimeoutMillis)
      ? connectionTimeoutMillis
      : 10000,
  };
}

export function getBackupPostgresEnv() {
  return resolveBackupEnv();
}

export function isBackupPostgresEnabled() {
  const env = resolveBackupEnv();
  return !!(env.connectionString || (env.host && env.database && env.user));
}

export function getBackupPostgresPool() {
  if (!isBackupPostgresEnabled()) {
    throw new Error(
      "[BackupPostgres] 缺少备份数据库配置，请设置 BACKUP_DATABASE_URL 或 BACKUP_PGHOST/BACKUP_PGDATABASE/BACKUP_PGUSER/BACKUP_PGPASSWORD",
    );
  }

  if (!globalThis.__nextchatBackupPostgresPool) {
    const env = resolveBackupEnv();
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
        "[BackupPostgres] pool error",
        error instanceof Error ? error.message : String(error),
      );

      if (globalThis.__nextchatBackupPostgresPool === pool) {
        globalThis.__nextchatBackupPostgresPool = undefined;
      }
    });

    globalThis.__nextchatBackupPostgresPool = pool;
  }

  return globalThis.__nextchatBackupPostgresPool;
}

async function withRetryableBackupPostgresOperation<T>(
  operation: () => Promise<T>,
) {
  const maxRetries = Math.max(
    0,
    Number(
      process.env.BACKUP_PG_RETRY_COUNT ?? process.env.PG_RETRY_COUNT ?? "3",
    ),
  );
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const poolBeforeAttempt = globalThis.__nextchatBackupPostgresPool;
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

      console.warn(
        "[BackupPostgres] retry operation after reconnect",
        error instanceof Error ? error.message : String(error),
      );

      // 与主库一致：仅连接层错误且池未被其他请求重建时才关闭连接池。
      if (
        shouldResetPoolForError(error) &&
        poolBeforeAttempt &&
        globalThis.__nextchatBackupPostgresPool === poolBeforeAttempt
      ) {
        await closeBackupPostgresPool().catch(() => {});
      }
      const delay = Math.min(1000, 150 * (attempt + 1) * (attempt + 1));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("unknown_error");
}

export async function backupPgQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return withRetryableBackupPostgresOperation(() =>
    getBackupPostgresPool().query<T>(text, params),
  );
}

export async function withBackupPgClient<T>(
  handler: (client: PoolClient) => Promise<T>,
) {
  return withRetryableBackupPostgresOperation(async () => {
    const client = await getBackupPostgresPool().connect();
    try {
      return await handler(client);
    } finally {
      client.release();
    }
  });
}

export async function withBackupPgTransaction<T>(
  handler: (client: PoolClient) => Promise<T>,
) {
  return withBackupPgClient(async (client) => {
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

export async function closeBackupPostgresPool() {
  if (!globalThis.__nextchatBackupPostgresPool) return;
  const pool = globalThis.__nextchatBackupPostgresPool;
  globalThis.__nextchatBackupPostgresPool = undefined;
  await pool.end();
}

export async function ensureBackupStorageSchema() {
  if (
    globalThis.__nextchatBackupStorageSchemaVersion !==
    BACKUP_STORAGE_SCHEMA_VERSION
  ) {
    globalThis.__nextchatBackupStorageSchemaReady = undefined;
  }

  if (!globalThis.__nextchatBackupStorageSchemaReady) {
    globalThis.__nextchatBackupStorageSchemaReady = withBackupPgClient(
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
        create table if not exists backup_api_config_settings (
          user_id uuid primary key,
          external_user_id text,
          enabled boolean not null default true,
          interval_minutes integer not null default 1440 check (interval_minutes >= 1),
          max_backups integer not null default 10 check (max_backups >= 1),
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
        await client.query(`
        create table if not exists backup_api_config_snapshots (
          id uuid primary key default generate_uuid_v4(),
          user_id uuid not null,
          external_user_id text,
          source text not null check (source in ('auto', 'manual', 'pre_restore')),
          payload_json jsonb not null,
          checksum text not null,
          profile_count integer not null default 0,
          created_at timestamptz not null default now()
        )
      `);
        await client.query(`
        create index if not exists idx_backup_api_config_snapshots_user_created
        on backup_api_config_snapshots(user_id, created_at desc)
      `);
        await client.query(`
        create table if not exists backup_chat_settings (
          user_id uuid primary key,
          external_user_id text,
          enabled boolean not null default true,
          interval_minutes integer not null default 1440 check (interval_minutes >= 1),
          max_backups integer not null default 30 check (max_backups >= 1),
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
        await client.query(`
        create table if not exists backup_chat_runs (
          id uuid primary key default generate_uuid_v4(),
          batch_id uuid,
          user_id uuid not null,
          external_user_id text,
          source text not null check (source in ('manual', 'auto')),
          mode text not null default 'incremental' check (mode in ('full', 'incremental')),
          from_watermark timestamptz,
          to_watermark timestamptz not null default now(),
          session_count integer not null default 0,
          message_count integer not null default 0,
          checksum text not null,
          created_at timestamptz not null default now()
        )
      `);
        // 同一轮全员备份共用 batch_id；历史行保持 null，避免把过去独立备份误合并。
        await client.query(
          "alter table backup_chat_runs add column if not exists batch_id uuid",
        );
        await client.query(`
        create index if not exists idx_backup_chat_runs_user_created
        on backup_chat_runs(user_id, created_at desc)
      `);
        await client.query(`
        create index if not exists idx_backup_chat_runs_batch_created
        on backup_chat_runs(batch_id, created_at desc)
      `);
        await client.query(`
        create table if not exists backup_chat_batches (
          id uuid primary key,
          source text not null check (source in ('manual', 'auto')),
          created_at timestamptz not null default now()
        )
      `);
        await client.query(`
        create table if not exists backup_chat_batch_members (
          batch_id uuid not null references backup_chat_batches(id) on delete cascade,
          user_id uuid not null,
          external_user_id text,
          status text not null check (status in ('created', 'skipped', 'failed')),
          reason text,
          session_count integer not null default 0,
          message_count integer not null default 0,
          created_at timestamptz not null default now(),
          primary key (batch_id, user_id)
        )
      `);
        await client.query(`
        create index if not exists idx_backup_chat_batch_members_batch
        on backup_chat_batch_members(batch_id, created_at asc)
      `);
        await client.query(`
        create table if not exists backup_chat_conversation_snapshots (
          id uuid primary key default generate_uuid_v4(),
          backup_id uuid not null references backup_chat_runs(id) on delete cascade,
          user_id uuid not null,
          external_user_id text,
          external_session_id text not null,
          title text not null default '',
          message_count integer not null default 0,
          session_payload jsonb not null,
          checksum text not null,
          updated_at_snapshot timestamptz,
          created_at timestamptz not null default now(),
          unique (backup_id, external_session_id)
        )
      `);
        await client.query(`
        create index if not exists idx_backup_chat_snapshots_backup
        on backup_chat_conversation_snapshots(backup_id, external_session_id)
      `);
        await client.query(`
        create index if not exists idx_backup_chat_snapshots_user_session
        on backup_chat_conversation_snapshots(user_id, external_session_id, created_at desc)
      `);
        await client.query(`
        create or replace trigger trg_backup_api_config_settings_updated_at
        before update on backup_api_config_settings
        for each row execute function set_updated_at()
      `);
        await client.query(`
        create or replace trigger trg_backup_chat_settings_updated_at
        before update on backup_chat_settings
        for each row execute function set_updated_at()
      `);
        globalThis.__nextchatBackupStorageSchemaVersion =
          BACKUP_STORAGE_SCHEMA_VERSION;
      },
    ).catch((error) => {
      globalThis.__nextchatBackupStorageSchemaReady = undefined;
      globalThis.__nextchatBackupStorageSchemaVersion = undefined;
      if (isPostgresTemporarilyUnavailableError(error)) {
        void closeBackupPostgresPool().catch(() => {});
      }
      throw error;
    });
  }

  await globalThis.__nextchatBackupStorageSchemaReady;
}
