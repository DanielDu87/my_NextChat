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
  getLegacyDrawAppSettingsStore,
  removeChatIndexState,
  syncAppSettingsStore,
} from "./app-settings-repository";
import {
  getDrawStoreSnapshot,
  getDrawStoreSnapshotMeta,
  removeDrawStoreSnapshot,
  setDrawStoreSnapshot,
} from "./draw-store-repository";
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

function resolveStoreSnapshotUserId(storeKey: string, userId: string) {
  // 提示词是全站共享数据，任何调用路径都强制读写默认共享用户。
  return storeKey === StoreKey.Prompt ? getDefaultSyncUserId() : userId;
}

function assertStoreKey(storeKey: string) {
  if (!SUPPORTED_STORE_KEYS.has(storeKey)) {
    throw new Error(`[DB Sync] 不支持的 store key: ${storeKey}`);
  }
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
    .join(",")}}`;
}

function buildSnapshotMetaFromPayload(params: {
  key: string;
  updatedAt: string;
  payload: unknown;
}) {
  const payloadText = stableJsonStringify(params.payload);
  return {
    key: params.key,
    updatedAt: params.updatedAt,
    checksum: createHash("md5").update(payloadText).digest("hex"),
    sizeBytes: Buffer.byteLength(payloadText, "utf8"),
  };
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

function stripPersistedConfigModelFields(payload: unknown) {
  const unwrapped = unwrapPersistedStoreState(payload);
  if (!unwrapped || typeof unwrapped !== "object" || Array.isArray(unwrapped)) {
    return payload;
  }

  const { models, ...state } = unwrapped as Record<string, unknown>;
  void models;
  return buildPersistedStoreState(StoreKey.Config, state);
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
  const snapshotUserId = resolveStoreSnapshotUserId(storeKey, userId);

  if (storeKey === StoreKey.Chat) {
    return getFullChatStateSnapshot(snapshotUserId);
  }

  if (storeKey === StoreKey.DrawList) {
    const drawPayload = await getDrawStoreSnapshot(snapshotUserId);
    if (drawPayload !== undefined) {
      return drawPayload;
    }

    const legacyPayload = await getLegacyDrawAppSettingsStore(snapshotUserId);
    if (legacyPayload !== undefined) {
      await setDrawStoreSnapshot(snapshotUserId, legacyPayload);
      return legacyPayload;
    }

    return undefined;
  }

  const result = await pgQuery<{ payload_json: unknown }>(
    `select null::jsonb as payload_json where false`,
    [],
  );

  const payload = result.rows[0]?.payload_json;
  const settingsPayload = await getAppSettingsStore(snapshotUserId, storeKey);
  if (settingsPayload !== undefined) {
    if (storeKey !== StoreKey.Access) {
      return storeKey === StoreKey.Config
        ? stripPersistedConfigModelFields(settingsPayload)
        : settingsPayload;
    }

    const secretPayload = await getEncryptedSyncSecret({
      userId: snapshotUserId,
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
    return storeKey === StoreKey.Config
      ? stripPersistedConfigModelFields(payload)
      : payload;
  }

  const secretPayload = await getEncryptedSyncSecret({
    userId: snapshotUserId,
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
  const promptUserId = getDefaultSyncUserId();

  const metas: Array<{
    key: string;
    updatedAt: string;
    checksum: string;
    sizeBytes: number;
  }> = [];

  if (normalizedStoreKeys.includes(StoreKey.Chat)) {
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

    const updatedAt = updatedResult.rows[0]?.updated_at || "";
    if (updatedAt) {
      metas.push({
        key: StoreKey.Chat,
        updatedAt,
        checksum: createHash("md5").update(updatedAt).digest("hex"),
        sizeBytes: 0,
      });
    }
  }

  const nonChatKeys = normalizedStoreKeys.filter(
    (key) => key !== StoreKey.Chat,
  );
  if (nonChatKeys.length === 0) {
    return metas;
  }

  if (nonChatKeys.includes(StoreKey.DrawList)) {
    const drawMeta = await getDrawStoreSnapshotMeta(userId);
    if (drawMeta) {
      metas.push(drawMeta);
    }
  }

  const settingsStoreKeys = nonChatKeys.filter(
    (key) => key !== StoreKey.DrawList,
  );
  const result =
    settingsStoreKeys.length > 0
      ? await pgQuery<{
          store_key: string;
          updated_at: string;
          payload_json: unknown;
        }>(
          `select * from (
       select
         'chat-next-web-plugin'::text as store_key,
         updated_at::text as updated_at,
         plugin_settings -> 'chat-next-web-plugin' as payload_json
       from app_settings
       where user_id = (select id from app_users where external_id = $2 limit 1)
         and plugin_settings ? 'chat-next-web-plugin'
       union all
       select
         'access-control'::text,
         updated_at::text,
         security_settings -> 'access-control'
       from app_settings
       where user_id = (select id from app_users where external_id = $2 limit 1)
         and security_settings ? 'access-control'
       union all
       select
         'prompt-store'::text,
         updated_at::text,
         extra_settings -> 'prompt-store'
       from app_settings
       where user_id = (select id from app_users where external_id = $3 limit 1)
         and extra_settings ? 'prompt-store'
       union all
       select
         'chat-update'::text,
         updated_at::text,
         extra_settings -> 'chat-update'
       from app_settings
       where user_id = (select id from app_users where external_id = $2 limit 1)
         and extra_settings ? 'chat-update'
       union all
       select
         'app-config'::text,
         updated_at::text,
         extra_settings -> 'app-config'
       from app_settings
       where user_id = (select id from app_users where external_id = $2 limit 1)
         and extra_settings ? 'app-config'
     ) snapshots
     where store_key = any($1::text[])
     order by store_key`,
          [settingsStoreKeys, userId, promptUserId],
        )
      : { rows: [] };
  const nextMetas = metas.concat(
    result.rows
      .filter((row) => row.store_key !== StoreKey.Access)
      .map((row) =>
        buildSnapshotMetaFromPayload({
          key: row.store_key,
          updatedAt: row.updated_at,
          payload: row.payload_json,
        }),
      ),
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
      const updatedAt =
        updatedResult.rows[0]?.updated_at || new Date(0).toISOString();
      nextMetas.push(
        buildSnapshotMetaFromPayload({
          key: StoreKey.Access,
          updatedAt,
          payload: accessSnapshot,
        }),
      );
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
  const activeSessionIds = Array.isArray(params.index?.state?.sessionIds)
    ? (params.index.state.sessionIds as string[]).filter(Boolean)
    : [];

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

    // 清理孤儿会话：不在当前索引里、且消息数为 0 的会话，直接物理删除，避免数据库长期堆积空壳。
    if (activeSessionIds.length > 0) {
      await client.query(
        `delete from conversations
         where user_id = (select id from app_users where external_id = $1 limit 1)
           and external_session_id != all($2::text[])
           and not exists (
             select 1 from messages m where m.conversation_id = conversations.id
           )`,
        [userId, activeSessionIds],
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
  const snapshotUserId = resolveStoreSnapshotUserId(storeKey, userId);

  if (storeKey === StoreKey.Chat) {
    await setFullChatStateSnapshot(payload, snapshotUserId);
    return;
  }

  if (storeKey === StoreKey.DrawList) {
    await setDrawStoreSnapshot(snapshotUserId, payload);
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
          userId: snapshotUserId,
          secretKey: storeKey,
          payload: secretPayload,
        },
        runQuery,
      );
      await syncProviderConfigsFromAccessState(
        snapshotUserId,
        payload,
        client as any,
      );
      await syncAppSettingsStore(
        snapshotUserId,
        storeKey,
        nextPayload,
        runQuery,
      );
    });
    return;
  }

  if (storeKey === StoreKey.Config) {
    nextPayload = stripPersistedConfigModelFields(payload);
  }

  await syncAppSettingsStore(snapshotUserId, storeKey, nextPayload);
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
  const snapshotUserId = resolveStoreSnapshotUserId(storeKey, userId);

  if (storeKey === StoreKey.Chat) {
    await removeFullChatStateSnapshot(snapshotUserId);
    return;
  }

  if (storeKey === StoreKey.DrawList) {
    await removeDrawStoreSnapshot(snapshotUserId);
    return;
  }

  await syncAppSettingsStore(snapshotUserId, storeKey, null);
}
