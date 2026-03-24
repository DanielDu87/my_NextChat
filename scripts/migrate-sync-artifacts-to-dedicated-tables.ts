import { closePostgresPool, pgQuery } from "../app/utils/server/postgres";
import {
  setFullChatStateSnapshot,
  setStoreSnapshot,
} from "../app/utils/server/sync-store-repository";
import { setLatestModelRefreshState } from "../app/utils/server/model-refresh-state-repository";
import { setProviderBalanceSnapshot } from "../app/utils/server/provider-balance-repository";
import { setModelSourceIndexSnapshot } from "../app/utils/server/model-source-index-repository";

type LegacyRow = {
  user_id?: string | null;
  artifact_type: string;
  artifact_path: string;
  payload_json: unknown;
};

function normalizeUserId(row: LegacyRow) {
  const normalized = String(row.user_id || "").trim();
  return normalized.length > 0 ? normalized : null;
}

async function hasLegacyTable() {
  const result = await pgQuery<{ exists: boolean }>(
    `select exists (
       select 1
       from information_schema.tables
       where table_schema = 'public'
         and table_name = 'sync_artifacts'
     ) as exists`,
  );
  return result.rows[0]?.exists === true;
}

async function main() {
  if (!(await hasLegacyTable())) {
    console.log(
      JSON.stringify(
        { ok: true, skipped: true, reason: "sync_artifacts_not_found" },
        null,
        2,
      ),
    );
    return;
  }

  const rowsResult = await pgQuery<LegacyRow>(
    `select
       user_id,
       artifact_type,
       artifact_path,
       payload_json
     from sync_artifacts
     order by artifact_type, artifact_path`,
  );

  const legacyRows = rowsResult.rows;
  const migrated: Record<string, number> = {};

  const chatByUser = new Map<
    string,
    {
      index?: Record<string, unknown>;
      sessions: Record<string, unknown>[];
    }
  >();

  for (const row of legacyRows) {
    const userId = normalizeUserId(row);
    if (!userId) {
      migrated.skipped_missing_user_id =
        (migrated.skipped_missing_user_id || 0) + 1;
      continue;
    }

    if (row.artifact_type === "chat_index") {
      const entry = chatByUser.get(userId) || { sessions: [] };
      entry.index = (row.payload_json || {}) as Record<string, unknown>;
      chatByUser.set(userId, entry);
      migrated.chat_index = (migrated.chat_index || 0) + 1;
      continue;
    }

    if (row.artifact_type === "chat_session") {
      const entry = chatByUser.get(userId) || { sessions: [] };
      entry.sessions.push({
        ...(row.payload_json as Record<string, unknown>),
        id: row.artifact_path,
      });
      chatByUser.set(userId, entry);
      migrated.chat_session = (migrated.chat_session || 0) + 1;
      continue;
    }

    if (row.artifact_type === "store_state") {
      await setStoreSnapshot(row.artifact_path, row.payload_json, userId);
      migrated[`store:${row.artifact_path}`] =
        (migrated[`store:${row.artifact_path}`] || 0) + 1;
      continue;
    }

    if (
      row.artifact_type === "provider_model_refresh" &&
      row.artifact_path === "latest"
    ) {
      await setLatestModelRefreshState(userId, row.payload_json);
      migrated.model_refresh = (migrated.model_refresh || 0) + 1;
      continue;
    }

    if (row.artifact_type === "provider_balance") {
      await setProviderBalanceSnapshot(userId, row.artifact_path, row.payload_json);
      migrated.provider_balance = (migrated.provider_balance || 0) + 1;
      continue;
    }

    if (row.artifact_type === "models_index") {
      await setModelSourceIndexSnapshot(row.artifact_path, row.payload_json);
      migrated.models_index = (migrated.models_index || 0) + 1;
      continue;
    }

    migrated.skipped = (migrated.skipped || 0) + 1;
  }

  for (const [userId, chat] of chatByUser.entries()) {
    const indexPayload = chat.index || {};
    const chatState = {
      ...(indexPayload.state && typeof indexPayload.state === "object"
        ? (indexPayload.state as Record<string, unknown>)
        : {}),
      currentSessionIndex: 0,
      sessions: chat.sessions,
    };
    await setFullChatStateSnapshot(chatState, userId);
  }

  await pgQuery(`drop table if exists sync_artifacts`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        migratedRows: legacyRows.length,
        categories: migrated,
        migratedUsers: chatByUser.size,
        droppedTable: "sync_artifacts",
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
    await closePostgresPool();
  });
