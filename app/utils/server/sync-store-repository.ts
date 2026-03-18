import { PERSIST_STORE_KEYS } from "@/app/utils/sync-store-keys";
import { pgQuery } from "./postgres";

const SUPPORTED_STORE_KEYS = new Set<string>(PERSIST_STORE_KEYS);

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

export async function getStoreSnapshotMetas(
  storeKeys: string[] = PERSIST_STORE_KEYS as unknown as string[],
) {
  const normalizedStoreKeys = storeKeys.filter((key) =>
    SUPPORTED_STORE_KEYS.has(key),
  );
  if (normalizedStoreKeys.length === 0) {
    return [];
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
     where artifact_type = 'store_state'
       and artifact_path = any($1::text[])
     order by artifact_path`,
    [normalizedStoreKeys],
  );

  return result.rows.map((row) => ({
    key: row.artifact_path,
    updatedAt: row.updated_at,
    checksum: row.checksum,
    sizeBytes: row.size_bytes,
  }));
}

export async function setStoreSnapshot(storeKey: string, payload: unknown) {
  assertStoreKey(storeKey);

  const serializedPayload = JSON.stringify(payload, (_, value) => {
    if (typeof value === "string") {
      return value.replace(/\u0000/g, "");
    }

    return value;
  });

  await pgQuery(
    `insert into sync_artifacts (artifact_type, artifact_path, payload_json)
     values ('store_state', $1, $2::jsonb)
     on conflict (artifact_type, artifact_path) do update set
       payload_json = excluded.payload_json,
       updated_at = now()`,
    [storeKey, serializedPayload],
  );
}

export async function removeStoreSnapshot(storeKey: string) {
  assertStoreKey(storeKey);

  await pgQuery(
    `delete from sync_artifacts
     where artifact_type = 'store_state' and artifact_path = $1`,
    [storeKey],
  );
}
