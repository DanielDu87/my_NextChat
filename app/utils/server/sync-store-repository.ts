import { StoreKey } from "@/app/constant";
import {
  buildChatIndexPayload,
  buildChatStateFromIndex,
  type ChatIndexPayload,
} from "@/app/utils/chat-sync";
import {
  buildPersistedStoreState,
  PERSIST_STORE_KEYS,
  unwrapPersistedStoreState,
} from "@/app/utils/sync-store-keys";
import {
  buildChatSessionRows,
  dedupeDeleteSessionIds,
  sanitizeJsonPayload,
} from "@/app/utils/server/sync-store-helpers";
import {
  getAppSettingsStore,
  syncAppSettingsStore,
} from "./app-settings-repository";
import {
  mergeAccessStorePayload,
  splitAccessStorePayload,
} from "./access-store-security";
import {
  ensureSyncStorageSchema,
  pgQuery,
  withPgTransaction,
} from "./postgres";
import {
  getProviderProfilesForAccessState,
  syncProviderConfigsFromAccessState,
} from "./provider-config-repository";
import { getEncryptedSyncSecret, setEncryptedSyncSecret } from "./sync-secrets";
import { getDefaultSyncUserId } from "./sync-user";

const SUPPORTED_STORE_KEYS = new Set<string>(PERSIST_STORE_KEYS);
const STORE_STATE_ARTIFACT_TYPE = "store_state";
const CHAT_INDEX_ARTIFACT_TYPE = "chat_index";
const CHAT_SESSION_ARTIFACT_TYPE = "chat_session";

function assertStoreKey(storeKey: string) {
  if (!SUPPORTED_STORE_KEYS.has(storeKey)) {
    throw new Error(`[DB Sync] 不支持的 store key: ${storeKey}`);
  }
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

function mergeAccessProfilesIntoPayload(payload: unknown, profiles: unknown[]) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    profiles.length === 0
  ) {
    return payload;
  }

  const mergeProfiles = (currentProfiles: unknown) => {
    const localProfiles = Array.isArray(currentProfiles) ? currentProfiles : [];
    const localMap = new Map<string, Record<string, unknown>>();

    localProfiles.forEach((profile) => {
      if (
        profile &&
        typeof profile === "object" &&
        !Array.isArray(profile) &&
        "id" in profile
      ) {
        localMap.set(
          String(profile.id || ""),
          profile as Record<string, unknown>,
        );
      }
    });

    const merged = profiles.map((profile) => {
      if (
        !profile ||
        typeof profile !== "object" ||
        Array.isArray(profile) ||
        !("id" in profile)
      ) {
        return profile;
      }

      const existing = localMap.get(String(profile.id || ""));
      return existing ? { ...profile, ...existing } : profile;
    });

    localMap.forEach((profile, id) => {
      if (
        !merged.some(
          (item) =>
            item &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            "id" in item &&
            String(item.id || "") === id,
        )
      ) {
        merged.push(profile);
      }
    });

    return merged;
  };

  if (
    "state" in payload &&
    payload.state &&
    typeof payload.state === "object" &&
    !Array.isArray(payload.state)
  ) {
    return {
      ...payload,
      state: {
        ...(payload.state as Record<string, unknown>),
        apiProfiles: mergeProfiles(
          (payload.state as Record<string, unknown>).apiProfiles,
        ),
      },
    };
  }

  return {
    ...(payload as Record<string, unknown>),
    apiProfiles: mergeProfiles(
      (payload as Record<string, unknown>).apiProfiles,
    ),
  };
}

