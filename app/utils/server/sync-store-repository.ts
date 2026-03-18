import { SYNC_STORE_KEYS } from "@/app/utils/sync-store-keys";
import { pgQuery } from "./postgres";

const SUPPORTED_STORE_KEYS = new Set<string>(SYNC_STORE_KEYS);

function assertStoreKey(storeKey: string) {
  if (!SUPPORTED_STORE_KEYS.has(storeKey)) {
    throw new Error(`[DB Sync] 不支持的 store key: ${storeKey}`);
  }
}

export function isSupportedStoreKey(storeKey: string) {
  return SUPPORTED_STORE_KEYS.has(storeKey);
}

export async function getStoreSnapshot(storeKey: string) {
  assertStoreKey(storeKey);

  const result = await pgQuery<{ payload_json: unknown }>(
    `select payload_json
     from sync_artifacts
     where artifact_type = 'store_state' and artifact_path = $1
     limit 1`,
    [storeKey],
  );

  return result.rows[0]?.payload_json;
}

export async function setStoreSnapshot(storeKey: string, payload: unknown) {
  assertStoreKey(storeKey);

  await pgQuery(
    `insert into sync_artifacts (artifact_type, artifact_path, payload_json)
     values ('store_state', $1, $2::jsonb)
     on conflict (artifact_type, artifact_path) do update set
       payload_json = excluded.payload_json,
       updated_at = now()`,
    [storeKey, JSON.stringify(payload)],
  );
}
