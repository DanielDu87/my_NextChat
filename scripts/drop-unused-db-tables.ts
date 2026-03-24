import { closePostgresPool, withPgTransaction } from "../app/utils/server/postgres";

const UNUSED_TABLES = [
  "usage_logs",
  "audit_logs",
  "prompt_templates",
  "chat_masks",
  "auth_sessions",
  "auth_accounts",
  "share_links",
  "tags",
  "message_attachments",
  "model_aliases",
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
