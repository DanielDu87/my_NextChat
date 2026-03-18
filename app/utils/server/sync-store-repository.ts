import { StoreKey } from "@/app/constant";
import {
  buildChatIndexPayload,
  buildChatStateFromIndex,
  getSyncableChatSessions,
  type ChatIndexPayload,
} from "@/app/utils/chat-sync";
import {
  buildPersistedStoreState,
  PERSIST_STORE_KEYS,
  unwrapPersistedStoreState,
} from "@/app/utils/sync-store-keys";
import { withPgTransaction } from "./postgres";
import { pgQuery } from "./postgres";

const SUPPORTED_STORE_KEYS = new Set<string>(PERSIST_STORE_KEYS);
const STORE_STATE_ARTIFACT_TYPE = "store_state";
const CHAT_INDEX_ARTIFACT_TYPE = "chat_index";
const CHAT_SESSION_ARTIFACT_TYPE = "chat_session";

function assertStoreKey(storeKey: string) {
  if (!SUPPORTED_STORE_KEYS.has(storeKey)) {
    throw new Error(`[DB Sync] 不支持的 store key: ${storeKey}`);
  }
}

function sanitizeJsonPayload(payload: unknown) {
  return JSON.stringify(payload, (_, value) => {
    if (typeof value === "string") {
      return value.replace(/\u0000/g, "");
    }

    return value;
  });
}

function normalizeChatStorePayload(payload: unknown) {
  const unwrapped = unwrapPersistedStoreState(payload) as Record<
    string,
    unknown
  >;

  if (Array.isArray(unwrapped)) {
    return {
      sessions: unwrapped,
      currentSessionIndex: 0,
    };
  }

  return unwrapped;
}

async function getLegacyChatStoreState() {
  const result = await pgQuery<{ payload_json: unknown }>(
    `select payload_json
     from sync_artifacts
     where artifact_type = $2 and artifact_path = $1
     limit 1`,
    [StoreKey.Chat, STORE_STATE_ARTIFACT_TYPE],
  );

  const payload = result.rows[0]?.payload_json;
  if (!payload) {
    return undefined;
  }

  return normalizeChatStorePayload(payload);
}

export function isSupportedStoreKey(storeKey: string) {
  return SUPPORTED_STORE_KEYS.has(storeKey);
}

export async function getChatIndexSnapshot() {
  const result = await pgQuery<{ payload_json: unknown }>(
    `select payload_json
     from sync_artifacts
     where artifact_type = $2 and artifact_path = $1
     limit 1`,
    [StoreKey.Chat, CHAT_INDEX_ARTIFACT_TYPE],
  );

  const payload = result.rows[0]?.payload_json;
  if (payload) {
    return payload as ChatIndexPayload;
  }

  const legacyChatState = await getLegacyChatStoreState();
  return legacyChatState ? buildChatIndexPayload(legacyChatState) : undefined;
}

export async function getChatSessionSnapshots(sessionIds: string[]) {
  const normalizedIds = [...new Set(sessionIds.filter(Boolean))];
  if (normalizedIds.length === 0) {
    return {} as Record<string, unknown>;
  }

  const result = await pgQuery<{
    artifact_path: string;
    payload_json: unknown;
  }>(
    `select artifact_path, payload_json
     from sync_artifacts
     where artifact_type = $2 and artifact_path = any($1::text[])`,
    [normalizedIds, CHAT_SESSION_ARTIFACT_TYPE],
  );

  const sessionMap = Object.fromEntries(
    result.rows.map((row) => [row.artifact_path, row.payload_json]),
  ) as Record<string, unknown>;

  if (Object.keys(sessionMap).length === normalizedIds.length) {
    return sessionMap;
  }

  const legacyChatState = await getLegacyChatStoreState();
  const legacySessions: Array<Record<string, unknown>> = Array.isArray(
    legacyChatState?.sessions,
  )
    ? (legacyChatState?.sessions as Array<Record<string, unknown>>)
    : [];

  legacySessions.forEach((session) => {
    const sessionId = String(session?.id || "");
    if (
      !sessionId ||
      sessionMap[sessionId] ||
      !normalizedIds.includes(sessionId)
    ) {
      return;
    }

    sessionMap[sessionId] = session;
  });

  return sessionMap;
}

