import { createHash } from "crypto";
import { ensureSyncStorageSchema, pgQuery } from "./postgres";
import { getOrCreateSyncAppUserId } from "./sync-app-user";

export type ApiConfigBackupSource = "auto" | "manual" | "pre_restore";

function checksum(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function profileCount(payload: any) {
  const state =
    payload?.state && typeof payload.state === "object"
      ? payload.state
      : payload;
  return Array.isArray(state?.apiProfiles) ? state.apiProfiles.length : 0;
}

export async function getApiConfigBackupSettings(externalUserId: string) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await pgQuery<{
    enabled: boolean;
    interval_minutes: number;
    max_backups: number;
  }>(
    `select enabled, interval_minutes, max_backups
     from api_config_backup_settings where user_id = $1::uuid`,
    [userId],
  );
  const row = result.rows[0];
  return {
    enabled: row?.enabled ?? true,
    intervalMinutes: row?.interval_minutes ?? 1440,
    maxBackups: row?.max_backups ?? 10,
  };
}

export async function saveApiConfigBackupSettings(
  externalUserId: string,
  settings: { enabled: boolean; intervalMinutes: number; maxBackups: number },
) {
  console.log("[API Config] ⚙️ 开始保存自动备份设置", settings);
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  await pgQuery(
    `insert into api_config_backup_settings (user_id, enabled, interval_minutes, max_backups)
     values ($1::uuid, $2, $3, $4)
     on conflict (user_id) do update set
       enabled = excluded.enabled,
       interval_minutes = excluded.interval_minutes,
       max_backups = excluded.max_backups`,
    [userId, settings.enabled, settings.intervalMinutes, settings.maxBackups],
  );
  await pruneApiConfigBackups(externalUserId, settings.maxBackups);
  console.log("[API Config] ✅ 自动备份设置已保存");
  return settings;
}

export async function listApiConfigBackups(externalUserId: string) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await pgQuery<{
    id: string;
    source: ApiConfigBackupSource;
    profile_count: number;
    created_at: string;
  }>(
    `select id::text, source,
       jsonb_array_length(
         case
           when jsonb_typeof(payload_json -> 'state' -> 'apiProfiles') = 'array'
             then payload_json -> 'state' -> 'apiProfiles'
           when jsonb_typeof(payload_json -> 'apiProfiles') = 'array'
             then payload_json -> 'apiProfiles'
           else '[]'::jsonb
         end
       ) as profile_count,
       created_at::text
     from api_config_backups where user_id = $1::uuid
     order by created_at desc`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    source: row.source,
    profileCount: row.profile_count,
    createdAt: row.created_at,
  }));
}

export async function createApiConfigBackup(
  externalUserId: string,
  payload: unknown,
  source: ApiConfigBackupSource,
) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const settings = await getApiConfigBackupSettings(externalUserId);
  const digest = checksum(payload);
  const count = profileCount(payload);
  console.log("[API Config] 💾 准备创建配置备份", {
    来源: source,
    配置数量: count,
  });
  if (source === "auto") {
    if (!settings.enabled) {
      console.log("[API Config] ⏭️ 自动备份已关闭，跳过本次备份");
      return { created: false, reason: "disabled" };
    }
    const latest = await pgQuery<{ checksum: string; created_at: string }>(
      `select checksum, created_at::text from api_config_backups
       where user_id = $1::uuid order by created_at desc limit 1`,
      [userId],
    );
    const row = latest.rows[0];
    if (row?.checksum === digest) {
      console.log("[API Config] ⏭️ API配置未变化，跳过重复备份");
      return { created: false, reason: "unchanged" };
    }
    if (
      row &&
      Date.now() - new Date(row.created_at).getTime() <
        settings.intervalMinutes * 60_000
    ) {
      console.log("[API Config] ⏭️ 未达到自动备份间隔，跳过本次备份", {
        备份间隔分钟: settings.intervalMinutes,
      });
      return { created: false, reason: "interval" };
    }
  }
  const result = await pgQuery<{ id: string }>(
    `insert into api_config_backups
       (user_id, source, payload_json, checksum, profile_count)
     values ($1::uuid, $2, $3::jsonb, $4, $5) returning id::text`,
    [userId, source, JSON.stringify(payload), digest, count],
  );
  await pruneApiConfigBackups(externalUserId, settings.maxBackups);
  console.log("[API Config] ✅ 配置备份已写入PostgreSQL", {
    备份ID: result.rows[0].id,
    来源: source,
    配置数量: count,
  });
  return { created: true, id: result.rows[0].id };
}

export async function pruneApiConfigBackups(
  externalUserId: string,
  max: number,
) {
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await pgQuery(
    `delete from api_config_backups where id in (
       select id from api_config_backups where user_id = $1::uuid
       order by created_at desc offset $2
     )`,
    [userId, max],
  );
  if ((result.rowCount ?? 0) > 0) {
    console.log("[API Config] 🧹 已清理超出保留数量的旧备份", {
      删除数量: result.rowCount,
      最大保留数量: max,
    });
  }
}

export async function deleteApiConfigBackup(
  externalUserId: string,
  id: string,
) {
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await pgQuery(
    `delete from api_config_backups where id = $1::uuid and user_id = $2::uuid`,
    [id, userId],
  );
  console.log("[API Config] 🗑️ 删除配置备份结果", {
    备份ID: id,
    已删除: (result.rowCount ?? 0) > 0,
  });
  return (result.rowCount ?? 0) > 0;
}

export async function getApiConfigBackupPayload(
  externalUserId: string,
  id: string,
) {
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await pgQuery<{ payload_json: unknown }>(
    `select payload_json from api_config_backups
     where id = $1::uuid and user_id = $2::uuid`,
    [id, userId],
  );
  return result.rows[0]?.payload_json;
}
