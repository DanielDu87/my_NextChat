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

export async function removeDrawImage(externalUserId: string, id: string) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  await pgQuery(
    `delete from user_draw_images
     where id = $1::uuid and user_id = $2::uuid`,
    [id, userId],
  );
}
