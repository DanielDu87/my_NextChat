import { ensureSyncStorageSchema, pgQuery } from "./postgres";
import { getOrCreateSyncAppUserId } from "./sync-app-user";

export async function createDrawImage(
  externalUserId: string,
  params: { contentType: string; data: Buffer },
) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const contentType = String(params.contentType || "application/octet-stream");
  const data = params.data;
  const sizeBytes = data.length;

  const result = await pgQuery<{ id: string }>(
    `insert into user_draw_images (
       user_id,
       content_type,
       size_bytes,
       data
     ) values (
       $1::uuid,
       $2::text,
       $3::int,
       $4::bytea
     )
     returning id::text as id`,
    [userId, contentType, sizeBytes, data],
  );

  return result.rows[0]?.id || "";
}

export async function createDrawImageWithThumb(
  externalUserId: string,
  params: { contentType: string; data: Buffer; thumbData: Buffer | null },
) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const contentType = String(params.contentType || "application/octet-stream");
  const data = params.data;
  const thumbData = params.thumbData;
  const sizeBytes = data.length;

  const result = await pgQuery<{ id: string }>(
    `insert into user_draw_images (
       user_id,
       content_type,
       size_bytes,
       data,
       thumb_data
     ) values (
       $1::uuid,
       $2::text,
       $3::int,
       $4::bytea,
       $5::bytea
     )
     returning id::text as id`,
    [userId, contentType, sizeBytes, data, thumbData],
  );

  return result.rows[0]?.id || "";
}

export async function getDrawImage(externalUserId: string, id: string) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await pgQuery<{ content_type: string; data: Buffer }>(
    `select content_type, data
     from user_draw_images
     where id = $1::uuid and user_id = $2::uuid
     limit 1`,
    [id, userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    contentType: row.content_type,
    data: row.data,
  };
}

export async function getDrawImageWithThumb(
  externalUserId: string,
  id: string,
) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await pgQuery<{
    content_type: string;
    data: Buffer;
    thumb_data: Buffer | null;
  }>(
    `select content_type, data, thumb_data
     from user_draw_images
     where id = $1::uuid and user_id = $2::uuid
     limit 1`,
    [id, userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    contentType: row.content_type,
    data: row.data,
    thumbData: row.thumb_data,
  };
}

// 仅查询缩略图，避免把整张原图 bytea（TOAST 大字段）也读出来，
// 让 ?thumb=1 缩略图请求更快、更省内存。
export async function getDrawImageThumb(externalUserId: string, id: string) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await pgQuery<{
    content_type: string;
    thumb_data: Buffer | null;
  }>(
    `select content_type, thumb_data
     from user_draw_images
     where id = $1::uuid and user_id = $2::uuid
     limit 1`,
    [id, userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    contentType: row.content_type,
    thumbData: row.thumb_data,
  };
}

export async function updateDrawImageThumb(
  externalUserId: string,
  id: string,
  thumbData: Buffer,
) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  await pgQuery(
    `update user_draw_images
     set thumb_data = $3::bytea
     where id = $1::uuid and user_id = $2::uuid`,
    [id, userId, thumbData],
  );
}

export async function removeDrawImage(externalUserId: string, id: string) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  await pgQuery(
    `delete from user_draw_images
     where id = $1::uuid and user_id = $2::uuid`,
    [id, userId],
  );
}
