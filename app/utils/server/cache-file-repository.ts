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

export async function getCacheFileMeta(externalUserId: string, id: string) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await pgQuery<{
    file_name: string;
    file_ext: string;
    content_type: string;
    size_bytes: number;
  }>(
    `select
       f.file_name,
       f.file_ext,
       f.content_type,
       f.size_bytes
     from user_cache_files f
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
  };
}

/**
 * 按 UUID 查询缓存文件元数据（不限定 user_id）。
 *
 * ⚠️ 内容寻址公共访问：同一 UUID 对应同一份不可变内容（content-addressable），
 * 因此任何拿到该 UUID 的已认证用户都可以读取，用于跨用户共享同一张图片/文件。
 * 安全前提是 UUID 不可猜测（128 bit 随机），不能依赖此函数隐藏私有数据。
 *
 * 调用方必须先做身份认证（requireAuthContext），传入 externalUserId 用于审计。
 */
export async function getCacheFileMetaById(externalUserId: string, id: string) {
  await ensureSyncStorageSchema();
  await getOrCreateSyncAppUserId(externalUserId);
  const result = await pgQuery<{
    file_name: string;
    file_ext: string;
    content_type: string;
    size_bytes: number;
  }>(
    `select
       f.file_name,
       f.file_ext,
       f.content_type,
       f.size_bytes
     from user_cache_files f
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
  };
}

export async function getCacheFileChunk(
  externalUserId: string,
  id: string,
  offset: number,
  length: number,
) {
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
       substring(coalesce(f.data, b.data) from $3::int + 1 for $4::int) as data
     from user_cache_files f
     left join cache_file_blobs b on b.id = f.blob_id
     where f.id = $1::uuid and f.user_id = $2::uuid
       and (f.is_pinned = true or f.expires_at > now())
     limit 1`,
    [id, userId, Math.max(0, offset), Math.max(0, length)],
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

/**
 * 按 UUID 查询缓存文件二进制（不限定 user_id）。内容寻址公共访问，
 * 安全前提是 UUID 不可猜测；调用方必须传入已认证 externalUserId 用于审计。
 */
export async function getCacheFileById(externalUserId: string, id: string) {
  await ensureSyncStorageSchema();
  await getOrCreateSyncAppUserId(externalUserId);
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

export async function getCacheFileChunkById(
  externalUserId: string,
  id: string,
  offset: number,
  length: number,
) {
  await ensureSyncStorageSchema();
  await getOrCreateSyncAppUserId(externalUserId);
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
       substring(coalesce(f.data, b.data) from $2::int + 1 for $3::int) as data
     from user_cache_files f
     left join cache_file_blobs b on b.id = f.blob_id
     where f.id = $1::uuid
       and (f.is_pinned = true or f.expires_at > now())
     limit 1`,
    [id, Math.max(0, offset), Math.max(0, length)],
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
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const excludeExternalSessionIds = (
    options?.excludeExternalSessionIds || []
  ).filter(Boolean);
  // 优先用 cache_file_references 表（写入消息时 upsert）做 O(1) 引用判断，
  // 仅在历史消息未登记引用时回退到 LIKE 全表扫。新建消息一律走引用表，
  // 该回退分支预计只会出现在升级前的旧消息上。
  const referenced = await pgQuery<{ exists: boolean }>(
    `select exists (
       select 1
       from cache_file_references r
       join messages m on m.id = r.message_id
       join conversations c on c.id = m.conversation_id
       where r.cache_file_id = $1::uuid
         and not (
           coalesce(c.external_session_id, '') = any($2::text[])
         )
       limit 1
     ) as exists`,
    [id, excludeExternalSessionIds],
  );
  let isReferenced = referenced.rows[0]?.exists === true;
  if (!isReferenced) {
    // 回退：历史消息（升级前）没有写 cache_file_references，必须用 LIKE 兜底。
    // 时间窗口 30 天已经覆盖绝大多数场景，避免 conversations×messages 全表扫。
    const legacyReferenced = await pgQuery<{ exists: boolean }>(
      `select exists (
         select 1
         from messages m
         join conversations c on c.id = m.conversation_id
         where m.updated_at > now() - interval '30 days'
           and (
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
    isReferenced = legacyReferenced.rows[0]?.exists === true;
  }
  if (isReferenced) {
    return;
  }
  await pgQuery(
    `delete from user_cache_files
     where id = $1::uuid
       and user_id = $2::uuid`,
    [id, userId],
  );
  await purgeOrphanCacheFileBlobs();
}

/**
 * 记录某条消息对缓存文件的引用。仅当消息 content_json / metadata_json 中
 * 真的包含 cache_file_id 时才调用，避免无意义膨胀 references 表。
 */
export async function recordCacheFileReferences(
  externalUserId: string,
  params: { messageId: string; contentJson: unknown; metadataJson?: unknown },
) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const ids = extractCacheFileIds(params.contentJson).concat(
    extractCacheFileIds(params.metadataJson),
  );
  if (ids.length === 0) return;
  // 同一 messageId 可能被多次 upsert（update on conflict 路径），用
  // on conflict do update 保证 last_seen_at 是最新一次引用时间。
  await pgQuery(
    `insert into cache_file_references (cache_file_id, user_id, message_id)
     select unnest($1::uuid[]), $2::uuid, $3::uuid
     on conflict (cache_file_id, message_id) do update
       set last_seen_at = now()`,
    [ids, userId, params.messageId],
  );
}

function extractCacheFileIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      // 缓存文件 URL 形如 /api/cache/<uuid>，从中提取 UUID
      const matches = value.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      );
      if (matches) matches.forEach((id) => ids.add(id.toLowerCase()));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };
  visit(payload);
  return Array.from(ids);
}

export async function commitCacheFiles(externalUserId: string, ids: string[]) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const cleaned = ids.filter(Boolean).slice(0, 80);
  if (cleaned.length === 0) return;
  // 必须限定 user_id，避免登录用户 pin 任意其他用户的缓存文件
  await pgQuery(
    `update user_cache_files
     set is_pinned = true,
         expires_at = expires_at
     where id = any($1::uuid[])
       and user_id = $2::uuid`,
    [cleaned, userId],
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
