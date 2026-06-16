import { createHash } from "crypto";
import { ensureSyncStorageSchema, pgQuery } from "./postgres";
import { getOrCreateSyncAppUserId } from "./sync-app-user";
import {
  buildPersistedStoreState,
  unwrapPersistedStoreState,
} from "@/app/utils/sync-store-keys";
import { StoreKey } from "@/app/constant";

type QueryFn = (text: string, params?: unknown[]) => Promise<unknown>;

function toJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function normalizeDrawStoreState(payload: unknown) {
  return unwrapPersistedStoreState(payload);
}

function buildDrawStorePayload(state: unknown) {
  return buildPersistedStoreState(StoreKey.DrawList, state);
}

export async function setDrawStoreSnapshot(
  externalUserId: string,
  payload: unknown,
  query?: QueryFn,
) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const runQuery = query ?? pgQuery;

  await runQuery(
    `insert into user_draw_stores (
       user_id,
       payload_json
     ) values (
       $1::uuid,
       $2::jsonb
     )
     on conflict (user_id) do update set
       payload_json = excluded.payload_json,
       updated_at = now()`,
    [userId, toJson(normalizeDrawStoreState(payload))],
  );
}

export async function getDrawStoreSnapshot(externalUserId: string) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);

  const result = await pgQuery<{ payload_json: unknown }>(
    `select payload_json
     from user_draw_stores
     where user_id = $1::uuid
     limit 1`,
    [userId],
  );

  const payload = result.rows[0]?.payload_json;
  return payload === undefined
    ? undefined
    : buildDrawStorePayload(normalizeDrawStoreState(payload));
}

export async function removeDrawStoreSnapshot(externalUserId: string) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);

  await pgQuery(
    `delete from user_draw_stores
     where user_id = $1::uuid`,
    [userId],
  );
}

export async function getDrawStoreSnapshotMeta(externalUserId: string) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);

  const result = await pgQuery<{
    updated_at: string;
    payload_text: string;
    size_bytes: number;
  }>(
    `select
       updated_at::text as updated_at,
       payload_json::text as payload_text,
       pg_column_size(payload_json) as size_bytes
     from user_draw_stores
     where user_id = $1::uuid
     limit 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return undefined;

  return {
    key: "draw-list",
    updatedAt: row.updated_at,
    checksum: createHash("md5").update(row.payload_text).digest("hex"),
    sizeBytes: row.size_bytes,
  };
}
