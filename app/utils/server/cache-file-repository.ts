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

async function purgeOrphanCacheFileBlobs() {
  await pgQuery(
    `delete from cache_file_blobs b
     where not exists (
       select 1
       from user_cache_files f
       where f.blob_id = b.id
     )`,
  );
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

  const blobResult = await pgQuery<{
    id: string;
    content_md5: string;
  }>(
    `insert into cache_file_blobs (
       content_type,
       content_md5,
       size_bytes,
       data
     ) values (
       $1::text,
       md5($2::bytea),
       $3::int,
       $2::bytea
     )
     on conflict (content_type, content_md5)
     do update set
       size_bytes = cache_file_blobs.size_bytes
     returning id::text as id, content_md5`,
    [contentType, data, sizeBytes],
  );
  const blob = blobResult.rows[0];
  if (!blob) return null;

  const existingPinned = await pgQuery<{ id: string; file_ext: string }>(
    `select id::text as id, file_ext
     from user_cache_files
     where blob_id = $1::uuid
       and is_pinned = true
     order by created_at asc
     limit 1`,
    [blob.id],
  );
  const existingPinnedRow = existingPinned.rows[0];
  if (existingPinnedRow) {
    return {
      id: existingPinnedRow.id,
      fileExt: existingPinnedRow.file_ext || fileExt,
    };
  }

  const existingDraft = await pgQuery<{ id: string; file_ext: string }>(
    `update user_cache_files
     set file_name = $3::text,
         file_ext = $4::text,
         content_type = $5::text,
         size_bytes = $6::int,
         content_md5 = $7::text,
         expires_at = now() + interval '3 days'
     where id = (
       select id
       from user_cache_files
       where user_id = $1::uuid
         and blob_id = $2::uuid
         and is_pinned = false
       order by created_at asc
       limit 1
     )
     returning id::text as id, file_ext`,
    [
      userId,
      blob.id,
      fileName,
      fileExt,
      contentType,
      sizeBytes,
      blob.content_md5,
    ],
  );
  const existingDraftRow = existingDraft.rows[0];
  if (existingDraftRow) {
    return {
      id: existingDraftRow.id,
      fileExt: existingDraftRow.file_ext || fileExt,
    };
  }

  const result = await pgQuery<{ id: string; file_ext: string }>(
    `insert into user_cache_files (
       user_id,
       file_name,
       file_ext,
       content_type,
       size_bytes,
       data,
       blob_id,
       content_md5
     ) values (
       $1::uuid,
       $2::text,
       $3::text,
       $4::text,
       $5::int,
       null,
       $6::uuid,
       $7::text
     )
     returning id::text as id, file_ext`,
    [
      userId,
      fileName,
      fileExt,
      contentType,
      sizeBytes,
      blob.id,
      blob.content_md5,
    ],
  );

  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, fileExt: row.file_ext || "" };
}