export async function getFullChatStateSnapshot() {
  const chatIndex = await getChatIndexSnapshot();
  if (!chatIndex) {
    const legacyChatState = await getLegacyChatStoreState();
    return legacyChatState
      ? buildPersistedStoreState(StoreKey.Chat, legacyChatState)
      : undefined;
  }

  const sessionMap = await getChatSessionSnapshots(
    chatIndex.sessions.map((entry) => entry.id),
  );
  const chatState = buildChatStateFromIndex(chatIndex, sessionMap);
  return buildPersistedStoreState(StoreKey.Chat, chatState);
}

export async function getStoreSnapshot(storeKey: string) {
  assertStoreKey(storeKey);

  if (storeKey === StoreKey.Chat) {
    return getFullChatStateSnapshot();
  }

  const result = await pgQuery<{ payload_json: unknown }>(
    `select payload_json
     from sync_artifacts
     where artifact_type = $2 and artifact_path = $1
     limit 1`,
    [storeKey, STORE_STATE_ARTIFACT_TYPE],
  );

  return result.rows[0]?.payload_json;
}

export async function getStoreSnapshotMetas(
  storeKeys: string[] = PERSIST_STORE_KEYS as unknown as string[],
) {
  const normalizedStoreKeys = storeKeys.filter((key) =>
    SUPPORTED_STORE_KEYS.has(key),
  );
  if (normalizedStoreKeys.length === 0) {
    return [];
  }

  const metas: Array<{
    key: string;
    updatedAt: string;
    checksum: string;
    sizeBytes: number;
  }> = [];

  if (normalizedStoreKeys.includes(StoreKey.Chat)) {
    const result = await pgQuery<{
      updated_at: string;
      checksum: string;
      size_bytes: number;
    }>(
      `select
         updated_at::text as updated_at,
         md5(payload_json::text) as checksum,
         pg_column_size(payload_json) as size_bytes
       from sync_artifacts
       where (artifact_type = $1 and artifact_path = $2)
          or (artifact_type = $3 and artifact_path = $2)
       order by case when artifact_type = $1 then 0 else 1 end
       limit 1`,
      [CHAT_INDEX_ARTIFACT_TYPE, StoreKey.Chat, STORE_STATE_ARTIFACT_TYPE],
    );

    const row = result.rows[0];
    if (row) {
      metas.push({
        key: StoreKey.Chat,
        updatedAt: row.updated_at,
        checksum: row.checksum,
        sizeBytes: row.size_bytes,
      });
    }
  }

  const nonChatKeys = normalizedStoreKeys.filter(
    (key) => key !== StoreKey.Chat,
  );
  if (nonChatKeys.length === 0) {
    return metas;
  }

  const result = await pgQuery<{
    artifact_path: string;
    updated_at: string;
    checksum: string;
    size_bytes: number;
  }>(
    `select
       artifact_path,
       updated_at::text as updated_at,
       md5(payload_json::text) as checksum,
       pg_column_size(payload_json) as size_bytes
     from sync_artifacts
     where artifact_type = $2
       and artifact_path = any($1::text[])
     order by artifact_path`,
    [nonChatKeys, STORE_STATE_ARTIFACT_TYPE],
  );

  return metas.concat(
    result.rows.map((row) => ({
      key: row.artifact_path,
      updatedAt: row.updated_at,
      checksum: row.checksum,
      sizeBytes: row.size_bytes,
    })),
  );
}

