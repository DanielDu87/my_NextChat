import { closePostgresPool, pgQuery } from "../app/utils/server/postgres";

async function main() {
  const existsResult = await pgQuery<{ exists: boolean }>(
    `select exists (
       select 1
       from information_schema.tables
       where table_schema = 'public'
         and table_name = 'user_chat_state_sessions'
     ) as exists`,
  );
  if (existsResult.rows[0]?.exists !== true) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: "legacy_user_chat_state_sessions_not_found",
        },
        null,
        2,
      ),
    );
    return;
  }

  const countResult = await pgQuery<{ count: string }>(
    `select count(*)::text as count
     from user_chat_state_sessions`,
  );
  const legacyRows = Number(countResult.rows[0]?.count || 0);

  await pgQuery(`drop table if exists user_chat_state_sessions`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        droppedTable: "user_chat_state_sessions",
        deletedLegacySessionRows: legacyRows,
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
