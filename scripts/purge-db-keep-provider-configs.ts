import { closePostgresPool, withPgTransaction } from "../app/utils/server/postgres";

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
  "model_catalog",
  "model_sync_runs",
  "user_model_refresh_states",
  "user_provider_balance_snapshots",
  "model_source_index_snapshots",
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

async function main() {
  const deletedRows: Record<string, number> = {};
  const preservedRows: Record<string, number> = {};

  await withPgTransaction(async (client) => {
    preservedRows.provider_configs = await getTableCount(client, "provider_configs");
    preservedRows.provider_api_keys = await getTableCount(client, "provider_api_keys");
    preservedRows.sync_secrets = await getTableCount(client, "sync_secrets");
    preservedRows.app_users = await getTableCount(client, "app_users");

    for (const tableName of TABLES_TO_PURGE) {
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
