import { closePostgresPool, withPgTransaction } from "../app/utils/server/postgres";

/**
 * 清理 v2 拆表历史 / 业务功能预留的"当前未使用"表。
 *
 * 当前已通过 v4 优化（2026-06-11）确认以下表**已下线**：
 *   - model_catalog
 *   - model_sync_runs
 *   - model_source_index_snapshots
 *   - user_model_refresh_states
 *
 * 这些表已不在运行时代码与 schema SQL 中，但本脚本仍可作为兜底（探测后 drop）。
 *
 * 注意：以下表名历史上从未在 ensureSyncStorageSchema 中 create，过时无效：
 *   - usage_logs
 *   - audit_logs
 *   - prompt_templates
 *   - chat_masks
 *   - auth_accounts
 *   - model_sync_cache
 *   - model_unmatched
 *   - app_store_states
 *
 * 仅作为保险保留；执行后输出 existed=false 即代表本来就不存在。
 */
const UNUSED_TABLES = [
  // 已下线模型表（v4 优化）
  "model_catalog",
  "model_sync_runs",
  "model_source_index_snapshots",
  "user_model_refresh_states",
  // v2 拆表历史表
  "user_app_update_state",
  "user_custom_models",
  "user_model_cache",
  "user_plugins",
  "user_masks",
  "user_prompts",
  "user_sd_tasks",
  // 业务功能预留表（始终空，从未被代码读写）
  "message_attachments",
  "tags",
  "share_links",
  "model_aliases",
  // 历史上从未在 ensureSyncStorageSchema 中 create 的占位名（保险保留）
  "usage_logs",
  "audit_logs",
  "prompt_templates",
  "chat_masks",
  "auth_accounts",
  "model_sync_cache",
  "model_unmatched",
  "app_store_states",
] as const;

async function main() {
  const dropped: Array<{ table: string; existed: boolean }> = [];

  await withPgTransaction(async (client) => {
    for (const tableName of UNUSED_TABLES) {
      const existsResult = await client.query<{ exists: boolean }>(
        `select exists (
           select 1
           from information_schema.tables
           where table_schema = 'public'
             and table_name = $1
         ) as exists`,
        [tableName],
      );

      const existed = existsResult.rows[0]?.exists === true;
      await client.query(`drop table if exists ${tableName} cascade`);
      dropped.push({ table: tableName, existed });
    }
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        dropped,
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
