import { pgQuery } from "./postgres";

declare global {
  // externalId -> app_users.id 进程内缓存。该映射创建后保持稳定，
  // 缓存可避免每个请求（尤其是 draw 图片/缩略图请求）都查一次 app_users。
  var __nextchatSyncAppUserIdCache: Map<string, string> | undefined;
}

function getSyncAppUserIdCache() {
  if (!globalThis.__nextchatSyncAppUserIdCache) {
    globalThis.__nextchatSyncAppUserIdCache = new Map<string, string>();
  }
  return globalThis.__nextchatSyncAppUserIdCache;
}

export async function getOrCreateSyncAppUserId(externalUserId: string) {
  const normalizedExternalUserId = String(externalUserId || "").trim();
  if (!normalizedExternalUserId) {
    throw new Error("[SyncAppUser] externalUserId 不能为空");
  }

  const cache = getSyncAppUserIdCache();
  const cached = cache.get(normalizedExternalUserId);
  if (cached) {
    return cached;
  }

  const existing = await pgQuery<{ id: string }>(
    `select id::text as id
     from app_users
     where external_id = $1
     limit 1`,
    [normalizedExternalUserId],
  );

  if (existing.rows[0]?.id) {
    cache.set(normalizedExternalUserId, existing.rows[0].id);
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

  const id = inserted.rows[0].id;
  cache.set(normalizedExternalUserId, id);
  return id;
}
