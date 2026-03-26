import { createHash } from "crypto";
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
import { dedupeDeleteSessionIds } from "@/app/utils/server/sync-store-helpers";
import {
  buildNormalizedChatIndexSnapshot,
  getNormalizedChatSessionSnapshots,
  syncNormalizedChatSessions,
} from "./chat-conversation-repository";
import {
  getChatIndexState,
  getAppSettingsStore,
  removeChatIndexState,
  syncAppSettingsStore,
} from "./app-settings-repository";
import {
  mergeAccessStorePayload,
  stripAccessStoreProfiles,
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
      return existing ? { ...existing, ...profile } : profile;
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

export function isSupportedStoreKey(storeKey: string) {
  return SUPPORTED_STORE_KEYS.has(storeKey);
}

export async function getChatIndexSnapshot(userId = getDefaultSyncUserId()) {
  const chatIndexState = await getChatIndexState(userId);
  const normalizedIndex = await buildNormalizedChatIndexSnapshot(
    userId,
    chatIndexState &&
      typeof chatIndexState === "object" &&
      !Array.isArray(chatIndexState)
      ? (chatIndexState as Record<string, unknown>)
      : undefined,
  );
  return normalizedIndex;
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

  const normalizedSessionMap = await getNormalizedChatSessionSnapshots(
    normalizedIds,
    userId,
  );
  return normalizedSessionMap;
}

export async function getFullChatStateSnapshot(
  userId = getDefaultSyncUserId(),
) {
  const chatIndex = await getChatIndexSnapshot(userId);
  if (!chatIndex) {
    return undefined;
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

  if (storeKey !== StoreKey.Access) {
    return payload;
  }

  const secretPayload = await getEncryptedSyncSecret({
    userId,
    secretKey: storeKey,
  });
  const mergedPayload = mergeAccessStorePayload(
    payload ?? { state: {} },
    secretPayload,
  );
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
    const payload = await getStoreSnapshot(StoreKey.Chat, userId);
    if (payload !== undefined) {
      const updatedResult = await pgQuery<{ updated_at: string | null }>(
        `select max(updated_at)::text as updated_at
         from (
           select updated_at
           from app_settings
           where user_id = (select id from app_users where external_id = $1 limit 1)
             and chat_settings ? '__chat-index-state__'
           union all
           select updated_at
           from conversations
           where user_id = (select id from app_users where external_id = $1 limit 1)
         ) chat_updates`,
        [userId],
      );
      const payloadText = JSON.stringify(payload);
      metas.push({
        key: StoreKey.Chat,
        updatedAt:
          updatedResult.rows[0]?.updated_at || new Date(0).toISOString(),
        checksum: createHash("md5").update(payloadText).digest("hex"),
        sizeBytes: Buffer.byteLength(payloadText, "utf8"),
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
  const nextMetas = metas.concat(
    result.rows
      .filter((row) => row.store_key !== StoreKey.Access)
      .map((row) => ({
        key: row.store_key,
        updatedAt: row.updated_at,
        checksum: row.checksum,
        sizeBytes: row.size_bytes,
      })),
  );

  if (nonChatKeys.includes(StoreKey.Access)) {
    const accessSnapshot = await getStoreSnapshot(StoreKey.Access, userId);
    if (accessSnapshot !== undefined) {
      const updatedResult = await pgQuery<{ updated_at: string | null }>(
        `select max(updated_at)::text as updated_at
         from (
           select updated_at
           from app_settings
           where user_id = (select id from app_users where external_id = $1 limit 1)
             and security_settings ? 'access-control'
           union all
           select updated_at
           from provider_configs
           where user_id = (select id from app_users where external_id = $1 limit 1)
           union all
           select pak.updated_at
           from provider_api_keys pak
           join provider_configs pc on pc.id = pak.provider_config_id
           where pc.user_id = (select id from app_users where external_id = $1 limit 1)
           union all
           select updated_at
           from sync_secrets
           where user_id = $1
             and secret_key = 'access-control'
         ) access_updates`,
        [userId],
      );
      const payloadText = JSON.stringify(accessSnapshot);
      nextMetas.push({
        key: StoreKey.Access,
        updatedAt:
          updatedResult.rows[0]?.updated_at || new Date(0).toISOString(),
        checksum: createHash("md5").update(payloadText).digest("hex"),
        sizeBytes: Buffer.byteLength(payloadText, "utf8"),
      });
    }
  }

  return nextMetas;
}

export async function getStoreSnapshotMeta(
  storeKey: string,
  userId = getDefaultSyncUserId(),
) {
  const metas = await getStoreSnapshotMetas([storeKey], userId);
  return metas[0];
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

  await withPgTransaction(async (client) => {
    await syncNormalizedChatSessions(client, {
      externalUserId: userId,
      index: params.index,
      upsertSessions: params.upsertSessions,
      deleteSessionIds,
    });
    await client.query(
      `insert into app_settings (
         user_id,
         chat_settings
       ) values (
         (select id from app_users where external_id = $1 limit 1),
         jsonb_build_object($2::text, $3::jsonb)
       )
       on conflict (user_id) do update set
         chat_settings = coalesce(app_settings.chat_settings, '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb),
         updated_at = now()`,
      [
        userId,
        "__chat-index-state__",
        JSON.stringify(params.index.state ?? {}),
      ],
    );
  });
}

export async function setFullChatStateSnapshot(
  payload: unknown,
  userId = getDefaultSyncUserId(),
) {
  const chatState = normalizeChatStorePayload(payload);
  const sessions = Array.isArray(chatState?.sessions) ? chatState.sessions : [];

  await applyChatDelta({
    userId,
    index: buildChatIndexPayload(chatState),
    upsertSessions: sessions,
    deleteSessionIds: [],
  });
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
    nextPayload = stripAccessStoreProfiles(publicPayload);
    await withPgTransaction(async (client) => {
      const runQuery = client.query.bind(client);
      await setEncryptedSyncSecret(
        {
          userId,
          secretKey: storeKey,
          payload: secretPayload,
        },
        runQuery,
      );
      await syncProviderConfigsFromAccessState(userId, payload, client as any);
      await syncAppSettingsStore(userId, storeKey, nextPayload, runQuery);
    });
    return;
  }

  await syncAppSettingsStore(userId, storeKey, nextPayload);
}

export async function removeFullChatStateSnapshot(
  userId = getDefaultSyncUserId(),
) {
  await ensureSyncStorageSchema();
  await removeChatIndexState(userId);
  await pgQuery(
    `delete from conversations
     where user_id = (select id from app_users where external_id = $1 limit 1)`,
    [userId],
  );
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
