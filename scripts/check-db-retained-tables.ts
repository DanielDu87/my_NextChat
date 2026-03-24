import { closePostgresPool, pgQuery } from "../app/utils/server/postgres";

async function main() {
  const tables = await pgQuery<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );
  const tableNames = new Set(tables.rows.map((row) => row.tablename));

  const countIfExists = (tableName: string) => {
    if (!tableNames.has(tableName)) {
      return "null";
    }
    return `(select count(*) from ${tableName})`;
  };

  const counts = await pgQuery<{ data: unknown }>(`
    select json_build_object(
      'app_users', ${countIfExists("app_users")},
      'provider_configs', ${countIfExists("provider_configs")},
      'provider_api_keys', ${countIfExists("provider_api_keys")},
      'sync_secrets', ${countIfExists("sync_secrets")},
      'app_settings', ${countIfExists("app_settings")},
      'app_store_states', ${countIfExists("app_store_states")},
      'audit_logs', ${countIfExists("audit_logs")},
      'auth_accounts', ${countIfExists("auth_accounts")},
      'auth_sessions', ${countIfExists("auth_sessions")},
      'chat_masks', ${countIfExists("chat_masks")},
      'conversations', ${countIfExists("conversations")},
      'messages', ${countIfExists("messages")},
      'message_attachments', ${countIfExists("message_attachments")},
      'tags', ${countIfExists("tags")},
      'share_links', ${countIfExists("share_links")},
      'model_catalog', ${countIfExists("model_catalog")},
      'model_aliases', ${countIfExists("model_aliases")},
      'model_sync_cache', ${countIfExists("model_sync_cache")},
      'model_sync_runs', ${countIfExists("model_sync_runs")},
      'model_unmatched', ${countIfExists("model_unmatched")},
      'prompt_templates', ${countIfExists("prompt_templates")},
      'user_model_refresh_states', ${countIfExists("user_model_refresh_states")},
      'user_provider_balance_snapshots', ${countIfExists("user_provider_balance_snapshots")},
      'model_source_index_snapshots', ${countIfExists("model_source_index_snapshots")},
      'usage_logs', ${countIfExists("usage_logs")}
    ) as data
  `);

  console.log(
    JSON.stringify(
      {
        tables: tables.rows.map((row) => row.tablename),
        counts: counts.rows[0]?.data ?? {},
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