async function getLegacyChatStoreState(userId = getDefaultSyncUserId()) {
  await ensureSyncStorageSchema();
  const result = await pgQuery<{ payload_json: unknown }>(
    `select payload_json
     from user_chat_state_indexes
     where user_id = $1
     limit 1`,
    [userId],
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

export async function getChatIndexSnapshot(userId = getDefaultSyncUserId()) {
  await ensureSyncStorageSchema();
  const result = await pgQuery<{ payload_json: unknown }>(
    `select payload_json
     from user_chat_state_indexes
     where user_id = $1
     limit 1`,
    [userId],
  );

  const payload = result.rows[0]?.payload_json;
  if (payload) {
    return payload as ChatIndexPayload;
  }

  const legacyChatState = await getLegacyChatStoreState(userId);
  return legacyChatState ? buildChatIndexPayload(legacyChatState) : undefined;
}

export async function getChatSessionSnapshots(
  sessionIds: string[],
  userId = getDefaultSyncUserId(),
) {
  await ensureSyncStorageSchema();
  const normalizedIds = [...new Set(sessionIds.filter(Boolean))];
  if (normalizedIds.length === 0) {
    return {} as Record<string, unknown>;
  }

  const result = await pgQuery<{
    session_id: string;
    payload_json: unknown;
  }>(
    `select session_id, payload_json
     from user_chat_state_sessions
     where user_id = $2
       and session_id = any($1::text[])`,
    [normalizedIds, userId],
  );

  const sessionMap = Object.fromEntries(
    result.rows.map((row) => [row.session_id, row.payload_json]),
  ) as Record<string, unknown>;

  if (Object.keys(sessionMap).length === normalizedIds.length) {
    return sessionMap;
  }

  const legacyChatState = await getLegacyChatStoreState(userId);
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

export async function getFullChatStateSnapshot(
  userId = getDefaultSyncUserId(),
) {
  const chatIndex = await getChatIndexSnapshot(userId);
  if (!chatIndex) {
    const legacyChatState = await getLegacyChatStoreState(userId);
    return legacyChatState
      ? buildPersistedStoreState(StoreKey.Chat, legacyChatState)
      : undefined;
  }

  const sessionMap = await getChatSessionSnapshots(
    chatIndex.sessions.map((entry) => entry.id),
    userId,
  );
  const chatState = buildChatStateFromIndex(chatIndex, sessionMap);
  return buildPersistedStoreState(StoreKey.Chat, chatState);
}

export async function getStoreSnapshot(
  storeKey: string,
  userId = getDefaultSyncUserId(),
) {
  await ensureSyncStorageSchema();
  assertStoreKey(storeKey);

  if (storeKey === StoreKey.Chat) {
    return getFullChatStateSnapshot(userId);
  }

  const result = await pgQuery<{ payload_json: unknown }>(
    `select null::jsonb as payload_json where false`,
    [],
  );

  const payload = result.rows[0]?.payload_json;
  const settingsPayload = await getAppSettingsStore(userId, storeKey);
  if (settingsPayload !== undefined) {
    if (storeKey !== StoreKey.Access) {
      return settingsPayload;
    }

    const secretPayload = await getEncryptedSyncSecret({
      userId,
      secretKey: storeKey,
    });
    const mergedPayload = mergeAccessStorePayload(
      settingsPayload,
      secretPayload,
    );
    const providerProfiles = await getProviderProfilesForAccessState(userId);
    return mergeAccessProfilesIntoPayload(mergedPayload, providerProfiles);
  }

  if (storeKey !== StoreKey.Access || payload === undefined) {
    return payload;
  }

  const secretPayload = await getEncryptedSyncSecret({
    userId,
    secretKey: storeKey,
  });
  const mergedPayload = mergeAccessStorePayload(payload, secretPayload);
  const providerProfiles = await getProviderProfilesForAccessState(userId);
  return mergeAccessProfilesIntoPayload(mergedPayload, providerProfiles);
}

export async function getStoreSnapshotMetas(
  storeKeys: string[] = PERSIST_STORE_KEYS as unknown as string[],
  userId = getDefaultSyncUserId(),
) {
  await ensureSyncStorageSchema();
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
       from user_chat_state_indexes
       where user_id = $1
       limit 1`,
      [userId],
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
    store_key: string;
    updated_at: string;
    checksum: string;
    size_bytes: number;
  }>(
    `select * from (
       select
         'app-config'::text as store_key,
         updated_at::text as updated_at,
         md5((model_settings -> 'app-config')::text) as checksum,
         pg_column_size(model_settings -> 'app-config') as size_bytes
       from app_settings
       where user_id = (select id from app_users where external_id = $2 limit 1)
         and model_settings ? 'app-config'
       union all
       select
         'model-cache-store'::text,
         updated_at::text,
         md5((model_settings -> 'model-cache-store')::text),
         pg_column_size(model_settings -> 'model-cache-store')
       from app_settings
       where user_id = (select id from app_users where external_id = $2 limit 1)
         and model_settings ? 'model-cache-store'
       union all
       select
         'chat-next-web-plugin'::text,
         updated_at::text,
         md5((plugin_settings -> 'chat-next-web-plugin')::text),
         pg_column_size(plugin_settings -> 'chat-next-web-plugin')
       from app_settings
       where user_id = (select id from app_users where external_id = $2 limit 1)
         and plugin_settings ? 'chat-next-web-plugin'
       union all
       select
         'sync'::text,
         updated_at::text,
         md5((sync_settings -> 'sync')::text),
         pg_column_size(sync_settings -> 'sync')
       from app_settings
       where user_id = (select id from app_users where external_id = $2 limit 1)
         and sync_settings ? 'sync'
       union all
       select
         'access-control'::text,
         updated_at::text,
         md5((security_settings -> 'access-control')::text),
         pg_column_size(security_settings -> 'access-control')
       from app_settings
       where user_id = (select id from app_users where external_id = $2 limit 1)
         and security_settings ? 'access-control'
       union all
       select
         'mask-store'::text,
         updated_at::text,
         md5((extra_settings -> 'mask-store')::text),
         pg_column_size(extra_settings -> 'mask-store')
       from app_settings
       where user_id = (select id from app_users where external_id = $2 limit 1)
         and extra_settings ? 'mask-store'
       union all
       select
         'prompt-store'::text,
         updated_at::text,
         md5((extra_settings -> 'prompt-store')::text),
         pg_column_size(extra_settings -> 'prompt-store')
       from app_settings
       where user_id = (select id from app_users where external_id = $2 limit 1)
         and extra_settings ? 'prompt-store'
       union all
       select
         'chat-update'::text,
         updated_at::text,
         md5((extra_settings -> 'chat-update')::text),
         pg_column_size(extra_settings -> 'chat-update')
       from app_settings
       where user_id = (select id from app_users where external_id = $2 limit 1)
         and extra_settings ? 'chat-update'
       union all
       select
         'sd-list'::text,
         updated_at::text,
         md5((extra_settings -> 'sd-list')::text),
         pg_column_size(extra_settings -> 'sd-list')
       from app_settings
       where user_id = (select id from app_users where external_id = $2 limit 1)
         and extra_settings ? 'sd-list'
     ) snapshots
     where store_key = any($1::text[])
     order by store_key`,
    [nonChatKeys, userId],
  );

  return metas.concat(
    result.rows.map((row) => ({
      key: row.store_key,
      updatedAt: row.updated_at,
      checksum: row.checksum,
      sizeBytes: row.size_bytes,
    })),
  );
}

export async function applyChatDelta(params: {
  userId?: string;
  index: ChatIndexPayload;
  upsertSessions: Array<Record<string, unknown>>;
  deleteSessionIds?: string[];
}) {
  await ensureSyncStorageSchema();
  const userId = params.userId ?? getDefaultSyncUserId();
  const deleteSessionIds = dedupeDeleteSessionIds(params.deleteSessionIds);
  const sessionRows = buildChatSessionRows(params.upsertSessions);

  await withPgTransaction(async (client) => {
    await client.query(
      `insert into user_chat_state_indexes (user_id, payload_json)
       values ($1, $2::jsonb)
       on conflict (user_id) do update set
         payload_json = excluded.payload_json,
         updated_at = now()`,
      [userId, sanitizeJsonPayload(params.index)],
    );

    if (sessionRows.length > 0) {
      for (const row of sessionRows) {
        await client.query(
          `insert into user_chat_state_sessions (user_id, session_id, payload_json)
           values ($1, $2, $3::jsonb)
           on conflict (user_id, session_id) do update set
             payload_json = excluded.payload_json,
             updated_at = now()`,
          [userId, row.artifactPath, row.payloadText],
        );
      }
    }

    if (deleteSessionIds.length > 0) {
      await client.query(
        `delete from user_chat_state_sessions
         where user_id = $2
           and session_id = any($1::text[])`,
        [deleteSessionIds, userId],
      );
    }
  });
}

export async function setFullChatStateSnapshot(
  payload: unknown,
  userId = getDefaultSyncUserId(),
) {
  const chatState = normalizeChatStorePayload(payload);
  const sessions = Array.isArray(chatState?.sessions) ? chatState.sessions : [];
  const sessionIds = sessions
    .map((session) => String(session?.id || ""))
    .filter(Boolean);

  await applyChatDelta({
    userId,
    index: buildChatIndexPayload(chatState),
    upsertSessions: sessions,
    deleteSessionIds: [],
  });

  await pgQuery(
    `delete from user_chat_state_sessions
     where user_id = $2
       and session_id <> all($1::text[])`,
    [sessionIds, userId],
  );
}

export async function setStoreSnapshot(
  storeKey: string,
  payload: unknown,
  userId = getDefaultSyncUserId(),
) {
  await ensureSyncStorageSchema();
  assertStoreKey(storeKey);

  if (storeKey === StoreKey.Chat) {
    await setFullChatStateSnapshot(payload, userId);
    return;
  }

  let nextPayload = payload;
  if (storeKey === StoreKey.Access) {
    const { publicPayload, secretPayload } = splitAccessStorePayload(payload);
    nextPayload = publicPayload;
    await setEncryptedSyncSecret({
      userId,
      secretKey: storeKey,
      payload: secretPayload,
    });
    await syncProviderConfigsFromAccessState(userId, payload);
  }

  await syncAppSettingsStore(userId, storeKey, nextPayload);
}

export async function removeFullChatStateSnapshot(
  userId = getDefaultSyncUserId(),
) {
  await ensureSyncStorageSchema();
  await pgQuery(`delete from user_chat_state_indexes where user_id = $1`, [
    userId,
  ]);
  await pgQuery(`delete from user_chat_state_sessions where user_id = $1`, [
    userId,
  ]);
}

export async function removeStoreSnapshot(
  storeKey: string,
  userId = getDefaultSyncUserId(),
) {
  await ensureSyncStorageSchema();
  assertStoreKey(storeKey);

  if (storeKey === StoreKey.Chat) {
    await removeFullChatStateSnapshot(userId);
    return;
  }

  await syncAppSettingsStore(userId, storeKey, null);
}
