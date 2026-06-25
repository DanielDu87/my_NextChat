import { ensureSyncStorageSchema, pgQuery } from "./postgres";
import { getOrCreateSyncAppUserId } from "./sync-app-user";

function getSafeFileExt(name: string, contentType: string) {
  const normalizedName = String(name || "");
  const parts = normalizedName.split(".");
  const fromName =
    parts.length > 1 ? `.${parts[parts.length - 1].toLowerCase()}` : "";
  if (fromName && fromName.length <= 12 && /^[.\w-]+$/.test(fromName)) {
    return fromName;
  }
  const normalizedType = String(contentType || "").toLowerCase();
  const fromType = normalizedType.includes("/")
    ? `.${normalizedType.split("/").pop()}`
    : "";
  if (fromType && fromType.length <= 12 && /^[.\w-]+$/.test(fromType)) {
    return fromType;
  }
  return "";
}

export async function createCacheFile(
  externalUserId: string,
  params: { fileName: string; contentType: string; data: Buffer },
) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const fileName = String(params.fileName || "file");
  const contentType = String(params.contentType || "application/octet-stream");
  const data = params.data;
  const sizeBytes = data.length;
  const fileExt = getSafeFileExt(fileName, contentType);

  const result = await pgQuery<{ id: string; file_ext: string }>(
    `insert into user_cache_files (
       user_id,
       file_name,
       file_ext,
       content_type,
       size_bytes,
       data
     ) values (
       $1::uuid,
       $2::text,
       $3::text,
       $4::text,
       $5::int,
       $6::bytea
     )
     on conflict (user_id, content_type, md5(data))
     do update set
       file_name = excluded.file_name,
       file_ext = excluded.file_ext,
       size_bytes = excluded.size_bytes,
       expires_at = case
         when user_cache_files.is_pinned then user_cache_files.expires_at
         else now() + interval '3 days'
       end
     returning id::text as id, file_ext`,
    [userId, fileName, fileExt, contentType, sizeBytes, data],
  );

  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, fileExt: row.file_ext || "" };
}

export async function getCacheFile(externalUserId: string, id: string) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await pgQuery<{
    file_name: string;
    file_ext: string;
    content_type: string;
    size_bytes: number;
    data: Buffer;
  }>(
    `select file_name, file_ext, content_type, size_bytes, data
     from user_cache_files
     where id = $1::uuid and user_id = $2::uuid
       and (is_pinned = true or expires_at > now())
     limit 1`,
    [id, userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    fileName: row.file_name,
    fileExt: row.file_ext,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    data: row.data,
  };
}

export async function removeCacheFile(externalUserId: string, id: string) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  await pgQuery(
    `delete from user_cache_files where id = $1::uuid and user_id = $2::uuid`,
    [id, userId],
  );
}

export async function commitCacheFiles(externalUserId: string, ids: string[]) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const cleaned = ids.filter(Boolean).slice(0, 80);
  if (cleaned.length === 0) return;
  await pgQuery(
    `update user_cache_files
     set is_pinned = true,
         expires_at = expires_at
     where user_id = $1::uuid
       and id = any($2::uuid[])`,
    [userId, cleaned],
  );
}

export async function purgeExpiredCacheFiles(externalUserId: string) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  await pgQuery(
    `delete from user_cache_files
     where id in (
       select id
       from user_cache_files
       where user_id = $1::uuid
         and is_pinned = false
         and expires_at <= now()
       limit 200
     )`,
    [userId],
  );
}
