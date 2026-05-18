import { pgQuery } from "./postgres";

export async function getOrCreateSyncAppUserId(externalUserId: string) {
  const normalizedExternalUserId = String(externalUserId || "").trim();
  if (!normalizedExternalUserId) {
    throw new Error("[SyncAppUser] externalUserId 不能为空");
  }

  const existing = await pgQuery<{ id: string }>(
    `select id::text as id
     from app_users
     where external_id = $1
     limit 1`,
    [normalizedExternalUserId],
  );

  if (existing.rows[0]?.id) {
    return existing.rows[0].id;
  }

  const inserted = await pgQuery<{ id: string }>(
    `insert into app_users (external_id, display_name)
     values ($1, $2)
     on conflict (external_id) do update set
       updated_at = now()
     returning id::text as id`,
    [normalizedExternalUserId, normalizedExternalUserId],
  );

  return inserted.rows[0].id;
}
