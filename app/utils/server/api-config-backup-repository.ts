import { createHash } from "crypto";
import {
  ensureSyncStorageSchema,
  pgQuery,
  withPgTransaction,
} from "./postgres";
import { getOrCreateSyncAppUserId } from "./sync-app-user";
import {
  decryptSyncSecretPayload,
  encryptSyncSecretPayload,
} from "./sync-secrets";

export type ApiConfigBackupSource = "auto" | "manual" | "pre_restore";

export const API_CONFIG_BACKUP_PAYLOAD_SCHEMA = 2;

export type ApiConfigBalanceEntry = {
  providerCode: string;
  encryptedManagementKey: string | null;
  maskedManagementKey: string | null;
  balanceSnapshot: unknown;
  lastError: string | null;
  queriedAt: string | null;
};

export type ApiConfigBackupPayloadV2 = {
  schema: 2;
  state: unknown;
  balanceEntries: ApiConfigBalanceEntry[];
};

export type ApiConfigBackupPayload = unknown;

function checksum(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function unwrapState(payload: any) {
  return payload?.state && typeof payload.state === "object"
    ? payload.state
    : payload;
}

function profileCount(payload: any) {
  const state = unwrapState(payload);
  return Array.isArray(state?.apiProfiles) ? state.apiProfiles.length : 0;
}

export function readBalanceEntriesFromPayload(
  payload: any,
): ApiConfigBalanceEntry[] {
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    payload.schema === API_CONFIG_BACKUP_PAYLOAD_SCHEMA &&
    Array.isArray(payload.balanceEntries)
  ) {
    return payload.balanceEntries as ApiConfigBalanceEntry[];
  }
  return [];
}

async function loadProviderBalanceEntries(
  externalUserId: string,
): Promise<ApiConfigBalanceEntry[]> {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await pgQuery<{
    provider_code: string;
    encrypted_management_key: string | null;
    masked_management_key: string | null;
    balance_snapshot: unknown;
    last_error: string | null;
    queried_at: string | null;
  }>(
    `select pc.provider_code,
            pbc.encrypted_management_key,
            pbc.masked_management_key,
            pbc.balance_snapshot,
            pbc.last_error,
            pbc.queried_at::text as queried_at
       from provider_configs pc
       left join provider_balance_configs pbc on pbc.provider_config_id = pc.id
      where pc.user_id = $1::uuid
      order by pc.provider_code`,
    [userId],
  );
  return result.rows.map((row) => ({
    providerCode: row.provider_code,
    encryptedManagementKey: row.encrypted_management_key,
    maskedManagementKey: row.masked_management_key,
    balanceSnapshot: row.balance_snapshot ?? null,
    lastError: row.last_error ?? null,
    queriedAt: row.queried_at ?? null,
  }));
}

export async function buildApiConfigBackupPayload(
  externalUserId: string,
  state: unknown,
): Promise<ApiConfigBackupPayloadV2> {
  return {
    schema: API_CONFIG_BACKUP_PAYLOAD_SCHEMA,
    state,
    balanceEntries: await loadProviderBalanceEntries(externalUserId),
  };
}

export async function writeApiConfigBalanceEntries(
  externalUserId: string,
  entries: ApiConfigBalanceEntry[],
) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  await withPgTransaction(async (client) => {
    for (const entry of entries) {
      if (!entry?.providerCode) continue;
      const target = await client.query<{ id: string }>(
        `select id::text as id from provider_configs
          where user_id = $1::uuid and provider_code = $2 limit 1`,
        [userId, entry.providerCode],
      );
      const providerConfigId = target.rows[0]?.id;
      if (!providerConfigId) {
        console.warn(
          "[API Config Backup] 跳过余额条目，找不到对应 provider_config",
          { providerCode: entry.providerCode },
        );
        continue;
      }
      const encrypted = entry.encryptedManagementKey
        ? (() => {
            try {
              return encryptSyncSecretPayload(
                decryptSyncSecretPayload(entry.encryptedManagementKey),
              );
            } catch {
              // 历史脏数据：原密文已损坏时直接落空，避免恢复阻塞
              return null;
            }
          })()
        : null;
      await client.query(
        `insert into provider_balance_configs (
           provider_config_id,
           encrypted_management_key,
           masked_management_key,
           balance_snapshot,
           last_error,
           queried_at
         ) values ($1::uuid, $2, $3, $4::jsonb, $5, $6::timestamptz)
         on conflict (provider_config_id) do update set
           encrypted_management_key = excluded.encrypted_management_key,
           masked_management_key = excluded.masked_management_key,
           balance_snapshot = excluded.balance_snapshot,
           last_error = excluded.last_error,
           queried_at = excluded.queried_at,
           updated_at = now()`,
        [
          providerConfigId,
          encrypted,
          entry.maskedManagementKey ?? null,
          entry.balanceSnapshot === null || entry.balanceSnapshot === undefined
            ? null
            : JSON.stringify(entry.balanceSnapshot),
          entry.lastError ?? null,
          entry.queriedAt ?? null,
        ],
      );
    }
  });
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
