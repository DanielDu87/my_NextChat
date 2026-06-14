import { StoreKey } from "@/app/constant";
import { ensureSyncStorageSchema, pgQuery } from "./postgres";
import { getOrCreateSyncAppUserId } from "./sync-app-user";

type QueryFn = (text: string, params?: unknown[]) => Promise<unknown>;

type SettingsColumn =
  | "chat_settings"
  | "plugin_settings"
  | "security_settings"
  | "extra_settings";

const STORE_COLUMN_MAP: Partial<Record<string, SettingsColumn>> = {
  [StoreKey.Plugin]: "plugin_settings",
  [StoreKey.Access]: "security_settings",
  [StoreKey.Config]: "extra_settings",
  [StoreKey.Prompt]: "extra_settings",
  [StoreKey.Update]: "extra_settings",
  [StoreKey.DrawList]: "extra_settings",
};

function getSettingsColumn(storeKey: string) {
  return STORE_COLUMN_MAP[normalizeStoreKey(storeKey)];
}

function normalizeStoreKey(storeKey: string) {
  return storeKey === "sd-list" ? StoreKey.DrawList : storeKey;
}

function getLegacyStoreKey(storeKey: string) {
  return storeKey === StoreKey.DrawList ? "sd-list" : undefined;
}

function toJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function normalizeChatIndexStatePayload(payload: unknown) {
  if (typeof payload !== "string") {
    return payload;
  }

  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

const CHAT_INDEX_STATE_KEY = "__chat-index-state__";

export async function syncAppSettingsStore(
  externalUserId: string,
  storeKey: string,
  payload: unknown,
  query?: QueryFn,
) {
  const normalizedStoreKey = normalizeStoreKey(storeKey);
  const legacyStoreKey = getLegacyStoreKey(normalizedStoreKey);
  const column = getSettingsColumn(normalizedStoreKey);
  if (!column) {
    return;
  }

  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const runQuery = query ?? pgQuery;

  if (legacyStoreKey) {
    await runQuery(
      `insert into app_settings (
         user_id,
         ${column}
       ) values (
         $1::uuid,
         jsonb_build_object($2::text, $3::jsonb)
       )
       on conflict (user_id) do update set
         ${column} = (coalesce(app_settings.${column}, '{}'::jsonb) - $4::text) || jsonb_build_object($2::text, $3::jsonb),
         updated_at = now()`,
      [userId, normalizedStoreKey, toJson(payload), legacyStoreKey],
    );
    return;
  }

  await runQuery(
    `insert into app_settings (
       user_id,
       ${column}
     ) values (
       $1::uuid,
       jsonb_build_object($2::text, $3::jsonb)
     )
     on conflict (user_id) do update set
       ${column} = coalesce(app_settings.${column}, '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb),
       updated_at = now()`,
    [userId, normalizedStoreKey, toJson(payload)],
  );
}

export async function getAppSettingsStore(
  externalUserId: string,
  storeKey: string,
) {
  const normalizedStoreKey = normalizeStoreKey(storeKey);
  const legacyStoreKey = getLegacyStoreKey(normalizedStoreKey);
  const column = getSettingsColumn(normalizedStoreKey);
  if (!column) {
    return undefined;
  }

  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = legacyStoreKey
    ? await pgQuery<{ payload_json: unknown }>(
        `select coalesce(${column} -> $2, ${column} -> $3) as payload_json
         from app_settings
         where user_id = $1::uuid
         limit 1`,
        [userId, normalizedStoreKey, legacyStoreKey],
      )
    : await pgQuery<{ payload_json: unknown }>(
        `select ${column} -> $2 as payload_json
         from app_settings
         where user_id = $1::uuid
         limit 1`,
        [userId, normalizedStoreKey],
      );

  return result.rows[0]?.payload_json;
}

export async function setChatIndexState(
  externalUserId: string,
  payload: unknown,
) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);

  await pgQuery(
    `insert into app_settings (
       user_id,
       chat_settings
     ) values (
       $1::uuid,
       jsonb_build_object($2::text, $3::jsonb)
     )
     on conflict (user_id) do update set
       chat_settings = coalesce(app_settings.chat_settings, '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb),
       updated_at = now()`,
    [userId, CHAT_INDEX_STATE_KEY, toJson(payload)],
  );
}

export async function getChatIndexState(externalUserId: string) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await pgQuery<{ payload_json: unknown }>(
    `select chat_settings -> $2 as payload_json
     from app_settings
     where user_id = $1::uuid
     limit 1`,
    [userId, CHAT_INDEX_STATE_KEY],
  );

  return normalizeChatIndexStatePayload(result.rows[0]?.payload_json);
}

export async function removeChatIndexState(externalUserId: string) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  await pgQuery(
    `update app_settings
     set chat_settings = coalesce(chat_settings, '{}'::jsonb) - $2::text,
         updated_at = now()
     where user_id = $1::uuid`,
    [userId, CHAT_INDEX_STATE_KEY],
  );
}
