import { closePostgresPool, withPgTransaction } from "../app/utils/server/postgres";

/**
 * ⚠️ 危险操作脚本：会清空用户聊天、设置等业务数据，仅保留 provider / 账号体系
 *
 * 脚本名"purge-db-keep-provider-configs"读法为"purge-db, keep provider-configs"：
 *   清空数据（除 provider 配置、API 账号、敏感 secret、用户主表之外）
 *
 * v4 优化（2026-06-11）后 TABLES_TO_PURGE 已剔除两项目前已被下线的表：
 *   - user_app_update_state（v4 之前已下线）
 *   - user_custom_models / user_model_cache / user_plugins / user_masks / user_prompts / user_sd_tasks（v4 之前已下线）
 *
 * 保留（PRESERVE）的核心表：
 *   - app_users / auth_sessions / provider_configs / provider_api_keys / sync_secrets / site_access_settings
 *   - 这几张表不会被该脚本触碰
 *
 * 历史/预留空表直接由 scripts/drop-unused-db-tables.ts 探测后 drop，不在本脚本覆盖。
 *
 * ⚠️ 该脚本必须由人工在维护窗口手工执行，执行前请先：
 *   1. 备份：pg_dump -Fc -t <保留表> + -t <待清空表> <dbname> > backup_<yyyymmdd>.dump
 *   2. 在外部通知所有用户
 *   3. 评估是否真要清空 messages / conversations / app_settings
 */
type CountResult = {
  count: string;
};

const TABLES_TO_PURGE = [
  "message_attachments",
  "share_links",
  "tags",
  "messages",
  "conversations",
  "app_settings",
  "model_aliases",
] as const;

async function getTableCount(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: CountResult[] }> },
  tableName: string,
) {
  const result = await client.query(
    `select count(*)::text as count from ${tableName}`,
  );
  return Number(result.rows[0]?.count || 0);
}

async function tableExists(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ exists: boolean }> }> },
  tableName: string,
) {
  const result = await client.query(
    `select exists (
       select 1
       from information_schema.tables
       where table_schema = 'public'
         and table_name = $1
     ) as exists`,
    [tableName],
  );
  return result.rows[0]?.exists === true;
}

async function main() {
  const deletedRows: Record<string, number> = {};
  const preservedRows: Record<string, number> = {};

  await withPgTransaction(async (client) => {
    preservedRows.provider_configs = await getTableCount(client, "provider_configs");
    preservedRows.provider_api_keys = await getTableCount(client, "provider_api_keys");
    preservedRows.sync_secrets = await getTableCount(client, "sync_secrets");
    preservedRows.app_users = await getTableCount(client, "app_users");

    for (const tableName of TABLES_TO_PURGE) {
      if (!(await tableExists(client, tableName))) {
        deletedRows[tableName] = 0;
        continue;
      }
      deletedRows[tableName] = await getTableCount(client, tableName);
      await client.query(`delete from ${tableName}`);
    }
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        deletedRows,
        preservedRows,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error:
            error instanceof Error ? error.stack || error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool().catch(() => {});
  });
