import { closePostgresPool, pgQuery } from "../app/utils/server/postgres";

async function main() {
  const sessionExistsResult = await pgQuery<{ exists: boolean }>(
    `select exists (
       select 1
       from information_schema.tables
       where table_schema = 'public'
         and table_name = 'user_chat_state_sessions'
     ) as exists`,
  );
  const indexExistsResult = await pgQuery<{ exists: boolean }>(
    `select exists (
       select 1
       from information_schema.tables
       where table_schema = 'public'
         and table_name = 'user_chat_state_indexes'
     ) as exists`,
  );
  if (
    sessionExistsResult.rows[0]?.exists !== true &&
    indexExistsResult.rows[0]?.exists !== true
  ) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: "legacy_chat_state_tables_not_found",
        },
        null,
        2,
      ),
    );
    return;
  }

  const sessionCountResult =
    sessionExistsResult.rows[0]?.exists === true
      ? await pgQuery<{ count: string }>(
          `select count(*)::text as count
           from user_chat_state_sessions`,
        )
      : { rows: [{ count: "0" }] };
  const indexCountResult =
    indexExistsResult.rows[0]?.exists === true
      ? await pgQuery<{ count: string }>(
          `select count(*)::text as count
           from user_chat_state_indexes`,
        )
      : { rows: [{ count: "0" }] };

  await pgQuery(`drop table if exists user_chat_state_sessions`);
  await pgQuery(`drop table if exists user_chat_state_indexes`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        droppedTables: [
          "user_chat_state_sessions",
          "user_chat_state_indexes",
        ],
        deletedLegacySessionRows: Number(sessionCountResult.rows[0]?.count || 0),
        deletedLegacyIndexRows: Number(indexCountResult.rows[0]?.count || 0),
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