export async function resolveExistingCacheFileByHash(
  externalUserId: string,
  params: { fileName: string; contentType: string; contentMd5: string },
) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const fileName = String(params.fileName || "file");
  const contentType = String(params.contentType || "application/octet-stream");
  const contentMd5 = String(params.contentMd5 || "")
    .trim()
    .toLowerCase();
  const fileExt = getSafeFileExt(fileName, contentType);
  if (!/^[a-f0-9]{32}$/.test(contentMd5)) {
    return null;
  }

  const blobResult = await pgQuery<{ id: string; size_bytes: number }>(
    `select id::text as id, size_bytes
     from cache_file_blobs
     where content_type = $1::text
       and content_md5 = $2::text
     limit 1`,
    [contentType, contentMd5],
  );
  const blob = blobResult.rows[0];
  if (!blob) return null;

  const existingPinned = await pgQuery<{ id: string; file_ext: string }>(
    `select id::text as id, file_ext
     from user_cache_files
     where blob_id = $1::uuid
       and is_pinned = true
     order by created_at asc
     limit 1`,
    [blob.id],
  );
  const existingPinnedRow = existingPinned.rows[0];
  if (existingPinnedRow) {
    return {
      id: existingPinnedRow.id,
      fileExt: existingPinnedRow.file_ext || fileExt,
    };
  }

  const existingDraft = await pgQuery<{ id: string; file_ext: string }>(
    `update user_cache_files
     set file_name = $3::text,
         file_ext = $4::text,
         content_type = $5::text,
         size_bytes = $6::int,
         content_md5 = $7::text,
         expires_at = now() + interval '3 days'
     where id = (
       select id
       from user_cache_files
       where user_id = $1::uuid
         and blob_id = $2::uuid
         and is_pinned = false
       order by created_at asc
       limit 1
     )
     returning id::text as id, file_ext`,
    [
      userId,
      blob.id,
      fileName,
      fileExt,
      contentType,
      blob.size_bytes,
      contentMd5,
    ],
  );
  const existingDraftRow = existingDraft.rows[0];
  if (existingDraftRow) {
    return {
      id: existingDraftRow.id,
      fileExt: existingDraftRow.file_ext || fileExt,
    };
  }

  const result = await pgQuery<{ id: string; file_ext: string }>(
    `insert into user_cache_files (
       user_id,
       file_name,
       file_ext,
       content_type,
       size_bytes,
       data,
       blob_id,
       content_md5
     ) values (
       $1::uuid,
       $2::text,
       $3::text,
       $4::text,
       $5::int,
       null,
       $6::uuid,
       $7::text
     )
     returning id::text as id, file_ext`,
    [
      userId,
      fileName,
      fileExt,
      contentType,
      blob.size_bytes,
      blob.id,
      contentMd5,
    ],
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
    `select
       f.file_name,
       f.file_ext,
       f.content_type,
       f.size_bytes,
       coalesce(f.data, b.data) as data
     from user_cache_files f
     left join cache_file_blobs b on b.id = f.blob_id
     where f.id = $1::uuid and f.user_id = $2::uuid
       and (f.is_pinned = true or f.expires_at > now())
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

export async function getCacheFileById(id: string) {
  await ensureSyncStorageSchema();
  const result = await pgQuery<{
    file_name: string;
    file_ext: string;
    content_type: string;
    size_bytes: number;
    data: Buffer;
  }>(
    `select
       f.file_name,
       f.file_ext,
       f.content_type,
       f.size_bytes,
       coalesce(f.data, b.data) as data
     from user_cache_files f
     left join cache_file_blobs b on b.id = f.blob_id
     where f.id = $1::uuid
       and (f.is_pinned = true or f.expires_at > now())
     limit 1`,
    [id],
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
    `delete from user_cache_files
     where id = $1::uuid
       and user_id = $2::uuid
       and is_pinned = false`,
    [id, userId],
  );
  await purgeOrphanCacheFileBlobs();
}

export async function removeOwnedCacheFile(
  externalUserId: string,
  id: string,
  options?: { excludeExternalSessionIds?: string[] },
) {
  await ensureSyncStorageSchema();
  await getOrCreateSyncAppUserId(externalUserId);
  const excludeExternalSessionIds = (
    options?.excludeExternalSessionIds || []
  ).filter(Boolean);
  const referenced = await pgQuery<{ exists: boolean }>(
    `select exists (
       select 1
       from messages m
       join conversations c on c.id = m.conversation_id
       where (
         m.content_json::text like '%' || $1::text || '%'
         or m.metadata_json::text like '%' || $1::text || '%'
       )
       and not (
         coalesce(c.external_session_id, '') = any($2::text[])
       )
       limit 1
     ) as exists`,
    [id, excludeExternalSessionIds],
  );
  if (referenced.rows[0]?.exists) {
    return;
  }
  await pgQuery(
    `delete from user_cache_files
     where id = $1::uuid`,
    [id],
  );
  await purgeOrphanCacheFileBlobs();
}

export async function commitCacheFiles(externalUserId: string, ids: string[]) {
  await ensureSyncStorageSchema();
  await getOrCreateSyncAppUserId(externalUserId);
  const cleaned = ids.filter(Boolean).slice(0, 80);
  if (cleaned.length === 0) return;
  await pgQuery(
    `update user_cache_files
     set is_pinned = true,
         expires_at = expires_at
     where id = any($1::uuid[])`,
    [cleaned],
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
  await purgeOrphanCacheFileBlobs();
}
