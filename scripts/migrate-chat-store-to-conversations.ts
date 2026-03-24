import { closePostgresPool, ensureSyncStorageSchema, pgQuery, withPgTransaction } from "../app/utils/server/postgres";
import { syncNormalizedChatSessions } from "../app/utils/server/chat-conversation-repository";

type ChatIndexRow = {
  user_id: string;
  payload_json: {
    sessions?: Array<{ id?: string }>;
    [key: string]: unknown;
  };
};

type ChatSessionRow = {
  session_id: string;
  payload_json: Record<string, unknown>;
};

async function hasLegacySessionTable() {
  const result = await pgQuery<{ exists: boolean }>(
    `select exists (
       select 1
       from information_schema.tables
       where table_schema = 'public'
         and table_name = 'user_chat_state_sessions'
     ) as exists`,
  );
  return result.rows[0]?.exists === true;
}

async function migrateUser(userId: string) {
  const indexResult = await pgQuery<ChatIndexRow>(
    `select user_id, payload_json
     from user_chat_state_indexes
     where user_id = $1
     limit 1`,
    [userId],
  );
  const index = indexResult.rows[0]?.payload_json;
  if (!index) {
    return {
      userId,
      migratedSessions: 0,
      skipped: true,
    };
  }

  const sessionResult = await pgQuery<ChatSessionRow>(
    `select session_id, payload_json
     from user_chat_state_sessions
     where user_id = $1
     order by updated_at asc`,
    [userId],
  );

  await withPgTransaction(async (client) => {
    await syncNormalizedChatSessions(client, {
      externalUserId: userId,
      index: index as any,
      upsertSessions: sessionResult.rows.map((row) => row.payload_json),
      deleteSessionIds: [],
    });
  });

  return {
    userId,
    migratedSessions: sessionResult.rows.length,
    skipped: false,
  };
}

async function main() {
  await ensureSyncStorageSchema();
  if (!(await hasLegacySessionTable())) {
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
  const userResult = await pgQuery<{ user_id: string }>(
    `select distinct user_id
     from user_chat_state_indexes
     order by user_id asc`,
  );

  const reports = [];
  for (const row of userResult.rows) {
    reports.push(await migrateUser(row.user_id));
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        users: reports.length,
        reports,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("[migrate-chat-store-to-conversations] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool().catch(() => {});
  });