export async function applyChatDelta(params: {
  index: ChatIndexPayload;
  upsertSessions: Array<Record<string, unknown>>;
  deleteSessionIds?: string[];
}) {
  const deleteSessionIds = [
    ...new Set((params.deleteSessionIds || []).filter(Boolean)),
  ];

  await withPgTransaction(async (client) => {
    await client.query(
      `insert into sync_artifacts (artifact_type, artifact_path, payload_json)
       values ($1, $2, $3::jsonb)
       on conflict (artifact_type, artifact_path) do update set
         payload_json = excluded.payload_json,
         updated_at = now()`,
      [
        CHAT_INDEX_ARTIFACT_TYPE,
        StoreKey.Chat,
        sanitizeJsonPayload(params.index),
      ],
    );

    for (const session of params.upsertSessions) {
      const sessionId = String(session.id || "");
      if (!sessionId) {
        continue;
      }

      await client.query(
        `insert into sync_artifacts (artifact_type, artifact_path, payload_json)
         values ($1, $2, $3::jsonb)
         on conflict (artifact_type, artifact_path) do update set
           payload_json = excluded.payload_json,
           updated_at = now()`,
        [CHAT_SESSION_ARTIFACT_TYPE, sessionId, sanitizeJsonPayload(session)],
      );
    }

    if (deleteSessionIds.length > 0) {
      await client.query(
        `delete from sync_artifacts
         where artifact_type = $2 and artifact_path = any($1::text[])`,
        [deleteSessionIds, CHAT_SESSION_ARTIFACT_TYPE],
      );
    }

    await client.query(
      `delete from sync_artifacts
       where artifact_type = $2 and artifact_path = $1`,
      [StoreKey.Chat, STORE_STATE_ARTIFACT_TYPE],
    );
  });
}

export async function setFullChatStateSnapshot(payload: unknown) {
  const chatState = normalizeChatStorePayload(payload);
  const sessions = getSyncableChatSessions(
    Array.isArray(chatState?.sessions) ? chatState.sessions : [],
  );
  const sessionIds = sessions
    .map((session) => String(session?.id || ""))
    .filter(Boolean);

  await applyChatDelta({
    index: buildChatIndexPayload(chatState),
    upsertSessions: sessions,
    deleteSessionIds: [],
  });

  await pgQuery(
    `delete from sync_artifacts
     where artifact_type = $2
       and artifact_path <> all($1::text[])`,
    [sessionIds, CHAT_SESSION_ARTIFACT_TYPE],
  );
}

export async function setStoreSnapshot(storeKey: string, payload: unknown) {
  assertStoreKey(storeKey);

  if (storeKey === StoreKey.Chat) {
    await setFullChatStateSnapshot(payload);
    return;
  }

  await pgQuery(
    `insert into sync_artifacts (artifact_type, artifact_path, payload_json)
     values ($3, $1, $2::jsonb)
     on conflict (artifact_type, artifact_path) do update set
       payload_json = excluded.payload_json,
       updated_at = now()`,
    [storeKey, sanitizeJsonPayload(payload), STORE_STATE_ARTIFACT_TYPE],
  );
}

export async function removeFullChatStateSnapshot() {
  await pgQuery(
    `delete from sync_artifacts
     where (artifact_type = $1 and artifact_path = $2)
        or artifact_type = $3
        or (artifact_type = $4 and artifact_path = $2)`,
    [
      CHAT_INDEX_ARTIFACT_TYPE,
      StoreKey.Chat,
      CHAT_SESSION_ARTIFACT_TYPE,
      STORE_STATE_ARTIFACT_TYPE,
    ],
  );
}

export async function removeStoreSnapshot(storeKey: string) {
  assertStoreKey(storeKey);

  if (storeKey === StoreKey.Chat) {
    await removeFullChatStateSnapshot();
    return;
  }

  await pgQuery(
    `delete from sync_artifacts
     where artifact_type = $2 and artifact_path = $1`,
    [storeKey, STORE_STATE_ARTIFACT_TYPE],
  );
}
