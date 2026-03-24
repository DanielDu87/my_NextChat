import { ensureSyncStorageSchema, pgQuery } from "./postgres";

export async function setModelSourceIndexSnapshot(
  sourceKey: string,
  payload: unknown,
) {
  await ensureSyncStorageSchema();
  await pgQuery(
    `insert into model_source_index_snapshots (source_key, payload_json)
     values ($1, $2::jsonb)
     on conflict (source_key) do update set
       payload_json = excluded.payload_json,
       updated_at = now()`,
    [sourceKey, JSON.stringify(payload ?? {})],
  );
}
