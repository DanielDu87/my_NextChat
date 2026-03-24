import { ensureSyncStorageSchema, pgQuery } from "./postgres";

export async function getLatestModelRefreshState(userId: string) {
  await ensureSyncStorageSchema();
  const result = await pgQuery<{ payload_json: unknown; updated_at: string }>(
    `select payload_json, updated_at::text as updated_at
     from user_model_refresh_states
     where user_id = $1 and refresh_key = 'latest'
     limit 1`,
    [userId],
  );

  return result.rows[0] || null;
}

export async function setLatestModelRefreshState(
  userId: string,
  payload: unknown,
) {
  await ensureSyncStorageSchema();
  await pgQuery(
    `insert into user_model_refresh_states (user_id, refresh_key, payload_json)
     values ($1, 'latest', $2::jsonb)
     on conflict (user_id, refresh_key) do update set
       payload_json = excluded.payload_json,
       updated_at = now()`,
    [userId, JSON.stringify(payload ?? {})],
  );
}

export async function removeLatestModelRefreshState(userId: string) {
  await ensureSyncStorageSchema();
  await pgQuery(
    `delete from user_model_refresh_states
     where user_id = $1 and refresh_key = 'latest'`,
    [userId],
  );
}
