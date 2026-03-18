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

export type PgResult<T extends QueryResultRow = QueryResultRow> =
  QueryResult<T>;
