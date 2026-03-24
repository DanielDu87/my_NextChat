import { ensureSyncStorageSchema, pgQuery } from "./postgres";

export async function getProviderBalanceSnapshot(userId: string, key: string) {
  await ensureSyncStorageSchema();
  const result = await pgQuery<{ payload_json: unknown }>(
    `select payload_json
     from user_provider_balance_snapshots
     where user_id = $1 and balance_key = $2
     limit 1`,
    [userId, key],
  );

  return result.rows[0]?.payload_json ?? null;
}

export async function setProviderBalanceSnapshot(
  userId: string,
  key: string,
  payload: unknown,
) {
  await ensureSyncStorageSchema();
  await pgQuery(
    `insert into user_provider_balance_snapshots (user_id, balance_key, payload_json)
     values ($1, $2, $3::jsonb)
     on conflict (user_id, balance_key) do update set
       payload_json = excluded.payload_json,
       updated_at = now()`,
    [userId, key, JSON.stringify(payload ?? {})],
  );
}
